# BP-04 — Communications & Sync

*Status: draft 0.1 · Suite: Brain Protocol v2 · Editor: Peter McCormack · Per the council brief of
11 June 2026. MUST, MUST NOT, SHOULD, SHOULD NOT and MAY carry RFC 2119/8174 meaning. Canon:
`BRAIN_PROTOCOL.md` v0.1 §§3–6a, `11-PARTNER-BRIEF.md` §§4.5–4.8, `12-PROTOCOL-V2.md` §§B.1, B.3,
Part D, `01-PLATFORM.md` §3.3, `FEDERATION.md`.*

---

## 1. Scope and applicability

This specification defines how data actually moves under a BP-03 grant: the wire profile over
A2A/MCP, the three interaction patterns (live query, subscription, sync), the Action relay as the
only cross-system write, the origin-chain loop guard, entity resolution on the wire, the error
model, and disconnect semantics. The grant itself is BP-03; sensitivity behaviour is BP-07; the
human gates the relay lands in are BP-08.

Conformance class applicability (per BP-00 §4):

| Section | Class D | Class A | Class H |
|---|---|---|---|
| §2 Wire profile, §7 Errors, §8 Disconnect, §9 Audit & bounds | MUST | MUST | MUST |
| §3.1 Live query (serve), §3.3 Sync (serve `read`) | MUST | MUST | MUST |
| §3.2 Subscription, §3.3 Sync (consume) | MAY | MUST | MUST |
| §5 Action relay — receive proposals | MUST (queue + out-of-band human, BP-08) | MUST | MUST |
| §5 Action relay — originate | MAY | MUST | MUST |
| §6 Entity resolution — cross-source proposals | MAY | MUST | MUST (incl. mediation) |

## 2. The wire profile

2.1 The transport is the open standards, profiled and never redefined: **A2A** (agent cards,
JSON-RPC 2.0, SSE, OAuth 2.1) for agent-to-agent; **MCP** (Streamable HTTP, OAuth 2.1) for
agent-to-tool. TLS 1.2+ always — necessary, not sufficient.

2.2 **Message envelope (normative).** Every protocol message — request, response, batch, relay —
travels in one envelope:

```jsonc
{
  "envelope_format": 1,
  "protocol_version": "2.0",
  "grant_id": "urn:brain:clinic-oakfield:grant:a1b2…",
  "message_id": "urn:brain:brainfeeder-mccormack:message:9c2e…",  // unique per message
  "in_reply_to": null,                       // request message_id on responses
  "method": "activities.read",               // capability.verb
  "issued_at": "2026-06-11T10:05:00Z",
  "nonce": "rqz81v…",                        // unique within the ±5-min window (BP-03 §4.2)
  "body": {                                  // method-specific; records are BP-01 envelopes
    "records": [ /* … */ ],
    "cursor": "op_9911",
    "counters": { "rejected_malformed": 0 }
  }
}
```

2.3 **JWS per batch.** The entire envelope is serialised canonically (BP-01 rules) and signed as
a JWS (`alg: EdDSA`) with the sender's grant private key — one signature per batch, covering
every record in it. The receiver MUST verify the signature **before** boundary validation;
unsigned, badly signed, tampered, or replayed-nonce envelopes are rejected (`invalid_signature` /
`replayed_nonce`), logged, and counted. A peer can no longer deny what it asserted; a middlebox
cannot alter it.

2.4 **JWE for S2.** Any S2-classed record (BP-07) in `body.records` — and any S2 Action payload —
is carried as a compact JWE (`ECDH-ES(X25519)+A256GCM`, BP-07 §3.4) encrypted to the
recipient's grant encryption public key, in
place of the plaintext record. Envelope metadata (ids, class, counts) stays in clear for routing
and audit; intermediaries, proxies and log pipelines see only ciphertext. Logs MUST NOT contain
S2 bodies. S3 does not travel at all (BP-07): an S3 payload on the wire is a conformance failure,
not an encryption problem.

2.5 Records inside `body` are BP-01 v2 envelopes: urn ids, `subtype`, bitemporality, `sensitivity`,
`visibility`, `owner`, `provenance`, `origin_chain`. The receiver validates every record at the
boundary after signature verification; malformed records are rejected and counted, never repaired
silently.

