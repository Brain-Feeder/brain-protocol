# Brain Protocol TCK — Class D

The executable Technology Compatibility Kit (BP-09 §2). It connects to a system under test as a
peer and through a thin adapter, seeds, attacks, and asserts, then emits a machine-readable
results file you publish for self-certification. Green is the precondition for connecting to the
mesh (INDEX step 9, BP-09 §2).

**Status:** Class D suite, 46 tests, green from a clean clone (CI-gated; the reference pipe self-
certifies and `break-a-law` proves the suite bites). Suite version 2.0.3.

## Quickstart

From a clean clone, the whole Class D run is one command:

```bash
./run-conformance.sh
```

That installs dependencies, starts the reference pipe's wire server on `:8080`, runs the full
Class D suite against it, writes `kit/results.json`, and tears the server down. A clean Class D
implementation passes **46/46** (the definition of done, BUILD-BRIEF §7).

To run the kit against your own system instead of the reference:

```bash
cd kit && npm install
# 1. stand up your system's wire endpoint (signed card, token, A2A) at some base URL
# 2. write an adapter (see ADAPTER.md) exporting a default factory at ../path/to/adapter.ts
npx tsx src/cli.ts run --class D \
  --target http://localhost:8080 \
  --adapter ../path/to/adapter.ts \
  --out results.json
```

Flags: `--class D`, `--target <base-url>` (the wire surface), `--adapter <file>` (the data-layer
surface), `--out <file>` (results), `--only T-ENV,T-DAT` (run a subset), `--strict` (fail instead
of skip when a surface is missing), `--system-id <id>` (override the target's own system id).

The kit never assumes your system's name. It learns your `system_id` from your verified agent card
at the start of a run (the loop-guard test, T-COM-02, reflects your own id back at you to prove you
reject echoes). If your card cannot be fetched, pass `--system-id`. A system honestly named anything
must certify — and CI proves it by renaming the reference and re-passing 46/46.

## The two surfaces

Wire-reachable behaviour — handshake, signatures, bounds, errors, dark-by-default — is tested over
real A2A/MCP HTTP against `--target`, with the kit playing a counterpart system (its own signed
card, per-grant Ed25519/X25519 keys, JWS proof-of-possession, nonce replay, clock skew). Data-layer
laws — adversarial visibility, vault invisibility, journal immutability, forget-to-zero, restore
replay — cannot be proven from the wire, so you supply a thin **adapter** the kit drives in process.
The adapter is your code against your own store; the kit never sees your credentials. The contract
is frozen and documented in [ADAPTER.md](./ADAPTER.md).

## What runs (46 tests, BP-09 §2.10)

`ENV-01…10` envelope and vocabulary · `DAT-01…11` the data-layer laws · `HSK-01…06` handshake,
identity, grants · `COM-01/02/03/06/07/08` communications and sync · `SEC-01/02/05/06/07/08/10/11`
security and sensitivity · `GAT-01/02/03/04/09` human gates. Every test id matches the BP-09
catalogue exactly, and every assertion message names the spec clause it enforces. Nothing is
asserted: each test seeds, attacks, and observes the system, then reports what it saw.

## Results

`results.json` validates against `schemas/tck-results.schema.json` and carries the suite version,
per-test pass/fail/skip with evidence pointers, and an overall verdict. A class passes only when
**every** test passes — a skip means the suite did not prove the law, so the verdict is `fail`.
Publish the file at a stable URL and reference it from your registry entry (`tck.results_url`).

## The reference is the proof

The reference pipe in `../reference/` is a deliberately small Postgres + RLS Class D provider that
passes this suite from a clean start (T-REF-01). It is both the kit's own proof and the best
onboarding artefact a partner gets — read it in an afternoon. To prove the kit is a real gate and
not a rubber stamp, `../reference/break-a-law.sh` deliberately breaks one law per spec and confirms
the corresponding suite goes red (T-REF-02): break BP-01's envelope validation and `T-ENV-01`
fails; break BP-02's RLS and `T-DAT-01` fails; break BP-03's proof-of-possession and `T-SEC-06`
fails; and so on through BP-04, BP-07, BP-08.

## Determinism and privacy

Fixed seeds, stable test ids, every assertion clause-named. The kit runs locally and transmits
nothing except to `--target` — `T-SEC-11` captures the session's network and fails on any non-peer
egress (CD-3).
