import { UserManager, type User } from 'oidc-client-ts';
import { config } from './config';
import { DbConnection, type ErrorContext } from './module_bindings';
import type { EstimateRequest as Estimate } from './module_bindings/types';

const loginPanel = document.querySelector<HTMLElement>('#login-panel')!;
const dashboard = document.querySelector<HTMLElement>('#admin-dashboard')!;
const message = document.querySelector<HTMLElement>('#admin-message')!;
const loginButton = document.querySelector<HTMLButtonElement>('#admin-login')!;
const logoutButton = document.querySelector<HTMLButtonElement>('#admin-logout')!;
const filter = document.querySelector<HTMLSelectElement>('#status-filter')!;
const leadList = document.querySelector<HTMLElement>('#lead-list')!;
const leadDetail = document.querySelector<HTMLElement>('#lead-detail')!;
let connection: DbConnection | undefined;
let selectedId: bigint | undefined;

const userManager = config.spacetimeAuthClientId ? new UserManager({
  authority: config.spacetimeAuthAuthority,
  client_id: config.spacetimeAuthClientId,
  redirect_uri: `${window.location.origin}/admin.html`,
  post_logout_redirect_uri: `${window.location.origin}/admin.html`,
  response_type: 'code',
  scope: 'openid profile email',
}) : undefined;

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.className = isError ? 'admin-message admin-message--error' : 'admin-message';
}

function rows(): Estimate[] {
  return connection ? Array.from(connection.db.adminEstimates.iter()) as Estimate[] : [];
}

function renderStats(): void {
  if (!connection) return;
  const estimates = rows();
  document.querySelector('#stat-new')!.textContent = String(estimates.filter(row => row.status === 'new').length);
  document.querySelector('#stat-total')!.textContent = String(estimates.length);
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

function renderLeads(): void {
  const visible = rows()
    .filter(row => filter.value === 'all' || row.status === filter.value)
    .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  leadList.replaceChildren(...visible.map(lead => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lead-card${selectedId === lead.id ? ' lead-card--selected' : ''}`;
    const title = document.createElement('strong');
    const meta = document.createElement('span');
    const state = document.createElement('span');
    title.textContent = lead.name;
    meta.textContent = `${lead.service.replaceAll('_', ' ')} · ${lead.createdAt.toDate().toLocaleDateString()}`;
    state.textContent = lead.status;
    state.className = `status-pill status-pill--${lead.status}`;
    button.append(title, meta, state);
    button.addEventListener('click', () => { selectedId = lead.id; renderLeads(); renderDetail(); });
    return button;
  }));
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No estimate requests match this filter.';
    leadList.append(empty);
  }
}

function field(label: string, value: string): HTMLElement {
  const wrapper = document.createElement('div');
  const heading = document.createElement('dt');
  const content = document.createElement('dd');
  heading.textContent = label;
  content.textContent = value || '—';
  wrapper.append(heading, content);
  return wrapper;
}

function renderDetail(): void {
  const lead = rows().find(row => row.id === selectedId);
  leadDetail.replaceChildren();
  if (!lead) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Select a request to see its details.';
    leadDetail.append(empty);
    return;
  }
  const title = document.createElement('h2');
  title.textContent = lead.name;
  const details = document.createElement('dl');
  details.className = 'lead-details';
  details.append(
    field('Email', lead.email), field('Phone', lead.phone), field('Preferred contact', lead.preferredContact),
    field('Service', lead.service.replaceAll('_', ' ')), field('Location', lead.location),
    field('Submitted', lead.createdAt.toDate().toLocaleString()), field('Project', lead.description),
  );
  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Status';
  const statusSelect = document.createElement('select');
  for (const value of ['new', 'contacted', 'scheduled', 'closed', 'declined']) {
    const option = new Option(value, value, false, value === lead.status);
    statusSelect.add(option);
  }
  statusSelect.addEventListener('change', async () => {
    try { await connection!.reducers.changeEstimateStatus({ id: lead.id, status: statusSelect.value }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update status', true); statusSelect.value = lead.status; }
  });
  const notesLabel = document.createElement('label');
  notesLabel.textContent = 'Admin notes';
  const notes = document.createElement('textarea');
  notes.rows = 6;
  notes.maxLength = 8000;
  notes.value = lead.adminNotes;
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save notes';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await connection!.reducers.updateEstimateNotes({ id: lead.id, notes: notes.value }); setMessage('Notes saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save notes', true); }
    finally { save.disabled = false; }
  });
  leadDetail.append(title, details, statusLabel, statusSelect, notesLabel, notes, save);
}

function renderAll(): void { renderStats(); renderLeads(); renderDetail(); }

function connect(user: User): void {
  setMessage('Connecting to live data…');
  connection = DbConnection.builder()
    .withUri(config.spacetimeUri)
    .withDatabaseName(config.spacetimeDatabase)
    .withToken(user.id_token)
    .onConnect(conn => {
      connection = conn;
      conn.db.adminEstimates.onInsert(renderAll);
      conn.db.adminEstimates.onDelete(renderAll);
      conn.db.adminEstimates.onUpdate(renderAll);
      conn.db.adminDailyVisits.onInsert(renderAll);
      conn.db.adminDailyVisits.onUpdate(renderAll);
      conn.db.adminLifetimeVisits.onInsert(renderAll);
      conn.db.adminLifetimeVisits.onUpdate(renderAll);
      conn.subscriptionBuilder()
        .onApplied(() => { setMessage('Live data connected.'); renderAll(); })
        .onError(ctx => setMessage(`Subscription failed: ${ctx.event?.message ?? 'unknown error'}`, true))
        .subscribe(['SELECT * FROM admin_estimates', 'SELECT * FROM admin_daily_visits', 'SELECT * FROM admin_lifetime_visits']);
    })
    .onDisconnect((_ctx, error) => setMessage(error ? `Disconnected: ${error.message}` : 'Disconnected.', true))
    .onConnectError((_ctx: ErrorContext, error: Error) => setMessage(`Connection failed: ${error.message}`, true))
    .build();
}

async function start(): Promise<void> {
  if (!userManager) {
    setMessage('Admin login is not configured. Set SPACETIMEAUTH_CLIENT_ID during the production build.', true);
    loginButton.disabled = true;
    return;
  }
  if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
    await userManager.signinRedirectCallback();
    history.replaceState({}, document.title, '/admin.html');
  }
  const user = await userManager.getUser();
  if (!user || user.expired) return;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  connect(user);
}

loginButton.addEventListener('click', () => void userManager?.signinRedirect());
logoutButton.addEventListener('click', () => { connection?.disconnect(); void userManager?.signoutRedirect(); });
filter.addEventListener('change', renderLeads);

void start().catch(error => setMessage(error instanceof Error ? error.message : 'Admin startup failed', true));
