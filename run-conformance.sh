#!/usr/bin/env bash
# The Class D conformance run (BUILD-BRIEF §7, T-REF-01). Brings up the reference pipe's wire
# server, runs the full Class D suite against it (wire + adapter), writes machine-readable results,
# and tears the server down. Exit 0 iff 46/46 pass.
#
#   ./run-conformance.sh [--out results.json]
#
# This is the one command behind the definition of done and the CI gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"
OUT="${1:-$ROOT/kit/results.json}"
[ "${1:-}" = "--out" ] && OUT="${2:-$ROOT/kit/results.json}"
# Resolve a relative --out against the repo root (the invocation dir), because the suite runs after
# `cd "$ROOT/kit"`. CI passes `--out kit/results.json`; without this it became kit/kit/results.json
# and the run died with ENOENT on writing results AFTER passing 46/46 (CI red since run #1).
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac

echo "→ installing dependencies"
( cd "$ROOT/kit" && npm install --silent )
( cd "$ROOT/reference" && npm install --silent )

echo "→ starting the reference pipe on :$PORT"
( cd "$ROOT/reference" && npx tsx serve.ts "$PORT" ) > /tmp/reference-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do grep -q "listening on http" /tmp/reference-server.log && break; sleep 1; done
if ! grep -q "listening on http" /tmp/reference-server.log; then echo "reference failed to start:"; cat /tmp/reference-server.log; exit 2; fi

echo "→ running the Class D suite"
cd "$ROOT/kit"
npx tsx src/cli.ts run --class D --target "http://localhost:$PORT" --adapter ../reference/adapter.ts --out "$OUT"