## 3. Interaction patterns

### 3.1 Live query — preferred

3.1.1 **Prefer live query over sync.** At decision time, ask the question and use the answer;
nothing is stored, so there is nothing to leak and nothing to forget — the strongest privacy
posture the protocol has.

3.1.2 The responder computes the answer **through its own data layer as the grant's member
lens**, with the visibility ceiling applied **at source** — the answer never contains anything
the grant could not sync. An AI's reasoning never augments an outbound answer above the ceiling.

3.1.3 A live query asks the narrowest question and MUST NOT pull underlying data unless `read`
was granted on that capability: "home by Thursday 18:00?" returns `yes/no/ETA`, never the diary.

3.1.4 Answers are claims: the asker attributes them ("Garage Brain says ~7pm"), hedges them, and
never launders them into first-party fact (BP-05, BP-06). If the asker derives and stores anything
from an answer, that derived record carries the connection as `source` (BP-06) — the answer
itself is not stored.

### 3.2 Subscription and presence

3.2.1 `subscribe` delivers push notifications over A2A SSE. Each push is a full §2 envelope,
individually signed. Push carries change notifications and small deltas; anything over the
declared batch bounds falls back to a sync pull.

3.2.2 **Presence is computed, never stored** — by either side. The responder computes presence at
answer time; the subscriber uses it and drops it. Persisting presence answers is non-conformant.

3.2.3 S0 rules (BP-07): S0 content is live-preferred and never stored by default; an S0
capability granted `read` MAY sync, but the grant must say so explicitly — `subscribe` on an S0
capability implies transient delivery only.

