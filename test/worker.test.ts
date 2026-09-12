import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';

class FakeStatement {
  params: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this as unknown as D1PreparedStatement;
  }
}

class FakeD1 {
  lifetime = 0;
  daily = new Map<string, number>();
  failNextBatch = false;

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error('sensitive database failure');
    }
    const results: D1Result[] = [];
    for (const raw of statements) {
      const statement = raw as unknown as FakeStatement;
      if (statement.sql.includes('INSERT INTO lifetime_visits')) {
        this.lifetime += 1;
        results.push({ success: true, meta: {} } as D1Result);
      } else if (statement.sql.includes('INSERT INTO daily_visits')) {
        const date = String(statement.params[0]);
        this.daily.set(date, (this.daily.get(date) ?? 0) + 1);
        results.push({ success: true, meta: {} } as D1Result);
      } else if (statement.sql.includes('SELECT total FROM lifetime_visits')) {
        results.push({ success: true, results: [{ total: this.lifetime }], meta: {} } as D1Result);
      } else if (statement.sql.includes('SELECT date, total FROM daily_visits')) {
        const rows = [...this.daily].sort(([a], [b]) => b.localeCompare(a)).map(([date, total]) => ({ date, total }));
        results.push({ success: true, results: rows, meta: {} } as D1Result);
      } else {
        throw new Error('Unexpected statement');
      }
    }
    return results;
  }
}

const db = new FakeD1();
const env = {
  DB: db as unknown as D1Database,
  ALLOWED_ORIGINS: 'https://milanexcavatingpa.com,http://localhost:8000',
  ADMIN_HOSTNAMES: 'milanexcavatingpa.com,www.milanexcavatingpa.com',
  ACCESS_TEAM_DOMAIN: 'milan.cloudflareaccess.com',
  ACCESS_AUD: 'expected-audience',
  ADMIN_EMAIL: 'emilan@ericmilan.dev',
} as Env;

function request(path: string, init: RequestInit = {}, host = 'milanexcavatingpa.com'): Request {
  return new Request(`https://${host}${path}`, {
    ...init,
    headers: { Origin: 'https://milanexcavatingpa.com', 'Content-Type': 'application/json', ...init.headers },
  });
}

async function call(req: Request, customEnv: Env = env): Promise<Response> {
  return worker.fetch!(req, customEnv, {} as ExecutionContext);
}

describe('analytics Worker', () => {
  beforeEach(() => {
    db.lifetime = 0;
    db.daily.clear();
    db.failNextBatch = false;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serves health only at /api/health and keeps estimate endpoints absent', async () => {
    expect(await (await call(request('/api/health', { method: 'GET' }))).json()).toEqual({ status: 'ok' });
    expect((await call(request('/health', { method: 'GET' }))).status).toBe(404);
    expect((await call(request('/api/estimates', { method: 'POST', body: '{}' }))).status).toBe(404);
  });

  it('atomically increments lifetime and UTC-daily totals', async () => {
    expect((await call(request('/api/visits', { method: 'POST', body: '{}' }))).status).toBe(202);
    expect((await call(request('/api/visits', { method: 'POST', body: '{}' }))).status).toBe(202);
    expect(db.lifetime).toBe(2);
    expect(db.daily.get('2026-09-11')).toBe(2);
  });

  it('enforces origin and rejects malformed visit requests', async () => {
    const forbidden = request('/api/visits', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } });
    expect((await call(forbidden)).status).toBe(403);
    expect((await call(request('/api/visits', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await call(request('/api/visits', { method: 'POST', body: '{"extra":true}' }))).status).toBe(400);
    expect((await call(request('/api/visits', { method: 'POST', body: JSON.stringify({ padding: 'x'.repeat(300) }) }))).status).toBe(413);
  });

  it('returns a safe error without incrementing when D1 fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.failNextBatch = true;
    const response = await call(request('/api/visits', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(503);
    expect(db.lifetime).toBe(0);
    expect(db.daily.size).toBe(0);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });

  it('returns D1 stats with the explicit local-only bypass', async () => {
    db.lifetime = 3;
    db.daily.set('2026-09-11', 3);
    const localEnv = { ...env, LOCAL_ADMIN_BYPASS: 'true' } as unknown as Env;
    const response = await call(request('/admin/api/stats', { method: 'GET' }, 'localhost'), localEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lifetime: 3, daily: [{ date: '2026-09-11', total: 3 }] });
  });

  it('rejects missing JWTs and direct workers.dev admin requests', async () => {
    expect((await call(request('/admin/api/stats', { method: 'GET' }))).status).toBe(403);
    expect((await call(request('/admin/api/stats', { method: 'GET' }, 'milan-excavating-gateway.workers.dev'))).status).toBe(403);
  });

  it('accepts only a valid Access JWT with the exact audience and email', async () => {
    vi.useRealTimers();
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })));

    async function token(overrides: { audience?: string; email?: string; expiresIn?: string } = {}): Promise<string> {
      return new SignJWT({ email: overrides.email ?? env.ADMIN_EMAIL })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://milan.cloudflareaccess.com')
        .setAudience(overrides.audience ?? env.ACCESS_AUD)
        .setIssuedAt()
        .setExpirationTime(overrides.expiresIn ?? '5m')
        .sign(privateKey);
    }

    expect((await call(request('/admin/api/stats', { method: 'GET', headers: { 'CF-Access-Jwt-Assertion': await token() } }))).status).toBe(200);
    expect((await call(request('/admin/api/stats', { method: 'GET', headers: { 'CF-Access-Jwt-Assertion': await token({ audience: 'wrong' }) } }))).status).toBe(403);
    expect((await call(request('/admin/api/stats', { method: 'GET', headers: { 'CF-Access-Jwt-Assertion': await token({ email: 'other@example.com' }) } }))).status).toBe(403);
    expect((await call(request('/admin/api/stats', { method: 'GET', headers: { 'CF-Access-Jwt-Assertion': await token({ expiresIn: '-1s' }) } }))).status).toBe(403);
  });
});
