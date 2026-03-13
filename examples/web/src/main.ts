import './style.css';

import { diskd } from '@diskd/sdk/browser';

const env = import.meta.env;

const CLIENT_ID = env.VITE_DISKD_CLIENT_ID ?? '<YOUR_CLIENT_ID>';
const ISSUER = env.VITE_DISKD_OIDC_ISSUER ?? 'https://oauth2.diskd.local:8080';
const AUDIENCE = env.VITE_DISKD_AUDIENCE ?? 'diskd-api';
const SCOPES = ['openid'];

const DISKD_BASE_URL = env.VITE_DISKD_BASE_URL ?? 'https://apis.diskd.local:8080';
window.DISKD_BASE_URL = DISKD_BASE_URL;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app');
}

app.innerHTML = `
  <h1>DiskD Drive API Quickstart</h1>
  <p>Google-style SDK usage: <code>diskd.auth.credentials</code> + <code>diskd.os.drive</code>.</p>
  <button id="authorize_button">Authorize</button>
  <button id="signout_button">Sign Out</button>
  <pre id="content"></pre>
`;

const authorizeBtn = document.querySelector<HTMLButtonElement>('#authorize_button');
const signoutBtn = document.querySelector<HTMLButtonElement>('#signout_button');
const contentEl = document.querySelector<HTMLPreElement>('#content');

const main = async (): Promise<void> => {
  const auth = await diskd.auth.credentials({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: window.location.origin + window.location.pathname,
    scopes: SCOPES,
    audience: AUDIENCE,
  });

  const drive = diskd.os.drive({ version: 'v1', auth });

  await auth.handleRedirectCallback();

  const updateButtons = () => {
    if (authorizeBtn) authorizeBtn.style.visibility = 'visible';
    if (signoutBtn) signoutBtn.style.visibility = auth.getToken() ? 'visible' : 'hidden';
  };

  const listFiles = async () => {
    await drive.init();
    const entries = await drive.list({ path: '/' });
    if (contentEl) contentEl.textContent = JSON.stringify(entries, null, 2);
  };

  const handleAuthClick = async () => {
    await auth.signIn();
  };

  const handleSignoutClick = () => {
    auth.signOut();
    if (contentEl) contentEl.textContent = '';
    updateButtons();
  };

  if (authorizeBtn) authorizeBtn.addEventListener('click', () => void handleAuthClick());
  if (signoutBtn) signoutBtn.addEventListener('click', handleSignoutClick);

  updateButtons();

  if (auth.getToken()) {
    await listFiles();
  }
};

void main();
