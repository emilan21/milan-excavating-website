import { config } from './config';

declare global {
  interface Window {
    onEstimateTurnstileLoad: () => void;
    turnstile?: {
      render: (target: string, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
    };
  }
}

const form = document.querySelector<HTMLFormElement>('#estimate-form');
const submitButton = document.querySelector<HTMLButtonElement>('#estimate-submit');
const status = document.querySelector<HTMLElement>('#estimate-status');
let widgetId: string | undefined;
let turnstileToken = '';

window.onEstimateTurnstileLoad = () => {
  if (!window.turnstile || !config.turnstileSiteKey) return;
  widgetId = window.turnstile.render('#estimate-turnstile', {
    sitekey: config.turnstileSiteKey,
    action: 'request_estimate',
    callback: (token: string) => { turnstileToken = token; },
    'expired-callback': () => { turnstileToken = ''; },
    'error-callback': () => { turnstileToken = ''; },
  });
};

function showStatus(message: string, kind: 'success' | 'error' | ''): void {
  if (!status) return;
  status.textContent = message;
  status.className = `form-status${kind ? ` form-status--${kind}` : ''}`;
}

form?.addEventListener('submit', async event => {
  event.preventDefault();
  showStatus('', '');
  if (!form.reportValidity()) return;
  if (!turnstileToken) {
    showStatus('Please complete the verification before submitting.', 'error');
    return;
  }

  const data = new FormData(form);
  const payload = {
    name: String(data.get('name') ?? ''),
    email: String(data.get('email') ?? ''),
    phone: String(data.get('phone') ?? ''),
    service: String(data.get('service') ?? ''),
    location: String(data.get('location') ?? ''),
    description: String(data.get('description') ?? ''),
    preferredContact: String(data.get('preferredContact') ?? ''),
    turnstileToken,
  };

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Sending…';
  }
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/estimates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { ok?: boolean; error?: { message?: string } };
    if (!response.ok || result.ok !== true) throw new Error(result.error?.message || 'Your request could not be sent');
    form.reset();
    showStatus('Thanks! Your estimate request was sent. We’ll be in touch soon.', 'success');
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'Your request could not be sent. Please try again.', 'error');
  } finally {
    turnstileToken = '';
    if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Request My Free Estimate';
    }
  }
});

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
