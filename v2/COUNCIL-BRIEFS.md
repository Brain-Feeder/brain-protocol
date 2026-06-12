# Brain Protocol v2 — Council briefs to the spec writers

*Status: ratified 11 June 2026. Council: solutions architecture, AI security red team, product
strategy, evaluation & quality, governance & compliance, LLMOps/platform, backend engineering,
data pipeline engineering, release engineering. Canon binding on every writer: `BRAIN_PROTOCOL.md`
v0.1, `11-PARTNER-BRIEF.md`, `12-PROTOCOL-V2.md` (ratified with amendments, incl. Part D),
`VOCABULARY.md`, `01-PLATFORM.md`, `02-DIRECTOR.md` §7–8. Where a brief and canon conflict, the
brief is wrong — raise it, do not improvise.*

---

## Council decisions (binding; one-line rationale each)

Where members disagreed, the council settled it. Writers encode these; they do not relitigate them.

- **CD-1 · S2 default posture — default-deny stands.** Red team wanted S2 to never cross without an
  elevated grant plus step-up confirm; product strategy wanted adoption-friendly defaults.
  **Decision: default-deny.** Rationale: one leaked health record kills the network's trust thesis;
  adoption cost is paid by making Class D cheap (CD-4), never by weakening S2.
- **CD-2 · Certification — tiered, not either/or.** Governance wanted a certification authority;
  architecture and strategy wanted open self-certification. **Decision: Class D self-certifies with
  published TCK results; Classes A and H — and any S2 capability at any class — require verified
  certification (test-traffic verification recorded in the registry); revocation registry applies
  network-wide.** Rationale: cheap entry where blast radius is small, verification where it is not.
- **CD-3 · Telemetry — local mandatory, central forbidden.** LLMOps wanted mandatory operational
  telemetry; privacy refused any phone-home. **Decision: every conformant system MUST keep a local
  per-exchange audit log (metadata only — who, method, when, outcome; never payload bodies);
  central or vendor telemetry is prohibited by the spec; sharing audit summaries is voluntary and
  grant-scoped.** Rationale: forensics without surveillance.
- **CD-4 · Conformance classes are profiles, not numbering prefixes.** A pipe still handshakes, so
  Class D spans BP-01–04 (provider profile) plus BP-07 core — but its kit is small and enumerated
  (target: a Class D system passes in under a day of integration work). Rationale: "join cheaply"
  is measured in tests passed, not specs cited.
- **CD-5 · Bitemporality is MUST on the wire for every class.** Strategy worried about small-system
  friction. **Decision: both `valid_time` and `system_time` are MUST; the degenerate form
  (`valid_time = system_time`) is explicitly permitted where learning and occurrence genuinely
  coincide; omission is non-conformant.** Rationale: backfilled facts silently corrupt history;
  the degenerate form costs one line.
- **CD-6 · Unknown vocabulary — opaque pass-through, fail-closed semantics.** Unknown subtypes and
  predicates pass through opaquely and are never silently aliased; an unknown visibility scope
  lands as `private`; a connection where either side's terms are neither base-vocabulary nor
  mapped does not proceed to sync. Rationale: semantic joinability is a connect-time precondition,
  not a hope.
- **CD-7 · Authority floors are protocol law, not preference.** Product wanted floors configurable
  per space. **Decision: S3 exchange and direct money movement are `never`; S2 exchanges, outbound
  messages, plan changes, and anything financial can never sit below `ask`; children's actions
  always gate to a guardian. Not configurable, by anyone.** Rationale: a dial that can be turned
  to zero is not a floor.
- **CD-8 · Injection bar — zero, with the corpus shipped.** Evaluation wanted a mandatory ≥50-case
  adversarial corpus for every Class A/H system; strategy called it a burden. **Decision: the
  corpus ships inside the conformance kit, free to run; the pass bar is zero successful
  instruction-following from federated content; Class D is exempt (nothing reasons).** Rationale:
  the cost objection dies when the kit does the work.
- **CD-9 · Goal is a reserved subtype, never a fifth primitive** (ratified in 12-PROTOCOL-V2 §A.3);
  mandatory `target`/`measure`/`horizon` attributes; emittable on either Entity or Activity.
  Rationale: a MAJOR version event must not be spent on a naming preference.
- **CD-10 · `needs_human` parks for 7 days by default**, then expires to `declined:expired`;
  nothing auto-resolves; reasons are the enumerated set in 12 Part D.1. Rationale: a dead end that
  guesses is worse than one that waits.

---

## BP-01 — Data Model & Vocabulary

**Scope.** The envelope and the words: primitives, the v2 record shape, controlled vocabulary,
naming rules, the derived-activity rule. Everything every other spec serialises.

