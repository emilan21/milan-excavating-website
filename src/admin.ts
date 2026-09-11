import { UserManager, type User } from 'oidc-client-ts';
import { config } from './config';
import { DbConnection, type ErrorContext } from './module_bindings';

const loginPanel = document.querySelector<HTMLElement>('#login-panel')!;
const dashboard = document.querySelector<HTMLElement>('#admin-dashboard')!;
const message = document.querySelector<HTMLElement>('#admin-message')!;
const loginButton = document.querySelector<HTMLButtonElement>('#admin-login')!;
const logoutButton = document.querySelector<HTMLButtonElement>('#admin-logout')!;
const adminUrl = `${window.location.origin}/admin`;
let connection: DbConnection | undefined;

const userManager = config.spacetimeAuthClientId ? new UserManager({
  authority: config.spacetimeAuthAuthority,
  client_id: config.spacetimeAuthClientId,
  redirect_uri: adminUrl,
  post_logout_redirect_uri: adminUrl,
  response_type: 'code',
  scope: 'openid profile email',
}) : undefined;

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.className = isError ? 'admin-message admin-message--error' : 'admin-message';
}

function showLogin(): void {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

function showDashboard(): void {
  loginPanel.hidden = true;
  dashboard.hidden = false;
}

function renderStats(): void {
  if (!connection) return;
  const lifetime = Array.from(connection.db.adminLifetimeVisits.iter())[0];
  document.querySelector('#stat-visits')!.textContent = lifetime ? lifetime.total.toLocaleString() : '0';
  const daily = Array.from(connection.db.adminDailyVisits.iter()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const body = document.querySelector<HTMLTableSectionElement>('#daily-visits-body')!;
  body.replaceChildren(...daily.map(day => {
    const row = document.createElement('tr');
    const date = document.createElement('td');
    const total = document.createElement('td');
    date.textContent = day.date;
    total.textContent = day.total.toLocaleString();
    row.append(date, total);
    return row;
  }));
}

function connect(user: User): void {
  setMessage('Connecting to live data…');
  connection = DbConnection.builder()
    .withUri(config.spacetimeUri)
    .withDatabaseName(config.spacetimeDatabase)
    .withToken(user.id_token)
    .onConnect(conn => {
      connection = conn;
      conn.db.adminDailyVisits.onInsert(renderStats);
      conn.db.adminDailyVisits.onUpdate(renderStats);
      conn.db.adminLifetimeVisits.onInsert(renderStats);
      conn.db.adminLifetimeVisits.onUpdate(renderStats);
      conn.subscriptionBuilder()
        .onApplied(() => {
          const lifetime = Array.from(conn.db.adminLifetimeVisits.iter())[0];
          if (!lifetime) {
            conn.disconnect();
            connection = undefined;
            showLogin();
            setMessage('This GitHub account is not authorized for the dashboard.', true);
            return;
          }
          showDashboard();
          setMessage('Live data connected.');
          renderStats();
        })
        .onError(ctx => setMessage(`Subscription failed: ${ctx.event?.message ?? 'unknown error'}`, true))
        .subscribe(['SELECT * FROM admin_daily_visits', 'SELECT * FROM admin_lifetime_visits']);
    })
    .onDisconnect((_ctx, error) => setMessage(error ? `Disconnected: ${error.message}` : 'Disconnected.', true))
    .onConnectError((_ctx: ErrorContext, error: Error) => setMessage(`Connection failed: ${error.message}`, true))
    .build();
}

async function start(): Promise<void> {
  showLogin();
  if (!userManager) {
    setMessage('Admin login is not configured. Set SPACETIMEAUTH_CLIENT_ID during the production build.', true);
    loginButton.disabled = true;
    return;
  }
  const callback = new URLSearchParams(window.location.search);
  if (callback.has('code') && callback.has('state')) {
    await userManager.signinCallback();
    history.replaceState({}, document.title, '/admin');
  } else if (callback.has('state')) {
    await userManager.signoutCallback();
    history.replaceState({}, document.title, '/admin');
  }
  const user = await userManager.getUser();
  if (!user || user.expired) return;
  connect(user);
}

async function logout(): Promise<void> {
  connection?.disconnect();
  connection = undefined;
  showLogin();
  setMessage('Signing out…');
  if (!userManager) return;
  try {
    await userManager.signoutRedirect();
  } catch (error) {
    await userManager.removeUser();
    showLogin();
    setMessage(error instanceof Error ? `Signed out locally: ${error.message}` : 'Signed out locally.', true);
  }
}

loginButton.addEventListener('click', () => void userManager?.signinRedirect());
logoutButton.addEventListener('click', () => void logout());

void start().catch(error => setMessage(error instanceof Error ? error.message : 'Admin startup failed', true));
