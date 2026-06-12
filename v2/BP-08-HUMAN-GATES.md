# BP-08 — Human Gates & Authority

*Status: draft 0.1 · Part of the Brain Protocol v2 suite (BP-00). Encodes council decisions CD-7
(authority floors are protocol law) and CD-10 (`needs_human` parking). Canon: `12-PROTOCOL-V2.md`
Part D, `11-PARTNER-BRIEF.md` §2.5/§3.2/§4.6. The key words MUST, MUST NOT, REQUIRED, SHALL,
SHOULD, MAY are to be interpreted per RFC 2119/8174.*

---

## 1. Scope and position

Humans decide what AIs decide. This specification defines the complete human authority model:
draft-and-confirm as the universal side-effect law, the `needs_human` parked state, dual and
multi-gate execution, the authority dial, and the non-configurable floors beneath it. It binds
every class: Class D minimally (accept proposed Actions, `action.execute` dark by default,
surface inbound proposals per the queue-and-webhook settlement in §7); Classes A and H in full.

A **gate** is a human confirm point. A gate decision is a server-side recorded fact — who, when,
against which payload hash. A client claim of "confirmed" is nothing.

## 2. Draft-and-confirm — the law

### 2.1 The rule

**No side-effect without a recorded human yes.** Anything irreversible or cross-boundary — pay,
book, send, renew, switch, share, delete, anything that mutates another system — exists first as
an Action with `requires_confirm: true` and `state: proposed`, and executes only after a human
confirm that is:

1. **Server-side recorded** — an append-only journal entry naming the human, the moment, and the
   exact payload confirmed;
2. **Bound to a payload hash** — the confirm covers SHA-256 of the canonical payload; any
   mutation of the payload after confirm invalidates it;
3. **Expiring** — drafts carry `expires_at`; an expired draft can never execute, and re-proposing
   updates the existing draft (idempotent), never duplicates it;
4. **Idempotent on execution** — every execution carries an idempotency key; replay dies on it.

`action.execute` is **dark by default**: a fresh connection accepting the method returns a valid
"proposed, not executed" result until the receiving human has deliberately enabled writes for
that connection. Connecting is not granting writes (TCK T-GAT-09).

### 2.2 The confirm journal entry (normative shape)

```jsonc
{ "journal_id": "jrn-01HZY4Q…",
  "verb": "confirmed",                      // ActivityStreams style: confirmed | declined | halted | unwound
  "actor": "mem-7f31",                      // the human; never an agent id
  "object": "urn:brain:brainfeeder-mccormack:action:f59d3b27-816c-4a40-9e12-7c4a85d0b3e1",
  "gate_id": "g-1",                         // which gate this decision satisfies (§4)
  "payload_hash": "sha256:9c4f1e02ab…",     // the exact payload the human saw and approved
  "summary_shown": "Book Emma's check-up at Oakfield Clinic, Tue 23 Jun 09:30.",
  "channel": "app",                         // app | webhook_console | delegated (§7)
  "recorded_at": "2026-06-12T08:41:17Z" }
```

The `summary_shown` is generated server-side from the payload (BP-05), never free-written: the
journal proves not only that a human said yes, but what they were shown when they said it.
Declines are journalled with the same shape (`verb: declined`, optional `reason`). The journal is
append-only (BP-02); a confirm that cannot be produced from the journal did not happen.

## 3. `needs_human` — the parked state

### 3.1 The state machine

When agents reach a point they cannot or may not resolve alone, the exchange does not fail and
does not guess — it parks. `needs_human` is a first-class Action state on the wire:

```
proposed ──────────────► confirmed ──► executed
   │  ▲                      │
   │  └── human resolves ────┤ (decline at any gate)
   ▼                         ▼
needs_human ──────────► declined            (declined:expired when the park times out)
```

```jsonc
{ "state": "needs_human",
  "needs_human": {
    "reason": "disagreement",               // exactly one of the enumerated reasons (§3.2)
    "addressed_to": "mem-7f31",             // a named human, always (§3.3)
    "explanation": "Oakfield Clinic has this appointment at 09:30; your calendar says 10:00.",
    "expires_at": "2026-06-19T08:41:17Z",   // default: park + 7 days (CD-10)
    "context": { "ours": "urn:brain:brainfeeder-mccormack:activity:…", "theirs": "urn:brain:clinic-oakfield:activity:…" } } }
```

