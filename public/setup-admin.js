document.querySelector('#setup').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/setup/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Création impossible');
    form.reset();
    document.querySelector('#result').textContent = 'Compte créé. Supprimez maintenant le secret ADMIN_BOOTSTRAP_TOKEN dans Cloudflare, puis connectez-vous à ToutiShop.';
  } catch (error) {
    document.querySelector('#result').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
