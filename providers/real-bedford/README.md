# The reference Class D pipe

A deliberately boring Brain Protocol v2 data provider (BUILD-BRIEF §4): Postgres with row-level
security, a small Node server, no AI, no UI. It implements the data-layer laws (BP-02) and the
provider profile of BP-03/BP-04, and passes the Class D suite from a clean start. It is the kit's
own proof and the partner onboarding artefact — small enough to read in an afternoon.

> **This is a conformance reference, not a production server.** It ships unauthenticated `/test/*`
> endpoints (for out-of-band key pinning, BUILD-BRIEF §6.3) and the `BRAIN_BREAK` law-breaker, and
> serves plain HTTP. It refuses to start under `NODE_ENV=production` or `BRAIN_PRODUCTION=1`. Read it
> to learn the laws and copy the patterns; do not deploy it as your Class D system. A production
> system implements the same laws but issues grants through the BP-03 §6 consent ceremony and
> terminates TLS at the edge. See [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md) for the full self-audit.

## T-REF-01 — clean-start run (AC-09.1)

From a clean clone, with Node 22+:

```bash
cd reference && npm install
npx tsx serve.ts 8080        # starts an embedded Postgres + the wire server
# in another shell:
cd kit && npm install
npx tsx src/cli.ts run --class D --target http://localhost:8080 --adapter ../reference/adapter.ts
```

Or, from the repo root, the whole thing in one command: `./run-conformance.sh`. Expected result:
**46/46 pass, verdict PASS**. The reference reads its own system id from `BRAIN_SYSTEM_ID`
(default `brain-reference`); `BRAIN_SYSTEM_ID=anything ./run-conformance.sh` still passes 46/46,
which is how CI proves the kit is not coupled to any particular system's name. No out-of-band question is needed beyond fingerprint verification
(BP-03 §2.3.3, deliberately out-of-band). Postgres is embedded (`embedded-postgres`), so there is
no external database to provision — the pipe brings up its own and tears it down on exit.

## What's inside

- `db/schema.sql` — the four primitives, the append-only journal, the vault schema, and the
  derived-memory store; row-level security with `force row level security` and the BP-02 §3.1
  visibility predicate; the children's-wall trigger; provenance-totality constraints; and
  `SECURITY DEFINER` lens helpers. Two roles: the owner ingests (bypassing RLS to write any
  member's rows), and every read runs under `SET LOCAL ROLE brain_app` so RLS bites against a
  non-owner exactly as a member or peer would hit it.
- `src/pipe.ts` — the data layer: ingest with boundary validation and the laws (unknown-scope-
  fails-closed, children's wall, the BP-01 §12 derivation rule), RLS reads under a member lens,
  the vault, the append-only journal, the per-exchange audit log, forget-on-disconnect (dependency-
  ordered purge, audit-to-zero, receipt), backup/restore with forget-log replay, staged atomic
  resync, and the Class D gate store.
- `src/server.ts` / `serve.ts` — the wire surface: the signed agent card at the well-known path,
  the OAuth token endpoint, and the A2A JSON-RPC endpoint with JWS proof-of-possession, grant-
  matrix enforcement, bounds and rate limits, dark-by-default execution, the loop guard, the S3
  wall, the SSRF guard, and the BP-04 error model.
- `src/validate.ts` — the pipe's own boundary validator built from the canonical `schemas/`
  (BP-09 §1, layer 3: every receiver re-fences regardless of what a peer's certificate claims).
- `adapter.ts` — implements the frozen TCK adapter contract against the pipe.

## T-REF-02 — break a law, watch the kit catch it (AC-09.2)

```bash
cd reference && ./break-a-law.sh           # all breaks
./break-a-law.sh adapter                    # only the in-process breaks (fast, no server)
./break-a-law.sh wire                       # only the served breaks
```

Each break is a `BRAIN_BREAK` toggle that disables exactly one law, and the harness asserts the
corresponding suite goes red: `envelope` (BP-01 → T-ENV-01), `rls` (BP-02 → T-DAT-01), `pop`
(BP-03 → T-SEC-06), `loopguard` (BP-04 → T-COM-02), `s3` (BP-07 → T-SEC-01), `gates` (BP-08 →
T-GAT-09). `BRAIN_BREAK` is a test affordance and must never be set in production.

## Build order

The BP-02 §8 thirteen-point Class D checklist is the build order this pipe follows: owner/
visibility/sensitivity/source/refs/bitemporal columns; RLS deny-by-default; the children's wall;
provenance totality; the append-only journal; the vault; forget-on-disconnect with audit and
receipt; 401-as-disconnect; backup-window replay; bounds and rate; the local audit log;
`records.export` under lens and ceiling; and the dated-requirement derivation rule.
