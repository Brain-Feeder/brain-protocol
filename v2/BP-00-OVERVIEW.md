# BP-00 — Brain Protocol v2: Overview & Suite Map

*Status: draft 0.1 · Ratified shape, texts drafted — for ratification · Editor: Peter McCormack · Source of truth: the
`brain-protocol` repo. Produced by the Brain Protocol v2 council (solutions architecture, AI security
red team, product strategy, evaluation & quality, governance & compliance, LLMOps/platform, backend,
data pipeline, release engineering), 11 June 2026. MUST/SHOULD/MAY carry RFC 2119/8174 meaning
throughout the suite.*

---

## 1. Purpose and thesis

Nobody owns a person's whole life, and nobody should. A garage system knows the car, a clinic knows
the appointments, a bank knows the money, a household hub knows the family — and the questions that
matter cut across all of them. The old answer was one platform that swallows everything; people
rightly distrust it. The Brain Protocol's answer is a **mesh of independent systems**, each
authoritative for its own domain, handing context to each other safely: scoped, consented,
attributed, bounded, and reversible.

v0.1 proved the idea in a single document. v2 is a **suite of specifications**, because the audience
has changed: it is no longer one team building one hub, it is any team building any system that
wants to be ready for agentic life. The suite tells them exactly how to build, in order:

1. **their data layer** so it can be trusted (BP-01, BP-02);
2. **the connection** — identity, handshake, grants (BP-03) and how data moves (BP-04);
3. **their agent** as a layer on top of that data (BP-05) and how it learns (BP-06);
4. **the trust machinery** — sensitivity, privacy, security (BP-07) and human authority (BP-08);
5. **how anyone proves it and how the whole thing evolves** (BP-09).

The thesis is unchanged and binding on every spec: **the laws live in the data layer, not in
prompts or UI**; every side-effect waits for a recorded human yes; connecting is reversible and
disconnecting means provable forgetting; and federated content is data, never instructions. A
system that does these four things can be trusted by any conformant brain; a system that skips any
one should be trusted by none. Specs are written so a small system can join cheaply (Class D below)
and grow into an agent or a hub without rework.

## 2. The suite map

Nine specifications under this umbrella. Each is normative, independently versioned within the
suite release, and conformance-tested per BP-09.

**BP-01 — Data Model & Vocabulary.** The shared language. The four frozen primitives (Entity,
Activity, Edge, Action) and the v2 record envelope: urn ids on the wire, `subtype`, bitemporality
(`valid_time`/`system_time`), `confidence`, `sensitivity`, `visibility` with registered scopes,
`owner`, `actor`, `provenance` (record-level) plus `origin_chain` (system-level), `interval`,
`state`. The merged controlled vocabulary (URS base + v0.1 terms), mapping tables as the only
extension valve, the reserved `goal` subtype, the borrow-at-the-edges naming rule (Schema.org,
iCalendar, ActivityStreams), and the derived-activity rule for dated requirements.

**BP-02 — Agent-Ready Systems.** What any system must enforce **in its data layer** before any
agent exists — the "build your data layer for agentic life" spec. The visibility law enforced at
the database (existence denied by silence; children's rows forced public-to-household and never
across the boundary); provenance totality on every row; the vault law (secrets server-side only,
zero client read paths, hash at rest, shown once); the append-only journal; forget-on-disconnect
with the forget audit and user-visible receipt; backup forget-replay; bounds and rate limits in
both directions. A plain database with these properties is a full peer.

**BP-03 — Handshake, Identity & Grants.** How two systems meet and what one may do to the other.
The agent card; signed cards and verified system identity (now mandatory, not deferred); version
and vocabulary negotiation (highest common version, capability intersection, mapping tables checked
at connect); the grant document and its permission matrix — capability × direction × mode ×
sensitivity ceiling × member lens × visibility ceiling, every absent cell denied; per-grant
asymmetric key pairs; token lifecycle (vaulted, hashed, expiring, revocable); revocation-as-
disconnect.

