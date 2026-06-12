# Changelog — Brain Protocol

All notable changes. Semver, one suite train (`MAJOR.MINOR.PATCH`). Additive =
MINOR (forward-compatible), breaking = MAJOR, errata = PATCH.

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
