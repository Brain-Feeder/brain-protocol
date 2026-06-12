# BP-07 — Security, Privacy & Sensitivity

*Status: draft 0.1 · Part of the Brain Protocol v2 suite (BP-00). Encodes council decisions CD-1
(S2 default-deny), CD-3 (telemetry: local mandatory, central forbidden), and CD-7 as it touches
sensitivity. Canon: `12-PROTOCOL-V2.md` §B.2/§B.3, `10-SECURITY-ELITE.md`, `11-PARTNER-BRIEF.md`
§3/§5/§6, `01-PLATFORM.md` §3.2/§6. The key words MUST, MUST NOT, REQUIRED, SHALL, SHOULD, MAY are
to be interpreted per RFC 2119/8174.*

---

## 1. Scope and position

This specification defines the trust layer of the wire: the sensitivity classification every
record carries, the cryptographic obligations on every exchange, the threat model every
conformant system is built against, the children's-data wall, the data-protection (UK/EU) role
mapping, and the audit posture. It binds every conformance class. Class D implements the core
profile — the clauses the BP-09 Class D suite tests: classification and stamping (§2), transport
and batch signing (§3.1–§3.2), key destruction on disconnect (§3.6), the children's wall (§5),
and the audit posture (§7). Classes A and H implement the specification in full, adding S2 JWE
and the full key lifecycle (§2.4, §3.3–§3.5).

Nothing in this specification weakens a law defined elsewhere. The visibility law (BP-02), the
grant matrix (BP-03), propose-only writes (BP-04), fencing (BP-05), memory provenance (BP-06) and
the human gates (BP-08) all stand; this specification adds the classification, the cryptography,
and the legal split that ride with them.

## 2. Sensitivity classes

### 2.1 The classification (normative)

Every record on the wire MUST carry a `sensitivity` field (BP-01 envelope) with exactly one of
four values. The classes are behavioural, not decorative: each fixes how the record may move.

| Class | Name | Definition | Examples |
|---|---|---|---|
| `S0` | Ambient | Transient situational facts whose value decays in hours and whose storage creates risk without benefit | presence ("home ~19:00"), availability, device-online status |
| `S1` | Household | The ordinary shared fabric of a space | events, tasks, lists, reminders, appointments, vehicle records |
| `S2` | Personal | Data about one person that would harm or embarrass if disclosed; includes UK/EU special-category data in summary form | health summaries, clinician reports, finance aggregates, transaction histories |
| `S3` | Sealed / identity | Data whose disclosure enables impersonation, fraud, or irreversible harm; anything the owner has sealed | passport and identity numbers, full clinical records, account numbers, sealed-vault items |

A record without a parseable `sensitivity` value MUST be rejected at the receiver's boundary
(BP-01 AC-01.1). A receiver encountering an unknown sensitivity token MUST treat the record as
`S3` — fail closed, never open.

### 2.2 Stamping rules

1. **The asserting system stamps the class.** The emitter classifies every record it emits, at or
   above the starter classification for its subtype (§2.3).
