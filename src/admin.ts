import { config } from './config';

type Stats = { lifetime: number; daily: Array<{ date: string; total: number }> };

const message = document.querySelector<HTMLElement>('#admin-message')!;
const refreshButton = document.querySelector<HTMLButtonElement>('#admin-refresh')!;

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.className = isError ? 'admin-message admin-message--error' : 'admin-message';
}

function renderStats(stats: Stats): void {
  document.querySelector('#stat-visits')!.textContent = stats.lifetime.toLocaleString();
  const body = document.querySelector<HTMLTableSectionElement>('#daily-visits-body')!;
  body.replaceChildren(...stats.daily.slice(0, 14).map(day => {
    const row = document.createElement('tr');
    const date = document.createElement('td');
    const total = document.createElement('td');
    date.textContent = day.date;
    total.textContent = day.total.toLocaleString();
    row.append(date, total);
    return row;
  }));
}

async function refresh(): Promise<void> {
  refreshButton.disabled = true;
  setMessage('Loading visit totals…');
  try {
    const response = await fetch(`${config.apiBaseUrl}/admin/api/stats`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
    renderStats(await response.json() as Stats);
    setMessage('Visit totals updated.');
  } catch (error) {
    setMessage(error instanceof Error ? error.message : 'Unable to load visit totals.', true);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', () => void refresh());
void refresh();
