import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

const env = {
  ALLOWED_ORIGINS: 'https://milanexcavatingpa.com,http://localhost:8000',
  SPACETIMEDB_BASE_URL: 'https://maincloud.spacetimedb.com',
  SPACETIMEDB_DATABASE: 'milan-excavating',
  SPACETIMEDB_TOKEN: 'test-service-token',
} as unknown as Env;

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

  it('serves a content-free health response', async () => {
    expect(await (await call(request('/health', { method: 'GET' }))).json()).toEqual({ status: 'ok' });
  });

  it('does not expose the removed estimate endpoint', async () => {
    const response = await call(request('/api/estimates', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('enforces the origin before recording visits', async () => {
    const response = await call(new Request('https://gateway.example/api/visits', {
      method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects oversized and malformed visit payloads', async () => {
    const oversized = request('/api/visits', { method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(300) }) });
    expect((await call(oversized)).status).toBe(413);
    const malformed = request('/api/visits', { method: 'POST', body: '{' });
    expect((await call(malformed)).status).toBe(400);
  });

  it('records a visit with the authenticated service identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await call(request('/api/visits', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(202);
    const reducerCall = fetchMock.mock.calls[0];
    expect(String(reducerCall[0])).toContain('/call/record_visit');
    expect((reducerCall[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-service-token' });
  });

  it('returns a safe response when SpacetimeDB fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive upstream error', { status: 500 })));
    const response = await call(request('/api/visits', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
});
