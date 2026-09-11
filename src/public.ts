import { config } from './config';

const visitSessionKey = 'milan-visit-recorded';
if (!sessionStorage.getItem(visitSessionKey)) {
  sessionStorage.setItem(visitSessionKey, 'true');
  void fetch(`${config.apiBaseUrl}/api/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    keepalive: true,
  }).catch(() => undefined);
}
