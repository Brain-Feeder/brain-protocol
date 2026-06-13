#!/usr/bin/env bash
# T-REF-02 / AC-09.2 — the kit is the gate. Deliberately break one law per Class D spec and prove
# the corresponding suite catches it. "The kit that cannot catch a broken law is the thing that is
# broken." Each break is a BRAIN_BREAK toggle in the reference (never set in production).
#
# Usage:  ./break-a-law.sh            # all breaks
#         ./break-a-law.sh adapter    # only the in-process (adapter) breaks
#         ./break-a-law.sh wire       # only the served (wire) breaks
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$HERE/../kit"
PORT=8090
PASS=0; FAIL=0
MODE="${1:-all}"

# expect_caught <label> <break-test-id> ; runs with BRAIN_BREAK already exported / server already up
check_red() { # $1 label, $2 expected-failing test id, $3 'adapter'|'wire', $4 break name
  local label="$1" tid="$2" kind="$3" brk="$4"
  local out rc
  if [ "$kind" = adapter ]; then
    out=$(cd "$KIT" && BRAIN_BREAK="$brk" npx tsx src/cli.ts run --class D --adapter ../reference/adapter.ts --only "$tid" 2>/dev/null)
  else
    BRAIN_BREAK="$brk" npx tsx "$HERE/serve.ts" $PORT > /tmp/break-srv.log 2>&1 &
    local SRV=$!
    for i in $(seq 1 20); do grep -q "listening on http" /tmp/break-srv.log && break; sleep 1; done
    out=$(cd "$KIT" && npx tsx src/cli.ts run --class D --target http://localhost:$PORT --only "$tid" 2>/dev/null)
    kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
  fi
  if echo "$out" | grep -q "verdict: .*FAIL\|FAIL  $tid"; then
    echo "  ✓ $label — broke the law, kit caught it ($tid went red)"; PASS=$((PASS+1))
  else
    echo "  ✗ $label — BROKE THE LAW BUT KIT STAYED GREEN ($tid) — the kit is broken"; FAIL=$((FAIL+1))
  fi
}

echo "T-REF-02: break one law per spec, prove the suite catches it"
if [ "$MODE" = all ] || [ "$MODE" = adapter ]; then
  check_red "BP-01 envelope validation" T-ENV-01 adapter envelope
  check_red "BP-02 visibility (RLS)"     T-DAT-01 adapter rls
fi
if [ "$MODE" = all ] || [ "$MODE" = wire ]; then
  check_red "BP-03 proof-of-possession"  T-SEC-06 wire pop
  check_red "BP-04 loop guard"           T-COM-02 wire loopguard
  check_red "BP-04 ingest needs sync grant" T-COM-06 wire ingestauth
  check_red "BP-07 S3 wall"              T-SEC-01 wire s3
  check_red "BP-08 human gate"           T-GAT-09 wire gates
fi
echo ""
echo "break-a-law: $PASS caught, $FAIL missed"
[ "$FAIL" -eq 0 ]
