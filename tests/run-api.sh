#!/usr/bin/env bash
# Starts three fresh wrangler dev servers and runs the API integration tests.
#   8788: dev environment (dev identity, local D1/R2, cron test endpoint)
#   8789: dev environment with dev auth turned off  -> everything must 401
#   8790: dev environment with Access configured     -> must fail closed
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f -- "[-]-port 8788" 2>/dev/null || true; pkill -f -- "[-]-port 8789" 2>/dev/null || true; pkill -f -- "[-]-port 8790" 2>/dev/null || true; true
STATE=$(mktemp -d)
npx vite build >/dev/null
npx wrangler d1 migrations apply DB --local --env dev --persist-to "$STATE" >/dev/null
P1=; P2=; P3=
trap 'kill $P1 $P2 $P3 2>/dev/null; pkill -f -- "[-]-port 8788" 2>/dev/null || true; pkill -f -- "[-]-port 8789" 2>/dev/null || true; pkill -f -- "[-]-port 8790" 2>/dev/null || true; rm -rf "$STATE"' EXIT
# The servers share one state directory: start them one after another, as
# workerd can fail with SQLITE_BUSY when several open it at the same moment.
up() { for i in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$1/" && return; sleep 1; done; }
npx wrangler dev --env dev --port 8788 --persist-to "$STATE" --test-scheduled --inspector-port 9230 >/tmp/api-8788.log 2>&1 &
P1=$!; up 8788
npx wrangler dev --env dev --port 8789 --persist-to "$STATE" --var ALLOW_DEV_AUTH:false --inspector-port 9231 >/tmp/api-8789.log 2>&1 &
P2=$!; up 8789
npx wrangler dev --env dev --port 8790 --persist-to "$STATE" --var ACCESS_TEAM_DOMAIN:family.cloudflareaccess.com --var ACCESS_AUD:test-aud --inspector-port 9232 >/tmp/api-8790.log 2>&1 &
P3=$!; up 8790
node --test --test-concurrency=1 tests/api.test.mjs
