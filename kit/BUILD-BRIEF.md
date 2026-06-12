# Build Brief: the TCK and the Reference Pipe

*Brief for a dedicated build session. Written 12 June 2026. Owner: Peter McCormack. This is a
work brief, not a specification; the normative source is BP-09 and the specs it tests. The kit
and the reference implementation live in this repository (`kit/`, `reference/`) and ship as part
of the canonical package (BP-09 §1).*

---

## 1. Objective

Make the repository self-sufficient as a partner brief. Today a team handed this repo can build
to spec but cannot prove conformance, and by the suite's own law cannot connect (TCK green is
the precondition, INDEX step 9, BP-09 §2). This build closes that gap with two artefacts:

1. **The executable TCK, Class D suite** (46 tests): a CLI harness that connects to a system
   under test as a peer, seeds, attacks, and asserts, producing a machine-readable results file
   suitable for self-certification publishing (BP-09 §3.1).
2. **The reference Class D pipe** (`reference/`): a minimal, readable data provider that passes
   the Class D suite from a clean start within one working day, documented (T-REF-01). It is
   both the kit's own proof and the best onboarding artefact a partner gets.

Success criterion, verbatim from the suite: a stranger's team, given only this repository, can
build, prove, and connect a Class D system without one out-of-band question beyond fingerprint
verification (BP-03 §2.3.3, deliberately out-of-band).

## 2. Scope

**In:** the Class D suite (ENV-01..10, DAT-01..11, HSK-01..06, COM-01/02/03/06/07/08,
SEC-01/02/05/06/07/08/10/11, GAT-01/02/03/04/09, per BP-09 §2.10); the harness, adapter
contract, results format, kit-peer simulator; the reference pipe; T-REF-01 and the Class D
portion of T-REF-02 (break one law per spec on a branch, watch the suite catch it); CI workflow
running the kit against the reference on every push.

**Out (later phases):** Class A and H suites (the ≥50-case injection corpus runs only at A);
the registry and verified-certification machinery; BP-10 T-HIS/T-DEC tests (one-way doors are
with the council); any telemetry of any kind (forbidden, CD-3, and itself tested by T-SEC-11).

## 3. Architecture decisions (proposed, overridable in session)

1. **Stack: TypeScript on Node**, matching the v0.1 tooling lineage (tsx, esbuild, zod). One
   binary entry point: `brain-tck run --class D --target <base-url> --adapter <file> --out
   results.json`.
2. **The kit is a peer, plus a seam.** Wire-reachable behaviour (handshake, sync, bounds,
   signatures, errors) is tested over real A2A/MCP HTTP against the target, with the kit playing
   the counterpart system (serving its own signed card, minting grant keys, signing batches,
   replaying nonces, sending malformed envelopes). Data-layer laws (adversarial visibility,
   vault invisibility, journal immutability, forget-to-zero, restore replay) cannot be proven
   from the wire alone: the implementer supplies a thin **adapter** implementing a fixed
   contract: `seedAs(member, records)`, `queryAs(member|anon, sql-free predicate)`,
   `snapshotChecksum()`, `backup()`, `restore(snapshot)`, `disconnect(connection)`,
   `readReceipt()`. The adapter is the implementer's code against their own store; the kit
   never needs their credentials. Document the contract in `kit/ADAPTER.md`.
3. **Deterministic and local.** No network egress except to the target (asserted by T-SEC-11's
   own capture). Fixed seeds, stable test ids matching the BP-09 catalogue, every assertion
   message naming the spec clause it enforces.
4. **Results format:** JSON with suite version, per-test pass/fail/skip plus evidence pointers,
   and an overall verdict; schema published at `schemas/tck-results.schema.json` so registry
   entries can reference it (BP-09 §4.1 `results_url`).

## 4. The reference pipe

A deliberately boring Class D data provider: Postgres with RLS, a small Node server, no AI, no
UI beyond a webhook console for the BP-08 Class D proposal queue. It implements the BP-02 §8
thirteen-point checklist in the order written, each point a commit, so the git history itself
teaches the build order. Includes: signed card at the well-known path, the provider profile of
BP-03/BP-04 (handshake, serve read/query, honour forget and bounds), the S3 pointer pattern,
and `records.export` with export-to-self. Target size: small enough to read in an afternoon.

## 5. Build order and estimates

| Wave | Content | Estimate |
|---|---|---|
| A | Harness skeleton, adapter contract, kit-peer (card, keys, JWS), results format; ENV suite (schemas already exist in `schemas/`) | 3-4 days |
| B | DAT suite against the adapter contract; begin reference pipe in parallel (checklist points 1-6) | 4-5 days |
| C | HSK + COM + SEC + GAT Class D subsets; reference pipe points 7-13 | 5-6 days |
| D | T-REF-01 clean-start one-day run, documented; Class D T-REF-02 break-a-law branches; CI workflow; `kit/README` quickstart | 2-3 days |

Roughly three working weeks single-threaded; the reference pipe overlaps waves B-C. Each wave
ends with the kit run, not asserted (the QA discipline: the builder does not sign off their own
wave without the suite executing).

## 6. Risks and open points for the build session

1. **The adapter seam is the hard design.** Too thick and the kit tests the adapter, not the
   system; too thin and DAT tests cannot reach the data layer. The contract above is the
   starting position; settle it in wave A and freeze it, because every partner writes one.
2. **T-DAT-06 (restore replay)** needs `backup()`/`restore()` hooks that some stores make
   awkward; permit a documented manual procedure with the kit verifying the post-restore state.
3. **Fingerprint pinning bootstrap** in tests: the kit pre-pins the target's key out of band by
   reading it from the run configuration, mirroring the real ceremony honestly.
4. **Clock skew tests** (±5-minute JWS window, BP-03 §4.2) need a controllable clock in the
   kit-peer, not in the target.
5. When the council ratifies BP-10's doors, T-HIS/T-DEC arrive as a MINOR kit release; nothing
   in this build should make that hard (test ids and the peer simulator should leave room).

## 7. Definition of done

`git clone && cd kit && npm install && brain-tck run --class D --target http://localhost:8080
--adapter ../reference/adapter.ts` passes 46/46 against the reference pipe on a clean machine;
the documented clean-start build of the reference by someone who did not write it fits inside
one working day (T-REF-01, AC-09.1); each deliberately broken law on a branch fails its suite
(AC-09.2, Class D scope); CI runs the suite on every push; no byte leaves the machine except to
the target.
