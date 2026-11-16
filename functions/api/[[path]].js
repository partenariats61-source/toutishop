const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const fail = (message, status = 400) => json({ error: message }, status);
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const cookieValue = (request, name) => (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
const randomToken = (n = 32) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
async function passwordHash(password, salt = randomToken(16)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$100000$${salt}$${Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('')}`;
}
async function passwordOK(password, stored) {
  const [kind, rounds, salt, expected] = String(stored).split('$');
  if (kind !== 'pbkdf2' || rounds !== '100000' || !salt || !expected) return false;
  const actual = await passwordHash(password, salt);
  return actual.split('$')[3] === expected;
}
async function currentUser(request, env) {
  const raw = cookieValue(request, 'toutishop_session');
  if (!raw) return null;
  return await env.TOUTISHOP_DB.prepare(`SELECT u.id,u.email,u.name,u.role,u.approved,s.csrf,s.expires,s.token_hash
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`).bind(await digest(raw), Math.floor(Date.now() / 1000)).first();
}
async function requireRole(request, env, roles) {
  const user = await currentUser(request, env);
  if (!user) return { response: fail('Connexion requise', 401) };
  if (!roles.includes(user.role) || (user.role === 'partner' && !user.approved)) return { response: fail('Accès non autorisé', 403) };
  if (!['GET', 'HEAD'].includes(request.method) && user.csrf !== request.headers.get('X-CSRF-Token')) return { response: fail('Jeton de sécurité invalide', 403) };
  return { user };
}
const cookie = (raw, maxAge) => `toutishop_session=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
async function body(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 1_000_000) return null;
  try { return await request.json(); } catch { return null; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.TOUTISHOP_DB;
  if (!db) return fail('Base Cloudflare D1 non reliée à ce site.', 503);
  const path = new URL(request.url).pathname;
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, payments: 'manual_offline', suppliers: 'manual', database: 'd1', accounts: env.ENABLE_PUBLIC_ACCOUNTS === '1' ? 'open' : 'closed', orders: env.ENABLE_ORDERS === '1' ? 'open' : 'closed', public_ready: false });
  if (path === '/api/products' && request.method === 'GET') {
    const rows = await db.prepare("SELECT id,name,category,price,stock,description,image,is_demo FROM products WHERE status='approved' AND price IS NOT NULL ORDER BY id").all();
    return json(rows.results || []);
  }
  if (path === '/api/me' && request.method === 'GET') {
    const u = await currentUser(request, env);
    return json({ authenticated: !!u, user: u ? { id: u.id, email: u.email, name: u.name, role: u.role, approved: !!u.approved } : null, csrf: u?.csrf || null });
  }
  if (path === '/api/register' && request.method === 'POST') {
    if (env.ENABLE_PUBLIC_ACCOUNTS !== '1') return fail('Les créations de compte ouvriront au lancement de la boutique.', 403);
    const d = await body(request); if (!d) return fail('Requête invalide.');
    const email = String(d.email || '').trim().toLowerCase(), name = String(d.name || '').trim(), pw = String(d.password || ''), role = d.role || 'client';
    if (!name || !email.includes('@') || pw.length < 12 || !['client', 'partner'].includes(role)) return fail('Vérifiez les champs. Le mot de passe doit contenir au moins 12 caractères.');
    try {
      const result = await db.prepare('INSERT INTO users(email,name,password_hash,role,approved) VALUES(?,?,?,?,0)').bind(email, name, await passwordHash(pw), role).run();
      if (role === 'partner') await db.prepare('INSERT INTO applications(user_id,business_name,email,category,about) VALUES(?,?,?,?,?)').bind(result.meta.last_row_id, String(d.business_name || name), email, String(d.category || 'Autre'), String(d.about || '')).run();
      return json({ created: true, partnerApprovalRequired: role === 'partner' }, 201);
    } catch { return fail('Adresse e-mail déjà utilisée', 409); }
  }
  if (path === '/api/login' && request.method === 'POST') {
    const d = await body(request); if (!d) return fail('Requête invalide.');
    const email = String(d.email || '').trim().toLowerCase(), u = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    if (!u || !(await passwordOK(String(d.password || ''), u.password_hash))) return fail('Identifiants incorrects', 401);
    const raw = randomToken(), csrf = randomToken(), expires = Math.floor(Date.now() / 1000) + 7 * 86400;
    await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)').bind(await digest(raw), u.id, csrf, expires).run();
    return json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, approved: !!u.approved }, csrf }, 200, { 'Set-Cookie': cookie(raw, 7 * 86400) });
  }
  if (path === '/api/logout' && request.method === 'POST') {
    const auth = await requireRole(request, env, ['client', 'partner', 'admin']); if (auth.response) return auth.response;
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(auth.user.token_hash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (path === '/api/my/orders' && request.method === 'GET') {
    const auth = await requireRole(request, env, ['client', 'partner', 'admin']); if (auth.response) return auth.response;
    const rows = await db.prepare('SELECT reference,items_json,total,shipping,status,created_at FROM orders WHERE user_id=? ORDER BY id DESC').bind(auth.user.id).all();
    return json((rows.results || []).map(r => ({ ...r, items: JSON.parse(r.items_json) })));
  }
  if (path === '/api/partner/orders' && request.method === 'GET') {
    const auth = await requireRole(request, env, ['partner']); if (auth.response) return auth.response;
    const rows = await db.prepare(`SELECT o.reference,o.email,o.total,o.status,o.created_at,
      GROUP_CONCAT(p.name || ' x ' || l.quantity, ', ') items FROM orders o JOIN order_lines l ON l.order_id=o.id
      JOIN products p ON p.id=l.product_id WHERE l.partner_id=? AND o.status='paid' GROUP BY o.id ORDER BY o.id DESC`).bind(auth.user.id).all();
    return json(rows.results || []);
  }
  if (path.startsWith('/api/admin/')) {
    const auth = await requireRole(request, env, ['admin']); if (auth.response) return auth.response;
    if (path === '/api/admin/summary' && request.method === 'GET') {
      const [sales, margin, pending, orders, awaiting] = await Promise.all([
        db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='paid'").first(),
        db.prepare("SELECT COALESCE(SUM((unit_price-partner_cost)*quantity),0) n FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status='paid'").first(),
        db.prepare("SELECT COUNT(*) n FROM applications WHERE status='pending'").first(),
        db.prepare('SELECT COUNT(*) n FROM orders').first(),
        db.prepare("SELECT COUNT(*) n FROM orders WHERE status='awaiting_payment'").first(),
      ]);
      return json({ sales: sales.n, grossMargin: margin.n, pendingApplications: pending.n, orders: orders.n, awaitingPayment: awaiting.n, payments: 'manual_only' });
    }
    if (path === '/api/admin/orders' && request.method === 'GET') {
      const r = await db.prepare('SELECT id,reference,customer_name,email,address,items_json,total,shipping,status,created_at FROM orders ORDER BY id DESC').all();
      return json((r.results || []).map(x => ({ ...x, items: JSON.parse(x.items_json) })));
    }
    if (path === '/api/admin/products' && request.method === 'GET') {
      const r = await db.prepare('SELECT id,name,category,cost,price,stock,description,image,status,partner_id,is_demo FROM products ORDER BY id DESC').all(); return json(r.results || []);
    }
    if (path === '/api/admin/partner-balances' && request.method === 'GET') {
      const r = await db.prepare(`SELECT u.id,u.name,
        COALESCE((SELECT SUM(l.partner_cost*l.quantity) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.partner_id=u.id AND o.status='paid'),0) due,
        COALESCE((SELECT SUM(amount) FROM partner_payments p WHERE p.partner_id=u.id),0) paid
        FROM users u WHERE u.role='partner' GROUP BY u.id`).all();
      return json((r.results || []).map(x => ({ ...x, balance: x.due - x.paid })));
    }
    if (path === '/api/admin/applications' && request.method === 'GET') {
      const r = await db.prepare('SELECT * FROM applications ORDER BY id DESC').all(); return json(r.results || []);
    }
    if (path === '/api/admin/applications/review' && request.method === 'POST') {
      const d = await body(request); if (!d || !['approved','rejected'].includes(d.status)) return fail('Décision invalide.');
      const app = await db.prepare('SELECT user_id FROM applications WHERE id=?').bind(Number(d.id)).first(); if (!app) return fail('Dossier introuvable.', 404);
      await db.batch([
        db.prepare('UPDATE applications SET status=? WHERE id=?').bind(d.status, Number(d.id)),
        db.prepare('UPDATE users SET approved=? WHERE id=?').bind(d.status === 'approved' ? 1 : 0, app.user_id),
      ]);
      return json({ status: d.status });
    }
    if (path === '/api/admin/products/approve' && request.method === 'POST') {
      const d = await body(request), id = Number(d?.id), price = Number(d?.price);
      if (!Number.isInteger(id) || !Number.isFinite(price) || price <= 0) return fail('Produit ou tarif invalide.');
      const r = await db.prepare("UPDATE products SET price=?,status='approved' WHERE id=? AND status='pending'").bind(money(price), id).run();
      return r.meta.changes ? json({ approved: true }) : fail('Produit en attente introuvable.', 404);
    }
    if (path === '/api/admin/products/price' && request.method === 'PUT') {
      const d = await body(request), id = Number(d?.id), price = Number(d?.price);
      if (!Number.isInteger(id) || !Number.isFinite(price) || price <= 0) return fail('Tarif invalide.');
      const r = await db.prepare("UPDATE products SET price=? WHERE id=? AND status='approved'").bind(money(price), id).run();
      return r.meta.changes ? json({ updated: true }) : fail('Produit introuvable.', 404);
    }
    if (path === '/api/admin/payments' && request.method === 'POST') {
      const d = await body(request), partner = Number(d?.partner_id), amount = Number(d?.amount), paidOn = String(d?.paid_on || ''), proof = String(d?.proof_ref || '').trim();
      if (!Number.isInteger(partner) || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || !proof) return fail('Paiement invalide.');
      const p = await db.prepare("SELECT id FROM users WHERE id=? AND role='partner'").bind(partner).first(); if (!p) return fail('Partenaire introuvable.', 404);
      const totals = await db.prepare(`SELECT
        COALESCE((SELECT SUM(l.partner_cost*l.quantity) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.partner_id=? AND o.status='paid'),0) due,
        COALESCE((SELECT SUM(amount) FROM partner_payments WHERE partner_id=?),0) paid`).bind(partner, partner).first();
      if (amount > Math.max(0, totals.due - totals.paid) + 0.005) return fail('Le montant dépasse le solde partenaire disponible des commandes payées.');
      await db.prepare('INSERT INTO partner_payments(partner_id,amount,paid_on,proof_ref,invoice_ref) VALUES(?,?,?,?,?)').bind(partner, money(amount), paidOn, proof, String(d.invoice_ref || '')).run();
      return json({ recorded: true, automaticTransfer: false }, 201);
    }
    return fail('Route inconnue.', 404);
  }
  if (path === '/api/applications' && request.method === 'POST') {
    const auth = await requireRole(request, env, ['partner']); if (auth.response) return auth.response;
    const d = await body(request) || {};
    await db.prepare('INSERT INTO applications(user_id,business_name,email,category,about) VALUES(?,?,?,?,?)').bind(auth.user.id, String(d.business_name || auth.user.name), auth.user.email, String(d.category || 'Autre'), String(d.about || '')).run();
    return json({ status: 'pending' }, 201);
  }
  if (path === '/api/products' && request.method === 'POST') {
    const auth = await requireRole(request, env, ['partner']); if (auth.response) return auth.response;
    const d = await body(request); if (!d) return fail('Produit incomplet.');
    const name = String(d.name || '').trim(), category = String(d.category || '').trim(), cost = Number(d.cost), stock = Number(d.stock);
    if (!name || !category || !Number.isFinite(cost) || cost <= 0 || !Number.isInteger(stock) || stock < 0) return fail('Valeurs de produit invalides.');
    const r = await db.prepare("INSERT INTO products(name,category,cost,stock,description,image,status,partner_id) VALUES(?,?,?,?,?,?,'pending',?)").bind(name, category, money(cost), stock, String(d.description || ''), String(d.image || ''), auth.user.id).run();
    return json({ id: r.meta.last_row_id, status: 'pending' }, 201);
  }
  if (path === '/api/orders' && request.method === 'POST') {
    if (env.ENABLE_ORDERS !== '1') return fail('La boutique est en préouverture : les commandes ne sont pas encore acceptées.', 403);
    const d = await body(request); if (!d) return fail('Commande incomplète.');
    const name = String(d.name || '').trim(), email = String(d.email || '').trim(), address = String(d.address || '').trim(), shipping = Number(d.shipping || 0), items = d.items;
    if (!name || !email.includes('@') || !address || !Array.isArray(items) || !items.length || items.length > 40 || !Number.isFinite(shipping) || shipping < 0) return fail('Commande invalide.');
    const requested = new Map();
    for (const item of items) { const id = Number(item.product_id), qty = Number(item.quantity); if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1) return fail('Quantités invalides.'); requested.set(id, (requested.get(id) || 0) + qty); }
    const lines = [];
    for (const [id, quantity] of requested) {
      const p = await db.prepare("SELECT id,name,price,cost,stock,partner_id FROM products WHERE id=? AND status='approved'").bind(id).first();
      if (!p || p.price === null || p.stock < quantity) return fail('Produit indisponible ou stock insuffisant.');
      lines.push({ product_id: p.id, name: p.name, quantity, unit_price: p.price, partner_id: p.partner_id, partner_cost: p.cost });
    }
    const ref = `TS-${new Date().getFullYear()}-${randomToken(3).slice(0,6).toUpperCase()}`, u = await currentUser(request, env);
    const total = money(lines.reduce((sum, l) => sum + l.unit_price*l.quantity, shipping));
    const stmts = [db.prepare("INSERT INTO orders(reference,user_id,customer_name,email,address,items_json,total,shipping,status) VALUES(?,?,?,?,?,?,?,?, 'awaiting_payment')")
      .bind(ref, u?.id || null, name, email, address, JSON.stringify(lines.map(({ product_id,name,quantity,unit_price }) => ({ product_id,name,quantity,unit_price }))), total, shipping)];
    for (const l of lines) stmts.push(db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').bind(l.quantity,l.product_id,l.quantity));
    for (const l of lines) stmts.push(db.prepare(`INSERT INTO order_lines(order_id,product_id,partner_id,quantity,unit_price,partner_cost)
      SELECT id,?,?,?,?,? FROM orders WHERE reference=?`).bind(l.product_id,l.partner_id,l.quantity,l.unit_price,l.partner_cost,ref));
    const batch = await db.batch(stmts), stockResults = batch.slice(1, 1 + lines.length);
    if (stockResults.some(x => x.meta.changes !== 1)) {
      const recovery = stockResults.flatMap((r, i) => r.meta.changes === 1 ? [db.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(lines[i].quantity,lines[i].product_id)] : []);
      recovery.push(db.prepare('DELETE FROM orders WHERE reference=?').bind(ref));
      await db.batch(recovery); return fail('Le stock vient de changer. Videz puis recommencez le panier.', 409);
    }
    return json({ reference: ref, status: 'awaiting_payment', payment: 'not_configured' }, 201);
  }
  if (path === '/api/setup/admin' && request.method === 'POST') {
    if (!env.ADMIN_BOOTSTRAP_TOKEN) return fail('Configuration initiale désactivée.', 404);
    if (String(env.ADMIN_BOOTSTRAP_TOKEN).length < 32) return fail('Le code de configuration doit faire au moins 32 caractères.', 503);
    const d = await body(request); if (!d || !d.token || d.token !== env.ADMIN_BOOTSTRAP_TOKEN) return fail('Code de configuration invalide.', 403);
    const existing = await db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first(); if (existing) return fail('Le compte administrateur est déjà créé.', 409);
    const email = String(d.email || '').trim().toLowerCase(), name = String(d.name || '').trim(), password = String(d.password || '');
    if (!email.includes('@') || !name || password.length < 12) return fail('Adresse invalide ou mot de passe trop court (12 caractères minimum).');
    try { await db.prepare("INSERT INTO users(email,name,password_hash,role,approved) VALUES(?,?,?,'admin',1)").bind(email,name,await passwordHash(password)).run(); return json({ created: true }, 201); }
    catch { return fail('Cette adresse existe déjà.', 409); }
  }
  return fail('Route inconnue.', 404);
}
