# BP-03 — Handshake, Identity & Grants

*Status: draft 0.1 · Suite: Brain Protocol v2 · Editor: Peter McCormack · Per the council brief of
11 June 2026. MUST, MUST NOT, SHOULD, SHOULD NOT and MAY carry RFC 2119/8174 meaning. Canon:
`BRAIN_PROTOCOL.md` v0.1 §§4–6a, `11-PARTNER-BRIEF.md` §4, `12-PROTOCOL-V2.md` Part B.*

---

## 1. Scope and applicability

This specification defines how two systems meet and what one may do to the other: discovery (the
signed agent card), version and vocabulary negotiation, system identity and per-grant keys, the
grant document and its permission matrix, the consent flow, the grant lifecycle, and token
handling. Movement of data under a grant is BP-04; sensitivity classes are defined in BP-07;
human gates in BP-08.

Conformance class applicability (per BP-00 §4):

| Section | Class D | Class A | Class H |
|---|---|---|---|
| §2 Agent card, §3 Negotiation | MUST (provider profile) | MUST | MUST |
| §4 Identity & keys | MUST | MUST | MUST |
| §5–§7 Grants (inbound — being granted to) | MUST | MUST | MUST |
| §5–§7 Grants (outbound — issuing grants) | MAY | MUST | MUST |
| §6.2 S2 elevated consent | only if offering an S2 capability | MUST | MUST |

## 2. Discovery — the signed agent card

### 2.1 Publication

2.1.1 Every system MUST publish a machine-readable agent card at the well-known HTTPS path
`/.well-known/brain-protocol/card.json`. Systems that also publish an A2A agent card at
`/.well-known/agent.json` MUST keep the two consistent; the Brain Protocol card is authoritative
for everything this suite defines.

2.1.2 The card MUST be served over TLS 1.2+ and MUST NOT require authentication to fetch.

2.1.3 The card describes the system, never a connection: nothing grant-specific, member-specific
or secret appears in it.

### 2.2 Card schema (normative)

```jsonc
{
  "card_format": 1,                              // MUST — this schema's version
  "system_id": "clinic-oakfield",                // MUST — stable, lower-case, globally unique by convention
  "name": "Oakfield Clinic Brain",               // MUST — human-readable
  "operator": {                                  // MUST — who answers for this system
    "legal_name": "Oakfield Clinic Ltd",
    "contact": "admin@oakfield-clinic.example",
    "jurisdiction": "GB"
  },
  "protocol_versions": ["2.0", "0.1"],           // MUST — descending preference (§3)
  "vocabulary": {                                 // MUST for v2 — checked at connect (§3.3)
    "base_version": "2.0",
    "mapping_table": "https://clinic.example/bp/mappings.json"   // MAY — local-term mappings
  },
  "conformance": {                                // MUST — class and proof (BP-09)
    "class": "A",
    "certification": {
      "tier": "verified",                         // "self" | "verified" per CD-2
      "registry_ref": "https://registry.brain-protocol.org/systems/clinic-oakfield",
      "last_pass": "2026-06-01",
      "suite_version": "2.0.0"
    }
  },
  "identity_keys": [                              // MUST — long-lived card-signing keys (JWK)
    { "kid": "id-2026-1", "kty": "OKP", "crv": "Ed25519", "x": "…",
      "use": "sig", "not_after": "2027-06-01" }
  ],
  "capabilities": [                               // MUST — what this system offers and consumes
    { "name": "appointment.book",  "direction": "offer",   "modes": ["propose"],
      "sensitivity_ceiling": "S1" },
    { "name": "appointment.read",  "direction": "offer",   "modes": ["read"],
      "sensitivity_ceiling": "S1", "audiences": ["private", "shared:household"] },
    { "name": "health_record.summary", "direction": "offer", "modes": ["read"],
      "sensitivity_ceiling": "S2" },               // S2 offer ⇒ verified certification (CD-2)
    { "name": "report.submit",     "direction": "consume", "modes": ["propose"],
      "sensitivity_ceiling": "S2" }
  ],
  "auth": { "type": "oauth2.1",                   // optional - omit if tokens come from the connect handshake (§6.4)
    "authorize_url": "https://clinic.example/oauth/authorize",
    "token_url": "https://clinic.example/oauth/token" },
  "endpoints": {                                  // MUST — at least one of a2a | mcp
    "a2a": "https://clinic.example/api/agent/a2a",
    "mcp": "https://clinic.example/api/agent/mcp"
  },
  "limits": { "max_batch_records": 500,           // SHOULD — declared bounds (BP-04 §9)
              "max_batch_bytes": 1048576, "rate_per_minute": 60 }
}
```