### 3.2 The reasons — enumerated, closed

| Reason | Meaning |
|---|---|
| `consent_required` | the exchange crosses an S2/S3 boundary without the required consent or step-up (BP-07) |
| `low_confidence` | entity resolution or extraction below threshold; a human must look |
| `authority_exceeded` | the grant's mode is propose-only and the proposal needs the receiving side's human |
| `disagreement` | the two systems' records conflict and an action depends on which is right |
| `policy_floor` | the authority policy or a protocol floor (§6) requires a human regardless |
| `unknown_vocabulary` | semantic dead end — an unmapped subtype or predicate the action depends on (CD-6) |

The set is closed; new reasons land by MINOR version through BP-09 governance. A receiver
encountering an unknown reason treats the item as parked and surfaces it verbatim — it MUST NOT
auto-resolve it.

### 3.3 Addressing, surfacing, expiry

- Every parked item is **addressed to a named human** (`addressed_to`), resolved by the parking
  system: the action's owner, or the space's responsible adult for the action type, or a guardian
  where a child is concerned (§6). Never a role without a person behind it; never an agent.
- Parked items MUST surface in the addressee's gate **in plain language** — the reason translated
  into a sentence a parent reads, with the context to decide. Surfacing is conformance: a parked
  item no human can see is a dead letter, and dead letters fail TCK T-GAT-05.
- Items expire after 7 days by default (CD-10; a space MAY configure shorter, MUST NOT configure
  "never"). Expiry resolves the item to **`declined:expired`**, returned to the proposing system
  as a decline. **Nothing auto-resolves; silence never means yes.**
- Notification of the addressee is REQUIRED at park time and SHOULD repeat once before expiry;
  the channel is the system's own business (push, digest, webhook console).

## 4. Dual and multi-gate execution

### 4.1 The all-gates rule

Some exchanges are gated on both sides by design: the clinic's staff must accept the slot AND the
family must confirm the booking. The Action envelope carries every required gate's state, and the
rule is absolute: **execution occurs only when all required gates are `confirmed`.** One gate
confirmed and one pending is a parked action, not a partially executed one (TCK T-GAT-08).

- Each gate names its space, its addressee, and its state: `pending | confirmed | declined`.
- Any gate declining resolves the whole action to `declined`; remaining gates are withdrawn and
  their addressees notified that the item no longer needs them.
- Gates confirm independently and in any order; each confirm is journalled in its own space
  (§2.2) and the gate state is reflected onto the shared envelope by the relaying server.
- A gate confirm binds to the same payload hash as every other gate. If the payload changes
  between gates (the clinic counter-offers a different slot), every previously confirmed gate
  reverts to `pending` and the humans are re-asked. No one's yes is stretched to cover something
  they did not see.
- Expiry applies to the whole envelope: if any gate is still `pending` at `expires_at`, the
  action resolves to `declined:expired`.

### 4.2 The clinic example, end to end

Brainfeeder (the family hub) books a check-up at Oakfield Clinic under the BP-03 §9 connection,
whose `appointment.book` cell is `offer / propose / S1` (issued by the clinic; Brainfeeder
consumes it).

