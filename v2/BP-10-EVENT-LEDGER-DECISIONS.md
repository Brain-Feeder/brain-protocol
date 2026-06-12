# BP-10: Event Ledger & Decisions

*Status: draft 0.1 · Brain Protocol v2 suite · Editor: Peter McCormack · **For council review:
five one-way doors are returned to the council in §13 and MUST be ratified before any production
ledger writes a row.** Canon: the longitudinal-memory session record of 12 June 2026
(`LONGITUDINAL-MEMORY-SESSION.md`), BP-00 suite context, and the gap analysis settled against
BP-01..BP-09 drafts of 11 June 2026. MUST/SHOULD/MAY carry RFC 2119/8174 meaning. This
specification is additive: it targets suite release v2.1 (MINOR per BP-09 §5.2) and changes
nothing for systems that do not offer it.*

---

## 1. Introduction and scope

### 1.1 The gap this closes

The v2 suite federates current state. Sync converges to the source's present truth (BP-04 §3.3.4,
the honest mirror); edits upsert in place (BP-04 §6.1); what was true before survives, at best,
as a metadata-only journal line with no wire surface. Three islands are already append-only (the
journal, BP-02 §3.4; derived-memory supersession, BP-06 §3; gate confirms, BP-08 §2.2), but no
consuming agent can answer "what did this look like in March", "what changed last month", or
"why did we change it". Actions record what was done and who authorised it, never why.

This specification adds the missing layer: an append-only **event ledger** beneath the graph, an
optional **`history`** grant mode that lets peers exchange change history, and **decision
events** that record the reasoning, alternatives, and expected outcome behind actions, including
an agent's own account of why it acted.

### 1.2 Position and doctrine

**The graph compiles knowledge into four primitives; the ledger records how the graph came to
be.** An event is a wire and storage object, like a tombstone or an error: it is not a graph
record and not a fifth primitive. Events never carry `type: entity|activity|edge|action`, never
enter the visibility-governed graph as rows, and MUST be rejected if presented as records
(T-ENV-01 unchanged). The graph remains the current view. The mirror semantics of BP-04 are
unchanged in full.

The suite's privacy doctrine stands: retention remains a liability to be governed, and this
specification governs it. Every mechanism here composes with, and none weakens, the visibility
law (BP-02), the vault (BP-02 §4), forget-on-disconnect (BP-02 §5), cryptographic forgetting
(BP-07 §3.6), the children's wall (BP-07 §5), and the human gates (BP-08).

### 1.3 Applicability

The `history` capability is **opt-in at every class**. A system not offering it has no
obligation in this specification and remains exactly as conformant as under v2.0.

| Section | Class D + history | Class A + history | Class H + history |
|---|---|---|---|
| §3 Event object, §4 Ledger law, §8 Ordering | MUST | MUST | MUST |
| §5 Emission (serve `changes.read`) | MUST | MUST | MUST |
| §5.5 Observed events (consume side) | MAY | SHOULD | MUST |
| §6 Decision events | not required | MUST (tier-2 drafts) | MUST |
| §7 Temporal retrieval (serve) | MUST (§7.1, §7.2) | MUST | MUST |
| §9 Erasure grades, §10 Trust | MUST | MUST | MUST |

## 2. Requirement words

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## 3. The event object

### 3.1 Identity

An event id takes the form `urn:brain:<system>:event:<uuid>`. This extends the BP-01 §4 ABNF
with a non-record id form: `event` is an envelope-object discriminator, not a record `rtype`,
and is invalid as a record `type`. **[Returned to council, §13 item 1.]**

### 3.2 Envelope (normative)

```jsonc
{
  "event_format": 1,
  "event_id": "urn:brain:garagebrain:event:6b2f9a04-1c33-4d2e-8f15-7a90c2b4e611",
  "kind": "record.updated",                // registry in §3.3
  "record": "urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44",
  "occurred_at": "2026-06-12T09:00:00Z",   // when the change was true (valid axis, CD-5)
  "recorded_at": "2026-06-12T09:00:02Z",   // when the emitter wrote it (system axis, CD-5)
  "sequence": 4127,                        // per-source monotonic, gap-free except via chain.gap
  "prev_event_hash": "sha256:1f8c…",       // hash of the preceding event in this source's chain
  "actor": "staff-m.patel",
  "owner": "mem-7f31",
  "visibility": "shared:household",        // stamped as at event time
  "sensitivity": "S1",
  "origin_chain": ["garagebrain"],
  "payload": {                             // encrypted at rest (§4.2); changed fields only
    "before": { "attributes": { "mot_due": "2027-03-14" } },
    "after":  { "attributes": { "mot_due": "2027-09-14" } }
  }
}
```