Field rules: `capabilities[].direction` is `offer` (we serve it) or `consume` (we call yours);
`modes` is a subset of `read | propose` — `write-direct` never appears on a card because it never
crosses a boundary (§5.2); `sensitivity_ceiling` is the highest class (BP-07) the capability ever
carries. An `offer` of an S2-ceiling capability at any class requires verified certification
(CD-2). A capability that may be shared at more than one visibility tier SHOULD declare `audiences`
(v1.1, additive): the ascending list of tiers it is shareable at. A consumer presents a
per-capability audience picker over those tiers at connect and records the choice on the grant; a
read clamps to the stricter of the user's choice and the grant ceiling. Absent `audiences`, the
consumer applies its own fallback, so a provider that omits it forgoes the per-capability picker.
Unknown card fields MUST be ignored (forward compatibility).

### 2.3 Card signing — mandatory

2.3.1 v0.1 deferred card signing; **that deferral ends here.** A v2 card MUST be signed:
the published artefact is a JWS (RFC 7515, compact or JSON serialisation) over the canonical card
body, signed with a key listed in `identity_keys`, `alg: EdDSA` (Ed25519). The plain JSON form MAY
be served beside it for human reading; verifiers use only the JWS.

2.3.2 A receiver MUST verify the card signature before any handshake step. An unsigned card, a
signature by a key not in `identity_keys`, an expired key (`not_after` past), or a body that does
not match the signature MUST abort the connection attempt. No third-party connection proceeds
without a verified card.

2.3.3 Identity verification chain, first tier: the card is self-certifying (signed by its own
listed key), so the trust anchor is **out-of-band fingerprint verification** — at first connect,
the operator confirms the Ed25519 key fingerprint of the peer's identity key through a channel
that is not the wire (the registry entry, a printed letter, a phone call, an existing business
relationship). The verified fingerprint MUST be pinned; a card later signed by an unpinned key
MUST be treated as a new, unverified identity. A signed public directory is BP-09's problem and
layers on top without changing this floor.

2.3.4 Identity keys are long-lived (SHOULD ≤ 24 months) and distinct from grant keys (§4). Key
rotation is announced by publishing the new key in `identity_keys` signed by the old one for an
overlap window of at least 30 days.

## 3. Version and vocabulary negotiation

3.1 On connect, each side reads the other's card and they operate at the **highest common
protocol version** and the **intersection of capabilities**. No lockstep deployment is ever
required; each system upgrades on its own schedule (BP-00 §5).

3.2 **v0.1 fallback.** A v2 system and a v0.1 peer converse in v0.1 with v2 features inert, under
these constraints:

- (a) The v2 side MUST still enforce its own v2 obligations locally (default-deny grants, bounds,
  audit log, forget) — fallback degrades the wire, never the law.
- (b) Because v0.1 cards are unsigned, a v0.1 connection is permitted **only** to a peer the
  operator already trusts and has fingerprint-verified out of band; otherwise refuse.
- (c) No S2 capability may be granted in either direction over a v0.1 connection — S2 requires
  the elevated grant and JWE of v2 (§6.2, BP-07). S3 never travels at any version.