```jsonc
// 1. Brainfeeder's agent drafts — after consulting the authority policy (§5): "book" is `ask`
{ "id": "urn:brain:brainfeeder-mccormack:action:f59d3b27-816c-4a40-9e12-7c4a85d0b3e1",
  "type": "action", "subtype": "book",
  "summary": "Book Emma's check-up at Oakfield Clinic, Tue 23 Jun 2026 09:30.",
  "payload": { "capability": "appointment.book", "slot": "2026-06-23T09:30:00+01:00",
               "patient_ref": "mem-3a91", "practitioner": "any", "duration_min": 20 },
  "payload_hash": "sha256:9c4f1e02ab…",
  "requires_confirm": true, "state": "proposed",
  "gates": [
    { "gate_id": "g-1", "space": "brainfeeder-mccormack:household", "addressed_to": "mem-7f31",
      "role": "guardian", "state": "pending" },                  // Emma is a child: guardian gate, floor §6
    { "gate_id": "g-2", "space": "clinic-oakfield", "addressed_to": "staff-m.patel",
      "state": "pending" } ],
  "proposed_by": "agent:brainfeeder-mccormack", "expires_at": "2026-06-19T08:41:17Z",
  "sensitivity": "S1", "visibility": "shared:adults",
  "owner": "mem-3a91", "actor": "agent:brainfeeder-mccormack",
  "source": "brainfeeder-mccormack", "external_ref": "action/20294",
  "origin_chain": ["brainfeeder-mccormack"],
  "valid_time": "2026-06-12T08:39:02Z", "system_time": "2026-06-12T08:39:02Z" }

// 2. Peter confirms gate g-1 in his own hub; the journal entry of §2.2 is recorded.
//    Envelope now: g-1 confirmed, g-2 pending → state remains "proposed"; nothing executes.

// 3. Brainfeeder's SERVER (never a client) relays the action to the clinic's action.execute.
//    The clinic validates the envelope, checks the grant cell, and parks it for its own human:
{ "state": "needs_human",
  "needs_human": { "reason": "authority_exceeded", "addressed_to": "staff-m.patel",
                   "explanation": "External booking request for Tue 23 Jun 09:30 — accept the slot?",
                   "expires_at": "2026-06-19T08:41:17Z" } }

// 4. Reception confirms g-2 in the clinic's gate (their journal records it).
//    All gates confirmed → the clinic executes under its own rules, idempotency key honoured:
{ "state": "executed",
  "result": { "appointment_ref": "clinic/appt/88412", "slot": "2026-06-23T09:30:00+01:00" } }

// 5. Both sides journal the outcome. The confirmed appointment later syncs back to Brainfeeder
//    as an S1 activity under appointment.read — the loop closes through data, not trust.
```

Had reception instead offered 10:00, the payload change would have reverted g-1 to `pending` and
Peter would have been asked again — about 10:00, not about whatever he last saw.

## 5. The authority dial

### 5.1 Levels

Per space, a policy decides what an agent may do alone, **per action type** — the family chooses,
the system enforces:

| Level | Meaning |
|---|---|
| `auto` | the agent acts, journals it, tells you after — reversible housekeeping only |
| `ask` | draft → gate → recorded confirm (the default for everything consequential) |
| `never` | the agent may not even draft it; refusal at source, naming the policy |

### 5.2 Policy as data

The policy is a record, not a setting buried in code — entity `subtype: authority_policy`,
journalled on every change (who turned which dial, when, from what to what):

```jsonc
{ "id": "urn:brain:brainfeeder-mccormack:entity:2b8c9d10-…", "type": "entity",
  "subtype": "authority_policy",
  "sensitivity": "S1", "visibility": "shared:adults", "owner": "space",
  "source": "manual", "external_ref": "policy/authority#household",
  "valid_time": "2026-06-12T08:00:00Z", "system_time": "2026-06-12T08:00:00Z",
  "attributes": { "name": "Household authority policy", "rules": [
      { "action_type": "dedupe_merge_own", "level": "auto" },
      { "action_type": "reschedule_own_reminder", "level": "auto" },
      { "action_type": "book", "level": "ask" },
      { "action_type": "send_message", "level": "ask" },          // floor: minimum ask (§6)
      { "action_type": "change_plan", "level": "ask" },           // floor: minimum ask (§6)
      { "action_type": "pay", "level": "never" } ] } }            // floor: never (§6)
```

### 5.3 Consulted before drafting