2. **Receivers MAY upgrade, MUST NOT downgrade.** A receiving system MAY raise the class of an
   ingested record under its own law (a peer's S1 lands as your S2 if your rules say so). A
   receiver MUST NOT lower a class, and MUST reject any inbound instruction, mapping, or
   re-emission that would lower one. On re-export (Class H), a record travels at the highest
   class it has carried anywhere in its `origin_chain`.
3. **Derivation inherits the ceiling.** A derived record (summary, inference, memory — BP-06)
   MUST carry a class no lower than the highest class among its `provenance` sources.
4. **Edges inherit the stricter endpoint**, as they do for visibility (BP-01).
5. A downgrade attempt observed on the wire is a conformance failure of the emitter and MUST be
   rejected and logged by the receiver (TCK T-SEC-05).

### 2.3 Starter classification

The subtype→sensitivity starter table is normative and ships with the vocabulary in **BP-01**;
this specification owns its semantics, BP-01 owns its rows. Indicative anchors (the BP-01 table
governs): `presence` → S0; `event`, `task`, `appointment`, `vehicle` → S1; `transaction`,
`health` summaries, `clinician_report` → S2; `document:passport`, `document:will`, account
credentials, sealed items → S3. Emitters MAY stamp above the starter class for any record;
stamping below it is non-conformant.

### 2.4 Wire behaviour per class

**S0 — live-only by default.** S0 capabilities SHOULD be served as live `query` answers, computed
to the narrowest form, and MUST NOT be stored by the receiver by default. A grant MAY explicitly
permit S0 retention (e.g. for a journalled safety check-in), in which case retention is bounded
and stated in the grant document. Nothing stored is nothing to leak and nothing to forget.

**S1 — standard grant.** S1 records flow under an ordinary BP-03 grant. The visibility law,
member lens, and visibility ceiling apply unchanged. Batches are JWS-signed (§3.2); no payload
encryption beyond transport is required.

**S2 — elevated, end-to-end encrypted (CD-1: default-deny).** S2 MUST NOT cross the wire unless
all three of the following hold; absence of any one is a refusal, not a degraded mode:

1. **Elevated grant.** The grant document carries an explicit per-class S2 consent cell for the
   capability (BP-03 matrix: sensitivity ceiling ≥ S2 on that exact cell). The consent is given
   by the data subject's guardian-of-self — the human whose data it is — at handshake or later,
   never implied by connecting.
2. **Step-up confirmation.** The first S2 exchange **per capability per grant** requires a fresh
   human confirmation through the BP-08 gate, distinct from the handshake consent. The cadence is
   per-capability-first-use (settled here from 12-PROTOCOL-V2 open decision 2; per-session
   step-up MAY be offered as a stricter product option but is not required). The step-up confirm
   is journalled like any gate decision (BP-08 §3).
3. **JWE end-to-end.** The S2 payload is encrypted to the recipient grant's public key (§3.3).
   Intermediaries, proxies, relays and log pipelines observe ciphertext only. Logs and audit
   records carry envelope metadata (ids, class, counts, outcome) and MUST NOT carry S2 bodies.

**S3 — never syncs.** No S3 payload may travel on any automatic protocol path: not in a sync
batch, not in a live answer, not inside an Action payload, not inside a derived memory. Any S3
payload observed on the wire is an automatic conformance failure of the emitter (TCK T-SEC-01)
and MUST be rejected, logged, and counted by the receiver. What MAY travel is a **reference
pointer**: a record asserting that the item exists, what it is called, and any non-secret
operational fact (such as an expiry that drives a derived activity). The pointer record:

- MUST NOT be stamped `S3` itself — it carries the class of the metadata it actually contains
  (SHOULD be `S1`, MUST NOT exceed `S2`);
- MUST contain an `attributes.s3_pointer` object and no other payload-bearing attributes;
- MUST set `s3_pointer.access` to `"human_mediated"` — there is no protocol verb that
  dereferences a pointer. Any real S3 exchange is a human-to-human act outside the protocol's
  automatic paths (the owner shows the document; the protocol only ever knew it existed).

```jsonc
// An S3 reference pointer — the only lawful wire shape for sealed data
{ "id": "urn:brain:brainfeeder:entity:6f1d3a92-7c44-4e0b-9b2a-5d8e0c47a113",
  "type": "entity", "subtype": "document",
  "sensitivity": "S1",                         // the class of THIS metadata, never "S3"
  "visibility": "shared:adults",
  "owner": "mem-3a91", "actor": "mem-7f31",
  "source": "brainfeeder", "external_ref": "document/441#pointer",
  "origin_chain": ["brainfeeder"],
  "valid_time": "2026-06-11T10:02:00Z", "system_time": "2026-06-11T10:02:00Z",
  "attributes": {
    "name": "Passport — Emma",
    "s3_pointer": {
      "class": "S3",                           // the class of the item it points AT
      "label": "Passport",
      "exists": true,
      "expires": "2031-04-02",                 // non-secret operational fact; drives the renewal activity
      "holder": "brainfeeder",                 // the system that holds the payload
      "access": "human_mediated"               // no protocol path dereferences this
    } } }
```

The expiry in a pointer is a dated requirement: the BP-01 derivation rule applies and the holder
derives the renewal activity (itself S1), so calendars work without the secret ever moving.

## 3. Cryptography

### 3.1 Transport baseline

TLS 1.2 or higher on every connection, with HSTS on every published endpoint. Transport
encryption is necessary and never sufficient: it authenticates the pipe, not the peer's
assertion, and it protects nothing at rest.

### 3.2 Integrity and non-repudiation — JWS on every batch

- Every record batch, live answer, and relayed Action MUST be **JWS-signed** (RFC 7515) with the
  emitting grant's private key (per-grant key pairs, BP-03). The signature covers method, body
  hash, timestamp, and nonce.
- The receiver MUST verify the signature **before** boundary validation. Unsigned, badly signed,
  tampered, or replayed-nonce batches are rejected, logged, and counted (TCK T-SEC-06/07/08) —
  never partially processed.
- Effect: a peer cannot deny what it asserted; a middlebox cannot alter it; a stolen bearer token
  without the grant key is useless (BP-03 AC-03.3).

### 3.3 Confidentiality — JWE for S2 and above

- S2 payloads are additionally **JWE-encrypted** (RFC 7516) to the recipient grant's public key:
  true end-to-end between the two systems' application layers. Plaintext exists only inside the
  emitter and the receiver; everything between sees ciphertext.
- S3 does not travel (§2.4); there is nothing to encrypt on the wire because nothing is on the
  wire. Pointers travel at their own (≤ S2) class rules.

### 3.4 Ciphersuite registry

The v2.0 mandatory-to-implement suite (ratifying 12-PROTOCOL-V2 open decision 3):

| Purpose | Algorithm | Notes |
|---|---|---|
| Signing (JWS) | **Ed25519** (`EdDSA`) | per-grant signing pair |
| Key agreement + content encryption (JWE) | **ECDH-ES on X25519 + A256GCM** | per-grant encryption pair |
| Hashing (payload hashes, token storage) | SHA-256 | |
| Card signing | Ed25519 over the canonical card body | BP-03 |

The suite is a registry, not a constant: new suites land by MINOR version through BP-09
governance; removal of a suite is a MAJOR event. A system MUST implement the mandatory suite and
MAY offer others; negotiation picks the strongest common suite, never below the mandatory one.

### 3.5 Key lifecycle

- **Per grant.** Each side mints its signing and encryption pairs at handshake and publishes the
  public halves in the grant document (BP-03). Keys are never shared across grants.
- **Rotation.** 90-day scheduled rotation (aligned with token expiry) and on-demand rotation at
  either side's initiative. Rotation publishes the new public keys through the grant-update path;
  the old key remains valid for verification of already-received material for a 7-day overlap
  window, then is destroyed. Rotation events are journalled.
- **Compromise.** A suspected key compromise is grounds for immediate on-demand rotation or
  revocation; the affected peer MUST be notified (§6.4 applies if data was exposed).

### 3.6 Revocation is key destruction — cryptographic forgetting

Disconnecting a grant MUST destroy both sides' grant keys (signing and encryption, public and
private halves held locally). Consequences, all REQUIRED:

1. Any retained S2 ciphertext — in either system, in any intermediary log, in any backup —
   becomes permanently unreadable the moment the keys are gone. This is **cryptographic
   forgetting**, and it runs ahead of the physical purge and ahead of any backup-retention lag.
2. The BP-02 forget receipt gains a line: *grant keys destroyed*, with timestamp. A receipt
   without it is incomplete (TCK T-SEC-09).
3. Key destruction is recorded in the journal as an event; the keys themselves never appear in
   any journal, log, or error message.
4. Grant private keys MUST NOT be included in general backups; if key escrow exists, the escrow
   copy is destroyed at disconnect and the destruction recorded in the receipt. *(Co-ratified
   line, stated identically in BP-02 §5.6.)* Backup restores replay the forget log (BP-02)
   **and** must not restore destroyed keys; a restored key is resurrection and is an incident,
   not an ops event.

## 4. Threat model

The protocol assumes a mesh in which any peer may one day be compromised, sloppy, or malicious,
and in which the data at stake is families' lives. The ranked top ten attack paths, each with its
required countermeasure and the specification that mandates it. A conformant system MUST
implement every countermeasure applicable to its class.

| # | Attack path | Required countermeasure | Mandated by |
|---|---|---|---|
| 1 | **Indirect prompt injection** — instructions smuggled in synced titles, names, memos, live answers | structural fencing of federated content; tool allowlists by origin in the router; zero-pass injection corpus in CI (CD-8) | BP-05; corpus shipped per BP-09 |
| 2 | **Cross-boundary exfiltration** — injected or social-engineered content steering private data into an outbound payload | egress check on every confirmed cross-boundary payload against the visibility ceiling and other members' private rows; confirm summaries generated server-side from the payload | BP-05 §egress; BP-03 ceiling |
| 3 | **Peer turns malicious after connect** | re-fence everything locally regardless of attestation; propose-only writes (no foreign mutation path exists); bounds both directions; one-tap revoke triggering forget + key destruction | BP-04, BP-05, BP-03, this spec §3.6 |
| 4 | **Token theft** | tokens vaulted server-side, hashed at rest, shown once, expiring; JWS proof-of-possession on every call — a bearer token alone fails everything | BP-03; this spec §3.2 |
| 5 | **SSRF** — a peer-supplied or user-supplied URL (agent cards, endpoints, webhooks) used to reach internal infrastructure | the SSRF guard on every such fetch: resolve to public IPs only, pin the resolved address, re-validate on every redirect, cap response size; metadata addresses, RFC 1918/4193 ranges, and DNS rebinding all blocked | this spec; tested at TCK T-SEC-10 |
| 6 | **Visibility and existence leaks** — a member, child, or peer seeing above its sight | visibility law in the data layer; member lens and ceiling on every grant; denial by silence; paired-asker tests | BP-02, BP-03, BP-05 |
| 7 | **Graph corruption via identity-hint poisoning** — crafted hints engineering a wrong merge | never auto-merge across sources; merge proposals through the human gate with `confidence`; declined pairs never re-proposed | BP-04 |
| 8 | **Forget incompleteness and resurrection** — derived memories surviving disconnect; backups or mesh echoes restoring forgotten data | forget audit to zero across every provenance-bearing table including derived stores; restore replays the forget log; origin-chain loop guard rejects echoes; cryptographic forget for S2 | BP-02, BP-04, BP-06, this spec §3.6 |
| 9 | **Batch tampering and replay** | JWS over method + body hash + timestamp + nonce; replayed nonces rejected; verification precedes validation | this spec §3.2 |
| 10 | **Resource exhaustion** — flooding a peer with syncs, queries, or proposals | size, count, and rate bounds in both directions; over-rate callers receive 429, never a silent drop; over-cap syncs truncated and flagged partial | BP-02, BP-04 |

