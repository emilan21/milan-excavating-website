const MAX_ESTIMATE_BODY_BYTES = 12_000;
const MAX_VISIT_BODY_BYTES = 256;
const TURNSTILE_ACTION = 'request_estimate';

type EstimatePayload = {
  name: string;
  email: string;
  phone: string;
  service: string;
  location: string;
  description: string;
  preferredContact: string;
  turnstileToken: string;
};

type TurnstileResult = {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseList(value: string): Set<string> {
  return new Set(value.split(',').map(item => item.trim()).filter(Boolean));
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

function cleanString(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_request', `${key} must be a string`);
  const cleaned = value.trim();
  if (cleaned.length > max) throw new HttpError(400, 'invalid_request', `${key} is too long`);
  return cleaned;
}

function validateEstimate(value: unknown): EstimatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_request', 'Request must be an object');
  const record = value as Record<string, unknown>;
  const payload: EstimatePayload = {
    name: cleanString(record, 'name', 100),
    email: cleanString(record, 'email', 254).toLowerCase(),
    phone: cleanString(record, 'phone', 40),
    service: cleanString(record, 'service', 40),
    location: cleanString(record, 'location', 160),
    description: cleanString(record, 'description', 4000),
    preferredContact: cleanString(record, 'preferredContact', 16),
    turnstileToken: cleanString(record, 'turnstileToken', 2048),
  };
  if (payload.name.length < 2) throw new HttpError(400, 'invalid_request', 'Name is required');
  if (!payload.email && !payload.phone) throw new HttpError(400, 'invalid_request', 'Provide an email or phone number');
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new HttpError(400, 'invalid_request', 'Email is invalid');
  if (!['retaining_walls', 'excavation', 'concrete', 'driveways', 'other'].includes(payload.service)) throw new HttpError(400, 'invalid_request', 'Service is invalid');
  if (payload.description.length < 10) throw new HttpError(400, 'invalid_request', 'Please provide more project detail');
  if (!['phone', 'email', 'either'].includes(payload.preferredContact)) throw new HttpError(400, 'invalid_request', 'Preferred contact method is invalid');
  if (payload.preferredContact === 'phone' && !payload.phone) throw new HttpError(400, 'invalid_request', 'Phone is required for phone contact');
  if (payload.preferredContact === 'email' && !payload.email) throw new HttpError(400, 'invalid_request', 'Email is required for email contact');
  if (!payload.turnstileToken) throw new HttpError(403, 'verification_required', 'Verification is required');
  return payload;
}

async function verifyTurnstile(request: Request, token: string, env: Env): Promise<void> {
  const expectedHostnames = parseList(env.TURNSTILE_HOSTNAMES);
  if (!env.TURNSTILE_SECRET || expectedHostnames.size === 0) throw new HttpError(503, 'verification_unavailable', 'Verification is unavailable');
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (remoteIp) body.set('remoteip', remoteIp);

  let result: TurnstileResult;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Siteverify returned ${response.status}`);
    result = await response.json<TurnstileResult>();
  } catch (error) {
    console.error(JSON.stringify({ event: 'turnstile_error', error: error instanceof Error ? error.message : 'unknown' }));
    throw new HttpError(403, 'verification_failed', 'Verification failed');
  }
  const metadataValid = env.TURNSTILE_TEST_MODE === 'true' || (result.action === TURNSTILE_ACTION && !!result.hostname && expectedHostnames.has(result.hostname));
  if (result.success !== true || !metadataValid) {
    console.log(JSON.stringify({ event: 'turnstile_rejected', errorCodes: result['error-codes'] ?? [] }));
    throw new HttpError(403, 'verification_failed', 'Verification failed');
  }
}

async function callReducer(name: string, args: unknown[], env: Env): Promise<void> {
  const base = env.SPACETIMEDB_BASE_URL.replace(/\/$/, '');
  const url = `${base}/v1/database/${encodeURIComponent(env.SPACETIMEDB_DATABASE)}/call/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SPACETIMEDB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SpacetimeDB reducer ${name} returned ${response.status}`);
}

async function handleEstimate(request: Request, env: Env): Promise<Response> {
  const origin = requireAllowedOrigin(request, env);
  const payload = validateEstimate(await readBoundedJson(request, MAX_ESTIMATE_BODY_BYTES));
  await verifyTurnstile(request, payload.turnstileToken, env);
  await callReducer('create_estimate', [
    payload.name,
    payload.email,
    payload.phone,
    payload.service,
    payload.location,
    payload.description,
    payload.preferredContact,
  ], env);
  console.log(JSON.stringify({ event: 'estimate_created', service: payload.service }));
  return jsonResponse({ ok: true }, 201, origin, env);
}

async function handleVisit(request: Request, env: Env): Promise<Response> {
  const origin = requireAllowedOrigin(request, env);
  await readBoundedJson(request, MAX_VISIT_BODY_BYTES);
  const date = new Date().toISOString().slice(0, 10);
  await callReducer('record_visit', [date], env);
  return jsonResponse({ ok: true }, 202, origin, env);
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const requestId = request.headers.get('CF-Ray') ?? crypto.randomUUID();
    console.log(JSON.stringify({ event: 'request', requestId, method: request.method, path: url.pathname }));

    try {
      if (request.method === 'OPTIONS') {
        requireAllowedOrigin(request, env);
        return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
      }
      if (url.pathname === '/health') {
        if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return jsonResponse({ status: 'ok' }, 200, origin, env);
      }
      if (url.pathname === '/api/estimates') {
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return await handleEstimate(request, env);
      }
      if (url.pathname === '/api/visits') {
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        return await handleVisit(request, env);
      }
      throw new HttpError(404, 'not_found', 'Not found');
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, origin, env);
      console.error(JSON.stringify({ event: 'request_error', requestId, path: url.pathname, error: error instanceof Error ? error.message : 'unknown' }));
      return jsonResponse({ error: { code: 'service_unavailable', message: 'Please try again later' } }, 503, origin, env);
    }
  },
};

export default handler;