- (d) v2 envelope fields emitted to a v0.1 peer are carried as additive fields (the v0.1
  forward-compatibility rule makes them ignorable); v2 fields absent from v0.1 input are defaulted
  conservatively at the boundary (`sensitivity` from the BP-01/BP-07 starter table, unknown
  visibility → `private`).

3.3 **Vocabulary check (CD-6).** At connect, each side declares its vocabulary base version plus
a mapping table for any local term. A connection where either side's terms are neither
base-vocabulary nor mapped MUST NOT proceed to sync; live query MAY proceed for base-vocabulary
capabilities only. Unmapped unknown terms encountered later pass through opaquely and MUST NOT be
silently aliased; an unknown visibility scope lands as `private`.

3.4 The negotiation result (version, capability intersection, vocabulary verdict) MUST be
recorded in both sides' audit logs and is re-evaluated whenever either card changes.

## 4. Identity and keys

4.1 **Per-grant key pairs.** At handshake each side mints fresh asymmetric key pairs **per
grant** — an Ed25519 signing pair and an X25519 encryption pair, never reused across grants,
never the identity key. Algorithm suite (settling 12-PROTOCOL-V2 open decision 3,
council-recommended, hereby ratified for v2.0): **Ed25519** for JWS signing;
**ECDH-ES on X25519 + A256GCM** for JWE (BP-07 §3.4). The public halves are exchanged inside the
grant documents (§5.4); the private halves live in each side's vault (BP-02) with zero client
read paths.

4.2 **Proof-of-possession.** Every call under a grant MUST carry a JWS signed with the caller's
grant private key over: `method`, SHA-256 hash of the body, `issued_at` timestamp, and a unique
`nonce`. The receiver MUST verify the signature against the grant's pinned public key, reject
timestamps outside a ±5-minute window, and reject any replayed nonce within that window. A valid
bearer token without a valid grant-key JWS MUST fail the call — a stolen token alone is useless.

4.3 **Short-lived access proofs.** The JWS of §4.2 is the access proof; its lifetime is the clock
window. Long-lived secrets never travel on the wire after mint.

4.4 **Rotation.** Grant keys MUST be rotatable on demand and SHOULD rotate on a 90-day schedule
aligned with token expiry. Rotation is a signed grant amendment (§7.3): the new public key is
published signed by the outgoing grant key; the old key remains valid for verification only
during a ≤ 7-day overlap, then MUST be destroyed.

4.5 **Revocation = key destruction.** Revoking a grant (§7.4) MUST destroy the grant keys —
signing and encryption pairs both (BP-07 §3.6). This is cryptographic forgetting (BP-07): any retained JWE ciphertext becomes permanently
unreadable, and the destruction is recorded as a line in the forget receipt (BP-02).

## 5. The grant

### 5.1 Definition

A **grant** is the revocable permission document binding one direction of one connection: what
the grantee may do against the grantor, cell by cell. A connection between two systems normally
comprises **two grants**, one issued by each side (§9 shows the pair). Absent grant = no access;
absent cell = denied cell. **Default deny, both axes, both directions.**

### 5.2 The permission matrix

The matrix is `capability × direction × mode × sensitivity ceiling × member lens × visibility
ceiling`. Per cell:

- **capability** — a named module from the card's intersection (§3.1).
- **direction** — `offer` (grantor serves it to the grantee) or `consume` (grantor may call the
  grantee's). A single grant document enumerates both directions from the grantor's standpoint.
- **mode** — `read` (sync/query/subscribe), `propose` (submit a draft Action into the receiving
  side's confirm gate, BP-04 §5, BP-08), or `write-direct`. **`write-direct` is reserved for a
  system's own records and MUST NOT appear in any grant cell — `propose` is the only cross-system
  mutation.** A grant document containing a `write-direct` cell is invalid and MUST be refused.
- **sensitivity ceiling** — the highest class (S0–S2) the cell may carry. S2 cells require the
  elevated consent of §6.2. **No cell may carry S3** — S3 never syncs (BP-07); reference-only
  pointers travel as the S1/S2 records they are.
- **member lens** — the named member through whose data-layer eyes all of the grantor's filtering
  runs. MUST be set at grant level; a cell MAY narrow it, never widen it. **Never a child** (§6.3).
- **visibility ceiling** — the maximum visibility scope (`private | shared:<scope> | public`,
  BP-01) above which nothing crosses, enforced in the data layer at answer time, regardless of
  the lens.

Every permitted cell is explicit in the document. Any call mapping to an absent cell MUST be
refused with `cell_denied` (BP-04 §7) and logged.

### 5.3 Grant document schema (normative)

```jsonc
{
  "grant_format": 1,
  "grant_id": "urn:brain:brainfeeder-mccormack:grant:6f0e…",   // minted by the grantor
  "grantor": "brainfeeder-mccormack",
  "grantee": "clinic-oakfield",
  "protocol_version": "2.0",
  "issued_at": "2026-06-11T10:00:00Z",
  "expires_at": "2026-09-09T10:00:00Z",            // 90-day default, renewable (§8.3)
  "member_lens": "mem-7f31",                       // never a child (§6.3)
  "visibility_ceiling": "shared:partners",
  "matrix": [                                      // every permitted cell, explicitly
    { "capability": "appointment.book", "direction": "offer",
      "mode": "propose", "sensitivity_ceiling": "S1" },
    { "capability": "health_record.summary", "direction": "consume",
      "mode": "read", "sensitivity_ceiling": "S2" }
  ],
  "elevated": {                                    // present iff any S2 cell exists (§6.2)
    "s2_capabilities": ["health_record.summary"],
    "consented_by": "mem-7f31",
    "consented_at": "2026-06-11T10:00:00Z",
    "step_up": "per_capability_first_use"
  },
  "keys": {                                        // per-grant public keys (§4)
    "grantor_public": { "kid": "g-bf-1", "kty": "OKP", "crv": "Ed25519", "x": "…" },
    "grantee_public": { "kid": "g-cl-1", "kty": "OKP", "crv": "Ed25519", "x": "…" },
    "grantor_encryption_public": { "kid": "g-bf-1e", "kty": "OKP", "crv": "X25519", "x": "…" },
    "grantee_encryption_public": { "kid": "g-cl-1e", "kty": "OKP", "crv": "X25519", "x": "…" },
    "rotation_days": 90
  },
  "action_execute": "dark",                        // dark | enabled — dark at issue (BP-08)
  "audit": { "negotiated_version": "2.0", "vocabulary_verdict": "base+mapped" },
  "signatures": {                                  // detached JWS by each side's identity key
    "grantor": "eyJhbGciOiJFZERTQSJ9…",
    "grantee": "eyJhbGciOiJFZERTQSJ9…"
  }
}
```

Serialisation (settling the brief's open question): canonical JSON per BP-01's serialisation
rules; both signatures are detached JWS over the canonical body minus the `signatures` member; a
grant lacking either signature is not in force.

### 5.4 Grant semantics

5.4.1 The grant is data, not configuration prose: both sides MUST store it, evaluate every call
against it server-side, and journal every amendment. The matrix is consulted **before** any
data-layer read and before any Action is accepted — the lens and ceilings are then enforced again
**in** the data layer (BP-02); the grant check is a gate, not the law itself.

5.4.2 A grant binds exactly one (grantor, grantee, member lens) triple. Serving two members to
the same peer means two grants, each with its own keys and tokens.

5.4.3 `action_execute` is `dark` at issue, always: connecting is not granting writes. Flipping it
to `enabled` is a deliberate, journalled human act distinct from consent to connect (BP-08).

## 6. The consent flow

### 6.1 Standard flow (S0/S1)

1. A human of the grantor's space initiates: fetch the peer's card, verify its signature and
   pinned fingerprint (§2.3), run negotiation (§3).
2. The grantor's system renders the proposed matrix **cell by cell in plain language** — what
   capability, which direction, which mode, up to which sensitivity, through whose lens, up to
   which visibility. Bundled "accept all" consent is non-conformant; per-capability choice is
   MUST (least privilege, v0.1 §5 carried forward).
3. The human approves; the consent is a server-side recorded act (who, when, against which
   grant-document hash) in the append-only journal.
4. Keys are minted (§4.1), the grant is signed by both sides (§5.3), tokens are issued (§8).

### 6.2 S2 elevated grant — human step-up (CD-1)

S2 cells require, in addition to §6.1:

- (a) **Explicit per-class consent at handshake**: the S2 capabilities are listed separately in
  the consent UI, named for what they are ("health summaries — personal-grade data"), and
  accepted distinctly from the S0/S1 cells. Silence or bundling = no S2.
- (b) **Step-up confirmation on first use, per capability** (settling the cadence question with
  BP-07's recommendation: per capability-first-use, not per session): the first S2 exchange on
  each capability parks as `needs_human(consent_required)` (BP-08) addressed to the consenting
  member; it proceeds only on their recorded confirm.
- (c) S2 payloads are JWE-encrypted end to end under the grant keys (BP-07). A grant with S2
  cells but no JWE capability on either side MUST NOT issue.
- (d) Default-deny stands: no v2 system ships S2 sharing enabled by any default, ever.

### 6.3 Child-lens constraints

- The `member_lens` of any grant MUST NOT be a child, at grant level or any cell.
- Children's rows never cross the federation boundary regardless of lens or ceiling — enforced in
  the data layer (BP-02), restated here as a grant invariant.
- A grant document naming a child lens is invalid; a receiver MUST refuse it and log the attempt.
- Inbound proposed Actions concerning a child always gate to a guardian (CD-7, BP-08).

### 6.4 Connect handshake — consumer-initiated establishment (the wire bootstrap)

§6.1–6.3 fix *who consents to what*; this section fixes *the on-the-wire exchange* by which a
consumer asks to connect and a grantor issues the grant. Without it, every connection is an
out-of-band exchange of signed documents. The handshake changes no law: writes stay propose-only,
secrets stay vaulted, grants stay dual-signed and default-deny, and S2 still requires §6.2.

**Roles.** The **consumer** wants to read or propose; the **grantor** owns the capability and issues
the grant. The grantor always consents — asking is not granting. Both sides MUST hold a long-lived
identity key (§4) and SHOULD publish a card (§2); on first contact the grantor MUST pin the
requester's identity fingerprint (§2.3.3), out of band or by trust-on-first-use surfaced to its human.

**Three signed A2A messages** (BP-04 §2 envelopes). The proof-of-possession on `connect.request` and
`connect.confirm` is signed by the **identity** key (no grant key is trusted yet); capability calls
after connect use the per-grant key as normal.

1. **`connect.request`** (consumer → grantor). Body carries the requester's `system_id` and identity
   key (inline or by `card_url`), the requested `capabilities` (`{capability, mode}`), a `member_hint`,
   the consumer's freshly minted `grantee_public` (§4.1), and a requested visibility ceiling. The
   grantor MUST verify the requester's card/identity and the PoP, confirm the requester key matches
   the pin, and refuse any capability it does not `offer` in that mode (`cell_denied`).
2. **`connect.issue`** (grantor → consumer). The grantor runs consent — auto-approve by policy for
   S0/S1, or park `needs_human(consent_required)` for S2 or first contact (§6.2, BP-08). On approval
   it mints its per-grant key, mints `grant_id`, builds the §5.3 grant (matrix = approved cells,
   `action_execute: "dark"`, both per-grant public keys), signs `signatures.grantor` with its identity
   key, and mints a token (§8). It responds with the grantor-signed grant + token,
   `state: "pending_grantee_signature"` (or a `needs_human` block if parked).
3. **`connect.confirm`** (consumer → grantor). The consumer MUST verify the issued grant — grantor
   signature valid against the pinned card key; `grantee_public` is exactly the key it minted; matrix
   ⊆ what it requested; no `write-direct` cell; `action_execute` dark; `member_lens` present and not a
   child (§6.3). It then signs `signatures.grantee` over the same canonical body and stores the grant
   behind the vault wall. The grantor attaches the grantee signature; the grant is now dual-signed and
   in force (§5.4, §7.1) and the token is activated. Both sides journal `connect`.

**Signature schemes (normative, so independent implementations interoperate).** The grant document
signatures (`signatures.grantor`, `signatures.grantee`) are each a compact JWS (`alg: EdDSA`, `kid` =
that system's identity key) whose payload is the JCS-canonical grant document with the `signatures`
member removed; verification checks the decoded payload equals that canonical form **and** the
signature is valid against the signer's identity key. The PoP on every message is the §4.2 JWS.

**Failure modes.** Card/identity verify failure or unpinned fingerprint → abort before issue
(`invalid_signature` / `fingerprint_unpinned`); unoffered capability or wrong mode → `cell_denied`;
consent declined → `connect_declined`; S2 without §6.2 → parks, never auto-issues; a `connect.confirm`
that never arrives → the issued-but-unconfirmed grant expires (grantor TTL, SHOULD ≤ 1 h) — no
half-open grant lingers. After connect, capability calls, sync, propose-only relay, errors, and
401-as-disconnect (BP-04) are unchanged; reconnecting supersedes any prior grant for the pair.

## 7. Grant lifecycle

7.1 **Issue** — §6. The grant takes effect when both signatures exist and the first token is
minted. Issue is journalled on both sides.

7.2 **Inspect** — both sides MUST expose the in-force grant (document minus key material and
token data) to their own humans on demand: every cell, plain-language, with last-used timestamps
per capability from the audit log. The grantee MUST also answer `grant.inspect` on the wire with
the grant body it believes is in force, so drift is detectable.

7.3 **Amend** — any change (add/remove a cell, narrow a ceiling, rotate keys, renew expiry) is a
new signed revision with a monotonically increasing `revision` number, consented per §6 where it
widens anything (widening S0/S1 → standard consent; adding any S2 cell → full §6.2). Narrowing
takes effect immediately without the peer's countersignature. Old revisions are journalled, never
overwritten.

7.4 **Revoke** — either end, at any time, one deliberate act:

1. Mark the grant revoked; refuse all further calls under it (`grant_revoked`).
2. Destroy the grant private key and the token hashes (§4.5, §8).
3. SHOULD send `connection.revoke` as a courtesy so the peer's forget flow starts immediately;
   token/key invalidation alone is sufficient — the peer's next call fails 401 and 401-as-
   disconnect (BP-04 §8) triggers its forget flow lazily.
4. Run the forget flow for everything traceable to the connection (BP-02) and produce the forget
   receipt, including the key-destruction line.

Revocation is not suspension; there is no un-revoke. Reconnecting is a fresh §6 flow with fresh
keys.

## 8. Token handling

8.1 Tokens are minted by the grantor against a grant, **vaulted server-side only** — zero client
read paths; they never reach a browser, a mobile client, a log line, or an error message (BP-02
vault law).

8.2 Store the **hash** (SHA-256), never the token: the token is shown **once** at mint to the
authorised human, then only verified.

8.3 Tokens expire — 90-day default, aligned with key rotation — and are renewable before expiry
through an authenticated `token.renew` under the existing grant (no fresh consent for a pure
renewal; renewal UX requirement: the grantor's human is notified, not interrupted, and renewal
appears in the inspect surface of §7.2). An expired or revoked token fails closed.

8.4 A token is bound to exactly one grant; presenting it with another grant's key JWS MUST fail.

## 9. Worked example — the clinic connection (canon, 12 §B.1)

Oakfield Clinic and the McCormack Brainfeeder hub connect. Two grants result. Brainfeeder may
**propose** bookings (never write the clinic's diary) and **read** confirmed appointments back;
the clinic may **propose** reports into Peter's review gate; health summaries are a consumable S2
read for Brainfeeder under elevated consent. No path exists by which either side mutates the
other's records without a human in the receiving system saying yes.

**Grant 1 — issued by the clinic (grantor) to Brainfeeder (grantee):**

```jsonc
{ "grant_format": 1,
  "grant_id": "urn:brain:clinic-oakfield:grant:a1b2…",
  "grantor": "clinic-oakfield", "grantee": "brainfeeder-mccormack",
  "protocol_version": "2.0",
  "issued_at": "2026-06-11T10:00:00Z", "expires_at": "2026-09-09T10:00:00Z",
  "member_lens": "patient-4471",                   // Peter's patient record at the clinic
  "visibility_ceiling": "shared:practice",
  "matrix": [
    { "capability": "appointment.book",      "direction": "offer", "mode": "propose",
      "sensitivity_ceiling": "S1" },               // BF drafts; clinic staff confirm in their gate
    { "capability": "appointment.read",      "direction": "offer", "mode": "read",
      "sensitivity_ceiling": "S1" },               // confirmed appointments sync back
    { "capability": "health_record.summary", "direction": "offer", "mode": "read",
      "sensitivity_ceiling": "S2" }                // scoped summaries only; full records are S3 — never
  ],
  "elevated": { "s2_capabilities": ["health_record.summary"],
    "consented_by": "patient-4471", "consented_at": "2026-06-11T10:00:00Z",
    "step_up": "per_capability_first_use" },
  "keys": { "grantor_public": { "kid": "g-cl-1", "kty": "OKP", "crv": "Ed25519", "x": "…" },
            "grantee_public": { "kid": "g-bf-1", "kty": "OKP", "crv": "Ed25519", "x": "…" },
            // X25519 encryption halves (§5.3) omitted for brevity — required: S2 cells exist
            "rotation_days": 90 },
  "action_execute": "dark",
  "signatures": { "grantor": "…", "grantee": "…" } }
```

**Grant 2 — issued by Brainfeeder (grantor) to the clinic (grantee):**

```jsonc
{ "grant_format": 1,
  "grant_id": "urn:brain:brainfeeder-mccormack:grant:c3d4…",
  "grantor": "brainfeeder-mccormack", "grantee": "clinic-oakfield",
  "protocol_version": "2.0",
  "issued_at": "2026-06-11T10:00:00Z", "expires_at": "2026-09-09T10:00:00Z",
  "member_lens": "mem-7f31",                       // Peter; never a child
  "visibility_ceiling": "private",                  // the clinic sees only Peter's own rows
  "matrix": [
    { "capability": "report.submit", "direction": "offer", "mode": "propose",
      "sensitivity_ceiling": "S2" }                 // clinic proposes a report into Peter's gate
  ],
  "elevated": { "s2_capabilities": ["report.submit"],
    "consented_by": "mem-7f31", "consented_at": "2026-06-11T10:00:00Z",
    "step_up": "per_capability_first_use" },
  "keys": { "grantor_public": { "kid": "g-bf-2", "kty": "OKP", "crv": "Ed25519", "x": "…" },
            "grantee_public": { "kid": "g-cl-2", "kty": "OKP", "crv": "Ed25519", "x": "…" },
            // X25519 encryption halves (§5.3) omitted for brevity — required: S2 cells exist
            "rotation_days": 90 },
  "action_execute": "dark",
  "signatures": { "grantor": "…", "grantee": "…" } }
```

Notes: the clinic's full clinical records are S3 — no cell exists for them and none can (§5.2);
at most the S2 summary read crosses, JWE-encrypted, after step-up. Each grant has its own key
pair and tokens; revoking one direction does not revoke the other, but a full disconnect revokes
both and triggers forget on both sides.

## 10. Settled questions and returns to the council

Settled in this draft: card signing scheme (self-certifying Ed25519 JWS + pinned out-of-band
fingerprint, §2.3); key suite (Ed25519 / ECDH-ES(X25519)+A256GCM, §4.1); grant serialisation (canonical
JSON, dual detached JWS, §5.3); S2 step-up cadence (per capability-first-use, §6.2, jointly with
BP-07); renewal UX (notify-not-interrupt, §8.3). Returned to the council: none.

## 11. Acceptance criteria as runnable tests

**AC-03.1 — Unsigned card refused.** Kit serves four cards to the system under test: (a) valid
signed card; (b) same card, `signature` stripped; (c) body mutated after signing; (d) signed by a
key absent from `identity_keys`. Assert: (a) proceeds to negotiation; (b)–(d) abort before any
handshake call, each refusal logged with reason. Run against both A2A and MCP endpoints.

**AC-03.2 — Matrix denial.** Issue a grant containing only `appointment.read / offer / read /
S1`. Drive calls for: an ungranted capability (`tasks.read`), a granted capability in the wrong
mode (`appointment.book` propose), the wrong direction, and an S2 record under an S1 cell.
Assert: every call refused with `cell_denied` (or `sensitivity_refused`), zero rows returned,
each refusal in the audit log; the single in-matrix call succeeds.

**AC-03.3 — Stolen token useless.** Mint a valid token; replay it (i) with no JWS, (ii) with a
JWS signed by a different grant's key, (iii) with a valid JWS but a reused nonce, (iv) with a
valid JWS timestamped outside the ±5-minute window. Assert: all four fail closed
(`invalid_signature` / `replayed_nonce`); the same call with token + correct fresh JWS succeeds.

**AC-03.4 — Negotiation downgrade.** Connect the system under test to the kit's reference v0.1
peer (unsigned card, pre-pinned fingerprint). Assert: conversation proceeds at v0.1; v2-only
fields are emitted additively and ignored without error; an attempted S2 grant cell over the
v0.1 connection is refused at issue; defaulting of absent v2 fields on inbound objects matches
§3.2(d) (unknown visibility lands `private`).

**AC-03.5 — Revocation immediate.** With a live grant and seeded synced data on the counterpart:
revoke at the grantor. Assert, in order: the grantee's next call fails 401/`grant_revoked`; the
grantee's 401-as-disconnect forget flow runs (BP-04 §8) and its forget audit returns zero; the
grantor's forget receipt includes the grant-key-destruction line with timestamp; a post-revoke
`token.renew` fails; reconnection requires a full fresh consent flow and new keys.

**AC-03.6 — Connect handshake (§6.4).** Drive the full exchange against the kit grantor: the consumer
sends `connect.request` for an offered S1 capability; assert the grantor issues a grant whose grantor
signature verifies, the consumer counter-signs, and the grant goes in force on both sides; a following
capability call under the grant succeeds. Then assert each refusal: a `connect.request` signed by a
key not matching the pin is refused (`invalid_signature`/`fingerprint_unpinned`) with no grant; a
request for an unoffered capability returns `cell_denied`; an S2 request without §6.2 parks
`needs_human` and never auto-issues; an issued grant left unconfirmed past the TTL is not in force; and
a second successful connect supersedes the first grant for the pair (one active grant remains).

---

*Done, for this spec, means: every decided position of the council brief is encoded without
contradiction, the settled questions of §10 stand or return to the council named, and AC-03.1–6
exist as kit tests that have been run, not asserted, before this document leaves draft.*