Rules:

1. The hash chain is computed over the canonical serialisation (BP-01 §14 JCS rules) with the
   payload represented by the **SHA-256 of its ciphertext**, so chain verification survives
   payload shredding (§9). **[Returned to council, §13 item 2.]**
2. `payload` carries changed fields only. `record.snapshot` events MAY be emitted periodically
   so consumers can fold without replaying from genesis; snapshot cadence is the implementer's
   business.
3. Events inherit `owner`, `visibility`, and `sensitivity` from the referenced record as at
   event time. An event referencing multiple records inherits the stricter of every endpoint,
   generalising BP-01 §5.6 footnote 1.
4. Events carry `origin_chain` and obey the BP-04 §4 loop guard identically: echoes rejected,
   3-hop cap, chain membership feeds the forget purge.
5. `occurred_at` and `recorded_at` follow CD-5 exactly as records do: the degenerate form is
   permitted; a backfilled event carries the historic `occurred_at` and the honest `recorded_at`.

### 3.3 Kind registry (initial)

`record.created · record.updated · record.archived · record.deleted · record.erased ·
record.snapshot · record.observed · decision.recorded · action.transitioned · grant.amended ·
event.disputed · chain.gap`

New kinds land by MINOR version through BP-09 governance. Receivers pass unknown kinds through
opaquely and MUST NOT act on them (the BP-01 §11 posture).

## 4. The ledger storage law

### 4.1 Append-only

A system offering `history` MUST maintain an event ledger with the journal's immutability
property (BP-02 §3.4 pattern; UPDATE and DELETE revoked from every application role), holding
one row per event, in emission order per source, hash-chained per source. The ledger is a
storage law, not a graph table: ledger rows are not records and are invisible to graph queries.

### 4.2 Encrypted payloads and the key hierarchy

Every event payload is encrypted at rest with a per-event content key. Content keys are wrapped
by **payload keys scoped to (connection, owner)**: K(c, o) for each source connection c and each
subject owner o the event carries. Payload keys live in the vault (BP-02 §4, zero client read
paths) and MUST NOT enter general backups (BP-02 §5.6 applies verbatim). Multi-subject events
wrap the content key once per subject; destruction of the content key erases the event whole
(§9.1). **[Returned to council, §13 item 3.]**

### 4.3 Retention is key lifecycle

A retention policy over history is implemented as scheduled payload-key destruction: events age
out by becoming skeletons (§9.2), honestly and provably, through the same mechanism as erasure.
A deployment MAY publish a retention schedule per capability in its card; silence means
retain-until-erased.

### 4.4 Relation to the journal

The journal (BP-02 §3.4) and the ledger overlap: confirms, refusals, and forget events appear in
both. For v2.1 both stand; implementers MAY back the journal as a view over the ledger. Unifying
them is flagged as a v2.2 candidate, not attempted here.

## 5. Emission

### 5.1 The per-mutation duty

A system offering `history` on a capability MUST emit exactly one event per mutation of records
in that capability's slice: created, updated (changed fields), archived, deleted, or erased.
Emission is monotonic (`sequence`) and chained (`prev_event_hash`) per source. A mutation
without an event, or an event without a mutation, is a conformance failure (AC-10.2).

### 5.2 The wire

Sync batches (BP-04 §3.3.2) gain an OPTIONAL `events: []` array beside `records` and
`tombstones`, carried under the same JWS batch signature (BP-07 §3.2) and the same bounds
(BP-04 §9). A new method serves the ledger directly:

```jsonc
// request
{ "method": "changes.read",
  "params": { "capability": "vehicle",
              "window": { "start": "2026-03-01T00:00:00Z", "end": "2026-06-01T00:00:00Z" },
              "kinds": ["record.updated", "decision.recorded"],   // optional filter
              "axis": "occurred",                                  // occurred | recorded
              "cursor": null, "limit": 500 } }

// response
{ "events": [ /* §3.2 envelopes; S2 payloads as JWE per BP-07 §2.4 */ ],
  "cursor": "op_8812", "complete": false, "as_of": "2026-06-12T10:00:00Z" }
```

