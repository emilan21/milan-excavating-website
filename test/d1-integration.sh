#!/usr/bin/env bash
set -euo pipefail

state_dir="$(mktemp -d /tmp/milan-d1-test.XXXXXX)"
trap 'rm -rf "$state_dir"' EXIT

WRANGLER_LOG_PATH=/tmp/milan-d1-test.log npx wrangler d1 migrations apply DB --env local --local --persist-to "$state_dir" --config worker/wrangler.jsonc >/dev/null

initial="$state_dir/initial.json"
delta="$state_dir/delta.json"
rollback="$state_dir/rollback.sql"
printf '%s\n' '{"lifetime":7,"daily":[{"date":"2026-09-10","total":4},{"date":"2026-09-11","total":3}]}' > "$initial"
printf '%s\n' '{"lifetime":2,"daily":[{"date":"2026-09-11","total":1},{"date":"2026-09-12","total":1}]}' > "$delta"

D1_PERSIST_TO="$state_dir" ./scripts/import-analytics-snapshot.sh seed "$initial" --local >/dev/null
D1_PERSIST_TO="$state_dir" ./scripts/import-analytics-snapshot.sh seed "$initial" --local >/dev/null
D1_PERSIST_TO="$state_dir" ./scripts/import-analytics-snapshot.sh delta "$delta" --local >/dev/null

result="$(WRANGLER_LOG_PATH=/tmp/milan-d1-test.log npx wrangler d1 execute DB --env local --local --persist-to "$state_dir" --config worker/wrangler.jsonc --json --command 'SELECT total FROM lifetime_visits WHERE id = 1; SELECT date, total FROM daily_visits ORDER BY date;')"
jq -e '.[0].results == [{"total":9}] and .[1].results == [{"date":"2026-09-10","total":4},{"date":"2026-09-11","total":4},{"date":"2026-09-12","total":1}]' <<<"$result" >/dev/null

printf '%s\n' 'UPDATE lifetime_visits SET total = total + 100 WHERE id = 1;' 'INSERT INTO daily_visits (date, total) VALUES ("2026-09-13", -1);' > "$rollback"
if WRANGLER_LOG_PATH=/tmp/milan-d1-test.log npx wrangler d1 execute DB --env local --local --persist-to "$state_dir" --config worker/wrangler.jsonc --file "$rollback" >/dev/null 2>&1; then
  echo "Expected invalid transaction to fail." >&2
  exit 1
fi
result="$(WRANGLER_LOG_PATH=/tmp/milan-d1-test.log npx wrangler d1 execute DB --env local --local --persist-to "$state_dir" --config worker/wrangler.jsonc --json --command 'SELECT total FROM lifetime_visits WHERE id = 1;')"
jq -e '.[0].results == [{"total":9}]' <<<"$result" >/dev/null

echo "D1 migration, idempotent seed, delta, and rollback checks passed."
