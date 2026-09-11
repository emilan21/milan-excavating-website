#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
environment="production"
production_domains=("milanexcavatingpa.com" "www.milanexcavatingpa.com")
widget_domains=("${production_domains[@]}" "localhost" "127.0.0.1")
spacetime_uri="https://maincloud.spacetimedb.com"
spacetime_database="milan-excavating"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-production.sh

Interactively provisions the GitHub production environment used by deploy.yml.
It can create or recover a Turnstile widget, creates a dedicated SpacetimeDB
gateway identity, and stores all deployment secrets without printing them.

Optional environment defaults:
  GITHUB_REPOSITORY             OWNER/REPO
  CLOUDFLARE_ACCOUNT_ID         Cloudflare account ID
  CLOUDFLARE_API_TOKEN          CI deployment token (kept secret)
  PUBLIC_API_BASE_URL           Deployed Worker origin, without a trailing slash
  SPACETIMEAUTH_CLIENT_ID       SpacetimeAuth OIDC client ID
  SPACETIMEDB_DEPLOY_TOKEN      Database-owner token (kept secret)
  SPACETIMEDB_GATEWAY_IDENTITY  Reuse an existing gateway identity
  SPACETIMEDB_SERVICE_TOKEN     Token paired with the reused identity (kept secret)
  TURNSTILE_SITE_KEY            Select an existing widget instead of creating one
  WRANGLER_BIN                  Canonical absolute Wrangler path outside this repo
  WRANGLER_VERSION              Exact version reported by WRANGLER_BIN (>= 4.109.0)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi
if [[ ! -t 0 ]]; then
  echo "This setup is interactive and requires a terminal." >&2
  exit 1
fi

for command_name in curl gh jq npm realpath sed spacetime; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

