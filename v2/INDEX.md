# Brain Protocol v2 — Suite Index

*Cross-edited 11 June 2026. Every spec below is draft 0.1, status **draft-for-ratification**.
Editor: Peter McCormack. Council decisions CD-1…CD-10 and per-spec briefs: `COUNCIL-BRIEFS.md`.*

## The suite at a glance

| Spec | Title | Lines | Scope in one line | Status |
|---|---|---|---|---|
| BP-00 | Overview & Suite Map | 184 | Thesis, suite map, shared terminology, conformance classes, versioning | draft-for-ratification |
| BP-01 | Data Model & Vocabulary | 497 | The four primitives, the v2 record envelope, controlled vocabulary, mapping tables, the goal subtype, the derived-activity rule | draft-for-ratification |
| BP-02 | Agent-Ready Systems | 379 | The data-layer laws before any agent exists: visibility, provenance totality, the vault, the journal, forget-to-zero, bounds | draft-for-ratification |
| BP-03 | Handshake, Identity & Grants | 461 | Signed agent cards, negotiation, per-grant keys (Ed25519 + X25519), the explicit permission matrix, tokens, revocation | draft-for-ratification |
| BP-04 | Communications & Sync | 427 | The A2A/MCP wire profile, live query vs sync, atomic staged resync, the origin-chain loop guard, propose-only Action relay, entity resolution, errors | draft-for-ratification |
| BP-05 | Agent Design & Behaviour | 375 | Visibility before the model, trust tiers T0–T3 and fencing, the tool router, action tiers 0–3, the egress check, injection posture | draft-for-ratification |
| BP-06 | Learning & Memory | 357 | All durable learning as graph facts: provenance closure, bitemporal correction, the transparency surface, recursive forget, no shadow profiles | draft-for-ratification |
| BP-07 | Security, Privacy & Sensitivity | 388 | Sensitivity classes S0–S3 and their wire behaviour, JWS/JWE crypto suite, cryptographic forgetting, threat model, children's wall, GDPR mapping | draft-for-ratification |
| BP-08 | Human Gates & Authority | 289 | Draft-and-confirm as law, `needs_human` parking (7-day → `declined:expired`), dual gates, the authority dial and its non-configurable floors | draft-for-ratification |
| BP-09 | Conformance, Certification & Governance | 343 | The 73-test TCK (46 D / 70 A / 73 H), tiered certification, the registry and network-wide revocation, the change process, v0.1→v2 migration | draft-for-ratification |
| BP-10 | Event Ledger & Decisions | new | The append-only event ledger beneath the graph, the opt-in `history` grant mode, decision events with reasoning and evidence, temporal retrieval, erasure grades (crypto-shred and chain-gap purge) | draft-for-council-review (targets v2.1; five one-way doors returned to council, BP-10 §13) |
| — | COUNCIL-BRIEFS | 341 | Ratified council decisions CD-1…CD-10 and the per-spec writers' briefs (canon, not a spec) | ratified |

## Conformance classes

Classes are **profiles across specs, not a prefix of the numbering** (CD-4) — even a pipe shakes
hands. Suite sizes per BP-09 §2.10.

| Class | Name | Shape | Implements | Certification (CD-2) |
|---|---|---|---|---|
| **D** | Data provider | a database with endpoints; no AI | BP-01, BP-02 in full; BP-03/04 provider profile; BP-07 core; BP-08 minimal — 46 TCK tests, target: pass in one working day | self-certifies with published TCK results |
| **A** | Agent | an assistant that reasons or acts across the boundary | Class D + BP-05, BP-06 in full; BP-07 in full; BP-08 in full — 70 TCK tests | verified certification |
| **H** | Hub / brain | a personal or domain hub serving several systems | Class A + cross-source merge proposals, re-export lineage, dual-gate orchestration — 73 TCK tests | verified certification |

Any system exposing an **S2 capability at any class** requires verified certification.

## Start here (for a new partner team)

*New to the repository? The public face is the [root README](../README.md) — pitch, quickstart,
licensing and contribution process. Machine-readable artefacts derived from these specs are in
[`../schemas/`](../schemas/) (JSON Schemas + the controlled vocabulary) and [`../examples/`](../examples/).*

1. Read **BP-00** end to end (20 minutes) — thesis, terminology, your likely class.
2. Decide your class: just serving data → **D**; an assistant that reasons or acts → **A**; mediating several systems → **H**.
3. Hand **BP-02 §8** (the 13-point checklist) to whoever owns your database — the laws live in the data layer, and most of the work is there.
4. Model your records as **BP-01** envelopes; stamp `sensitivity` from the BP-01 §9 starter table and `visibility` on every row from day one.
5. Implement the **BP-03** handshake: publish a signed card, mint per-grant keys, refuse everything not in an explicit grant cell.
6. Move data per **BP-04**: prefer live query; sync atomically; never write into a peer — propose Actions instead.
7. If anything reasons over connected data, **BP-05 + BP-06** are mandatory: fence federated content, route tools outside the model, keep memory in the graph.
8. Wire the **BP-08** gates early — `action.execute` dark by default, confirms server-side and hash-bound; floors are law, not settings.
9. Run the **BP-09 TCK** for your class in CI from week one; green is the precondition for connecting to anything you don't control.
10. A Class D pass is designed to take **one working day** of integration work — if it's taking longer, re-read BP-02 before writing more code.