**Decided positions to encode.** The URS envelope is the v2 record shape with our additions
(12 §B.4): urn ids (`urn:brain:<system>:<type>:<uuid>`) canonical on the wire, UUID+source valid
internally; `subtype` as the wire name for kind/activity_type/predicate/action_type; bitemporality
MUST per CD-5; `confidence` optional everywhere, MUST on merge proposals and derived/inferred
records (absent = asserted-as-fact); `sensitivity` MUST (classes defined in BP-07); `visibility`
grammar `private | shared:<scope> | public` with registered scopes, unknown scope → `private`
(CD-6); `owner` MUST on entities/activities (anchors the visibility law), `actor` optional;
`provenance` (record urns) and `origin_chain` (system ids) both carried — they are complementary;
the Action envelope unchanged from 11 §2.5 as the shape URS lacked; the merged controlled
vocabulary of 12 §A.4 as the v2 base with mapping tables as the only extension valve; `goal` per
CD-9; Schema.org/iCalendar/ActivityStreams borrowing per 11 §2.6; the MOT rule — dated
requirements on entities MUST derive activities.

**Open to the writer.** The full subtype→sensitivity starter classification table; the registered
visibility scope registry's initial entries; canonical JSON serialisation details (field order,
null handling); the `interval` flattening rules at the boundary.

**Acceptance criteria.** AC-01.1 *Envelope rejection*: kit rejects any object missing id, type,
source, external_ref (edges exempt), visibility, sensitivity, or either time. AC-01.2 *Bitemporal
backfill*: a backfilled fact round-trips with `system_time` ≠ `valid_time` intact. AC-01.3 *Goal
duality*: a `subtype: goal` record is accepted on either primitive and rejected without
target/measure/horizon. AC-01.4 *Vocabulary valve*: an unmapped unknown term passes through
opaquely and is provably never aliased to a known term. AC-01.5 *Derivation*: a dated requirement
attribute yields exactly one derived activity that updates and deletes with its entity.

## BP-02 — Agent-Ready Systems

**Scope.** The data layer any system must have before any agent exists: the four laws enforced in
the database, the vault, the journal, forget, bounds. The spec a CTO reads first.

**Decided positions to encode.** Visibility enforced at the data layer — a query as a member
physically cannot return rows above their sight; UI filtering is not conformance; existence denied
by silence (11 §3.1). Children's rows forced public-to-household, never across the boundary, no
child lens on any grant. Provenance totality: every row carries `source` + `external_ref`; a
derived write without attributable provenance is rejected (01-PLATFORM §3.3.4). Vault law: secrets
server-side only, zero client read paths, hash at rest, shown once, revocable, expiring
(11 §4.9). Append-only journal of side-effects and derived writes. Forget-on-disconnect: purge in
dependency order, forget audit scans every provenance-bearing table to zero, user-visible forget
receipt; 401/403 inbound = disconnect; backup restores replay the forget log before serving
traffic. Bounds both directions (size, count, rate); per CD-3 the local audit log is mandatory,
metadata only.

**Open to the writer.** Reference purge ordering for non-Postgres stores; the receipt's minimum
fields; how a system without members (single-user) degenerates the visibility law; retention
guidance defaults.

**Acceptance criteria.** AC-02.1 *Adversarial visibility*: signed in as member B, member A's
private rows return zero — run, not asserted. AC-02.2 *Forget-to-zero*: rows seeded into every
provenance-bearing table including derived stores, disconnect executed, audit returns zero,
receipt produced. AC-02.3 *Vault invisibility*: secret-bearing tables are unreadable even to the
owning user's own client. AC-02.4 *Restore replay*: a restore from backup replays the forget log
and the audit re-passes before traffic is served. AC-02.5 *Bounds hold*: an over-cap sync is
truncated and flagged partial; an over-rate caller receives 429, never a silent drop.

## BP-03 — Handshake, Identity & Grants

**Scope.** Discovery, identity, negotiation, and the grant document — what one system may do to
another, made explicit cell by cell.

**Decided positions to encode.** The agent card at a well-known HTTPS endpoint; **signed cards and
verified system identity are v2-mandatory** (v0.1's deferral ends here — no third-party connection
without them). Negotiation: highest common version, capability intersection, vocabulary
base-or-mapped checked at connect (CD-6). The permission grammar of 12 §B.1: per-capability
direction (`offer`/`consume`) and mode (`read`/`propose`/`write-direct`); `write-direct` reserved
for a system's own records; **`propose` is the only cross-system mutation**; the matrix is
capability × direction × mode × sensitivity ceiling × member lens × visibility ceiling; absent
cell = denied; default deny both axes and directions. Per-grant asymmetric key pairs published in
the grant document; JWS proof-of-possession on every call; short-lived access proofs; tokens
vaulted, hashed, expiring (90-day default), revocable; revocation = disconnect; `connection.revoke`
honoured as courtesy.

