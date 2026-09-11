#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <current-kv-count>" >&2
  exit 2
fi
: "${SPACETIMEDB_DATABASE:=milan-excavating}"
spacetime call --no-config --server maincloud "$SPACETIMEDB_DATABASE" import_legacy_visit_total "$1"
echo "Imported legacy lifetime total. This reducer cannot be run twice."
