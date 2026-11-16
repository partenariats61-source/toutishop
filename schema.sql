CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client','partner','admin')),
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  cost REAL NOT NULL,
  price REAL,
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  partner_id INTEGER REFERENCES users(id),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  customer_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  total REAL NOT NULL,
  shipping REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  partner_id INTEGER REFERENCES users(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  partner_cost REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER REFERENCES users(id),
  amount REAL NOT NULL,
  paid_on TEXT NOT NULL,
  proof_ref TEXT NOT NULL,
  invoice_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  business_name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  about TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_order_lines_partner ON order_lines(partner_id);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);

WITH sample_products(name,category,cost,price,stock,description,image,status,is_demo) AS (VALUES
  ('Vase Alba en céramique','Maison',18.5,32.9,12,'Un vase aux lignes douces, façonné à la main.','photo-1578500494198-246f612d3b3d','approved',1),
  ('Sérum éclat botanique','Beauté',12,24.5,12,'Un soin visage léger aux extraits botaniques.','photo-1601049541289-9b1b7bbbfe19','approved',1),
  ('Sac Lila en toile','Accessoires',22,39,12,'Un compagnon du quotidien pratique et élégant.','photo-1548036328-c9fa89d128fa','approved',1),
  ('Bougie « Soir d’été »','Maison',9.5,19.9,12,'Une bougie coulée à la main, parfumée avec délicatesse.','photo-1603006905003-be475563bc59','approved',1),
  ('Carnet des belles idées','Papeterie',7,16,12,'Un carnet pour noter projets, envies et petits bonheurs.','photo-1531346878377-a5be20888e57','approved',1),
  ('Tasse Nuage en grès','Maison',11,22,12,'Une tasse artisanale en grès tournée à la main.','photo-1514228742587-6b1558fcca3d','approved',1),
  ('Pochette Sacha','Accessoires',9,18.9,12,'La pochette qui garde vos essentiels à portée de main.','photo-1544816155-12df9643f363','approved',1),
  ('Huile sèche douceur','Beauté',13.5,27,12,'Une huile nourrissante aux ingrédients sélectionnés.','photo-1608248543803-ba4f8c70ae0b','approved',1)
)
INSERT INTO products(name,category,cost,price,stock,description,image,status,is_demo)
SELECT name,category,cost,price,stock,description,image,status,is_demo FROM sample_products
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);
