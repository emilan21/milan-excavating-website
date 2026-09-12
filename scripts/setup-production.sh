#!/usr/bin/env bash
set -euo pipefail

account_id="14610bd4acb62d09ffc284286b59507e"
environment="production"

for command_name in curl gh jq; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done
[[ -t 0 ]] || { echo "This setup is interactive and requires a terminal." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null

read -r -p "GitHub repository (OWNER/REPO): " github_repository
read -r -s -p "Cloudflare API token (input hidden): " cloudflare_api_token; echo

[[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid GitHub repository." >&2; exit 1; }

auth_header="Authorization: Bearer $cloudflare_api_token"
response="$(curl --disable -fsS "https://api.cloudflare.com/client/v4/accounts/$account_id/pages/projects/milan-excavating-site" -H "$auth_header")" || {
  unset cloudflare_api_token auth_header
  echo "Cloudflare token cannot read the Pages project. Check its Pages permissions." >&2
  exit 1
}
jq -e '.success == true and .result.name == "milan-excavating-site"' >/dev/null <<<"$response" || {
  unset cloudflare_api_token auth_header
  echo "Cloudflare rejected access to the milan-excavating-site Pages project." >&2
  exit 1
}

printf '%s' "$cloudflare_api_token" | gh secret set CLOUDFLARE_API_TOKEN --env "$environment" --repo "$github_repository"
printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env "$environment" --repo "$github_repository"
unset cloudflare_api_token auth_header

echo "Production Pages deployment secrets updated."