The three the council watches hardest: #1 (the federation is the product *and* the attack
surface), #8 (a forget leak breaks the protocol's central promise), and #3 (the mesh's trust
model must survive any single peer going bad).

## 5. The children's-data wall

Children's data gets a wall, not a dial. All of the following are protocol law at every class:

1. **Forced household visibility.** Anything a child creates is forced to the household audience
   (`shared:household`); children cannot hold `private` rows and never see adults' private rows.
   Enforced in the data layer (BP-02), not in UI.
2. **Never across the boundary.** Children's rows MUST NOT cross the federation boundary. No
   grant carries a child member lens, and outbound answers are screened so that a child's data
   never rides along in an adult-lens answer beyond the household.
3. **The registered exception.** The only lawful child-scoped grant is a **registered exception**:
   created by a guardian, scoped to a single named capability and a single named peer (e.g. the
   school system's `attendance.read`), journalled at creation, documented with a child-specific
   data-protection impact assessment, and revocable in one tap with the full forget flow. An
   exception is never implied, never defaulted, never created by the child, and never broadened
   without a fresh guardian act. Systems that do not implement the exception mechanism simply
   refuse all child-scoped grants — that is full conformance.
4. **Guardians gate everything.** Every action concerning a child — proposed by any agent, any
   peer, or the child — gates to a guardian (BP-08 floor, CD-7). There is no authority-dial
   setting that changes this.
5. No conformant system addresses nudging, profiling, or marketing surfaces to a child member
   (UK Age Appropriate Design Code alignment).

## 6. Data-protection mapping (UK GDPR / EU GDPR)

This section states where legal obligations land so that no implementer discovers them in an
incident. It is normative as to protocol behaviour; it is not legal advice for any specific
deployment.

### 6.1 Roles per grant

- Each conformant system is an **independent controller** for the data of its own space.
- Across a grant, the relationship is **controller-to-controller**: the disclosing system remains
  controller of what it discloses; the receiving system becomes an independent controller of what
  it ingests, with its own obligations (purpose limitation to the grant's scope, the forget flow
  as erasure, the transparency surface as the right of access). The grant document is the record
  of the disclosure's scope and basis.
- A system that merely relays (a pure pipe carrying others' encrypted exchanges, processing on
  documented instructions) is a **processor** for that traffic and MUST be bound by processor
  terms; the moment it reasons over, stores, or reuses the data it is a controller and the full
  obligations attach.
- Joint controllership arises only where two systems jointly determine purposes and means; the
  protocol's default grant does not create it. Where a deployment does (e.g. a co-operated hub),
  the parties MUST record an Article 26 arrangement.
- Provider/deployer mapping (EU AI Act): the system operator is the deployer of its own agent;
  the protocol imposes the human-oversight machinery (BP-08) that deployers rely on as their
  oversight control.

### 6.2 Lawful basis notes

- The **grant ceremony is the consent record**: who consented, to which cells of the matrix,
  when, revocably. Grants map naturally to consent (UK/EU Art. 6(1)(a)) or, for the user's own
  system acting on their instruction, contract (Art. 6(1)(b)).
- **S2 routinely contains special-category data** (Art. 9 — health above all). The S2 elevated
  grant plus step-up confirm is designed to evidence **explicit consent** (Art. 9(2)(a)). A
  system MUST NOT serve special-category data under a grant whose S2 consent cell is absent —
  which is the same rule as CD-1, stated legally.
- Legitimate interests is a poor fit for cross-boundary family data and SHOULD NOT be relied on
  for S2; systems choosing it for S1 traffic MUST document the balancing test.
- Revocation of a grant is withdrawal of consent: it MUST be as easy as the giving (one tap), and
  the forget flow (BP-02) plus key destruction (§3.6) is the erasure that follows.

### 6.3 Data subject rights, mechanically

Access = the transparency surface (BP-06) plus export; erasure = forget-on-disconnect and
per-item delete; rectification = the correction flow with its journalled old value (BP-06);
portability = the v2 envelope itself, which is a structured, machine-readable format by design.

### 6.4 Breach notification between peers

- A conformant system that suffers a breach affecting data received under a grant MUST notify the
  disclosing peer **without undue delay and within 72 hours** of becoming aware, through the
  grant's notification channel (BP-03 card metadata), with: what was exposed (classes and counts,
  never re-exposing payloads), when, what has been done, and what the peer should do.