3.2.4 Backoff (settling the brief's open question): on stream failure or push rejection, the
sender retries with exponential backoff — base 1 s, factor 2, cap 300 s, full jitter — and gives
up the stream (falling back to pull) after 24 h of failure. A 401/403 is never retried: it is a
disconnect (§8).

### 3.3 Sync — when permitted

3.3.1 Sync (`read`) lands the granted slice in the consumer's store, normalised to the four
primitives, stamped `source` + `external_ref` + the connection's default visibility, validated at
the boundary. Use it for stable, frequently referenced data; do not sync what live query serves.

3.3.2 **Batch format.** A sync response body:

```jsonc
{ "records": [ /* BP-01 envelopes, S2 ones as JWE */ ],
  "tombstones": [ { "op": "delete", "id": "urn:brain:clinic-oakfield:activity:77aa…",
                    "deleted_at": "2026-06-11T09:58:00Z" } ],
  "cursor": "op_10241",                      // opaque resume point, monotonic per grant
  "complete": false }                        // more pages exist
```

Pagination (settled): `cursor` is an opaque string the consumer echoes back; pages are capped at
the smaller of the card-declared bounds and 500 records / 1 MiB; cursors MUST remain valid for at
least 7 days.

3.3.3 **Atomic staged resync.** A resync MUST be staged: (1) pull all pages into a staging area,
resumable by cursor across interruptions; (2) validate every record (signature already verified
per batch; boundary validation per record; loop guard §4; bounds §9); (3) swap staged state into
the read model **in one transaction**. Never delete-then-insert. A sync that fails at any step
leaves the previous state byte-intact and the read model never blanks. Full-replace is an
explicit, journalled repair operation, never the default. Partial recovery (settled): an
interrupted stage resumes from its last acknowledged cursor; staging areas older than 7 days are
discarded and restarted.

3.3.4 **Honest-mirror deletes.** The mirror tells the truth: a tombstone deletes the mirrored
record (and its dependent edges) in the same swap, journalled as `removed` with the source's
`deleted_at`. A record absent from a *complete* full resync of the granted slice is likewise
removed. The consumer MUST NOT resurrect a deleted record from cache or backup; restores replay
the forget and tombstone logs before serving traffic (BP-02).

## 4. Origin chain — the loop guard

4.1 Every synced record carries `origin_chain`, the ordered system ids it has passed through
(`["garagebrain"]`; after re-export by a hub, `["garagebrain","brainfeeder-mccormack"]`).

4.2 **On emit**, append your own system id to every outgoing record's chain.

4.3 **On ingest**, reject and log (counting each):

- any record whose chain already contains your own system id — the **echo rejection rule**
  (`echo_rejected`);
- any record claiming you as its `source` (`echo_rejected`);
- any chain longer than **3 hops** (`hop_limit_exceeded`) — a runaway mesh, not a use case.

4.4 Chain membership is provenance for the forget purge: disconnecting a system also purges
records whose chain contains it (BP-02).

4.5 Hubs (Class H) re-exporting foreign records MUST preserve the inbound chain intact and MUST
NOT re-stamp `source` — relabelled provenance makes data unforgettable and is a conformance
failure.

## 5. The Action relay — PROPOSE-only cross-system writes

5.1 **No system ever writes directly into another's graph.** `propose` is the only cross-system
mutation (BP-03 §5.2): a proposed Action lands in the receiving side's confirm gate and a human
(or the receiver's own authorised process, under its own rules) says yes. Any other attempted
cross-system mutation is refused (`cell_denied`). `action.execute` is dark by default — until the
receiving side's human deliberately enables writes, it returns a valid "proposed, not executed"
result.

5.2 **State machine** (states normative on the wire; reasons per CD-10/BP-08):

```
proposed ── origin human confirms (server-recorded, payload-hash-bound) ──▶ confirmed(origin)
proposed ── origin human declines ─────────────────────────────────────────▶ declined
proposed ── expires_at passes ─────────────────────────────────────────────▶ expired
proposed ── gate reason raised ────────────────────────────────────────────▶ needs_human(reason)
needs_human ── addressed human resolves: approve ──────────────────────────▶ proposed | confirmed(…)
needs_human ── addressed human resolves: reject ───────────────────────────▶ declined
needs_human ── 7 days pass (CD-10), nothing auto-resolves ─────────────────▶ declined:expired
confirmed(origin) ── origin SERVER relays envelope to receiver ────────────▶ relayed
relayed ── receiver validates grant cell + signature + idempotency:
   ├─ receiver gate required and unconfirmed (dual gate) ──────────────────▶ needs_human(receiver)
   ├─ all required gates confirmed ── receiver executes under its own law ─▶ executed (+ receipt)
   └─ validation fails ────────────────────────────────────────────────────▶ failed(error_code)
needs_human(receiver) ── receiver human confirms ──────────────────────────▶ executed (+ receipt)
needs_human(receiver) ── receiver human rejects / 7-day expiry ────────────▶ declined | declined:expired
```

Terminal states: `executed`, `declined`, `declined:expired`, `expired`, `failed`. Drafts are
idempotent (re-proposing updates, never duplicates); an expired draft can never execute; a
confirm binds to the payload hash, so a mutated payload invalidates it (BP-08).

5.3 **Transition documents (normative JSON).**

The draft, at the origin:

```jsonc
{ "id": "urn:brain:brainfeeder-mccormack:action:f59d…", "type": "action",
  "subtype": "book", "state": "proposed",
  "summary": "Book GP appointment, Oakfield Clinic, Thu 18 Jun 09:00.",   // derived from payload, never free-written
  "payload": { "capability": "appointment.book", "slot": "2026-06-18T09:00:00Z",
               "patient_ref": "patient-4471" },
  "payload_hash": "sha256:9e1c…", "requires_confirm": true,
  "gates": [ { "gate_id": "origin",   "addressed_to": "mem-7f31",     "state": "pending" },
             { "gate_id": "receiver", "addressed_to": "clinic-staff", "state": "pending" } ],  // dual gate
  "proposed_by": "agent:brainfeeder-mccormack", "expires_at": "2026-06-17T17:00:00Z",
  "source": "brainfeeder-mccormack", "external_ref": "action/3321",
  "sensitivity": "S1", "valid_time": "2026-06-11T10:05:00Z", "system_time": "2026-06-11T10:05:00Z" }
```

The recorded confirm (origin journal; the client claim is nothing — this is the server fact):

```jsonc
{ "journal": "confirmed", "action_id": "urn:brain:brainfeeder-mccormack:action:f59d…",
  "payload_hash": "sha256:9e1c…", "confirmed_by": "mem-7f31",
  "confirmed_at": "2026-06-11T10:07:12Z", "method": "ui.confirm_card" }
```

A park, on the wire and in the gate:

```jsonc
{ "action_id": "urn:brain:brainfeeder-mccormack:action:f59d…", "state": "needs_human",
  "needs_human": {                         // shape normative in BP-08 §3.1
    "reason": "consent_required",          // consent_required | low_confidence | authority_exceeded
                                           // | disagreement | policy_floor | unknown_vocabulary
    "addressed_to": "clinic-staff", "expires_at": "2026-06-18T10:07:12Z",
    "explanation": "First S2 exchange on report.submit requires step-up consent." } }
```

The relay (a §2 envelope; `method: "action.execute"`; sent by the origin **server**, never a
client) carries the confirmed Action plus its idempotency key. Idempotency-key format (settled):
`<action urn>#<base64url(sha256(payload))>` — replays with the same key return the original
result; the same urn with a different hash is `idempotency_conflict`.

The execution receipt, returned and journalled on both sides:

```jsonc
{ "journal": "executed", "action_id": "urn:brain:brainfeeder-mccormack:action:f59d…",
  "idempotency_key": "urn:…:action:f59d…#nqL8…",
  "executed_by": "clinic-oakfield", "executed_at": "2026-06-11T10:09:40Z",
  "gates": [ { "gate_id": "origin",   "state": "confirmed", "by": "mem-7f31",      "at": "2026-06-11T10:07:12Z" },
             { "gate_id": "receiver", "state": "confirmed", "by": "staff-m.patel", "at": "2026-06-11T10:09:31Z" } ],
  "result": { "appointment_ref": "appt/8812", "slot": "2026-06-18T09:00:00Z" },
  "receipt_signature": "eyJhbGciOiJFZERTQSJ9…" }   // JWS by the executor's grant key
```

Both sides journal: the origin journals `proposed`, `confirmed`, `relayed` and the receipt; the
receiver journals receipt of the proposal, its own gate decision, and `executed` (or the terminal
failure). A relayed action without a recorded human confirm behind it is a conformance failure on
the sender; execution without all required gates `confirmed` is one on the receiver (BP-08).

5.4 **Dual gates.** The envelope carries every required gate's state (`gates[]`). Execution
occurs only when all are `confirmed`. Which exchanges are dual-gated is the receiver's policy
plus the BP-08 floors; the receiver declares gate requirements in its `needs_human` response, and
the origin surfaces the wait honestly ("waiting for the clinic to confirm the slot").

## 6. Entity resolution on the wire

6.1 **Tier 1 — exact (automatic).** The same `(source, external_ref)` upserts in place: identity
by definition, never a duplicate. This is the only automatic resolution that exists.

6.2 **Tier 2 — cross-source (proposed, never automatic).** Emitters populate the standard
identity hints in `attributes` where held — normalised email, normalised phone, vehicle
registration, exact name + date of birth — rather than burying them in free text. Receivers
compare hints in that deterministic priority (then fuzzy name within the same `subtype`, lowest
confidence); a candidate match becomes a **merge proposal routed to the human gate**, carrying
`confidence` (MUST, per BP-01). **Never auto-merge across sources** — a duplicate is recoverable
in one tap; a silent wrong merge corrupts the graph every AI on the mesh reasons over. Nothing
federated auto-merges into a member record.

6.3 **The merge-proposal JSON (normative):**

```jsonc
{ "id": "urn:brain:brainfeeder-mccormack:action:2b7c…", "type": "action",
  "subtype": "entity.merge", "state": "proposed", "requires_confirm": true,
  "summary": "These look like the same person — treat them as one?",
  "confidence": 0.93,
  "payload": {
    "left":  "urn:brain:brainfeeder-mccormack:entity:11aa…",   // surviving record
    "right": "urn:brain:clinic-oakfield:entity:44bb…",          // merged-in record
    "hints_matched": ["email_normalised", "name_dob"],
    "survivor": "left" },
  "payload_hash": "sha256:c44a…",
  "gates": [ { "gate_id": "origin", "addressed_to": "mem-7f31", "state": "pending" } ],
  "proposed_by": "resolver:brainfeeder-mccormack", "expires_at": "2026-06-18T10:00:00Z",
  "source": "derived", "external_ref": "merge/2b7c",
  "provenance": ["urn:brain:brainfeeder-mccormack:entity:11aa…",
                 "urn:brain:clinic-oakfield:entity:44bb…"],
  "sensitivity": "S1", "valid_time": "2026-06-11T10:10:00Z", "system_time": "2026-06-11T10:10:00Z" }
```

6.4 Rules: a pair is proposed once; a **declined pair is never re-proposed** (the decline is
journalled and consulted); a confirmed merge keeps both source records resyncable — subsequent
upserts from either `(source, external_ref)` land on the canonical entity via a `same_as` edge,
and unmerge is a one-tap recovery that restores both. Merges of records about a child gate to a
guardian (CD-7). Low-confidence candidates below a receiver-chosen threshold are not proposed at
all; the threshold MUST NOT exceed auto-merge into existence — i.e. no threshold makes Tier 2
automatic.

## 7. Error model

7.1 Errors are first-class protocol objects, returned inside a signed envelope:

```jsonc
{ "error": { "code": "ceiling_exceeded", "message": "Requested records exceed the grant's visibility ceiling.",
             "retryable": false, "details": { "ceiling": "shared:partners" } } }
```

7.2 **Enumerated codes (normative).** Receivers MUST use these codes; unknown codes are treated
as `protocol_error`:

| Code | Meaning | Retryable |
|---|---|---|
| `unauthenticated` | token invalid/expired/revoked — **disconnect semantics, §8** | no |
| `grant_revoked` | grant explicitly revoked — disconnect semantics, §8 | no |
| `cell_denied` | call maps to an absent matrix cell (BP-03 §5.2) | no |
| `ceiling_exceeded` | payload or request above the visibility ceiling | no |
| `sensitivity_refused` | class above the cell's sensitivity ceiling; any S3 on the wire; downgrade attempt | no |
| `gate_required` | execution attempted without all required gates `confirmed` (BP-08) | no — resolve the gate |
| `unknown_vocabulary` | unmapped subtype/predicate where semantics are load-bearing (CD-6) — parks as `needs_human(unknown_vocabulary)` where an Action depends on it | no — map or park |
| `invalid_signature` | missing/bad JWS; tampered envelope | no |
| `replayed_nonce` | nonce reuse inside the window | no |
| `malformed` | envelope or record fails boundary validation | no |
| `echo_rejected` | own id in chain or claimed as source (§4.3) | no |
| `hop_limit_exceeded` | origin chain longer than 3 hops | no |
| `expired_draft` | relayed Action past `expires_at` | no |
| `idempotency_conflict` | known idempotency key, different payload hash | no |
| `rate_limited` | over the declared rate; HTTP 429, `Retry-After` set | yes |
| `payload_too_large` | over declared size/count bounds; response truncated and flagged `partial` | yes — paginate |
| `protocol_error` | anything else; details required | varies |

7.3 Every error is logged on both sides (§9). Errors never echo payload bodies, secrets, or S2
plaintext back to the caller.

## 8. 401-as-disconnect and the forget trigger

8.1 An inbound `401`/`403` (`unauthenticated`/`grant_revoked`) on an outbound call **is the other
side revoking you**. The caller MUST: stop using the connection immediately (no retries, no
backoff); mark the grant dead; and trigger the full forget flow for everything traceable to that
connection — synced records, their edges, chain-member records (§4.4), and derived memory (BP-02,
BP-06) — producing the forget receipt, including the key-destruction line (BP-03 §7.4).

8.2 A transient auth failure is not an excuse: if re-authentication under the existing grant
succeeds within one immediate attempt, proceed; otherwise treat as disconnect. Erring towards
forgetting is conformant; erring towards retaining is not.

8.3 `connection.revoke` received inbound has the same effect immediately and without the failed
call. It is a courtesy that makes erasure immediate rather than lazy; honouring it is SHOULD,
acting on 401 is MUST.

## 9. Per-exchange audit and bounds

9.1 **Audit (CD-3).** Every exchange — query, push, sync page, relay, error — is logged locally:
who (grant id + peer system id), method, when, outcome (success/error code), counts. **Metadata
only; never payload bodies; never S2 content.** Central or vendor telemetry is prohibited;
sharing audit summaries is voluntary and grant-scoped. A bumped "last used" timestamp is not an
audit log.

9.2 **Data-quality counters** (canonical names, settled): `rejected_malformed`,
`rejected_unsigned`, `rejected_replayed`, `rejected_echo`, `rejected_hop_limit`,
`rejected_ceiling`, `rejected_sensitivity`, `truncated_overcap`, `passed_through_unknown`.
Exposed to the system's own operators; reported per sync in `body.counters`.

9.3 **Bounds, both directions.** Serve side: cap response size and record counts at the
card-declared limits and rate-limit callers (429 + `Retry-After`, never a silent drop). Consume
side: cap what one sync may ingest; an over-cap inbound batch is truncated at the bound and the
result flagged `partial` — never silently absorbed. Neither side trusts the other to be
well-behaved or finite.

## 10. Settled questions and returns to the council

Settled in this draft: subscribe/push backoff (§3.2.4); pagination and cursor rules (§3.3.2);
partial sync recovery (§3.3.3); honest-mirror delete semantics (§3.3.4); idempotency-key format
(§5.3); data-quality counter names (§9.2). Returned to the council: none.

## 11. Acceptance criteria as runnable tests

**AC-04.1 — Mid-sync kill.** Seed the consumer with a known-good synced state (checksummed).
Start a multi-page resync against the kit peer; kill the consumer process (i) mid-page-pull,
(ii) after staging completes but before the swap, (iii) mid-swap-transaction. After each kill,
assert: the read model equals the pre-sync checksum byte-for-byte; no query window observed a
blanked or partially swapped read model (poll continuously during the run); on restart, the stage
resumes from the last acknowledged cursor and completes; the final state equals the source slice.

**AC-04.2 — Echo rejected.** Sync a record A→B; have B (the kit hub) re-export it to A with the
chain `["A","B"]` intact; also send A a record claiming `source: "A"`, and a record with a 4-hop
chain. Assert: all three are rejected at A's boundary with `echo_rejected` / `hop_limit_exceeded`,
each appears in the audit log and the `rejected_echo`/`rejected_hop_limit` counters, and none
lands in the graph. Then disconnect B and assert chain-member records purge with it (§4.4).

**AC-04.3 — One proposal.** Seed the same person (matching normalised email, different
`external_ref`) into two kit source systems; sync both. Assert: exactly one merge proposal
exists, carrying `confidence`, both record urns in `provenance`, status `proposed`; zero
auto-merges occurred. Confirm it: one canonical entity results; resync both sources and assert
both upsert cleanly onto it with no duplicate reappearing. Decline a second seeded pair: assert
it is never re-proposed across three further resyncs.

**AC-04.4 — No foreign writes.** Against a grant with `read` and `propose` cells, attempt every
non-propose mutation path the surface exposes: a direct record upsert, an entity PATCH, a
tombstone injection for a record the sender does not own, a `write-direct` mode call, and an
`action.execute` carrying an unconfirmed draft. Assert: all refused (`cell_denied` /
`gate_required`), zero graph changes (checksum before/after), every attempt logged. Assert the
only mutation that succeeds end-to-end is a proposed Action passing the full §5.2 machine,
including the dual-gate hold (execution with one of two gates unconfirmed does not execute).

**AC-04.5 — Forensic log.** Run a scripted session of at least: one live query, one subscription
push, one multi-page sync, one Action relay (park → resolve → execute), one of each §7.2
rejection class that the kit can synthesise. Assert: every exchange appears in the local audit
log with grant id, peer, method, timestamp, and outcome; counters match the synthesised
rejections exactly; a full-text scan of the log finds zero payload bodies, zero tokens, and zero
S2 plaintext; and no network egress to any non-peer host occurred during the session (CD-3 — no
phone-home).

---

*Done, for this spec, means: every decided position of the council brief is encoded without
contradiction, the settled questions of §10 stand or return to the council named, and AC-04.1–5
exist as kit tests that have been run, not asserted, before this document leaves draft.*