confirm() {
  local prompt="$1" answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

prompt_value() {
  local variable_name="$1" label="$2" default_value="$3" value
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " value
    value="${value:-$default_value}"
  else
    while [[ -z "${value:-}" ]]; do
      read -r -p "$label: " value
    done
  fi
  printf -v "$variable_name" '%s' "$value"
}

read_secret() {
  local variable_name="$1" label="$2" existing_value="${3:-}" value
  if [[ -n "$existing_value" ]]; then
    value="$existing_value"
  else
    while [[ -z "${value:-}" ]]; do
      read -r -s -p "$label (input hidden): " value
      echo
    done
  fi
  [[ "$value" != *[$'\n\r']* ]] || {
    unset value
    echo "$label must be a single line." >&2
    exit 1
  }
  printf -v "$variable_name" '%s' "$value"
  unset value
}

set_secret() {
  local name="$1" value="$2"
  printf '%s' "$value" | gh secret set "$name" --env "$environment" --repo "$github_repository"
}

set_variable() {
  local name="$1" value="$2"
  printf '%s' "$value" | gh variable set "$name" --env "$environment" --repo "$github_repository"
}

version_at_least_4_109() {
  local version="$1" major minor patch
  IFS=. read -r major minor patch <<<"$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]] || return 1
  (( major > 4 || (major == 4 && minor > 109) || (major == 4 && minor == 109 && patch >= 0) ))
}

resolve_wrangler() {
  local candidate="${WRANGLER_BIN:-}" expected="${WRANGLER_VERSION:-}" actual
  prompt_value candidate "Canonical Wrangler executable (absolute path, outside this repo)" "$candidate"
  [[ "$candidate" == /* && -x "$candidate" ]] || {
    echo "WRANGLER_BIN must be an executable absolute path." >&2
    exit 1
  }
  wrangler_bin="$(realpath "$candidate")"
  case "$wrangler_bin" in
    "$project_root"|"$project_root"/*)
      echo "Credential-bearing Turnstile commands cannot use project-local Wrangler." >&2
      exit 1
      ;;
  esac
  prompt_value expected "Exact Wrangler version you approve" "$expected"
  actual="$(WRANGLER_WRITE_LOGS=false WRANGLER_LOG=log WRANGLER_LOG_SANITIZE=true \
    "$wrangler_bin" --version 2>/dev/null | sed -nE 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -1)"
  [[ -n "$actual" && "$actual" == "$expected" ]] || {
    echo "Wrangler version mismatch: approved '$expected', executable reported '${actual:-unknown}'." >&2
    exit 1
  }
  version_at_least_4_109 "$actual" || {
    echo "Turnstile widget management requires Wrangler 4.109.0 or newer." >&2
    exit 1
  }
  wrangler_version="$actual"
}

validate_turnstile_secret() {
  local secret="$1" validation_response
  validation_response="$(
    printf '%s' "$secret" |
      jq -sRr '"secret=" + (@uri) + "&response=XXXX.DUMMY.TOKEN.XXXX"' |
      curl --disable -fsS "https://challenges.cloudflare.com/turnstile/v0/siteverify" \
        -H "Content-Type: application/x-www-form-urlencoded" --data-binary @-
  )"
  if ! jq -e '
    (.success == false) and
    ((."error-codes" // []) | index("invalid-input-response") != null) and
    ((."error-codes" // []) | index("invalid-input-secret") == null)
  ' >/dev/null <<<"$validation_response"; then
    unset validation_response
    return 1
  fi
  unset validation_response
}

cd "$project_root"
gh auth status --hostname github.com >/dev/null

default_repository="${GITHUB_REPOSITORY:-}"
if [[ -z "$default_repository" ]]; then
  default_repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
fi
prompt_value github_repository "GitHub repository (OWNER/REPO)" "$default_repository"
[[ "$github_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "Invalid GitHub repository name." >&2
  exit 1
}

prompt_value cloudflare_account_id "Cloudflare account ID" "${CLOUDFLARE_ACCOUNT_ID:-}"
[[ "$cloudflare_account_id" =~ ^[A-Fa-f0-9]{32}$ ]] || {
  echo "Cloudflare account ID must be 32 hexadecimal characters." >&2
  exit 1
}

prompt_value public_api_base_url "Production gateway origin" "${PUBLIC_API_BASE_URL:-}"
public_api_base_url="${public_api_base_url%/}"
[[ "$public_api_base_url" =~ ^https://[^/]+$ ]] || {
  echo "Gateway origin must look like https://api.example.com (no path)." >&2
  exit 1
}

echo
if [[ -z "${SPACETIMEAUTH_CLIENT_ID:-}" ]]; then
  echo "SpacetimeAuth is attached to a published Maincloud database, so the database"
  echo "must exist before its login settings can be enabled. The safe first publish"
  echo "below never deletes existing data."
  if confirm "Publish/update $spacetime_database on Maincloud now?"; then
    [[ "$(spacetime --version)" == *"2.10.0"* ]] || {
      echo "SpacetimeDB CLI 2.10.0 must be active." >&2
      exit 1
    }
    spacetime login show >/dev/null
    npm run build:module
    spacetime publish "$spacetime_database" --server maincloud --module-path spacetimedb --delete-data=never --yes=remote,migrate
  else
    echo "Publish the database first, then rerun this assistant." >&2
    exit 1
  fi
  echo
  echo "Now open https://spacetimedb.com/$spacetime_database and:"
  echo "  1. Open SpacetimeAuth in the left sidebar and click Use SpacetimeAuth."
  echo "  2. In Clients, edit the default browser client."
  echo "  3. Add both /admin.html production URLs as redirect and logout URLs."
  echo "  4. In Customization, enable Magic Link."
  echo "  5. Copy the public client ID (client_...). Do not use the client secret."
  echo "The owner can receive the admin role after their first login; the README has"
  echo "that final step."
fi
prompt_value spacetimeauth_client_id "SpacetimeAuth client ID" "${SPACETIMEAUTH_CLIENT_ID:-}"
[[ "$spacetimeauth_client_id" =~ ^client_[A-Za-z0-9]+$ ]] || {
  echo "SpacetimeAuth client ID must look like client_abc123." >&2
  exit 1
}

if [[ -n "${TURNSTILE_SITE_KEY:-}" ]]; then
  turnstile_mode="existing"
  turnstile_site_key="$TURNSTILE_SITE_KEY"
else
  prompt_value turnstile_mode "Turnstile widget mode (create/existing)" "create"
  [[ "$turnstile_mode" == "create" || "$turnstile_mode" == "existing" ]] || {
    echo "Turnstile mode must be 'create' or 'existing'." >&2
    exit 1
  }
  if [[ "$turnstile_mode" == "existing" ]]; then
    prompt_value turnstile_site_key "Existing Turnstile sitekey" ""
  fi
fi

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
echo "  Turnstile: $turnstile_mode managed widget for ${widget_domains[*]}"
echo "  SpacetimeDB gateway identity: $([[ "$reuse_gateway" == true ]] && echo reuse || echo create)"
echo "  Secrets: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,"
echo "           SPACETIMEDB_DEPLOY_TOKEN, SPACETIMEDB_SERVICE_TOKEN, TURNSTILE_SECRET"
echo "  Variables: SPACETIMEDB_GATEWAY_IDENTITY, PUBLIC_API_BASE_URL,"
echo "             TURNSTILE_SITE_KEY, SPACETIMEAUTH_CLIENT_ID"
echo
confirm "Create/update these production settings?" || exit 0

resolve_wrangler
export CLOUDFLARE_ACCOUNT_ID="$cloudflare_account_id"
if ! WRANGLER_WRITE_LOGS=false WRANGLER_LOG=log WRANGLER_LOG_SANITIZE=true \
  "$wrangler_bin" whoami --account "$cloudflare_account_id" --json >/dev/null; then
  echo "Wrangler is not authenticated for Cloudflare account $cloudflare_account_id." >&2
  echo "Authenticate the approved executable or export a token with Account.Turnstile:Edit, then retry." >&2
  exit 1
fi
gh api --method PUT "repos/$github_repository/environments/$environment" >/dev/null
expected_domains_json="$(printf '%s\n' "${widget_domains[@]}" | jq -Rsc 'split("\n")[:-1]')"
turnstile_domain_args=()
for domain in "${widget_domains[@]}"; do
  turnstile_domain_args+=(--domain "$domain")
done

if [[ "$turnstile_mode" == "create" ]]; then
  echo
  echo "Turnstile write manifest"
  echo "  Wrangler: $wrangler_bin ($wrangler_version)"
  echo "  Account: $cloudflare_account_id"
  echo "  Widget: milan-excavating-estimates (managed)"
  echo "  Domains: ${widget_domains[*]}"
  echo "  Secret destination: GitHub $github_repository / $environment / TURNSTILE_SECRET"
  confirm "Create this Turnstile widget?" || {
    echo "Stopped before widget creation." >&2
    exit 1
  }
  set +x
  widget_response="$(
    WRANGLER_WRITE_LOGS=false WRANGLER_LOG=log WRANGLER_LOG_SANITIZE=true \
      "$wrangler_bin" turnstile widget create "milan-excavating-estimates" \
      "${turnstile_domain_args[@]}" \
      --mode managed --json
  )" || {
    unset widget_response
    echo "Turnstile widget creation failed." >&2
    exit 1
  }
else
  requested_turnstile_site_key="$turnstile_site_key"
  echo
  echo "Turnstile recovery manifest"
  echo "  Wrangler: $wrangler_bin ($wrangler_version)"
  echo "  Account: $cloudflare_account_id"
  echo "  Sitekey: $turnstile_site_key"
  echo "  Required domains: ${widget_domains[*]}"
  echo "  Secret destination: GitHub $github_repository / $environment / TURNSTILE_SECRET"
  confirm "Retrieve and store this existing widget's secret?" || {
    echo "Stopped before secret retrieval." >&2
    exit 1
  }
  set +x
  widget_response="$(
    WRANGLER_WRITE_LOGS=false WRANGLER_LOG=log WRANGLER_LOG_SANITIZE=true \
      "$wrangler_bin" turnstile widget get "$turnstile_site_key" --json
  )" || {
    unset widget_response
    echo "Turnstile widget retrieval failed." >&2
    exit 1
  }
fi

turnstile_site_key="$(jq -er --argjson expected "$expected_domains_json" '
  . as $widget |
  select(
    ($widget.sitekey | type) == "string" and ($widget.sitekey | test("^\\S+$")) and
    ($widget.secret | type) == "string" and ($widget.secret | test("^\\S+$")) and
    ($widget.domains | type) == "array" and
    all($expected[]; . as $domain | $widget.domains | index($domain) != null)
  ) | $widget.sitekey
' <<<"$widget_response")" || {
  unset widget_response
  echo "Turnstile widget metadata did not contain the required sitekey, secret, and domains." >&2
  exit 1
}
if [[ "$turnstile_mode" == "existing" && "$turnstile_site_key" != "$requested_turnstile_site_key" ]]; then
  unset widget_response
  echo "Turnstile returned a different sitekey than the requested widget." >&2
  exit 1
fi
unset requested_turnstile_site_key
turnstile_secret="$(jq -er '.secret | select(test("^\\S+$"))' <<<"$widget_response")"
unset widget_response
echo "Validated Turnstile widget metadata for sitekey $turnstile_site_key."
if ! validate_turnstile_secret "$turnstile_secret"; then
  unset turnstile_secret
  echo "Turnstile rejected the widget secret." >&2
  exit 1
fi
set_secret TURNSTILE_SECRET "$turnstile_secret"
unset turnstile_secret
set_variable TURNSTILE_SITE_KEY "$turnstile_site_key"
echo "Stored Turnstile widget $turnstile_site_key."

if [[ "$reuse_gateway" == true ]]; then
  gateway_identity="$SPACETIMEDB_GATEWAY_IDENTITY"
  gateway_token="$SPACETIMEDB_SERVICE_TOKEN"
else
  echo
  confirm "Create a dedicated SpacetimeDB identity for the gateway?" || {
    echo "Stopped before SpacetimeDB identity creation." >&2
    exit 1
  }
  set +x
  identity_response="$(curl --disable -fsS -X POST "$spacetime_uri/v1/identity")"
  gateway_identity="$(jq -er '.identity | select(type == "string" and test("^\\S+$"))' <<<"$identity_response")"
  gateway_token="$(jq -er '.token | select(type == "string" and test("^\\S+$"))' <<<"$identity_response")"
  unset identity_response
fi
set_secret SPACETIMEDB_SERVICE_TOKEN "$gateway_token"
unset gateway_token SPACETIMEDB_SERVICE_TOKEN
set_variable SPACETIMEDB_GATEWAY_IDENTITY "$gateway_identity"
echo "Stored gateway identity $gateway_identity (token hidden)."
unset gateway_identity

read_secret cloudflare_api_token "Cloudflare CI API token" "${CLOUDFLARE_API_TOKEN:-}"
set_secret CLOUDFLARE_API_TOKEN "$cloudflare_api_token"
unset cloudflare_api_token CLOUDFLARE_API_TOKEN
set_secret CLOUDFLARE_ACCOUNT_ID "$cloudflare_account_id"

if [[ -n "${SPACETIMEDB_DEPLOY_TOKEN:-}" ]]; then
  spacetime_deploy_token="$SPACETIMEDB_DEPLOY_TOKEN"
else
  set +x
  spacetime_login_output="$(spacetime login show --token)"
  spacetime_deploy_token="$(sed -n "s/^Your auth token (don't share this!) is //p" <<<"$spacetime_login_output")"
  unset spacetime_login_output
  if [[ -z "$spacetime_deploy_token" ]]; then
    read_secret spacetime_deploy_token "SpacetimeDB database-owner deployment token" ""
  fi
fi
set_secret SPACETIMEDB_DEPLOY_TOKEN "$spacetime_deploy_token"
unset spacetime_deploy_token SPACETIMEDB_DEPLOY_TOKEN

set_variable PUBLIC_API_BASE_URL "$public_api_base_url"
set_variable SPACETIMEAUTH_CLIENT_ID "$spacetimeauth_client_id"

echo
echo "Configured GitHub environment '$environment':"
gh secret list --env "$environment" --repo "$github_repository" --json name --jq '.[].name' | sed 's/^/  secret: /'
gh variable list --env "$environment" --repo "$github_repository" --json name --jq '.[].name' | sed 's/^/  variable: /'

echo
echo "Setup is complete. The first deployment will publish the database, configure"
echo "the gateway identity, deploy the Worker, and deploy Pages in that order."
if confirm "Trigger deploy.yml on master now (the workflow change must already be pushed)?"; then
  gh workflow run deploy.yml --repo "$github_repository" --ref master
else
  echo "Deployment not triggered. Run: gh workflow run deploy.yml --repo $github_repository --ref master"
fi