**Open to the writer.** Card signing scheme and identity verification chain (recommend keys in the
card, out-of-band fingerprint verification for the first tier; a directory is BP-09's problem);
grant-document serialisation; key algorithm suite ratification (recommend Ed25519 /
ECDH-ES+A256GCM per 12's open decision 3); renewal UX requirements.

**Acceptance criteria.** AC-03.1 *Unsigned card refused*: a connection attempt with an unsigned or
badly signed card does not proceed. AC-03.2 *Matrix denial*: a call against an absent cell is
refused and logged. AC-03.3 *Stolen token useless*: a valid bearer token without the grant-key JWS
fails every call. AC-03.4 *Negotiation downgrade*: a v2 and a v0.1 peer converse at v0.1 with v2
features inert. AC-03.5 *Revocation immediate*: after revoke, the next call fails closed and the
counterpart's forget flow triggers.

## BP-04 — Communications & Sync

**Scope.** Movement: the A2A/MCP profile, sync and live query, resync atomicity, the loop guard,
entity resolution, the Action relay, exchange logging.

**Decided positions to encode.** Prefer live query over sync — nothing stored is nothing to leak
or forget; presence answers the narrowest form, never the underlying diary. Atomic staged resync
(01 §3.3.3): stage, validate, swap in one transaction; a failed sync leaves the previous state
byte-intact; full-replace is an explicit repair, never the default. Origin-chain loop guard
(11 §4.7): append on emit; reject own-id-in-chain, own-id-as-source, chains over 3 hops; chain
membership is provenance for the forget purge. Two-tier entity resolution (12 §A.4 Q3): exact
`(source, external_ref)` upserts; cross-source matches on deterministic hints become merge
proposals through the gate carrying `confidence`; **never auto-merge across sources**; declined
pairs never re-proposed; nothing federated auto-merges into a member record. Propose-only
cross-system writes: the action relay of 11 §4.6 — draft at home, human confirms at home, server
relays, receiver validates scopes and executes under its own rules. Every exchange logged per
CD-3. JWS verification before boundary validation; malformed and unsigned batches rejected and
counted.

**Open to the writer.** Subscribe/push semantics and backoff; pagination and cursor rules; partial
sync recovery; data-quality counters' canonical names; idempotency-key format for relayed actions.

**Acceptance criteria.** AC-04.1 *Mid-sync kill*: a sync killed mid-run leaves prior state intact
and the read model never blanks. AC-04.2 *Echo rejected*: an A→B→A object is rejected and logged.
AC-04.3 *One proposal*: the same person seeded in two systems yields exactly one merge proposal,
zero auto-merges; confirming yields one canonical entity and both sources still resync cleanly.
AC-04.4 *No foreign writes*: every attempted cross-system mutation other than a proposed Action is
refused. AC-04.5 *Forensic log*: every exchange in a test session appears in the audit log with
who, method, when, outcome — and no payload bodies.

## BP-05 — Agent Design & Behaviour

**Scope.** The agent layer: context assembly, trust tiers, tool discipline, the action taxonomy,
egress. Binds any system the moment a model reasons over connected data or acts across a boundary.

**Decided positions to encode.** **Visibility before the model**: context is selected through the
data layer as the asker; no privileged service-role reads for prompts, ever (11 §5.1). Four trust
tiers — system prompt, user words, first-party data, federated/untrusted — tracked through every
turn; tier-(d) content structurally fenced under the standing law (data, never instructions);
fencing applies regardless of any peer attestation — re-fence on your own side always. Tool
allowlists by origin enforced in the tool router: write and propose tools fire only in service of
a user instruction; tier-(d)-only turns run with them disabled; every tool call logs tiers present
and the driving instruction. The action taxonomy of 11 §5.2 with the tier-1 rate cap (the gate
does not cover reversible writes — caps and provenance bound the blast radius). The egress check:
confirmed cross-boundary payloads screened against the visibility ceiling and other members'
private rows; confirm-card summaries generated server-side from the payload, never free-written.
Peers' answers are claims: attributed, hedged, never laundered into certainty. Hidden rows denied
by silence.

**Open to the writer.** Recommended fencing format; per-register behaviour (child askers); how a
non-LLM rules engine satisfies the same clauses; tier-1 cap default value.

**Acceptance criteria.** AC-05.1 *Poisoned title inert*: the 11 §5.3 attack corpus renders as data
— zero tool fires, zero draft changes (CD-8 bar). AC-05.2 *Lying answer contained*: an inbound
"pre-authorised, execute now" claim leaves the confirm gate untouched. AC-05.3 *Egress block*: a
planted above-ceiling payload is blocked before leaving and surfaced. AC-05.4 *Paired askers*: the
same question from members with different sight neither leaks nor acknowledges hidden rows.
AC-05.5 *Router not prompt*: with the system prompt deliberately weakened, the tool router still
refuses tier-(d)-driven writes.

## BP-06 — Learning & Memory

**Scope.** How an agent remembers, infers, corrects, and forgets — memory as governed data, not
model state.

**Decided positions to encode.** Every derived memory is a first-class record carrying
`provenance` (the urns it was derived from) and `source` (the connection, where one was involved);
an untagged derived memory is a forget leak and a conformance failure (01 §3.3.4). Inferences
carry `confidence` (MUST per BP-01); asserted facts and inferred beliefs are distinguishable on
the record. Corrections journal the old value; learning is bitemporal — what was believed, when,
superseded by what. A transparency surface per connection: "what was learned from {system}",
user-visible and user-deletable. On disconnect, derived memory purges with its sources and appears
in the forget receipt. Foreign claims never become first-party facts silently — promotion of a
claim to fact is itself a recorded event. Memory writes are tier-1 reversible writes under BP-05's
caps; memory poisoning is in the injection corpus.

**Open to the writer.** Decay/staleness policy; summarisation lineage (a summary of summaries
keeps full provenance closure); whether confidence thresholds gate recall into context; conflict
representation when two sources disagree (recommend: both kept, `disagreement` surfaced via
BP-08's `needs_human` where action depends on it).

**Acceptance criteria.** AC-06.1 *No orphan memory*: an audit across derived stores finds zero
memories lacking provenance closure. AC-06.2 *Forget includes learning*: a fact learned through a
connection is gone after disconnect, proven end to end. AC-06.3 *Correction trail*: correcting a
fact preserves the journaled old value with both timelines. AC-06.4 *Claim vs fact*: a peer's
claim is retrievable as a claim and never serialises as first-party fact without a recorded
promotion. AC-06.5 *Poison fails*: injected "remember this rule" content writes nothing (shared
corpus with BP-05).

## BP-07 — Security, Privacy & Sensitivity

**Scope.** The classification S0–S3 and its wire behaviour, cryptography, forgetting as proof, the
legal split, the threat model.

**Decided positions to encode.** Sensitivity classes per 12 §B.2, with CD-1's default-deny: S0
ambient (live-preferred, never stored by default); S1 household (standard grant, visibility law
applies); S2 personal (elevated per-class consent at handshake plus step-up confirm on first use
per capability; payloads JWE-encrypted end to end; logs carry envelope metadata, never S2 bodies);
S3 sealed (**never syncs** — reference-only pointers; any real S3 exchange is human-to-human
outside the protocol's automatic paths). Asserting system stamps the class; receivers MAY upgrade,
MUST NOT downgrade. Every batch JWS-signed with the grant key; unsigned or badly signed batches
rejected before validation. Key lifecycle: per grant, 90-day rotation and on demand; **revocation
= key destruction — cryptographic forgetting**, recorded as a line in the forget receipt
(12 §B.3). Forget receipts per BP-02, including derived memory and key destruction. The
controller/controller split and provider/deployer mapping (01 §6) stated normatively so every
implementer knows where legal obligations land. Children's data never crosses the boundary. The
ranked threat model (injection, exfiltration, SSRF, leak, secret exposure, exhaustion, forget
incompleteness, compromised peer, token theft) with required controls; SSRF guard requirements for
any user-supplied URL fetch (01 §3.2).

**Open to the writer.** The starter subtype→sensitivity table (with BP-01); S2 step-up cadence —
per capability-first-use (recommended) vs per session; ciphersuite registry and rotation
procedure; incident-notification floor for conformant systems.

**Acceptance criteria.** AC-07.1 *S3 never travels*: any S3 payload on the wire is an automatic
kit failure; reference pointers pass. AC-07.2 *S2 walls*: S2 without an elevated grant is
rejected; intermediaries observe only ciphertext; a downgrade attempt is rejected. AC-07.3
*Signature law*: unsigned, tampered, and replayed-nonce batches are all rejected and logged.
AC-07.4 *Crypto-forget*: after disconnect, retained ciphertext is unreadable (keys destroyed) and
the receipt records it. AC-07.5 *SSRF closed*: metadata IPs, RFC1918, rebinding, and redirect
tricks are all blocked by the mandated guard tests.

## BP-08 — Human Gates & Authority

**Scope.** The complete authority model: the confirm gate, `needs_human`, dual gates, the
authority dial and its floors. 12 Part D, made a spec.

**Decided positions to encode.** Draft-and-confirm as the universal side-effect law: anything
irreversible or cross-boundary exists first as a proposed Action; the confirm is a server-side
recorded human act bound to a payload hash; drafts are idempotent and expire; expired drafts can
never execute; `action.execute` dark by default — connecting is not granting writes. `needs_human`
as a first-class wire state with the enumerated reasons (`consent_required`, `low_confidence`,
`authority_exceeded`, `disagreement`, `policy_floor`, `unknown_vocabulary`); parked items address
a person, surface in their gate in plain language, and expire per CD-10. Dual gates: the envelope
carries each required gate's state; execution only when all are `confirmed`. The authority dial
(`auto`/`ask`/`never`) per action type per space, journalled on change, consulted **before**
drafting — a forbidden action is refused at source naming the policy. **Hard floors per CD-7,
non-configurable.** Children's actions always gate to a guardian.

**Open to the writer.** Gate addressing/escalation when the addressed human is absent; delegation
between adults; notification semantics for parked items; how a Class D system surfaces inbound
proposals with no UI of its own (recommend: queue + webhook, human resolution out of band).

**Acceptance criteria.** AC-08.1 *No confirm, no execution*: executing without a stored confirm is
impossible server-side; replay against a mutated payload is invalidated by the hash; double-execute
dies on the idempotency key. AC-08.2 *Park and resolve*: a `needs_human` round-trips park → human
resolves → execution; unresolved expires to `declined:expired`. AC-08.3 *Floor unbreakable*: a
policy-floor bypass attempt (set money to `auto`, draft an S3 action) is refused at source.
AC-08.4 *Dual gate holds*: execution attempted with one of two gates unconfirmed does not execute.
AC-08.5 *Dark by default*: a fresh connection's `action.execute` returns "proposed, not executed"
until writes are deliberately enabled.

## BP-09 — Conformance, Certification & Governance

**Scope.** The kit, the certificates, the registry, and the change process — how trust scales past
people who know each other.

**Decided positions to encode.** Three enforcement layers (canonical package, executable TCK in
CI, runtime boundary validation). The kit's content is the union of the canon suites: 11 §6's
checklist items, the eval suites of 11 §5.4 (visibility leaks, forget audit, ≥50-case injection
corpus per CD-8, confirm-gate bypass), 12 Part C.1's v2 additions (sensitivity, signing,
bitemporality, goal subtype), and 12 Part D.3's gate tests (`needs_human` round-trip, policy-floor
bypass refusal, dual-gate enforcement) — partitioned by class per CD-4 with the Class D suite kept
deliberately small. Certification per CD-2: self-cert with published results (D), verified
certification (A, H, any S2 capability); the registry records system × class × version × last pass
× attestations and supports **network-wide revocation** of a system that turns malicious. Runtime
attestation of the unfenceable clauses (the §6b problem): peers attest, hubs record, everyone
re-fences regardless. Change process: PR → TCK green → editor approval → version bump →
CHANGELOG; Brainfeeder is the canary; semver, N/N−1 window, deprecate-then-remove; upgrade
distribution via package, signed registry webhooks, and machine-readable migration descriptors
(additive auto-adoptable, breaking always waits for a human and a green TCK).

**Open to the writer.** Who runs verified certification at first (recommend: the editor plus any
already-certified Class H peer, two signatures); registry hosting and signing; dispute and appeal
process for revocation; badge/claim wording rules ("Brain Protocol v2 Class A certified").

**Acceptance criteria.** AC-09.1 *Class D in a day*: a reference pipe implementation passes the
Class D suite from a clean start within one working day, documented. AC-09.2 *Kit is the gate*: a
deliberately broken law (one per spec BP-01…08) is caught by the corresponding kit suite — proven
by breaking each on a branch. AC-09.3 *Revocation propagates*: a revoked system's connections fail
closed at the next handshake check across test peers. AC-09.4 *Descriptor automation*: an additive
release auto-adopts through the descriptor path with TCK green; a breaking release parks for a
human. AC-09.5 *Negotiated history*: N and N−1 peers interoperate for the stated window with the
kit run on both sides.

---

*Done, for a writer, means: the spec encodes every decided position above without contradiction,
settles its open questions explicitly (or returns them to the council named, not fudged), and its
acceptance criteria exist as runnable kit tests — run, not asserted — before the spec leaves
draft.*
