# Brain Protocol

**A common language — and a set of safety laws — so independent systems and AI
agents can share a human's life data with consent, confirmation, and the right
to be forgotten.**

Nobody owns a person's whole life, and nobody should. A garage system knows the
car, a clinic knows the appointments, a bank knows the money, a household hub
knows the family — and the questions that matter cut across all of them. The
old answer was one platform that swallows everything; people rightly distrust
it. The Brain Protocol's answer is a **mesh of independent systems**, each
authoritative for its own domain, handing context to each other safely:
scoped, consented, attributed, bounded, and reversible.

Four laws bind every conformant system:

1. **The laws live in the data layer**, not in prompts or UI.
2. **Every side-effect waits for a recorded human yes** — draft-and-confirm,
   bound to a payload hash, server-side.
3. **Connecting is reversible, and disconnecting means provable forgetting** —
   an audit to zero rows, a user-visible receipt, keys destroyed.
4. **Federated content is data, never instructions.**

## Why a new protocol?

Excellent standards already cover pieces of this: **Schema.org** names things,
**iCalendar** times them, **ActivityStreams** journals them, **MCP** connects
agents to tools, **A2A** connects agents to agents. The Brain Protocol borrows
all of them deliberately — kinds from Schema.org, timed-activity semantics from
iCalendar, journal verbs from ActivityStreams, and A2A + MCP as the wire it
profiles rather than redefines.

What none of them provide is what a *life* needs before any of that data can
safely move between systems that don't share an owner:

- **Visibility** — who may see each record, enforced where the data lives, with
  existence denied by silence and a hard wall around children's data.
- **Provenance** — every row says where it came from, totally, so sync is
  idempotent and forgetting is possible at all.
- **Confirm gates** — nothing irreversible happens without a named human's
  recorded yes against the exact payload; cross-system writes are
  propose-only, always.
- **Forget** — disconnecting purges everything traceable to the connection,
  audits to zero, destroys the keys, and hands the human a receipt.

## The v2 suite

The specifications live in [`v2/`](v2/) — start with the
[suite index](v2/INDEX.md).

| Spec | Title | Scope in one line |
|---|---|---|
| [BP-00](v2/BP-00-OVERVIEW.md) | Overview & Suite Map | Thesis, suite map, shared terminology, conformance classes, versioning |
| [BP-01](v2/BP-01-DATA-MODEL.md) | Data Model & Vocabulary | The four primitives, the v2 record envelope, controlled vocabulary, mapping tables, the goal subtype, the derived-activity rule |
| [BP-02](v2/BP-02-AGENT-READY-SYSTEMS.md) | Agent-Ready Systems | The data-layer laws before any agent exists: visibility, provenance totality, the vault, the journal, forget-to-zero, bounds |
| [BP-03](v2/BP-03-HANDSHAKE-IDENTITY-GRANTS.md) | Handshake, Identity & Grants | Signed agent cards, negotiation, per-grant keys (Ed25519 + X25519), the explicit permission matrix, tokens, revocation |
| [BP-04](v2/BP-04-COMMUNICATIONS-SYNC.md) | Communications & Sync | The A2A/MCP wire profile, live query vs sync, atomic staged resync, the origin-chain loop guard, propose-only Action relay, entity resolution, errors |
| [BP-05](v2/BP-05-AGENT-DESIGN.md) | Agent Design & Behaviour | Visibility before the model, trust tiers T0–T3 and fencing, the tool router, action tiers, the egress check, injection posture |
| [BP-06](v2/BP-06-LEARNING-MEMORY.md) | Learning & Memory | All durable learning as graph facts: provenance closure, bitemporal correction, the transparency surface, recursive forget, no shadow profiles |
| [BP-07](v2/BP-07-SECURITY-PRIVACY.md) | Security, Privacy & Sensitivity | Sensitivity classes S0–S3 and their wire behaviour, JWS/JWE crypto suite, cryptographic forgetting, threat model, children's wall, GDPR mapping |
| [BP-08](v2/BP-08-HUMAN-GATES.md) | Human Gates & Authority | Draft-and-confirm as law, `needs_human` parking, dual gates, the authority dial and its non-configurable floors |
| [BP-09](v2/BP-09-CONFORMANCE-GOVERNANCE.md) | Conformance, Certification & Governance | The 73-test TCK, tiered certification, the registry and network-wide revocation, the change process, v0.1→v2 migration |
| — | [COUNCIL-BRIEFS](v2/COUNCIL-BRIEFS.md) | Ratified council decisions CD-1…CD-10 and the per-spec writers' briefs (canon, not a spec) |

