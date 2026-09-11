#!/usr/bin/env bash
set -euo pipefail

required=(
  CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SPACETIMEDB_DEPLOY_TOKEN
  SPACETIMEDB_SERVICE_TOKEN SPACETIMEDB_GATEWAY_IDENTITY
  PUBLIC_API_BASE_URL SPACETIMEDB_URI SPACETIMEDB_DATABASE
  SPACETIMEAUTH_CLIENT_ID
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then echo "Missing required environment variable: $name" >&2; exit 1; fi
done

npm ci
npm ci --prefix spacetimedb
npm test
npm run typecheck
BUILD_ENV=production npm run build
spacetime login --token "$SPACETIMEDB_DEPLOY_TOKEN"
spacetime publish "$SPACETIMEDB_DATABASE" --server maincloud --module-path spacetimedb --delete-data=never --yes=remote,migrate
spacetime call --no-config --server maincloud "$SPACETIMEDB_DATABASE" configure_security "$SPACETIMEDB_GATEWAY_IDENTITY" "$SPACETIMEAUTH_CLIENT_ID"
jq -n --arg spacetime "$SPACETIMEDB_SERVICE_TOKEN" \
  '{SPACETIMEDB_TOKEN: $spacetime}' |
  npx wrangler secret bulk --config worker/wrangler.jsonc
npm run deploy:worker
npm run deploy:pages
echo "Deployment completed in database -> Worker -> Pages order."
