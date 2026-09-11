#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
environment="production"
spacetime_uri="https://maincloud.spacetimedb.com"
spacetime_database="milan-excavating"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-production.sh

Interactively configures the GitHub production environment used by deploy.yml.
It creates a dedicated SpacetimeDB identity for visit recording and stores all
deployment credentials without printing them.

Optional environment defaults:
  GITHUB_REPOSITORY             OWNER/REPO
  CLOUDFLARE_ACCOUNT_ID         Cloudflare account ID
  CLOUDFLARE_API_TOKEN          CI token with Workers Scripts and Pages edit
  PUBLIC_API_BASE_URL           Deployed Worker origin, without a trailing slash
  SPACETIMEAUTH_CLIENT_ID       SpacetimeAuth OIDC client ID
  SPACETIMEDB_DEPLOY_TOKEN      Database-owner token
  SPACETIMEDB_GATEWAY_IDENTITY  Reuse an existing gateway identity
  SPACETIMEDB_SERVICE_TOKEN     Token paired with the reused identity
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
if [[ $# -ne 0 ]]; then usage >&2; exit 2; fi
if [[ ! -t 0 ]]; then echo "This setup is interactive and requires a terminal." >&2; exit 1; fi

for command_name in curl gh jq npm sed spacetime; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done

confirm() {
  local prompt="$1" answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^([yY]|yes|YES)$ ]]
}

prompt_value() {
  local variable_name="$1" label="$2" default_value="$3" value=""
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " value
    value="${value:-$default_value}"
  else
    while [[ -z "$value" ]]; do read -r -p "$label: " value; done
  fi
  printf -v "$variable_name" '%s' "$value"
}

read_secret() {
  local variable_name="$1" label="$2" existing_value="${3:-}" value=""
  if [[ -n "$existing_value" ]]; then
    value="$existing_value"
  else
    while [[ -z "$value" ]]; do read -r -s -p "$label (input hidden): " value; echo; done
  fi
  [[ "$value" != *[$'\n\r']* ]] || { echo "$label must be a single line." >&2; exit 1; }
  printf -v "$variable_name" '%s' "$value"
  unset value
}

set_secret() { printf '%s' "$2" | gh secret set "$1" --env "$environment" --repo "$github_repository"; }
set_variable() { printf '%s' "$2" | gh variable set "$1" --env "$environment" --repo "$github_repository"; }

validate_cloudflare_token() {
  local token="$1" account="$2" response
  response="$(curl --disable -fsS "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts" -H "Authorization: Bearer $token")" || return 1
  jq -e '.success == true' >/dev/null <<<"$response" || return 1
  response="$(curl --disable -fsS "https://api.cloudflare.com/client/v4/accounts/$account/pages/projects/milan-excavating-site" -H "Authorization: Bearer $token")" || return 1
  jq -e '.success == true' >/dev/null <<<"$response"
}

cd "$project_root"
gh auth status --hostname github.com >/dev/null

