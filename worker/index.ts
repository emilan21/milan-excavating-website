import { createRemoteJWKSet, jwtVerify } from 'jose';

const MAX_VISIT_BODY_BYTES = 256;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type DailyVisit = { date: string; total: number };
type LifetimeVisit = { total: number };

function parseList(value: string): Set<string> {
  return new Set(value.split(',').map(item => item.trim()).filter(Boolean));
}

function accessIssuer(value: string): string {
  const configured = value.trim();
  const url = new URL(configured.startsWith('https://') ? configured : `https://${configured}`);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.cloudflareaccess.com') ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid Cloudflare Access team domain');
  }
  return url.origin;
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && parseList(env.ALLOWED_ORIGINS).has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null, env: Env): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(origin, env),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function requireAllowedOrigin(request: Request, env: Env): string {
  const origin = request.headers.get('Origin');
  if (!origin || !parseList(env.ALLOWED_ORIGINS).has(origin)) {
    throw new HttpError(403, 'origin_not_allowed', 'Origin is not allowed');
  }
  return origin;
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  if (!request.body) throw new HttpError(400, 'invalid_json', 'A JSON body is required');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

function requireEmptyObject(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new HttpError(400, 'invalid_request', 'Request body must be an empty JSON object');
  }
}

async function handleVisit(request: Request, env: Env): Promise<Response> {
  const origin = requireAllowedOrigin(request, env);
  requireEmptyObject(await readBoundedJson(request, MAX_VISIT_BODY_BYTES));
  const date = new Date().toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO lifetime_visits (id, total) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET total = total + 1
    `),
    env.DB.prepare(`
      INSERT INTO daily_visits (date, total) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET total = total + 1
    `).bind(date),
  ]);
  return jsonResponse({ ok: true }, 202, origin, env);
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (env.LOCAL_ADMIN_BYPASS === 'true') return;

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (!parseList(env.ADMIN_HOSTNAMES).has(hostname)) throw new HttpError(403, 'access_denied', 'Access denied');

  const token = request.headers.get('CF-Access-Jwt-Assertion');
  if (!token) throw new HttpError(403, 'access_denied', 'Access denied');

  try {
    const issuer = accessIssuer(env.ACCESS_TEAM_DOMAIN);
    const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
    });
    if (payload.email !== env.ADMIN_EMAIL) throw new Error('Unexpected email claim');
  } catch {
    throw new HttpError(403, 'access_denied', 'Access denied');
  }
}

async function handleStats(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const [lifetimeResult, dailyResult] = await env.DB.batch([
    env.DB.prepare('SELECT total FROM lifetime_visits WHERE id = 1'),
    env.DB.prepare('SELECT date, total FROM daily_visits ORDER BY date DESC'),
  ]);
  const lifetime = (lifetimeResult.results as LifetimeVisit[])[0]?.total ?? 0;
  const daily = dailyResult.results as DailyVisit[];
  return jsonResponse({ lifetime, daily }, 200, request.headers.get('Origin'), env);
}

const handler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const requestId = request.headers.get('CF-Ray') ?? crypto.randomUUID();
    console.log(JSON.stringify({ event: 'request', requestId, method: request.method, path: url.pathname }));

    try {
      if (url.pathname === '/api/visits' && request.method === 'OPTIONS') {
        requireAllowedOrigin(request, env);
        return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
      }
      if (url.pathname === '/api/health') {
        if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return jsonResponse({ status: 'ok' }, 200, origin, env);
      }
      if (url.pathname === '/api/visits') {
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return await handleVisit(request, env);
      }
      if (url.pathname === '/admin/api/stats') {
        if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return await handleStats(request, env);
      }
      throw new HttpError(404, 'not_found', 'Not found');
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin, env);
      console.error(JSON.stringify({ event: 'request_error', requestId, path: url.pathname, error: error instanceof Error ? error.message : 'unknown' }));
      return jsonResponse({ error: { code: 'service_unavailable', message: 'Please try again later' } }, 503, origin, env);
    }
  },
} satisfies ExportedHandler<Env>;

export default handler;
