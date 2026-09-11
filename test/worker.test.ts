import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

const env = {
  ALLOWED_ORIGINS: 'https://milanexcavatingpa.com,http://localhost:8000',
  TURNSTILE_HOSTNAMES: 'milanexcavatingpa.com',
  TURNSTILE_TEST_MODE: 'false',
  SPACETIMEDB_BASE_URL: 'https://maincloud.spacetimedb.com',
  SPACETIMEDB_DATABASE: 'milan-excavating',
  TURNSTILE_SECRET: 'test-secret',
  SPACETIMEDB_TOKEN: 'test-service-token',
} as unknown as Env;

const validPayload = {
  name: 'Terry Milan', email: 'terry@example.com', phone: '', service: 'excavation',
  location: 'Uniontown, PA', description: 'Excavate and prepare a new foundation area.',
  preferredContact: 'email', turnstileToken: 'fresh-token',
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://gateway.example${path}`, {
    ...init,
    headers: { Origin: 'https://milanexcavatingpa.com', 'Content-Type': 'application/json', ...init.headers },
  });
}

async function call(req: Request): Promise<Response> {
  return worker.fetch!(req, env, {} as ExecutionContext);
}

describe('gateway Worker', () => {
  beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('serves a content-free health response and rejects wrong methods', async () => {
    expect(await (await call(request('/health', { method: 'GET' }))).json()).toEqual({ status: 'ok' });
    expect((await call(request('/api/estimates', { method: 'GET' }))).status).toBe(405);
  });

  it('enforces the origin before processing public writes', async () => {
    const response = await call(new Request('https://gateway.example/api/visits', {
      method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects oversized and malformed payloads', async () => {
    const oversized = request('/api/estimates', { method: 'POST', body: JSON.stringify({ description: 'x'.repeat(13_000) }) });
    expect((await call(oversized)).status).toBe(413);
    const invalid = request('/api/estimates', { method: 'POST', body: JSON.stringify({ ...validPayload, email: '', phone: '' }) });
    expect((await call(invalid)).status).toBe(400);
  });

  it('fails closed when Turnstile rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    const response = await call(request('/api/estimates', { method: 'POST', body: JSON.stringify(validPayload) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'verification_failed', message: 'Verification failed' } });
  });

  it('verifies Turnstile before invoking the authenticated reducer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, action: 'request_estimate', hostname: 'milanexcavatingpa.com' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(request('/api/estimates', { method: 'POST', body: JSON.stringify(validPayload) }));
    expect(response.status).toBe(201);
    const reducerCall = fetchMock.mock.calls[1];
    expect(String(reducerCall[0])).toContain('/call/create_estimate');
    expect((reducerCall[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-service-token' });
    expect(JSON.parse(String((reducerCall[1] as RequestInit).body))).toEqual([
      validPayload.name, validPayload.email, validPayload.phone, validPayload.service,
      validPayload.location, validPayload.description, validPayload.preferredContact,
    ]);
  });

  it('rejects replay and writes only the first submission', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, action: 'request_estimate', hostname: 'milanexcavatingpa.com' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await call(request('/api/estimates', { method: 'POST', body: JSON.stringify(validPayload) }));
    const replay = await call(request('/api/estimates', { method: 'POST', body: JSON.stringify(validPayload) }));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(403);
    expect(fetchMock.mock.calls.filter(callArgs => String(callArgs[0]).includes('/call/create_estimate'))).toHaveLength(1);
  });

  it('returns a safe response when SpacetimeDB fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, action: 'request_estimate', hostname: 'milanexcavatingpa.com' }))
      .mockResolvedValueOnce(new Response('sensitive upstream error', { status: 500 })));
    const response = await call(request('/api/estimates', { method: 'POST', body: JSON.stringify(validPayload) }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
});
