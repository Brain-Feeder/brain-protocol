# Brain Protocol - roadmap and open threads

One page that points at where each thread actually lives. It links; it does not restate (a roadmap
that duplicates the CHANGELOG, the specs, or the registry just becomes a fourth thing that drifts).
Convention: hyphens not em dashes, sentence case.

Canonical homes:
- Released changes and version history: `CHANGELOG.md`
- The specs themselves: `v2/BP-00..BP-09`
- What is certified, by whom: `registry/registry.json` (+ `schemas/registry-entry.schema.json`)
- Conformance health: GitHub Actions, "Class D conformance"

## Shipped

- v2 specification suite (BP-00..BP-09) + council decisions (CD-1..CD-10).
- Class D conformance kit + reference implementation - 46/46, green in CI (run #14).
- Conformance registry v0 - signed, hash-chained, append-only; live and empty.
- Suite 2.0.1 / 2.0.2 / 2.0.3 tagged and public; CI pipeline green end-to-end
  (suite + renamed-reference run + break-a-law 7/7 + registry verify).

## In flight

- **First partner integration (TPMS).** Stranger-certified Class D 46/46; card + Ed25519 fingerprint
  verified; cache-binding check closed. Open: TPMS re-runs against the v2.0.3 tag, registers a clean
  46/46, then the first S1 grant (`calendar.read`) opens. State of record: the integration memory note,
  not this file.
- **CI forcing functions (TODO, high value).** Add a CI status badge to `README.md`; require the
  "Class D conformance" check to pass before merge to `main` (branch protection). The 14-run red streak
  was invisible because nothing forced the signal; this fixes that class of problem at the root.
- **Node 24 actions bump (by ~16 Jun 2026).** CI actions (`checkout`, `setup-node`, `upload-artifact`)
  run on Node 20, which GitHub is forcing to Node 24. Bump the action versions.

## Next

- **Public conformance status page** - the registry rendered (who is certified, class, suite version)
  plus the live suite version and latest green run. This is the moat made visible: "do not trust us,
  run the test - and here is who already did." Thin and mostly static (reads `registry.json` + a CI
  badge), not an admin app. Build it once the registry has its first real entry (TPMS).

## Council / one-way doors (ratify before building)

- **BP-10 Event Ledger and Decisions** (draft 0.1, for council review): the append-only event ledger,
  the opt-in `history` grant, decision events, erasure grades. Entirely additive (targets 2.1.0).
  Five one-way doors returned to the council (BP-10 ss.13) MUST be ratified before any production ledger.
  Canon: the longitudinal-memory session notes + `CHANGELOG.md` "targets 2.1.0".

## Settled rulings (reference, not open)

- **Forget-scope (BP-02 ss.5):** the audit test is lineage-to-zero (source / origin_chain / provenance),
  not text removal; soft-scrub is conformant if the row is predicate-unreachable; restore must re-scrub.
- **Read-source-scoping (2.0.3):** a provider-choice hardening modelled in the reference, deliberately
  NOT a mandatory Class D law (making it universal would be a MINOR spec change for the council).
