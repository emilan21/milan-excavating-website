#!/usr/bin/env bash
set -euo pipefail

required=(CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then echo "Missing required environment variable: $name" >&2; exit 1; fi
done

npm ci
npm run deploy:pages
echo "Pages deployment completed."
