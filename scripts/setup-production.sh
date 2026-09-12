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
read -r -p "Cloudflare Access team domain (https://TEAM.cloudflareaccess.com): " access_team_domain
read -r -p "Cloudflare Access application audience (AUD): " access_aud
read -r -p "Approved admin email [emilan@ericmilan.dev]: " admin_email
admin_email="${admin_email:-emilan@ericmilan.dev}"

[[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid GitHub repository." >&2; exit 1; }
[[ "$access_team_domain" =~ ^https://[A-Za-z0-9-]+\.cloudflareaccess\.com$ ]] || { echo "Invalid Access team domain." >&2; exit 1; }
[[ -n "$access_aud" ]] || { echo "Access audience is required." >&2; exit 1; }
[[ "$admin_email" == "emilan@ericmilan.dev" ]] || { echo "Admin email must be emilan@ericmilan.dev." >&2; exit 1; }

auth_header="Authorization: Bearer $cloudflare_api_token"
for endpoint in d1/database access/apps access/policies access/identity_providers; do
  response="$(curl --disable -fsS "https://api.cloudflare.com/client/v4/accounts/$account_id/$endpoint" -H "$auth_header")" || {
    unset cloudflare_api_token auth_header
    echo "Cloudflare token cannot read $endpoint. Check the required token scopes." >&2
    exit 1
  }
  jq -e '.success == true' >/dev/null <<<"$response" || { echo "Cloudflare rejected access to $endpoint." >&2; exit 1; }
done

printf '%s' "$cloudflare_api_token" | gh secret set CLOUDFLARE_API_TOKEN --env "$environment" --repo "$github_repository"
printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env "$environment" --repo "$github_repository"
printf '%s' "$access_team_domain" | gh secret set ACCESS_TEAM_DOMAIN --env "$environment" --repo "$github_repository"
printf '%s' "$access_aud" | gh secret set ACCESS_AUD --env "$environment" --repo "$github_repository"
printf '%s' "$admin_email" | gh secret set ADMIN_EMAIL --env "$environment" --repo "$github_repository"
unset cloudflare_api_token auth_header

echo "Production secrets updated. Remove obsolete SpacetimeDB, SpacetimeAuth, PUBLIC_API_BASE_URL, and Turnstile repository settings after cutover acceptance."