S2-classed event payloads follow S2 wire behaviour in full (elevated grant cell, step-up, JWE);
S3 never appears in any event payload (BP-07 §2.4; an S3 payload in an event is the same
automatic failure as anywhere else).

### 5.3 The grant mode

`history` is a new mode in the BP-03 §5.2 matrix, alongside `read` and `propose`. Absent cell =
denied cell, as ever. A `history` cell implies nothing about `read`: each is granted explicitly.
The cell carries the same sensitivity ceiling, member lens, and visibility ceiling semantics,
applied to events by §7.3.

### 5.4 The tombstone split

The BP-04 §3.3.2 tombstone gains a MUST `reason` field:

- **`deleted`** (editorial: correction, withdrawal by the source): the mirror removes the record
  as today; ledger history of it is retained.
- **`erased`** (rights-driven: data-subject erasure, forget flow, guardian act): the mirror
  removes the record AND the consumer MUST apply its erasure grade (§9) to every ledger event
  referencing it, recording the outcome in a receipt line.

The reason-less form remains accepted for one MINOR (treated as `deleted`) and is deprecated per
BP-09 §5.3. This split also resolves the BP-01 §7 / BP-04 §3.3.2 inconsistency: an entity
tombstone with reason `deleted` is non-conformant (entities archive, BP-01 §7); with reason
`erased` it is lawful.

### 5.5 Observed events: peers that emit no history