**BP-04 — Communications & Sync.** How data actually moves. The A2A/MCP wire profile; sync versus
live query with live preferred; atomic staged resync (the read model never blanks); the
origin-chain loop guard (reject echoes, cap hops); two-tier entity resolution (exact upsert by
`(source, external_ref)`; cross-source matches become merge proposals — never auto-merge);
**propose-only cross-system writes** — the Action relay is the universal write model, no system
ever writes directly into another's graph; per-exchange audit logging; size, count, and rate
bounds.

**BP-05 — Agent Design & Behaviour.** The agent as a layer on the data. Visibility filtering
**before** the model (context assembled under the asker's data-layer lens, never a privileged
read); the four trust tiers and structural fencing of federated content; tool allowlists by origin
enforced in the router, not the prompt; the action taxonomy (read / reversible-write / gated /
refused) with rate caps where the gate does not reach; the egress check on outbound payloads;
answers from peers treated as claims, attributed and hedged; refusal and existence-leak rules.

**BP-06 — Learning & Memory.** How an agent learns without poisoning the graph or leaking on
forget. Every derived memory carries provenance to its sources (untagged derived memory is a
conformance failure); inferences carry `confidence`; corrections journal the old value;
bitemporal learning (what was believed when); the transparency surface ("what it learned from
{system}"); derived memory is purged with its source on disconnect; foreign claims are never
laundered into first-party fact.

**BP-07 — Security, Privacy & Sensitivity.** The sensitivity classes S0–S3 and their wire
behaviour: S0 ambient (live-query preferred, never stored by default); S1 household (standard
grant); S2 personal (elevated grant, step-up confirm, JWE end-to-end); S3 sealed (never syncs —
reference-only pointers). Receivers may upgrade a class, never downgrade. JWS signing of every
batch; key lifecycle; **cryptographic forgetting** (grant-key destruction on disconnect, recorded
in the forget receipt); the controller/controller legal split; children's-data wall; the threat
model and the injection posture shared with BP-05.

**BP-08 — Human Gates & Authority.** Humans decide what AIs decide. Draft-and-confirm as law: the
confirm is a server-side recorded human act, bound to a payload hash, expiring, idempotent;
`action.execute` dark by default. The `needs_human` parked state with enumerated reasons; dual
gates where both sides' humans must say yes; the authority dial (`auto`/`ask`/`never`) per action
type per space, with **hard floors that are protocol law, not preference** — S3 and direct money
movement are `never`; S2 exchanges, outbound messages, plan changes, and anything financial are
never below `ask`; children's actions always gate to a guardian.

**BP-09 — Conformance, Certification & Governance.** How anyone proves it and how the suite
evolves. The executable conformance kit (TCK) per class; certification tiers (self-certification
with published results for Class D; verified certification for Classes A and H and for any S2
capability); the registry, interop matrix, and network-wide revocation; runtime boundary
validation; the change process (PR → TCK green → editor approval → version bump → CHANGELOG),
semver and the N/N−1 window, deprecation policy, and upgrade distribution (package, registry
webhooks, machine-readable migration descriptors).

## 3. Terminology (normative across the suite)

- **System** — any software holding or producing life data that implements the protocol at its
  boundary. Its internal model is its own business; the boundary is ours.
- **Agent** — the protocol-speaking machine interface a system exposes. Not necessarily an AI: a
  plain endpoint is an agent. Where a model reasons over data or drafts actions, the BP-05/06
  obligations attach.
- **Brain** — a system's conformant data layer plus its agent, taken together: the authoritative
  node for one domain.
- **Hub** — a brain that consumes from and serves multiple systems on behalf of a human or
  household, mediating between them. Brainfeeder is the reference hub; being a hub is product
  behaviour, never protocol privilege. Mesh, not star: no system is a mandatory hop.
- **Grant** — the revocable permission document binding one connection: the BP-03 matrix
  (capability × direction × mode × sensitivity ceiling × member lens × visibility ceiling) plus
  its key pair and tokens. Absent cell = denied cell.
- **Gate** — a human confirm point. A gate decision is a server-side recorded fact (who, when,
  against which payload hash); a client claim of "confirmed" is nothing.
- **Space** — the tenancy a brain serves (a household, a team, a practice): its members, its
  authority policy, its visibility audience.
- **Human** — a named member of a space with authority over it. The only source of a confirm; the
  addressee of every `needs_human`; the party both ends of a dual gate name.

## 4. Conformance classes

A class is a **profile across specs, not a prefix of the numbering** — even a pipe must shake
hands. Each spec marks every normative clause D/A/H; the kit ships one suite per class, so a small
system can join cheaply and upgrade without rework.

| Class | Name | Implements | Typical shape |
|---|---|---|---|
| **D** | Data provider | BP-01, BP-02 in full; BP-03 and BP-04 at the *provider profile* (card, handshake, serve `read`/`query`, honour forget and bounds); BP-07 core (stamp sensitivity, sign batches, S3 wall); BP-08 minimal (accept proposed Actions, dark by default) | a database with endpoints; no AI, no chatbot |
| **A** | Agent | Class D plus BP-05 and BP-06 in full, BP-07 in full (S2 JWE, key lifecycle), BP-08 in full (gates, `needs_human`, authority floors), both grant directions | a system whose assistant reasons over or acts across the boundary |
| **H** | Hub / brain | Class A plus the multi-system obligations: cross-source entity resolution proposals, origin-chain mediation on re-export, dual-gate orchestration, per-connection transparency surfaces, the full TCK | a personal or domain hub serving several systems |

Certification per class is defined in BP-09: Class D self-certifies with published TCK results;
Classes A and H — and any system exposing an S2 capability at any class — require verified
certification.

## 5. Versioning and relationships

- **To v0.1:** `BRAIN_PROTOCOL.md` v0.1 and `11-PARTNER-BRIEF.md` remain valid; v2 restructures
  and tightens them additively, contradicting nothing silently. v0.1 peers remain conformant
  partners via negotiation (BP-03): a v2 and a v0.1 system converse in v0.1; v2 features activate
  only when both sides speak v2. The ratified URS analysis (`12-PROTOCOL-V2.md`) is the v2
  baseline this suite normatively encodes.
- **To external standards:** the wire is **A2A** (agent cards, JSON-RPC 2.0, SSE, OAuth 2.1) and
  **MCP** (Streamable HTTP, OAuth 2.1) — the suite profiles them and redefines nothing. Naming
  borrows at the edges: **Schema.org** for kinds, **iCalendar** semantics for timed activities and
  recurrence, **ActivityStreams**-style journal verbs. Signing and encryption use **JWS/JWE**
  (RFC 7515/7516); requirement words use RFC 2119/8174.
- **Mechanics:** semver across the suite as one release train (`2.MINOR.PATCH`). The four
  primitives are frozen — a fifth is a MAJOR event. Additive changes are MINOR; never break
  within a MAJOR; N and N−1 supported for a stated window; ignore unknown fields, pass through
  unknown vocabulary opaquely, never silently alias.

## 6. Status

| Spec | Title | Status |
|---|---|---|
| BP-00 | Overview & Suite Map | this document — draft 0.1, council-ratified shape |
| BP-01 | Data Model & Vocabulary | draft 0.1 — written; for ratification |
| BP-02 | Agent-Ready Systems | draft 0.1 — written; for ratification |
| BP-03 | Handshake, Identity & Grants | draft 0.1 — written; for ratification |
| BP-04 | Communications & Sync | draft 0.1 — written; for ratification |
| BP-05 | Agent Design & Behaviour | draft 0.1 — written; for ratification |
| BP-06 | Learning & Memory | draft 0.1 — written; for ratification |
| BP-07 | Security, Privacy & Sensitivity | draft 0.1 — written; for ratification |
| BP-08 | Human Gates & Authority | draft 0.1 — written; for ratification |
| BP-09 | Conformance, Certification & Governance | draft 0.1 — written; for ratification |

Writers' instructions, the council's decided positions, and per-spec acceptance criteria are in
`COUNCIL-BRIEFS.md` beside this file. No spec text overrides a council decision without returning
to the council.
