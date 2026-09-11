#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

for command_name in node npm spacetime curl jq; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done

npm run build:client
runtime_dir="$(mktemp -d /tmp/milan-spacetimedb.XXXXXX)"
child_pids=()
cleanup() {
  for pid in "${child_pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$runtime_dir"
}
trap cleanup EXIT INT TERM

echo "Starting local SpacetimeDB on http://127.0.0.1:3000"
spacetime start --listen-addr 127.0.0.1:3000 --data-dir "$runtime_dir" --in-memory --non-interactive &
child_pids+=("$!")
for _ in $(seq 1 40); do
  curl -fsS http://127.0.0.1:3000/v1/identity/public-key >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS http://127.0.0.1:3000/v1/identity/public-key >/dev/null

spacetime publish milan-excavating-local --server local --module-path spacetimedb --delete-data=never --yes
gateway_json="$(curl -fsS -X POST http://127.0.0.1:3000/v1/identity)"
gateway_identity="$(jq -er '.identity' <<<"$gateway_json")"
gateway_token="$(jq -er '.token' <<<"$gateway_json")"
unset gateway_json
spacetime call --server local milan-excavating-local configure_security "$gateway_identity" client_local
(
  umask 077
  printf '%s\n' \
    'ALLOWED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000' \
    'SPACETIMEDB_BASE_URL=http://127.0.0.1:3000' \
    'SPACETIMEDB_DATABASE=milan-excavating-local' \
    "SPACETIMEDB_TOKEN=$gateway_token" > worker/.dev.vars
)
unset gateway_token gateway_identity

spacetime dev milan-excavating-local --project-path . --server local --server-only --yes &
child_pids+=("$!")
npm run dev:worker &
child_pids+=("$!")
npm run dev:pages &
child_pids+=("$!")

echo "Website: http://localhost:8000"
echo "Gateway: http://localhost:8787/health"
echo "Database: http://127.0.0.1:3000"
wait
