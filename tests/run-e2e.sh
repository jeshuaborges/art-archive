#!/usr/bin/env bash
# Fresh local archive -> seed through the API -> browser tests at phone size.
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f -- "[-]-port 8791" 2>/dev/null || true; true
STATE=$(mktemp -d)
npx vite build >/dev/null
npx wrangler d1 migrations apply DB --local --env dev --persist-to "$STATE" >/dev/null
npx wrangler dev --env dev --port 8791 --persist-to "$STATE" --inspector-port 9233 >/tmp/e2e-8791.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; pkill -f -- "[-]-port 8791" 2>/dev/null || true; rm -rf "$STATE"' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8791/ && break; sleep 1; done
BASE=http://localhost:8791 node scripts/seed.mjs >/dev/null
rm -f tests/shots/*.png
E2E_BASE=http://localhost:8791 python3 tests/e2e.py
