#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

for command_name in node npm; do
  command -v "$command_name" >/dev/null || { echo "Missing required command: $command_name" >&2; exit 1; }
done

create_dev_vars() {
  umask 077
  printf '%s\n' \
    'LOCAL_ADMIN_BYPASS=true' \
    'ALLOWED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000' \
    'ACCESS_TEAM_DOMAIN=https://local.invalid' \
    'ACCESS_AUD=local' \
    'ADMIN_EMAIL=local@example.test' > worker/.dev.vars.local
}

if [[ ! -f worker/.dev.vars.local ]]; then
  create_dev_vars
  echo "Created worker/.dev.vars.local with the local-only admin bypass."
fi

npm run db:migrate:local
LOCAL_API_BASE_URL=http://localhost:8787 npm run build:client

child_pids=()
cleanup() {
  for pid in "${child_pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

npm run dev:worker &
child_pids+=("$!")
npm run dev:pages &
child_pids+=("$!")

echo "Website: http://localhost:8000"
echo "Worker health: http://localhost:8787/api/health"
echo "Admin (local bypass): http://localhost:8000/admin"
echo "D1 data persists under .wrangler/state"
wait