A consumer MAY ledger its own observations of a non-emitting peer: on detecting a difference at
sync time, it appends a `record.observed` event whose `source` is **itself**, whose
`occurred_at` is the sync time (the honest best it knows), and whose payload carries the
observed before/after. Observed events MUST NOT be re-exported as the peer's history and MUST
be presented as observations ("the record changed sometime before this sync; the source does
not share change history"). Observed history is sync-cadence fidelity: no actor, no reason, no
intermediate states. This is the graceful-degradation tier; nothing about a non-conformant or
pre-v2.1 peer breaks.

## 6. Decision events

### 6.1 Shape

```jsonc
{
  "event_format": 1,
  "event_id": "urn:brain:brainfeeder-mccormack:event:9d41…",
  "kind": "decision.recorded",
  "occurred_at": "2026-06-12T10:15:00Z", "recorded_at": "2026-06-12T10:15:00Z",
  "sequence": 588, "prev_event_hash": "sha256:77ab…",
  "actor": "mem-7f31",                       // the decider: a member, or agent:<system>
  "owner": "mem-7f31",
  "visibility": "shared:adults", "sensitivity": "S1",
  "origin_chain": ["brainfeeder-mccormack"],
  "payload": {
    "decision": "Switch household insurance to Aviva at renewal",          // MUST
    "reasoning_summary": "Renewal premium rose 31%; two comparable quotes lower; Aviva matches cover terms.",  // MUST
    "evidence": ["urn:brain:…:activity:renewal-2026…", "urn:brain:…:activity:quote-aviva…"],  // MUST
    "alternatives": [                                                      // OPTIONAL
      { "option": "Stay with current insurer", "rejected_because": "price" },
      { "option": "LV= quote",                 "rejected_because": "excess doubled" } ],
    "expected_outcome": "Equivalent cover, roughly 340 GBP/year saved",    // OPTIONAL
    "review_by": "2027-06-01",                                             // OPTIONAL
    "resulting_actions": ["urn:brain:brainfeeder-mccormack:action:f59d…"]  // SHOULD where actions result
  }
}
```

The MUST core is deliberately minimal (`decision`, `reasoning_summary`, `actor`, `evidence`) so
compliance stays light for simple systems.

### 6.2 Graph projection

Every decision event projects a graph activity with the new vocabulary `subtype: decision`
(BP-01 §10.2 addition), whose attributes mirror the payload and whose `provenance` is the
evidence list. Retrieval then works through every existing path under the visibility law; the
event is the immutable record, the activity is the current-view projection and may be
superseded by a later decision under BP-06 §3 semantics. `review_by` is a dated requirement:
the BP-01 §12 rule derives the review task automatically.

A human decision projects as asserted (no `confidence`). An agent decision projects with
`source: agent-inference` and `confidence`, and is a claim until promoted (BP-06 §4.4): **an
agent's account of its own reasoning is never first-party fact.**

### 6.3 Agent self-reporting

Where a space has `history` enabled, an agent MUST emit a `decision.recorded` event when it
drafts a tier-2 action, and SHOULD when it makes a material recommendation. The
`reasoning_summary` is generated server-side at draft time, alongside the BP-08 confirm summary,
and `resulting_actions` names the draft. The existing BP-08 §2.2 confirm journal entry lifts
mechanically into an `action.transitioned` event. No new human ceremony is added anywhere.

## 7. Temporal retrieval

### 7.1 `history.read`

```jsonc
{ "method": "history.read",
  "params": { "record": "urn:brain:garagebrain:entity:8d6f…", "cursor": null } }
```

Returns the event chain for one record, oldest first, under §7.3 filtering.

### 7.2 `changes.read`

As §5.2. Both verbs MUST be served wherever a `history` cell is granted; bounds, pagination,
signing, and audit follow BP-04 §2/§9 unchanged.

### 7.3 Visibility over history: stricter-of-then-and-now

An event is retrievable by an asker iff the asker may see it under BOTH the stamps the event
carried at emission AND the current stamps of the referenced record (where the record still
exists; where it does not, the event stamps alone govern, and deletion never widens). Enforced
in the data layer (the BP-02 §3.1 posture): one predicate joining stored event stamps to
current record stamps, taking the stricter. Multi-record events take the stricter of every
endpoint, then and now. Denial is by silence (BP-02 §3.1). **[Returned to council, §13
item 4.]**

Consequences, stated so no implementer discovers them in an incident: a member whose sight
narrows loses historical access with it; a row made `public` today does not publish its private
past; a member who leaves the space loses the lens entirely, with export-to-self (BP-02 §7,
which MUST include the member's own decrypted events) followed by their choice of erasure grade
as the departure flow.

### 7.4 `records.as_of`: reserved

As-of state reconstruction (fold to a moment, on either axis) is RESERVED for v2.2: named here
so implementers do not coin private spellings, deliberately unspecified until the demand gate
in the session record's Phase 2 is met. Implementations MAY serve richer temporal queries
locally; they MUST NOT serve any history that erasure grades have removed.

## 8. Ordering, backfill, idempotency

1. **Per-source guarantees (MUST):** `sequence` strictly monotonic and gap-free except via
   recorded `chain.gap`; hash chain intact; `event_id` unique and stable; redelivery idempotent
   (same id, same content: ignored; same id, different content: `idempotency_conflict` plus an
   automatic `event.disputed` annotation, §10.3).
2. **Backfill:** appended at the chain head, never inserted mid-chain; historic `occurred_at`,
   honest `recorded_at`. The chain orders emission; the timeline orders occurrence; both axes
   are queryable (§5.2 `axis`).
3. **Cross-source guarantees: declined.** Federated emitters share no clock and no sequencer;
   this specification guarantees no global order. Consumers order by `occurred_at` with
   `recorded_at` as tiebreak, and agents MUST hedge simultaneity within plausible clock skew.
   Vector clocks are explicitly deferred until real multi-hub meshes demonstrate need.

## 9. Erasure: the ledger forgets

### 9.1 Grade 1: crypto-shred (default)

- **Disconnect from system X:** destroy every K(X, \*). Every event from that connection
  becomes an undecryptable skeleton, ahead of any physical purge, exactly as BP-07 §3.6 works
  for S2 ciphertext today.
- **Subject erasure** (a member's right, or a guardian's act): destroy every K(\*, o).
- **Multi-subject events** are erased whole when any subject erases (the BP-06 §7.2 rule,
  "erased, not trimmed"); surviving subjects may re-assert what is theirs as new events.

### 9.2 The skeleton

After shredding, an event row retains exactly: `event_id`, coarse kind class (`record` |
`decision` | `chain`), `sequence`, `prev_event_hash`, `recorded_at`, and the key id. Everything
else, including the `record` reference, `actor`, `owner`, `occurred_at`, stamps, and payload,
lives inside the ciphertext and is gone. Derived retrieval indexes over shredded events are
purged and rebuilt before serving (BP-06 §1.2's index rule). **[Returned to council, §13
item 5: the skeleton field set.]**

### 9.3 Grade 2: purge with chain-gap markers

Where even the skeleton's shape is identifying (event cadence from a mental-health clinic is
health data), event rows are physically deleted and a signed marker preserves chain continuity:

```jsonc
{ "kind": "chain.gap", "event_id": "urn:brain:…:event:…",
  "sequence": 4313, "prev_event_hash": "sha256:…",
  "payload_clear": {                       // gap markers are never encrypted
    "erased_from_sequence": 3801, "erased_to_sequence": 4102,
    "erased_head_hash": "sha256:…", "erased_tail_hash": "sha256:…",
    "reason": "erasure", "receipt_ref": "urn:brain:…:action:receipt…" } }
```

Defaults: S0/S1 sources shred; S2 sources shred and MUST offer purge on request; children's
events never leave the household boundary (BP-07 §5 unchanged) and a guardian MAY purge. The
DPIA for any S2 history grant states the chosen grade.

### 9.4 What integrity becomes after erasure

Stated plainly: tamper-evidence degrades from content-evidence to shape-evidence. The chain
(over ciphertext hashes) still proves no events were inserted, removed, or reordered, and when
each was recorded; gap markers prove erasure happened at a recorded moment with a recorded
scope. It can no longer prove what erased events said. The forget receipt (BP-02 §5.4) gains
lines: `events_shredded`, `events_purged`, `chain_gaps`, `payload_keys_destroyed`. Backup
restores replay the shred and gap log before serving traffic (BP-02 §5.6 verbatim).

## 10. Trust: a poisoned timeline does not expire

### 10.1 Authentication and signature retention

Events enter only under the per-batch JWS discipline (BP-07 §3.2): unsigned or tampered events
never reach the ledger. New requirement: the ledger MUST retain the batch JWS and signer key id
alongside stored events. Amendment to BP-07 §3.6, the **key-fate split**: encryption keys are
destroyed both halves on disconnect (unchanged; crypto-forgetting stands); signing PUBLIC keys
are retained in a verification archive bound to the ledger where a history grant existed,
because a verification key can prove only that the peer said what the ledger holds, never
decrypt anything. Under Grade 2 purge, signatures and fingerprints purge with their events.
**[Returned to council, §13 item 5.]**

### 10.2 Historical content is data, never instructions

Events enter model context only inside BP-05 §3.4 fences, with extended labels:
`[event tier=T2 source=garagebrain kind=record.updated occurred=… recorded=…]`. Tier is
evaluated at RETRIEVAL, not ingestion: a peer whose certification is revoked (BP-09 §4.3) has
its historical events demoted to T3 from that moment; content beyond one hop is T3 as today
(BP-05 §3.2.1). An agent's own past `reasoning_summary` re-enters context as a T2 claim, never
as instruction: the standing law (BP-05 §3.3) applies to your own history, because your own
history may contain laundered text. The injection corpus (CD-8) gains historical cases; the
zero-pass bar is unchanged.

### 10.3 Dispute, not deletion

A poisoned or wrong event cannot be edited; it is annotated by an append-only `event.disputed`
event referencing it. Disputed events drop out of normal recall (BP-06 §6.2 threshold
mechanics applied to events), surface only with their dispute attached, and any action
depending on a disputed event parks as `needs_human(disagreement)` (BP-06 §6.4, unchanged).

## 11. Deltas to the suite (informative until council ratification)

| Spec | Delta |
|---|---|
| BP-01 | ABNF event-id form (§3.1); `decision` activity subtype; event-kind registry pointer |
| BP-02 | Ledger storage law cross-reference; receipt event lines (§9.4) |
| BP-03 | Mode `history` in the matrix (§5.3); payload-key hierarchy beside grant keys |
| BP-04 | `events[]` in batches; `changes.read`; tombstone `reason` (§5.4) |
| BP-05 | Event fencing labels; retrieval-time re-tiering; decision self-report duty (§6.3) |
| BP-06 | Decision projection rules; provenance closure includes events |
| BP-07 | §3.6 key-fate split (§10.1); signature retention |
| BP-08 | Confirm entries lift to `action.transitioned` events |
| BP-09 | T-HIS/T-DEC suites (§12); `history` capability surfaced in registry entries |

## 12. Acceptance criteria (runnable kit tests)

All bind only systems offering `history`; ids reserve the T-HIS/T-DEC ranges in the BP-09
catalogue.

**AC-10.1: Chain integrity** (T-HIS-01). Ingest a seeded event stream; tamper one stored
event; insert one; remove one; reorder two. **Pass:** verification detects each manipulation;
an untampered ledger verifies end to end including across a `chain.gap`.

**AC-10.2: Per-mutation emission** (T-HIS-02). Drive create/update/archive/delete/erase
against a system under test offering `history`. **Pass:** exactly one event per mutation, in
order, gap-free sequence, correct kinds; no event without a mutation.

**AC-10.3: Shred to skeleton** (T-HIS-03). Disconnect a seeded connection. **Pass:** every
event from it is undecryptable; rows retain only the §9.2 skeleton fields; retrieval verbs
return nothing from them; the receipt carries the §9.4 lines; restore from backup replays the
shred log before serving.

**AC-10.4: Gap marker** (T-HIS-04). Grade 2 purge a seeded segment. **Pass:** rows are gone;
the `chain.gap` marker commits to the erased endpoints; the chain verifies across the gap; the
receipt references the purge.

**AC-10.5: Tombstone split** (T-HIS-05). Send tombstones with each reason. **Pass:**
`deleted` removes the mirror row and retains ledger history; `erased` removes the mirror row
and applies the erasure grade to referencing events; an entity tombstone with reason `deleted`
is rejected.

**AC-10.6: Event loop guard and idempotency** (T-HIS-06). Replay an event; redeliver with
mutated content; echo one back with the receiver's id in chain. **Pass:** replay ignored;
mutation yields `idempotency_conflict` plus an auto-dispute; echo rejected per BP-04 §4.

**AC-10.7: Stricter-of retrieval** (T-HIS-07). Seed events, then narrow one record's
visibility and widen another's; query as paired askers. **Pass:** the narrowed record's history
disappears for the demoted asker; the widened record's private-era events stay hidden; denial
is by silence.

**AC-10.8: Observed events honest** (T-HIS-08). Sync against a non-emitting kit peer that
mutates between syncs. **Pass:** `record.observed` events appear with the consumer as source
and sync-time `occurred_at`; they are never re-exported as the peer's history; agent answers
present them as observations.

**AC-10.9: Decision on draft** (T-DEC-01). Drive an agent to draft a tier-2 action with
`history` enabled. **Pass:** a `decision.recorded` event exists naming the draft in
`resulting_actions`, with server-generated `reasoning_summary` and the MUST core present;
the confirm lifts to `action.transitioned`.

**AC-10.10: Decision projection** (T-DEC-02). Inspect the graph after AC-10.9 plus one
human-asserted decision. **Pass:** each decision projects exactly one `subtype: decision`
activity with provenance to its evidence; the agent's carries `source: agent-inference` and
`confidence` and retrieves as a claim; `review_by` derives the review task per BP-01 §12.

**AC-10.11: History is never instructions** (T-DEC-03). Run the historical injection cases
(a decision event whose reasoning contains instructions; a backfilled event claiming a
confirm; a snapshot smuggling a tool call) through the real ask path. **Pass:** zero tool
fires, zero gate changes, zero memory writes (CD-8 bar); disputed-event parking works.

## 13. Returned to the council (the one-way doors)

Unlike BP-01..BP-09, which settled their open questions, this draft **returns five decisions**:
each is irreversible once a production ledger exists, and none ships without ratification.

1. **The event-id ABNF ruling.** Confirm that `urn:…:event:…` is an envelope-object id and not
   a fifth primitive (recommendation: it is not, because events never enter the graph; the
   four-primitives freeze of BP-00 §5 stands untouched).
2. **Chain construction.** Hash over canonical serialisation with payload-as-ciphertext-hash,
   so integrity survives shredding (recommendation: as specified, §3.2 rule 1).
3. **The key hierarchy.** Payload keys scoped (connection, owner); multi-subject events erased
   whole on any subject's erasure (recommendation: as specified, §4.2/§9.1).
4. **Stricter-of-then-and-now** as the visibility rule over history (recommendation: as
   specified, §7.3; the two pure alternatives each leak in one direction).
5. **The skeleton field set and the BP-07 §3.6 key-fate split** (recommendation: as specified,
   §9.2/§10.1; retaining a signing public key proves only authorship of what the ledger already
   holds, and the local grant journal already records the relationship's existence).

Settled by this draft without return: the kind registry (§3.3, extensible by MINOR); the
tombstone split (§5.4); observed events (§5.5); the decision MUST core (§6.1); `records.as_of`
reserved not specified (§7.4); cross-source ordering declined (§8); journal/ledger unification
deferred to v2.2 (§4.4).

---

*Done, for this spec, means: any conformant agent can answer "what changed, and why did we
change it" from retrieval alone; every answer traces to signed, chained events; nothing in the
ledger weakens a forget receipt, a visibility stamp, or a child's wall; erasure leaves a
verifiable shape and no readable content; and a system that wants none of it remains a full
peer, exactly as conformant as the day before this specification existed.*