- The notification, its timestamp, and its acknowledgement are journalled on both sides — the
  journal is the evidence trail a regulator asks for.
- This duty is protocol conformance, additional to (not a substitute for) each controller's own
  duty to its supervisory authority (UK ICO / EU SA, 72 hours) and to affected data subjects
  where the risk threshold is met.

### 6.5 Incident-notification floor (settled)

The floor for conformant systems, settling this spec's open question: peer notification within
72 hours (§6.4); affected humans told plainly and promptly where the high-risk threshold is met
— no minimising, no burying; the incident, its scope, and its remediation journalled. Systems
MAY commit to stronger floors in their cards; they MUST NOT ship weaker ones.

## 7. Audit and telemetry (CD-3)

### 7.1 The local per-exchange audit log — REQUIRED

Every conformant system, every class, MUST keep a local, append-only, per-exchange audit log.
Each entry records **metadata only**:

```jsonc
{ "exchange_id": "ex-01HZX…",            // unique per exchange
  "grant_id": "grant-7d2f…",
  "peer": "garagebrain",
  "direction": "inbound",                 // inbound | outbound
  "method": "calendar.read",
  "at": "2026-06-11T10:14:02Z",
  "outcome": "ok",                        // ok | rejected | error | rate_limited | refused
  "counts": { "records": 41, "rejected": 0 },
  "classes_present": ["S0", "S1"],        // sensitivity classes observed, never the bodies
  "signature_valid": true }
```

