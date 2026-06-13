# Changelog — Brain Protocol

All notable changes. Semver, one suite train (`MAJOR.MINOR.PATCH`). Additive =
MINOR (forward-compatible), breaking = MAJOR, errata = PATCH.

## Unreleased

- **Suite 2.0.3 (PATCH, 2026-06-13) — reference read-source-scoping.** The reference now serves only
  its OWN-source rows through a read grant (`calendar.read`/`records.read`/`records.export`): records
  synced in from another system under a connection are never read back through that connection's read
  grant. This closes the last item deferred from 2.0.2 and models the privacy-preserving choice a
  hardened provider makes (TPMS scopes `calendar.read` to its own source). It is a reference-exemplar
  hardening and a **provider choice**, not a new mandatory Class D law — making own-source scoping a
  universal requirement would be a spec expansion (MINOR) for the council, since some hubs legitimately
  serve multi-source reads. No test semantics changed; Class D still passes 46/46 (the bounds pre-seed
  is own-source, so T-DAT-07 is unaffected). A `BREAK 'sourcescope'` toggle disables the filter so the
  property can be probed and regressed.

- **Suite 2.0.2 (PATCH, 2026-06-13).** Two kit-fidelity fixes surfaced by the first partner
  integration (TPMS), both the same shape — a test reaching its verdict for a reason other than the
  system's own behaviour. The read-bounds law (BP-02 §6) is unchanged; only how the kit exercises it
  changes, so this is a PATCH (BP-09 §5.2). (1) **T-DAT-07 no longer seeds by wire ingest.** The old
  fixture pushed 600 rows over `records.ingest` while holding only a read grant, then read them back —
  which only "passed" against a reference that accepted unauthenticated ingest. A correctly-hardened
  provider (write-gated ingest, own-source reads, a per-batch DoS guard) refuses that path, so the
  assertion was never reached — and an unreached assertion is not a pass. A served read-bounds law
  cannot be black-box seeded by a read-only peer at all (a read grant can never write, BP-04 §5.1;
  served reads return the provider's own rows). The kit now reads with an explicit `limit` and asserts
  the served bounds envelope (`records ≤ cap`, `truncated` + `cursor` when more rows stand under the
  lens, `complete`/null when not) against rows the provider stands up as a certification precondition
  (see `kit/ADAPTER.md`). (2) **The reference is tightened:** `records.ingest`/`records.resync` now
  require a sync-mode grant cell — a read grant can never write — removing the looseness that masked
  the above; the COM/SEC seeding tests now hold a sync cell. (3) **Fidelity note (T-COM-07/T-ENV-01):**
  the kit must observe the system's own wire/boundary rejection, never a harness-side canonical
  pre-screen; documented in `kit/ADAPTER.md`. Full Class D still passes 46/46 from a clean clone, with
  T-DAT-07 now observing real truncation (500-row page, `truncated:true`, cursor) rather than passing
  on a looseness. Two lock-ins so neither fix can silently regress: T-COM-06 now also asserts that
  `records.ingest` under a read-only grant is refused, with a `BREAK 'ingestauth'` branch proving the
  kit catches a re-loosening (T-REF-02); and the bounds cap is read from the provider's advertised
  `limits.max_batch_records` on its verified card (threaded through the harness as `targetCap`) rather
  than a hardcoded constant, so a provider with a different cap is tested against its own.

- **Conformance registry v0 (BP-09 §4, 2026-06-12).** `registry/` — a signed, append-only,
  publicly-readable record of conformance attestations, hosted from this repository, with no
  telemetry (CD-3). Closes the gap a partner integration surfaced: a published `results.json` is
  evidence, but a registry entry is what makes a conformance *claim* legitimate (§3.1/§3.3). Each
  entry is hash-chained and signed by the registry key; CI verifies the whole chain (links,
  signatures, schema, the CD-2 S2⇒verified invariant) on every push, and tampering with any stored
  field fails verification. Entry shape in `schemas/registry-entry.schema.json`; tooling supports
  keygen/register/status/revoke/verify. Ships live and empty — the registry key exists, ready for
  the first system to publish results and register. The private registry key is the maintainer's
  custody (git-ignored).

- **Suite 2.0.1 (PATCH, 2026-06-12).** Carries the system-id fix below (a coupling removed, no
  test semantics changed — PATCH per BP-09 §5.2). `results.json` now also records `kit_commit`
  (the kit's git short hash) so published results cite an exact, reproducible build until tagged
  releases exist; cite as "suite 2.0.1 (kit commit <hash>)".

- **Stranger-test fixes from the first partner integration (2026-06-12).** A partner team built a
  Class D provider from the repository alone and passed 46/46 without reading `reference/` — and
  surfaced two repo-side defects against the "stranger certifies with zero out-of-band questions"
  criterion (BUILD-BRIEF §1). Fixed: (1) the kit no longer hard-codes the system-under-test's id —
  it learns the target's `system_id` from its verified agent card (with a `--system-id` override),
  and the reference reads its own id from `BRAIN_SYSTEM_ID`; a renamed-reference run is now a CI
  step so the coupling cannot regress (a system honestly named anything certifies). (2) Repo
  visibility — see the open release blocker below. Test-fixture and example system ids were also
  made partner-neutral.

- **Class D conformance kit + reference pipe (2026-06-12).** The executable TCK
  (`kit/`) and a reference Class D data provider (`reference/`) now exist and pass
  **46/46** of the BP-09 §2.10 Class D suite from a clean clone (`./run-conformance.sh`).
  The kit tests both surfaces the brief calls for — wire-reachable behaviour over real
  A2A/MCP HTTP against a target, and the data-layer laws through a thin frozen adapter
  (`kit/ADAPTER.md`) — with Ed25519 JWS proof-of-possession, X25519/A256GCM JWE, and a
  machine-readable results file (`schemas/tck-results.schema.json`, BP-09 §4.1). The
  reference is Postgres + row-level security with the BP-02 §8 laws and the BP-03/BP-04
  serve obligations; `reference/BUILD-ORDER.md` maps each checklist point to its code.
  `reference/break-a-law.sh` proves the kit catches a broken law per spec (T-REF-02), and
  CI runs the suite and the break-a-law proof on every push. Class A/H suites, the
  ≥50-case injection corpus, the registry, and BP-10's T-HIS/T-DEC remain out of scope
  for this phase (test ids leave room).

## Unreleased: targets 2.1.0

- **BP-10: Event Ledger & Decisions** (draft 0.1, for council review, 2026-06-12): the
  append-only event ledger beneath the graph; the opt-in `history` grant mode; change events
  with per-source hash chains; decision events (reasoning, alternatives, evidence, expected
  outcome) including agent self-reporting; `changes.read` / `history.read`; the tombstone
  `deleted`/`erased` split; erasure grades (crypto-shred to skeleton, purge with chain-gap
  markers); stricter-of-then-and-now visibility over history; signature retention with the
  BP-07 §3.6 key-fate split. Entirely additive: systems not offering `history` are unaffected.
  Five one-way doors returned to the council (BP-10 §13) and MUST be ratified before any
  production ledger exists. Session canon: `LONGITUDINAL-MEMORY-SESSION.md` (2026-06-12).
  v2.0.0 ratification proceeds unblocked on its own clock.

## 2.0.0-draft.1 — 2026-06-11

The v2 suite: nine specifications (BP-00…BP-09) plus the ratified council
decisions (CD-1…CD-10, `v2/COUNCIL-BRIEFS.md`), replacing the single v0.1
document. Status: draft-for-ratification. Headline changes from v0.1:

- **The URS record envelope** (BP-01): URN ids on the wire, `subtype` unifying
  kind/activity_type/predicate/action_type, `owner`, record-level `provenance`
  alongside system-level `origin_chain`, the registered visibility scopes, and
  canonical JSON (omit-not-null, unknown-field pass-through).
- **Bitemporality** (BP-01, CD-5): `valid_time` and `system_time` are MUST on
  every record, every class; backfill becomes honest.
- **Sensitivity classes S0–S3** (BP-07): stamped on every record; S2 is
  default-deny with elevated consent, step-up confirm, and JWE end-to-end;
  S3 never syncs — reference-only pointers.
- **Propose-only cross-system writes** (BP-04): the Action relay is the
  universal write model; no system ever writes directly into another's graph;
  `write-direct` cannot appear in any grant.
- **Human gates as law** (BP-08): draft-and-confirm with server-side recorded,
  hash-bound, expiring, idempotent confirms; `needs_human` parking with closed
  reasons and 7-day expiry to `declined:expired`; dual gates; authority floors
  that no configuration can lower (CD-7, CD-10).
- **Conformance classes D/A/H** (BP-00/BP-09, CD-4): profiles across specs, so
  a plain database is a full peer; Class D designed to pass in one working day.
- **The TCK** (BP-09): 73 executable tests (46 D / 70 A / 73 H), shipped with
  the ≥50-case injection corpus (CD-8); tiered certification (CD-2), the
  registry, and network-wide revocation.
- Also new: mandatory signed agent cards and per-grant Ed25519/X25519 key
  pairs (BP-03), the forget receipt with cryptographic forgetting (BP-02/BP-07),
  the children's-data wall (BP-07 §5), and the v0.1→v2 migration guide
  (BP-09 §6).
- Repository: public packaging — README, dual licensing (CC-BY-4.0 specs /
  Apache-2.0 schemas), JSON Schemas (`schemas/`), worked examples
  (`examples/`), contribution process. v0.1 material moved to `archive/v0.1/`.

## 0.1.0 — 2026-06-08

Initial draft: single-document protocol with the entity/activity/edge/action
vocabulary, agent cards, validators, version negotiation, and the first
conformance kit (preserved in `archive/v0.1/`).