The agent consults the policy **before** drafting. An action the policy forbids is refused at
source with a refusal that names the policy ("Your household policy sets payments to never — I
can't draft that"), not drafted-then-blocked. A `never` action that somehow reaches the gate is a
conformance failure twice over. Where a turn legitimately needs a forbidden or floored act, the
correct behaviour is `needs_human(policy_floor)` — park, don't push.

## 6. The floors — protocol conformance, not product settings (CD-7)

The dial has floors that no space, no operator, no product, and no configuration may lower. A
conformant implementation has **no code path** that accepts a value below a floor; an attempt to
set one is refused at source and journalled (TCK T-GAT-07).

| Action class | Floor |
|---|---|
| Any S3 exchange | `never` — not draftable by any agent |
| Direct money movement | `never` — not draftable by any agent |
| S2 exchanges | minimum `ask` — and the first use per capability additionally requires the BP-07 step-up confirm |
| Messages leaving the space | minimum `ask` |
| Changes to the meaning of a confirmed plan | minimum `ask` |
| Anything financial short of moving money (pay-adjacent, switching, renewing with cost) | minimum `ask` |
| Any action concerning a child | always `ask`, addressed to a guardian — never the child, never `auto` |

A dial that can be turned to zero is not a floor. Floors are tested as protocol conformance
(BP-09 policy-floor suite); a system shipping a configurable floor fails certification regardless
of its default.

## 7. Settled questions register

| Question (from the council brief) | Settlement |
|---|---|
| Gate addressing when the addressee is absent | The item stays addressed and parked; after half its park window with no view event, the system SHOULD escalate by notifying the space's other adults that it waits (not transferring it). It expires per §3.3 if untouched. Absence never reroutes authority silently. |
| Delegation between adults | An adult MAY delegate a gate to another adult of the same space, per item or standing per action type; delegation is journalled, the confirm records both (`actor` = decider, `channel: delegated`, delegator named in the entry). Guardian gates may pass only guardian-to-guardian. |
| Notification semantics | Notify at park, remind once before expiry (§3.3); channel is implementation-defined; the gate surface itself is the source of truth. |
| Class D surfacing with no UI | A Class D system MUST queue inbound proposals and parked items and expose them via a webhook or pollable endpoint to an operator console; human resolution happens out of band but the confirm is still recorded server-side in the Class D system's journal. A queue nobody drains expires per §3.3 — safely, to `declined:expired`. |

## 8. Humans-first principles (normative)

1. **A human can always inspect** what is pending: every draft, every parked item, every gate
   state, in plain language, with the true payload summary.
2. **A human can always halt**: any pending action can be declined or withdrawn by an authorised
   human at any moment before execution, on either side of a dual gate.
3. **A human can always unwind what is reversible**: tier-1 auto acts are journalled and undoable;
   the journal shows what to unwind and who did it (`verb: unwound`).
4. **Silence never means yes.** Expiry declines. Absence parks. Unknown reasons park. Ambiguity
   parks. The protocol has no path on which inaction becomes consent.
5. **The record outlives the moment.** Every yes, no, halt, and unwind is in the append-only
   journal — there is always a straight answer to "what did it do, and who agreed".

## 9. Acceptance criteria

Each criterion exists as a runnable kit test (BP-09 catalogue ids in brackets); met only when
run and seen to pass.

- **AC-08.1 — No confirm, no execution.** Executing without a stored confirm is impossible
  server-side; replay against a mutated payload is invalidated by the hash; double-execution dies
  on the idempotency key. [T-GAT-01, T-GAT-02, T-GAT-03]
- **AC-08.2 — Park and resolve.** A `needs_human` round-trips park → human resolves → execution;
  unresolved items expire to `declined:expired`. [T-GAT-05, T-GAT-06]
- **AC-08.3 — Floor unbreakable.** Setting money movement to `auto` and drafting an S3 action are
  both refused at source. [T-GAT-07]
- **AC-08.4 — Dual gate holds.** Execution attempted with one of two gates unconfirmed does not
  execute. [T-GAT-08]
- **AC-08.5 — Dark by default.** A fresh connection's `action.execute` returns "proposed, not
  executed" until writes are deliberately enabled. [T-GAT-09]

---

*Done, for this spec, means: nothing irreversible happens anywhere in the mesh without a named
human's recorded yes against the exact payload; everything an agent cannot decide waits, visibly,
for a person; and no setting, anywhere, can lower the floors a family stands on.*
