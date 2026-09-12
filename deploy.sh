#!/usr/bin/env bash
set -euo pipefail

required=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID ACCESS_TEAM_DOMAIN ACCESS_AUD ADMIN_EMAIL)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then echo "Missing required environment variable: $name" >&2; exit 1; fi
done

npm ci
npm test
npm run typecheck
npm run build
npm run db:migrate:remote
jq -n \
  --arg team "$ACCESS_TEAM_DOMAIN" \
  --arg aud "$ACCESS_AUD" \
  --arg email "$ADMIN_EMAIL" \
  '{ACCESS_TEAM_DOMAIN: $team, ACCESS_AUD: $aud, ADMIN_EMAIL: $email}' |
  npx wrangler secret bulk --env= --config worker/wrangler.jsonc
npm run deploy:worker
npm run deploy:pages
echo "Deployment completed in D1 migration -> Worker -> Pages order."
