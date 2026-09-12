# Milan Excavating Website

The public site is static HTML on Cloudflare Pages. A Cloudflare Worker records one privacy-minimal visit per browser session in D1, and a Cloudflare Access-protected dashboard reads lifetime and daily totals. No visitor identifiers or other PII are stored.

## Architecture

- Pages serves `frontend/` on `milanexcavatingpa.com` and `www.milanexcavatingpa.com`.
- Worker routes cover `/api/*` and `/admin/api/*` on both hostnames.
- D1 database `milan-excavating-analytics` is bound as `DB`.
- `POST /api/visits` is public but accepts only allowed browser origins and an empty JSON object. Its D1 batch atomically increments UTC-daily and lifetime totals.
- `GET /admin/api/stats` requires a valid Cloudflare Access JWT, the configured Access audience, the exact email `emilan@ericmilan.dev`, and a production hostname.
- Cloudflare Access performs GitHub login before `/admin*` reaches Pages or the Worker. The browser has no custom OIDC code.

Estimate endpoints are intentionally absent.

## Local development

Requirements: Node.js and npm. Install dependencies, then start Pages, the Worker, and persistent local D1:

```bash
npm install
./dev.sh
```

`dev.sh` creates the ignored `worker/.dev.vars.local` on first run with `LOCAL_ADMIN_BYPASS=true`. That binding exists only in Wrangler's named `local` environment and is never declared in production configuration. Local endpoints are:

- Website: `http://localhost:8000`
- Worker: `http://localhost:8787`
- Health: `http://localhost:8787/api/health`
- Dashboard: `http://localhost:8000/admin`

Local D1 state is under `.wrangler/state`. Apply migrations independently with `npm run db:migrate:local`.

## Checks

```bash
npm run db:migrate:local
npm test
npm run test:d1
npm run typecheck
npm run build
WRANGLER_LOG_PATH=/tmp/milan-wrangler.log npx wrangler deploy --env= --dry-run --config worker/wrangler.jsonc
```

Browser tests require built assets and a server on port 8000:

```bash
python3 -m http.server 8000 --directory frontend
npm run test:e2e
```

## Cloudflare Access and GitHub

Use a Cloudflare API token scoped to account `14610bd4acb62d09ffc284286b59507e` and the `milanexcavatingpa.com` zone:

- Account: Workers Scripts Edit, Cloudflare Pages Edit, D1 Edit
- Account: Access Apps and Policies Edit
- Account: Access Organizations, Identity Providers, and Groups Edit
- Zone: Workers Routes Edit, Zone Read

Configure Access before deploying the D1-backed admin endpoint:

1. In Zero Trust, note the team domain: `https://TEAM.cloudflareaccess.com`.
2. Reuse the existing GitHub OAuth App. Change its homepage to the Access team domain and its callback to `https://TEAM.cloudflareaccess.com/cdn-cgi/access/callback`.
3. Generate a fresh GitHub OAuth client secret, enter the client ID and new secret into the Cloudflare Access GitHub identity provider, and invalidate the old SpacetimeAuth credential. Keep GitHub as the only login method.
4. Create a reusable Allow policy whose Emails selector contains only `emilan@ericmilan.dev`.
5. Create one self-hosted application with both application paths `milanexcavatingpa.com/admin*` and `www.milanexcavatingpa.com/admin*`. Attach the reusable policy, set the application session to 30 days, and enable instant authentication.
6. Copy the application Audience (AUD) tag. Store the team domain, AUD, and exact email as Worker/GitHub environment secrets using `./scripts/setup-production.sh`.

Cloudflare documents the GitHub callback and IdP setup at <https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/github/> and JWT validation at <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>.

The dashboard loads totals once and has a manual **Refresh** button. **Sign out** opens `/cdn-cgi/access/logout`.

## Deployment

GitHub Actions tests first, then deploys in this order:

1. apply pending remote D1 migrations;
2. update the Worker's Access validation secrets;
3. deploy the Worker;
4. deploy Pages.

The production GitHub environment requires secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAIL`. The setup helper validates that the Cloudflare token can read D1, Access apps, reusable policies, and identity providers before storing them.

The Worker currently keeps its `workers.dev` route only for migration diagnostics. Direct admin requests there are denied by the hostname check. After same-origin production acceptance, set `workers_dev` to `false` in `worker/wrangler.jsonc` and deploy the Worker again.

## Data cutover

Do the cutover in one maintenance window:

1. Apply the D1 schema: `npm run db:migrate:remote`.
2. Capture an initial SpacetimeDB export: `./scripts/export-spacetimedb.sh`. The command prints the timestamped, gitignored backup directory.
3. Seed its `analytics-snapshot.json`: `./scripts/import-analytics-snapshot.sh seed BACKUP/analytics-snapshot.json --remote`.
4. Configure Access, then deploy the D1 Worker while the old Pages build still points at the old service.
5. Capture a final SpacetimeDB export. Compute the stable-window additions:

   ```bash
   ./scripts/calculate-snapshot-delta.sh INITIAL/analytics-snapshot.json FINAL/analytics-snapshot.json > /tmp/milan-final-delta.json
   ./scripts/import-analytics-snapshot.sh delta /tmp/milan-final-delta.json --remote
   ```

6. Deploy Pages, validate, and export D1 with `npx wrangler d1 export DB --env= --remote --config worker/wrangler.jsonc --output BACKUP/d1-final.sql`.
7. Only after the acceptance checks pass, delete SpacetimeDB:

   ```bash
   spacetime delete --no-config --server maincloud milan-excavating --yes
   ```

8. Confirm whether the SpacetimeAuth project was removed; delete an orphan in its dashboard. Delete Worker secret `SPACETIMEDB_TOKEN`, then remove GitHub secrets/variables beginning with `SPACETIMEDB_` or `SPACETIMEAUTH_`, plus `PUBLIC_API_BASE_URL` and unused Turnstile settings. Retain the globally installed SpacetimeDB CLI.

Never run seed twice against a live D1 database. The final reconciliation uses additive deltas so D1 visits recorded after Worker cutover are not overwritten.

## Production acceptance

- `GET /api/health` returns `{ "status": "ok" }`.
- A controlled browser session increments the UTC day and lifetime totals exactly once.
- `/admin` redirects immediately to GitHub through Access.
- `emilan@ericmilan.dev` sees the migrated totals and Refresh works.
- Anonymous, wrong-account, invalid-token, and direct `workers.dev` admin requests are denied.
- D1 equals the final SpacetimeDB snapshot plus visits received by D1 during reconciliation.
