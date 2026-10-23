import { mountApp } from './app.js';
import { createClient } from './api.js';

/**
 * The API address comes from config.js (the deployed public URL).
 * On localhost only, `?api=<url>` lets you point a dev copy at another server;
 * the deployed site ignores it.
 */
function resolveApiBase() {
  const configured = window.APP_CONFIG?.API_BASE_URL;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const override = isLocalhost ? new URLSearchParams(window.location.search).get('api') : null;
  return override || configured;
}

const root = document.getElementById('app');
const base = resolveApiBase();

if (!base || base.includes('YOUR-API')) {
  root.textContent = 'This app is not configured yet: set API_BASE_URL in config.js to the deployed API address.';
} else {
  document.getElementById('api-host').textContent = new URL(base).host;
  mountApp({ root, client: createClient(base) });
}
