#!/usr/bin/env bash
set -euo pipefail

database="${SPACETIMEDB_DATABASE:-milan-excavating}"
backup_root="${1:-backups/spacetimedb}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_root/$timestamp"
mkdir -p "$destination"

spacetime sql --no-config --server maincloud --format json "$database" 'SELECT * FROM lifetime_visit' > "$destination/lifetime_visit.json"
spacetime sql --no-config --server maincloud --format json "$database" 'SELECT * FROM daily_visit' > "$destination/daily_visit.json"
spacetime sql --no-config --server maincloud --format json "$database" 'SELECT * FROM estimate_request' > "$destination/estimate_request.json"

jq -n \
  --slurpfile lifetime "$destination/lifetime_visit.json" \
  --slurpfile daily "$destination/daily_visit.json" \
  '{
    lifetime: ($lifetime[0][0].rows[0][1] // 0),
    daily: [$daily[0][0].rows[] | {date: .[0], total: .[1]}]
  }' > "$destination/analytics-snapshot.json"

echo "$destination"
