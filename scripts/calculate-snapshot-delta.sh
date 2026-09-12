#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <initial-snapshot.json> <final-snapshot.json>" >&2
  exit 2
fi

jq -n --slurpfile initial "$1" --slurpfile final "$2" '
  ($initial[0]) as $i | ($final[0]) as $f |
  if ($f.lifetime < $i.lifetime) then error("final lifetime is less than initial lifetime") else . end |
  {
    lifetime: ($f.lifetime - $i.lifetime),
    daily: [
      $f.daily[] as $day |
      (($i.daily | map(select(.date == $day.date)) | .[0].total) // 0) as $before |
      if ($day.total < $before) then error("final daily total is less than initial total for " + $day.date) else
        {date: $day.date, total: ($day.total - $before)}
      end |
      select(.total > 0)
    ]
  }
'