Payload bodies MUST NOT appear in the log at any class; S2 entries carry envelope metadata only
(§2.4). The log is what makes forensics, the forget audit, and breach reconstruction possible. A
bumped "last used" timestamp is not an audit log.

### 7.2 Central telemetry — FORBIDDEN

No conformant system phones home. Central or vendor telemetry — automatic transmission of usage,
audit, exchange, or content data to the protocol's maintainers, a certification body, or any
third party — is **prohibited by this specification**. The conformance kit (BP-09) runs locally;
certification evidence is published by the system operator, not collected. A system found
transmitting central telemetry fails conformance and is subject to registry revocation (BP-09).

### 7.3 Voluntary, grant-scoped audit sharing

Two connected peers MAY agree — as an explicit grant capability like any other, default absent —
to exchange **audit summaries** scoped to their own connection: counts, outcomes, rejection
totals, never bodies. This supports mutual debugging and the dual-sided evidence of §6.4. It is
voluntary, revocable, bounded by the same rate and size limits, and confers no access beyond the
summaries themselves.

## 8. Settled questions register

| Question (from the council brief) | Settlement |
|---|---|
| S2 step-up cadence | Per capability-first-use per grant (§2.4); per-session allowed as a stricter option |
| Ciphersuite registry | §3.4: Ed25519 / ECDH-ES(X25519)+A256GCM mandatory; registry evolves by MINOR |
| Starter subtype→sensitivity table | Semantics here (§2.3); rows live in BP-01 with the vocabulary — one source of truth |
| Incident-notification floor | §6.5: 72h peer notice, plain prompt human notice at high risk, journalled |

## 9. Acceptance criteria

Each criterion exists as a runnable kit test (BP-09 catalogue ids in brackets); a criterion is
met only when its test has been run and seen to pass.

- **AC-07.1 — S3 never travels.** Any S3 payload on the wire is an automatic kit failure; a
  conformant reference pointer passes. [T-SEC-01, T-SEC-02]
- **AC-07.2 — S2 walls.** S2 without an elevated grant cell is rejected; an intermediary observer
  sees only ciphertext; a class-downgrade attempt is rejected and logged. [T-SEC-03, T-SEC-04,
  T-SEC-05]
- **AC-07.3 — Signature law.** Unsigned, tampered, and replayed-nonce batches are each rejected
  and logged, with verification preceding validation. [T-SEC-06, T-SEC-07, T-SEC-08]
- **AC-07.4 — Crypto-forget.** After disconnect, retained S2 ciphertext is unreadable (keys
  destroyed on both sides) and the forget receipt records the destruction. [T-SEC-09]
- **AC-07.5 — SSRF closed.** Metadata IPs, RFC 1918/4193 ranges, DNS rebinding, and redirect
  tricks are all blocked by the mandated guard. [T-SEC-10]

---

*Done, for this spec, means: every record on the wire carries a class that governs how it moves,
S2 is ciphertext to everyone but its two ends, S3 never moves at all, disconnection destroys the
keys, the ten attack paths each meet a tested control, and no byte of telemetry ever leaves a
family's system without a grant that says so.*
