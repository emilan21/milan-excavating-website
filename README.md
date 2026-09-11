# Milan Excavating Website

The public site remains a vanilla static site on Cloudflare Pages. Estimate requests and directional visit analytics are stored transactionally in SpacetimeDB, with a Cloudflare Worker acting as the only public write gateway.

## Architecture

- `frontend/`: static public site and no-index admin dashboard
- `worker/`: CORS, request validation, Turnstile Siteverify, and authenticated SpacetimeDB reducer calls
- `spacetimedb/`: private lead/analytics tables, reducers, role-filtered admin views, and lifecycle authorization
- `src/module_bindings/`: generated SpacetimeDB 2.10 TypeScript bindings
- `src/public.ts` and `src/admin.ts`: esbuild entry points for the public form and live dashboard

The browser never receives the Worker's SpacetimeDB token or Turnstile secret. All lead and analytics tables are private. The three public views return rows only while the caller has an active WebSocket session whose SpacetimeAuth token passed issuer, audience, and `admin` role checks.

## Local development

Requirements: Node.js, npm, `jq`, `curl`, and SpacetimeDB CLI 2.10.0.

```bash
npm install
npm install --prefix spacetimedb
./dev.sh
```

`dev.sh` builds the browser bundles, starts an in-memory SpacetimeDB at `127.0.0.1:3000`, publishes the module, creates a disposable gateway identity, configures it, writes an ignored `worker/.dev.vars`, and starts the Worker and Pages servers.

- Site: `http://localhost:8000`
- Gateway health: `http://localhost:8787/health`
- SpacetimeDB: `http://127.0.0.1:3000`

The estimate form uses Cloudflare's always-pass Turnstile test credentials locally. Production validates the real token's `request_estimate` action and exact hostname. SpacetimeAuth admin login should be acceptance-tested against Maincloud because the disposable local database does not reproduce the hosted auth project.

## Checks

```bash
npm test
npm run typecheck
npm run build
WRANGLER_LOG_PATH=/tmp/milan-wrangler.log npx wrangler deploy --dry-run --config worker/wrangler.jsonc
```

## First production setup

SpacetimeAuth is simply the login page for `/admin.html`. A visitor never uses it. The owner signs in by email, receives an ID token containing the `admin` role, and the SpacetimeDB module uses that claim to decide whether it may return lead data.

Run the guarded assistant:

```bash
WRANGLER_BIN=/home/emilan/.local/share/mise/installs/npm-wrangler/latest/node_modules/.bin/wrangler \
WRANGLER_VERSION=4.128.0 \
./scripts/setup-production.sh
```

On the first run, the assistant walks through this order:

1. Publish the SpacetimeDB module to Maincloud without deleting data. This makes its dashboard and SpacetimeAuth settings available.
2. Open `https://spacetimedb.com/milan-excavating`, select **SpacetimeAuth**, and click **Use SpacetimeAuth**.
3. Open **Clients**, edit the default browser client, and add both of these as **Redirect URIs** and **Post Logout Redirect URIs**:

   - `https://milanexcavatingpa.com/admin.html`
   - `https://www.milanexcavatingpa.com/admin.html`

4. In **Customization**, enable **Magic Link**. Copy the public client ID beginning with `client_`; do not copy or expose the client secret.
5. Return to the assistant. It creates or recovers Turnstile, creates the dedicated Worker identity, and stores the following in the GitHub `production` environment.

GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SPACETIMEDB_DEPLOY_TOKEN`
- `SPACETIMEDB_SERVICE_TOKEN`
- `TURNSTILE_SECRET`

GitHub variables:

- `SPACETIMEDB_GATEWAY_IDENTITY`
- `PUBLIC_API_BASE_URL`
- `TURNSTILE_SITE_KEY`
- `SPACETIMEAUTH_CLIENT_ID`

After the first deployment, finish owner access:

1. Visit `https://milanexcavatingpa.com/admin.html` and request a magic link using the owner's email. This creates the user in SpacetimeAuth; the first login may show no dashboard data yet.
2. Return to the database's **SpacetimeAuth → Users** dashboard, create the role `admin` if needed, and assign it to that owner user.
3. Sign out of `/admin.html`, then sign in again so the newly issued ID token includes `roles: ["admin"]`.

The client ID is public configuration. The client secret is not needed by this browser application. SpacetimeAuth is currently documented as beta, so its dashboard labels may change slightly.

## KV cutover

1. Read the existing `count` value from the old `MILAN_COUNTER` KV namespace.
2. Import it exactly once as the authenticated database owner:

   ```bash
   ./scripts/import-legacy-count.sh 1234
   ```

3. Deploy the gateway and production frontend.
4. Submit one real estimate, confirm it appears live at `/admin.html`, update its status and notes, and confirm an unauthenticated SpacetimeDB subscription receives no lead rows.
5. Reconcile lifetime visits with the imported KV count plus accepted new visits.
6. Keep the old Worker and KV namespace temporarily for rollback. Remove them only after acceptance; doing so does not reset SpacetimeDB.

Do not rerun the legacy import reducer: it rejects a second import and also rejects import after new visit tracking has begun.

## Production acceptance checklist

- Gateway `/health` returns only `{ "status": "ok" }`.
- Disallowed origins and methods fail.
- A real Turnstile token succeeds once and fails on replay.
- One production estimate appears live for the owner.
- Anonymous and non-admin subscribers see zero rows from every admin view.
- Status and notes changes appear without refreshing.
- Daily and lifetime visit totals update, and a second load in the same browser session does not increment again.