default_repository="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)}"
prompt_value github_repository "GitHub repository (OWNER/REPO)" "$default_repository"
[[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid GitHub repository name." >&2; exit 1; }

prompt_value cloudflare_account_id "Cloudflare account ID" "${CLOUDFLARE_ACCOUNT_ID:-}"
[[ "$cloudflare_account_id" =~ ^[A-Fa-f0-9]{32}$ ]] || { echo "Cloudflare account ID must be 32 hexadecimal characters." >&2; exit 1; }

prompt_value public_api_base_url "Production gateway origin" "${PUBLIC_API_BASE_URL:-}"
public_api_base_url="${public_api_base_url%/}"
[[ "$public_api_base_url" =~ ^https://[^/]+$ ]] || { echo "Gateway origin must look like https://api.example.com (no path)." >&2; exit 1; }

if [[ -z "${SPACETIMEAUTH_CLIENT_ID:-}" ]]; then
  echo "Open https://spacetimedb.com/$spacetime_database and copy the public client ID from SpacetimeAuth → Clients."
fi
prompt_value spacetimeauth_client_id "SpacetimeAuth client ID" "${SPACETIMEAUTH_CLIENT_ID:-}"
[[ "$spacetimeauth_client_id" =~ ^client_[A-Za-z0-9]+$ ]] || { echo "SpacetimeAuth client ID must look like client_abc123." >&2; exit 1; }

reuse_gateway=false
if [[ -n "${SPACETIMEDB_GATEWAY_IDENTITY:-}" || -n "${SPACETIMEDB_SERVICE_TOKEN:-}" ]]; then
  [[ -n "${SPACETIMEDB_GATEWAY_IDENTITY:-}" && -n "${SPACETIMEDB_SERVICE_TOKEN:-}" ]] || {
    echo "Set both SPACETIMEDB_GATEWAY_IDENTITY and SPACETIMEDB_SERVICE_TOKEN, or neither." >&2
    exit 1
  }
  reuse_gateway=true
fi

echo
echo "Production setup manifest"
echo "  GitHub destination: $github_repository / environment $environment"
echo "  Cloudflare account: $cloudflare_account_id"
echo "  Gateway origin: $public_api_base_url"
echo "  SpacetimeDB: $spacetime_uri / $spacetime_database"
echo "  Gateway identity: $([[ "$reuse_gateway" == true ]] && echo reuse || echo create)"
confirm "Create/update these production settings?" || exit 0

gh api --method PUT "repos/$github_repository/environments/$environment" >/dev/null

if [[ "$reuse_gateway" == true ]]; then
  gateway_identity="$SPACETIMEDB_GATEWAY_IDENTITY"
  gateway_token="$SPACETIMEDB_SERVICE_TOKEN"
else
  identity_response="$(curl --disable -fsS -X POST "$spacetime_uri/v1/identity")"
  gateway_identity="$(jq -er '.identity | select(type == "string" and test("^\\S+$"))' <<<"$identity_response")"
  gateway_token="$(jq -er '.token | select(type == "string" and test("^\\S+$"))' <<<"$identity_response")"
  unset identity_response
fi
set_secret SPACETIMEDB_SERVICE_TOKEN "$gateway_token"
set_variable SPACETIMEDB_GATEWAY_IDENTITY "$gateway_identity"
unset gateway_token gateway_identity SPACETIMEDB_SERVICE_TOKEN

read_secret cloudflare_api_token "Cloudflare CI API token" "${CLOUDFLARE_API_TOKEN:-}"
if ! validate_cloudflare_token "$cloudflare_api_token" "$cloudflare_account_id"; then
  unset cloudflare_api_token
  echo "Cloudflare rejected the CI token. It needs Workers Scripts: Edit and Cloudflare Pages: Edit for this account." >&2
  exit 1
fi
set_secret CLOUDFLARE_API_TOKEN "$cloudflare_api_token"
unset cloudflare_api_token CLOUDFLARE_API_TOKEN
set_secret CLOUDFLARE_ACCOUNT_ID "$cloudflare_account_id"

if [[ -n "${SPACETIMEDB_DEPLOY_TOKEN:-}" ]]; then
  spacetime_deploy_token="$SPACETIMEDB_DEPLOY_TOKEN"
else
  spacetime_login_output="$(spacetime login show --token)"
  spacetime_deploy_token="$(sed -n "s/^Your auth token (don't share this!) is //p" <<<"$spacetime_login_output")"
  unset spacetime_login_output
  [[ -n "$spacetime_deploy_token" ]] || read_secret spacetime_deploy_token "SpacetimeDB database-owner deployment token" ""
fi
set_secret SPACETIMEDB_DEPLOY_TOKEN "$spacetime_deploy_token"
unset spacetime_deploy_token SPACETIMEDB_DEPLOY_TOKEN

set_variable PUBLIC_API_BASE_URL "$public_api_base_url"
set_variable SPACETIMEAUTH_CLIENT_ID "$spacetimeauth_client_id"

echo
echo "Setup complete. Push to master or run:"
echo "  gh workflow run deploy.yml --repo $github_repository --ref master"
