#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <seed|delta> <snapshot.json> [--local|--remote]" >&2
}

if [[ $# -ne 3 || ! "$1" =~ ^(seed|delta)$ || ! "$3" =~ ^--(local|remote)$ ]]; then usage; exit 2; fi
mode="$1"
snapshot="$2"
target="$3"
[[ -f "$snapshot" ]] || { echo "Snapshot does not exist: $snapshot" >&2; exit 1; }

jq -e '
  (.lifetime | type == "number" and floor == . and . >= 0) and
  (.daily | type == "array") and
  all(.daily[]; (.date | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and (.total | type == "number" and floor == . and . >= 0)) and
  ([.daily[].date] | length == (unique | length))
' "$snapshot" >/dev/null || { echo "Snapshot must contain a nonnegative integer lifetime and unique UTC daily rows." >&2; exit 1; }

sql_file="$(mktemp /tmp/milan-d1-import.XXXXXX.sql)"
trap 'rm -f "$sql_file"' EXIT

if [[ "$mode" == seed ]]; then
  printf 'INSERT INTO lifetime_visits (id, total) VALUES (1, %s) ON CONFLICT(id) DO UPDATE SET total = excluded.total;\n' "$(jq -r '.lifetime' "$snapshot")" >> "$sql_file"
  while IFS=$'\t' read -r date total; do
    printf "INSERT INTO daily_visits (date, total) VALUES ('%s', %s) ON CONFLICT(date) DO UPDATE SET total = excluded.total;\n" "$date" "$total" >> "$sql_file"
  done < <(jq -r '.daily[] | [.date, .total] | @tsv' "$snapshot")
else
  printf 'UPDATE lifetime_visits SET total = total + %s WHERE id = 1;\n' "$(jq -r '.lifetime' "$snapshot")" >> "$sql_file"
  while IFS=$'\t' read -r date total; do
    printf "INSERT INTO daily_visits (date, total) VALUES ('%s', %s) ON CONFLICT(date) DO UPDATE SET total = total + excluded.total;\n" "$date" "$total" >> "$sql_file"
  done < <(jq -r '.daily[] | [.date, .total] | @tsv' "$snapshot")
fi

wrangler_args=(d1 execute DB "$target" --config worker/wrangler.jsonc --file "$sql_file")
if [[ "$target" == --local ]]; then
  wrangler_args+=(--env local)
  if [[ -n "${D1_PERSIST_TO:-}" ]]; then wrangler_args+=(--persist-to "$D1_PERSIST_TO"); fi
else
  wrangler_args+=(--env=)
fi
WRANGLER_LOG_PATH=/tmp/milan-d1-wrangler.log npx wrangler "${wrangler_args[@]}"
echo "Applied $mode snapshot to D1 ($target)."
