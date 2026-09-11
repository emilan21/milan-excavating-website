const MAX_VISIT_BODY_BYTES = 256;

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
