# Milan Excavating Website

The public website is a vanilla static site on Cloudflare Pages. Customers contact the business by phone. A Cloudflare Worker records privacy-minimal visit totals in SpacetimeDB, and the no-index admin page displays those totals after SpacetimeAuth login.

The previously deployed estimate tables remain private and dormant for safe, non-destructive database compatibility. The website has no estimate form and the Worker does not expose an estimate endpoint.

## Local development

Requirements: Node.js, npm, `jq`, `curl`, and SpacetimeDB CLI 2.10.0.

Install dependencies once:

```bash
npm install
npm install --prefix spacetimedb
```

Start the complete local stack:

```bash
./dev.sh
```

This starts:

- Website: `http://localhost:8000`
- Gateway health check: `http://localhost:8787/health`
- Local SpacetimeDB: `http://127.0.0.1:3000`

Open the website and verify the phone buttons. The first page load records one visit; refreshing the same tab does not record another visit because tracking is limited to once per browser session.

Stop all three local services with `Ctrl+C` in the terminal running `dev.sh`.

SpacetimeAuth itself is hosted and cannot be fully exercised against the disposable local database. Test its redirect on production after configuring the exact canonical admin URL below.

## Local checks before pushing

Run the same core checks used by CI:

```bash
npm test
npm run typecheck
npm run build
```

For the browser tests, start the local stack in one terminal:

```bash
./dev.sh
```

Then run this in another terminal:

```bash
npm run test:e2e
```

To inspect the browser tests interactively instead:

```bash
./test/run_cypress.sh
```

You can also validate the Worker package without deploying it:

```bash
WRANGLER_LOG_PATH=/tmp/milan-wrangler.log npx wrangler deploy --dry-run --config worker/wrangler.jsonc
```

## Admin login

The visit dashboard is available at:

```text
https://milanexcavatingpa.com/admin
```

Cloudflare Pages canonicalizes `admin.html` to `/admin`. In the [SpacetimeDB dashboard](https://spacetimedb.com/milan-excavating), open **SpacetimeAuth → Clients**, edit client `client_034MjxE6XYq2KZBezBMYV9`, and add both values below to **Redirect URIs** and **Post Logout Redirect URIs**:

- `https://milanexcavatingpa.com/admin`
- `https://www.milanexcavatingpa.com/admin`

Then:

1. Open `/admin` and click **Email me a sign-in link**.
2. Complete the email login once so the user exists.
3. In **SpacetimeAuth → Users**, assign that user the role named exactly `admin`.
4. Sign out and sign in again so the new token includes the role.

The dashboard shows lifetime visits and the latest 14 daily totals. Anonymous and non-admin users receive no analytics rows.

## Deployment

Pushes to `master` are mirrored from Gitea to GitHub. GitHub Actions then tests and deploys in this order:

1. SpacetimeDB module
2. Cloudflare gateway Worker
3. Cloudflare Pages site

The production environment requires these GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SPACETIMEDB_DEPLOY_TOKEN`
- `SPACETIMEDB_SERVICE_TOKEN`

It also requires these GitHub variables:

- `SPACETIMEDB_GATEWAY_IDENTITY`
- `PUBLIC_API_BASE_URL`
- `SPACETIMEAUTH_CLIENT_ID`

The Cloudflare CI token needs `Workers Scripts: Edit` and `Cloudflare Pages: Edit` for the production account.

The one-time guarded setup helper is:

```bash
./scripts/setup-production.sh
```

## Production acceptance

- `/health` returns `{ "status": "ok" }`.
- `POST /api/estimates` returns `404`.
- The public page shows phone contact buttons and no web form.
- A page load records one visit per browser session.
- `/admin` initiates SpacetimeAuth using the `/admin` redirect URI.
- Anonymous and non-admin subscribers receive no visit rows.