Machine-readable artefacts derived from the specs:

- [`schemas/`](schemas/) — JSON Schema (draft 2020-12) for the record envelope,
  the Action, the agent card, the grant document, and the forget receipt, plus
  the controlled vocabulary as data ([`vocabulary.json`](schemas/vocabulary.json)).
- [`examples/`](examples/) — the specs' worked JSON as standalone files.

## Conformance classes

A class is a profile across specs, not a prefix of the numbering — even a pipe
shakes hands.

- **Class D — Data provider.** A database with endpoints; no AI. Implements the
  data model and data-layer laws in full plus the provider profile of the
  handshake and wire. 46 TCK tests; designed to pass in **one working day**;
  self-certifies with published results.
- **Class A — Agent.** An assistant that reasons or acts across the boundary.
  Class D plus agent behaviour, memory, full security and full gates. 70 tests;
  verified certification.
- **Class H — Hub / brain.** A personal or domain hub serving several systems.
  Class A plus cross-source merge proposals, re-export lineage, and dual-gate
  orchestration. 73 tests; verified certification.

Any system exposing an S2 (personal-grade) capability at any class requires
verified certification.

## Quickstart — you have a system with data

1. Read [BP-01](v2/BP-01-DATA-MODEL.md) — the four primitives and the record
   envelope your data will wear on the wire.
2. Read [BP-02](v2/BP-02-AGENT-READY-SYSTEMS.md) — the laws your data layer
   must enforce. Hand §8 (the 13-point checklist) to whoever owns your
   database; most of the work is there.
3. Model your records as envelopes and validate your export against
   [`schemas/envelope.schema.json`](schemas/envelope.schema.json), with
   subtypes from [`schemas/vocabulary.json`](schemas/vocabulary.json). The
   [`examples/`](examples/) show what conformant records look like.
4. Run the **Class D checklist** (BP-02 §8) and then the Class D TCK suite
   (BP-09 §2) in CI. Green is the precondition for connecting to anything you
   don't control.

If it's taking longer than a day, re-read BP-02 before writing more code.

## Status

**v2, draft 0.1 — draft-for-ratification.** Every spec is written and
council-shaped; the suite is now **seeking ratification partners**: teams who
will implement a class, run the TCK, and feed reality back into the drafts
before v2.0.0 is tagged. If that could be you, open an issue.

v0.1 (the single-document protocol and its reference package) remains a valid
peer via negotiation; its material is preserved under [`archive/`](archive/).

## Licence

Specification texts (`v2/`) are **CC-BY-4.0** ([`LICENSE-SPEC`](LICENSE-SPEC));
schemas, examples and reference code are **Apache-2.0** ([`LICENSE`](LICENSE)).
See [`LICENSING.md`](LICENSING.md) for the why. Implementing the protocol in
any product, open or closed, requires no permission and no payment.

## Contributing

Anyone may propose; the maintainer council ratifies. The pipeline is
mechanical: **PR → TCK green → editor approval → version bump → CHANGELOG.**
The four primitives are frozen — a fifth is a MAJOR event. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the RFC process and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for conduct.

*Editor: Peter McCormack. Brainfeeder is the reference hub and the canary —
being a hub is product behaviour, never protocol privilege.*
