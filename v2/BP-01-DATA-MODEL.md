# BP-01 — Data Model & Vocabulary

*Status: draft 0.1 · Brain Protocol v2 suite · Editor: Peter McCormack. Encodes the council
decisions of 11 June 2026 (`COUNCIL-BRIEFS.md`), the ratified URS analysis (`12-PROTOCOL-V2.md`),
and `11-PARTNER-BRIEF.md` §2. Suite context in `BP-00-OVERVIEW.md`.*

---

## 1. Introduction and scope

This specification defines the shared language of the Brain Protocol: the four primitives, the v2
record envelope, the controlled vocabulary, the naming rules, and the derived-activity rule. It is
what every other specification in the suite serialises. A system's internal model is its own
business; the shapes defined here are the boundary, and the boundary is conformance-tested.

Every normative clause in this specification applies to **all conformance classes (D, A, H)**
unless explicitly marked otherwise. BP-01 is implemented in full even by a pipe.

## 2. Requirement words

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## 3. The primitives

### 3.1 Four, frozen

Everything a system knows compiles into four primitives. Adding a fifth, or removing or renaming
a required field on any of them, is a MAJOR version event for the whole ecosystem.

| Primitive | Is | Wire `type` |
|---|---|---|
| **Entity** | anything that exists, persistently | `entity` |
| **Activity** | anything that happens, anchored in time | `activity` |
| **Edge** | a typed, directional link between two records | `edge` |
| **Action** | anything that would change the world, held for consent | `action` |

A record whose `type` is not one of these four MUST be rejected at the boundary. In particular,
`type: "goal"` is invalid (§3.2) and `type: "attribute"` is invalid — attributes are a facet of
every record, never a record themselves.

### 3.2 The reserved subtype `goal`

Per council decision CD-9, `goal` is a **reserved subtype**, never a fifth primitive. A record
with `subtype: "goal"`:

- MAY be emitted as `type: "entity"` (a persistent thing that owns plans and accumulates edges)
  **or** as `type: "activity"` (a happening with a lifecycle and a horizon). Receivers MUST
  accept either framing and map it to their internal model at the boundary.
- MUST carry three attributes, and MUST be rejected if any is absent:
  `target` (the desired state), `measure` (how success is judged), `horizon` (by when).
- Uses the goal state vocabulary: `intended | in_progress | achieved | abandoned | archived`.

Worked examples of both emission forms are in §15.

### 3.3 What is not a primitive

Lists are saved sets — an entity (`subtype: list`) whose membership is edges, or a saved query.
Presence is computed from recent activities and edges, never stored. Dates, labels, categories,
zones, tags and folders are attributes or taxonomy and MUST NOT cross the wire as records. If a
concept does not fit the four primitives, it is almost certainly a new subtype of one of them.

## 4. Identifiers

The canonical wire identifier is a URN. Internal storage as UUID plus `source` is equivalent and
valid; the mapping happens at the boundary.

```abnf
record-id = "urn:brain:" system ":" rtype ":" uuid
system    = lc-alnum *63( lc-alnum / "-" )        ; the minting system's id
rtype     = "entity" / "activity" / "edge" / "action"
uuid      = 8HEXDIG "-" 4HEXDIG "-" 4HEXDIG "-" 4HEXDIG "-" 12HEXDIG
            ; RFC 9562 UUID, lower case
lc-alnum  = %x61-7A / DIGIT                        ; a-z 0-9
```

Rules: the id is minted by the emitting system, is stable for the record's life, and never
changes on re-emission. The `system` segment MUST equal the minting system's id (it does not
change if the record later travels). Where `source` names the asserting system, the two are
equal; where `source` is a method value (`manual`, `derived`, `agent-inference` — §5.2, BP-06),
the segment remains the minting system's id. The `rtype` segment MUST equal the record's `type`
— a goal emitted as an entity has `rtype` `entity`. A receiver MUST reject a record whose URN
segments contradict its envelope fields (`rtype` vs `type`; `system` vs `source` where `source`
names a system).

## 5. The record envelope

Every record, whatever its type, carries the same envelope. Requirement levels per field, with
the applicability matrix in §5.6. Example values are abbreviated.

### 5.1 Identity and typing

- **`id`** — MUST · string (URN, §4) · globally unique, stable identity.
  `"id": "urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44"`
- **`type`** — MUST · enum `entity | activity | edge | action` · the primitive discriminator.
  `"type": "activity"`
- **`subtype`** — MUST · string (controlled vocabulary, §10) · the wire name for what v0.1 called
  `kind`, `activity_type`, `predicate` and `action_type`; those remain valid internal aliases.
  `"subtype": "appointment"`

### 5.2 Origin

- **`source`** — MUST · string (system id) · which system asserted this record; also required on
  computed/on-the-fly records (`manual`, `derived`, `garagebrain`, …). `"source": "garagebrain"`
- **`external_ref`** — MUST (edges OPTIONAL) · string · the source's own stable name for the
  record; the key for idempotent sync, entity resolution and forget. `"external_ref": "vehicle/2231"`
- **`provenance`** — OPTIONAL; MUST on derived or inferred records · array of record URNs · the
  records this one was derived from (record-level derivation). A derived record without
  provenance is a forget leak and non-conformant. `"provenance": ["urn:brain:garagebrain:entity:8d6f…"]`
- **`origin_chain`** — MUST on synced/re-emitted records; SHOULD locally · array of system ids ·
  the ordered systems the record has passed through (system-level lineage, the BP-04 loop
  guard). `provenance` and `origin_chain` are complementary, never interchangeable.
  `"origin_chain": ["garagebrain", "brainfeeder"]`

### 5.3 People

- **`owner`** — MUST on entities and activities; SHOULD on actions; OPTIONAL on edges · opaque
  member reference (a local member id or a person-entity URN) · whose life the record belongs
  to. Owner anchors the visibility law (BP-02) and the member lens (BP-03). `"owner": "mem-7f31"`
- **`actor`** — OPTIONAL · opaque reference or URN · who or what created/performed the record.
  Owner and actor are different facts: the school (actor) books the dentist for the child
  (owner). On actions this is `proposed_by` (§5.7). `"actor": "urn:brain:school:entity:91ab…"`
- **`subject`** — MUST on edges; OPTIONAL on activities · record URN · what the record is about.
  On activities it is a denormalised convenience; the edge remains the source of truth.
  `"subject": "urn:brain:garagebrain:entity:8d6f…"`
- **`object`** — MUST on edges only · record URN · the target of the edge's predicate.

### 5.4 Time (normative rules in §6)

- **`valid_time`** — MUST · RFC 3339 UTC timestamp · when the fact happened or became true.
  `"valid_time": "2026-06-08T14:00:00Z"`
- **`system_time`** — MUST · RFC 3339 UTC timestamp · when the asserting system learned it.
  `"system_time": "2026-06-08T14:03:00Z"`
- **`interval`** — OPTIONAL · object `{ "start": <timestamp>, "end": <timestamp|absent> }` · for
  spans: activity start/end, entity or edge validity windows. `"interval": { "start": "2021-09-01T00:00:00Z" }`

### 5.5 Lifecycle, access, trust

- **`state`** — MUST on activities and actions; OPTIONAL on entities; not used on edges ·
  string (controlled vocabulary, §7) · where the record is in its type's state machine.
  `"state": "open"`
- **`visibility`** — MUST · grammar `private | shared:<scope> | public` with registered scopes
  (§8) · who may see the record. Unknown scope ⇒ receiver treats as `private` (CD-6).
  `"visibility": "shared:household"`
- **`sensitivity`** — MUST · enum `S0 | S1 | S2 | S3` (classes defined in BP-07; starter
  classification §9) · stamped by the asserting system; receivers MAY upgrade, MUST NOT
  downgrade. `"sensitivity": "S1"`
- **`confidence`** — OPTIONAL everywhere; MUST on merge proposals and on derived/inferred
  records · number 0–1 · how sure the asserting system is. **Absent means asserted-as-fact** by
  the source; emitters MUST NOT use `confidence: 1.0` to mean "fact" — they omit the field.
  `"confidence": 0.85`
- **`attributes`** — OPTIONAL (but see naming MUSTs below) · JSON object · subtype-specific
  fields. `attributes.name` is MUST on entities; `attributes.title` is MUST on activities;
  `attributes.summary` SHOULD be present (a serialised record is LLM context). Money is integer
  minor units plus ISO 4217 currency (`"amount_minor": 5485, "currency": "GBP"`). Emitters
  SHOULD place standard entity-resolution hints here (normalised email, phone, registration)
  rather than in free text.

### 5.6 Applicability matrix

| Field | Entity | Activity | Edge | Action |
|---|---|---|---|---|
| `id`, `type`, `subtype`, `source` | MUST | MUST | MUST | MUST |
| `external_ref` | MUST | MUST | OPTIONAL | MUST |
| `owner` | MUST | MUST | OPTIONAL | SHOULD |
| `actor` | OPTIONAL | OPTIONAL | OPTIONAL | as `proposed_by` |
| `subject` / `object` | — | `subject` OPTIONAL | both MUST | — |
| `valid_time`, `system_time` | MUST | MUST | MUST | MUST |
| `interval` | OPTIONAL | OPTIONAL | OPTIONAL | — |
| `state` | OPTIONAL | MUST | — | MUST |
| `visibility`, `sensitivity` | MUST | MUST | MUST¹ | MUST |
| `confidence`, `provenance` | conditional (§5.2, §5.5) | conditional | conditional | conditional |
| `origin_chain` | MUST when synced | MUST when synced | MUST when synced | MUST when relayed |
| `attributes` | MUST (`name`) | MUST (`title`) | OPTIONAL | OPTIONAL |

¹ An edge's `visibility` and `sensitivity` MUST each be at least as strict as the stricter of its
two endpoints.

### 5.7 The Action extension

The Action envelope is unchanged from `11-PARTNER-BRIEF.md` §2.5 — the wire shape the URS lacked.
In addition to the common envelope (verb in `subtype`, lifecycle in `state`):

- **`summary`** — MUST · string · one plain sentence of what will happen — what the human reads
  before saying yes; generated from the payload, never free-written around it.
- **`payload`** — MUST · JSON object · the exact machine-readable instruction that executes on
  confirm. The confirm binds to a hash of this payload (BP-08).
- **`requires_confirm`** — MUST · boolean · `true` for anything irreversible or cross-boundary.
- **`proposed_by`** — SHOULD · string · who or what drafted it (`agent:garagebrain`).
- **`expires_at`** — SHOULD · RFC 3339 UTC timestamp · drafts go stale; an expired draft can
  never execute.
- **`gates`** — MUST when more than one human confirm is required · per-gate states for
  dual-gated exchanges; semantics in BP-08.

## 6. Bitemporality and intervals

Per council decision CD-5, **both `valid_time` and `system_time` are MUST on every record, for
every class**. Omission of either is non-conformant. The **degenerate form**
`valid_time == system_time` is explicitly permitted where learning and occurrence genuinely
coincide — it costs one line. A backfilled fact carries the historical `valid_time` and the
honest, later `system_time`; a receiver MUST store and re-emit both unchanged. Conflating the two
axes silently corrupts history and is tested (AC-01.2).

**Interval flattening rules** (settling the open question):

1. `interval` is the single wire spelling for every span: activity `starts_at`/`ends_at`, entity
   and edge `valid_from`/`valid_to` all map to `interval.start`/`interval.end` at the boundary.
   Internal column names are unconstrained.
2. When `interval` is present, `valid_time` MUST equal `interval.start`.
3. An open-ended span omits `end` (never `null`, §14). A point-in-time record omits `interval`
   entirely; `valid_time` suffices.
4. All-day and date-only semantics follow iCalendar: the flag travels as
   `attributes.all_day: true` with `interval` at day boundaries in the record's local zone
   expressed in UTC; recurrence travels as `attributes.recurrence` (an RFC 5545 RRULE string).
5. A venue-anchored event - one fixed to a local clock at a place, such as a recording session -
   carries `attributes.tz` as an IANA timezone name (e.g. `Europe/London`). `valid_time` and
   `interval` stay UTC instants for ordering, but a consumer rendering the event to a human MUST
   display it in `attributes.tz` when present, so the local clock time stays put across a DST
   transition; absent `tz`, a consumer renders in its own default zone and MAY drift. Surfaced by
   the first calendar integration, 2026-06.

## 7. State machines

`state` values come from the controlled vocabulary (§10.4) and each primitive has its own
machine. Receivers MUST reject a state not valid for the record's type, except that unknown
states from a mapped vocabulary pass through opaquely (§11).

- **Entity** — no mandatory state. `archived` MAY be carried; absence means current. Entities
  are archived (and their `interval.end` closed), never overwritten or deleted on the wire.
- **Activity** — `scheduled → open → in_progress → done`, with `blocked` reachable from `open`
  or `in_progress` (and returning to either), and `cancelled` reachable from any non-terminal
  state. `done` and `cancelled` are terminal.
- **Goal (reserved subtype, either primitive)** — `intended → in_progress → achieved |
  abandoned`, then optionally `→ archived`. `achieved`, `abandoned` and `archived` are terminal
  apart from the archive step.
- **Edge** — no state machine. Edge lifecycle is its validity `interval`: edges expire, they are
  not deleted ("was with the previous insurer" is an expired edge).
- **Action** — `proposed → confirmed → executed`; `proposed → declined`; `proposed → expired`;
  `proposed → needs_human → confirmed | declined`. `needs_human` is a first-class wire state
  whose reasons, addressing and 7-day default expiry (`declined:expired`) are defined in BP-08
  (CD-10). For cross-system relays, `confirmed → relayed → executed | failed` (BP-04 §5.2).
  `executed`, `declined`, `expired` and `failed` are terminal. No transition may skip
  `confirmed` on the way to `executed`.
- **Derived memory (BP-06, any primitive)** — `active → superseded | retracted | expired`;
  supersession, retraction and expiry semantics are defined in BP-06 §3 and §6.

## 8. Visibility scopes registry

The grammar is `private | shared:<scope> | public`:

- **`private`** — the owning member only.
- **`shared:<scope>`** — a registered audience within the owning space.
- **`public`** — every member of the owning space; eligible to cross the wire subject to the
  grant's visibility ceiling and sensitivity rules. `public` never means "the open internet".

**Initial registered scopes** (settling the open question):

| Scope | Audience | Registers v0.1 value |
|---|---|---|
| `shared:partners` | the owner and their partner(s) | `partners` |
| `shared:adults` | all adult members of the space | `adults` |
| `shared:household` | every member, children included | `everyone` |

New scopes are registered by MINOR version through the `brain-protocol` repository process. Per
CD-6, a receiver encountering an **unknown scope MUST treat the record as `private`** — fail
closed, never open. Mapping tables (§11) may map a local scope to a registered one; unmapped
scopes are never silently aliased. Enforcement of visibility in the data layer is BP-02;
children's forced visibility and the no-child-lens rule are BP-02/BP-03.

## 9. Sensitivity starter classification

`sensitivity` classes S0–S3 and their wire behaviour are defined in BP-07. The asserting system
stamps the class; this table is the **starter default by subtype**, so two systems start from
the same posture when an emitter has no classification of its own. Emitters MAY stamp higher
than the default; receivers MAY upgrade and MUST NOT downgrade (BP-07).

| Default | Subtypes |
|---|---|
| **S0** (ambient) | computed presence/availability answers (never stored by default) |
| **S1** (household) | `person, organisation, product, place, device, vehicle, property, pet, goal, list, plan, document`¹, `task, event, message, reminder, note, observation`², `status_change, appointment, renewal, job, plan_step` and all edge predicates³ |
| **S2** (personal) | `account, policy, transaction`; clinical documents and health summaries (`document` and `observation` in a health context); finance aggregates |
| **S3** (sealed) | identity documents (`document` carrying passport, birth-certificate, or account-number payloads); credentials and vault items. S3 never syncs — reference-only pointers cross the wire (BP-07) |

¹ `document` defaults S1; clinical documents are S2; identity documents are S3.
² `observation` defaults S1; health observations are S2.
³ Edges carry no class of their own by subtype: an edge inherits the stricter of its endpoints
(§5.6).

## 10. The controlled vocabulary (v2 base)

The merged vocabulary of `12-PROTOCOL-V2.md` §A.4 is the v2 base: the URS starter set plus the
v0.1 terms it was missing. Mapping tables (§11) are the **only** extension valve; new base terms
land by MINOR version through the `brain-protocol` repository.

### 10.1 Entity subtypes

`person, organisation, account, document, product, place, device` (URS) +
`vehicle, property, policy, pet, goal, list, plan` (v0.1; Schema.org-named per §13) +
`fact` (v2; derived memory, BP-06 §2) and `authority_policy` (v2; BP-08 §5.2).

### 10.2 Activity subtypes

`task, event, message, transaction, reminder, note, observation, status_change` (URS) +
`appointment, renewal, job, plan_step` (v0.1) + the reserved `goal` subtype (§3.2).

### 10.3 Edge predicates

`owns, member_of, works_for, related_to, parent_of, attended, assigned_to, blocks, depends_on,
paid, mentions` (URS) + `derived_from, cares_for, shares_with, insured_by, located_at,
travelling_on, responsible_for, child_of, partner_of, paid_from, same_as` (v0.1) +
`disagreement` (v2; conflict linking, BP-06 §6.4).

### 10.4 States

`open, in_progress, blocked, done, cancelled, intended, achieved, archived` (URS) +
`scheduled, abandoned, proposed, confirmed, executed, declined, expired, needs_human` (v0.1 and
Part D; the last six are the action lifecycle) + `relayed, failed` (v2; the BP-04 relay) +
`active, superseded, retracted` (v2; derived memory, BP-06). Partitioned per type in §7.

Action verbs (`subtype` on actions) are not enumerated by the base vocabulary: they are named by
the capability they invoke (`book`, `send_message`, `entity.merge`, …) and are validated against
the grant matrix (BP-03), not this registry.

## 11. Mapping tables — the extension valve

A connection only joins semantically if both sides speak the base vocabulary or have declared an
explicit mapping. Per CD-6 this is a **connect-time precondition, not a hope**:

- At handshake (BP-03) each side declares its vocabulary version plus a mapping table for every
  local term it emits or expects that is not in the base.
- A connection where either side's terms are neither base-vocabulary nor mapped **does not
  proceed to sync**.
- Unmapped unknown terms received later pass through opaquely (stored and re-emitted verbatim)
  and MUST NOT be silently treated as synonyms of known terms. An unknown visibility scope lands
  as `private` (§8).

**Mapping table format** (declared in the handshake document):

```jsonc
{
  "vocabulary_version": "2.0",
  "mappings": [
    { "field": "subtype",   "local": "employed_by", "base": "works_for",  "direction": "both" },
    { "field": "subtype",   "local": "relates_to",  "base": "related_to", "direction": "emit" },
    { "field": "state",     "local": "completed",   "base": "done",       "direction": "emit" },
    { "field": "visibility_scope", "local": "team", "base": "adults",     "direction": "emit" }
  ]
}
```

`field` is one of `subtype | state | visibility_scope`. `direction` is `emit` (translate on the
way out), `accept` (translate on the way in) or `both`. A mapping is term-to-term and total: a
declared local term always translates; partial or contextual mappings are not permitted. Each
side MUST log every translation applied.

## 12. Derived activities — the MOT rule

**Any entity attribute that is a date carrying a requirement** (a renewal, expiry, due date, or
review) **MUST produce a derived activity**, so the deadline appears in calendars and to-do
views automatically. Normatively:

1. Exactly one derived activity exists per dated requirement attribute.
2. Its `external_ref` is `<entity external_ref>#<attribute name>` (e.g. `vehicle/2231#mot_due`),
   its `provenance` contains the entity's URN, and its `source` is the entity's source.
3. Editing the attribute updates the activity in place (same `external_ref`); clearing the
   attribute or archiving/deleting the entity cancels or removes the activity.
4. The derived activity is linked to its entity by a `related_to` (or more specific) edge.

## 13. Naming — borrow at the edges

Do not invent a name where a good standard already has one:

- **Entity and activity subtypes**: where Schema.org defines a matching type, use its name,
  lower-cased (`vehicle`, `person`, `invoice`). Never coin a synonym (`automobile`) for a thing
  Schema.org already names.
- **Timed activities**: iCalendar semantics — `interval` ↔ DTSTART/DTEND, `attributes.all_day`,
  RFC 5545 RRULE recurrence — so an activity round-trips to any calendar.
- **Journal verbs** (BP-02): ActivityStreams style — `created`, `updated`, `completed`,
  `confirmed`, `declined`, `forgot` — past-tense actor-verb-object facts.

The primitives are ours; the names at the edges are the web's.

## 14. Canonical JSON serialisation

Settling the open question:

1. Records are UTF-8 JSON objects. Field order is not significant; emitters SHOULD follow the
   order of §5 for human readability.
2. **Absent optional fields are omitted, never `null`.** `null` is not a permitted value for any
   envelope field; absence is the only signal (this is what makes "confidence absent =
   asserted-as-fact" well defined).
3. Unknown fields MUST be ignored for validation and SHOULD be passed through opaquely on
   re-emission (the forward-compatibility rule).
4. Timestamps are RFC 3339 UTC with the `Z` designator, seconds precision or finer.
5. Where a batch is JWS-signed (BP-07), the signing input is the RFC 8785 (JCS) canonical form;
   ordinary exchange does not require canonicalisation.

## 15. Worked examples

A garage system (`garagebrain`) models a customer, their car, the MOT deadline, the link, and a
goal in both emission forms.

```jsonc
// 1. A person — entity
{ "id": "urn:brain:garagebrain:entity:2f5a9c1d-7e34-48b2-a6d0-913c4e8f7a02",
  "type": "entity", "subtype": "person", "source": "garagebrain",
  "external_ref": "customer/0871", "owner": "mem-7f31",
  "valid_time": "2021-09-01T00:00:00Z", "system_time": "2026-06-11T09:10:00Z",
  "visibility": "shared:household", "sensitivity": "S1",
  "attributes": { "name": "Peter McCormack", "summary": "Account holder since 2021.",
                  "email_normalised": "me@petermccormack.com" } }

// 2. A vehicle — entity, with a dated requirement attribute
{ "id": "urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44",
  "type": "entity", "subtype": "vehicle", "source": "garagebrain",
  "external_ref": "vehicle/2231", "owner": "mem-7f31",
  "valid_time": "2021-09-01T00:00:00Z", "system_time": "2026-06-11T09:12:00Z",
  "interval": { "start": "2021-09-01T00:00:00Z" },
  "visibility": "shared:household", "sensitivity": "S1",
  "attributes": { "name": "Land Rover Defender",
                  "summary": "Family car, reg LD70 XKP. MOT due 14 Mar 2027.",
                  "registration": "LD70 XKP", "make": "Land Rover", "mot_due": "2027-03-14" } }

// 3. The MOT deadline — a derived activity (the §12 rule), provenance to its entity
{ "id": "urn:brain:garagebrain:activity:3a9e7f10-58c2-4d77-b6e4-91f0a2c83d05",
  "type": "activity", "subtype": "task", "source": "garagebrain",
  "external_ref": "vehicle/2231#mot_due", "owner": "mem-7f31",
  "subject": "urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44",
  "valid_time": "2027-03-14T00:00:00Z", "system_time": "2026-06-11T09:12:00Z",
  "state": "open", "visibility": "shared:household", "sensitivity": "S1",
  "provenance": ["urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44"],
  "attributes": { "title": "MOT due — Land Rover Defender", "due_on": "2027-03-14" } }

// 4. The link — an edge (visibility/sensitivity no wider than the stricter endpoint)
{ "id": "urn:brain:garagebrain:edge:c41b8a6d-2e95-4f08-a3d7-60e9b5f12c88",
  "type": "edge", "subtype": "related_to", "source": "garagebrain",
  "subject": "urn:brain:garagebrain:activity:3a9e7f10-58c2-4d77-b6e4-91f0a2c83d05",
  "object":  "urn:brain:garagebrain:entity:8d6f1c2e-4b0a-4f3e-9a51-2e7c0d9b1a44",
  "valid_time": "2026-06-11T09:12:00Z", "system_time": "2026-06-11T09:12:00Z",
  "visibility": "shared:household", "sensitivity": "S1" }

// 5a. A goal — emitted as an entity (the hub's framing)
{ "id": "urn:brain:brainfeeder:entity:b2c47a90-1f6e-4d2b-8a3c-5e90d1f47b16",
  "type": "entity", "subtype": "goal", "source": "manual",
  "external_ref": "goal/run-10k", "owner": "mem-7f31",
  "valid_time": "2026-06-01T00:00:00Z", "system_time": "2026-06-01T08:00:00Z",
  "state": "in_progress", "visibility": "private", "sensitivity": "S1",
  "attributes": { "name": "Run a 10k", "target": "complete a 10k race",
                  "measure": "official race finish time recorded", "horizon": "2026-09-30" } }

// 5b. The same goal — emitted as an activity (the URS framing); receivers accept both
{ "id": "urn:brain:examplefit:activity:e7d10f3b-9a48-4c61-b5f2-08c3a6d92e74",
  "type": "activity", "subtype": "goal", "source": "examplefit",
  "external_ref": "goals/10k-2026", "owner": "mem-7f31",
  "valid_time": "2026-06-01T00:00:00Z", "system_time": "2026-06-01T08:00:00Z",
  "interval": { "start": "2026-06-01T00:00:00Z", "end": "2026-09-30T23:59:59Z" },
  "state": "in_progress", "visibility": "private", "sensitivity": "S1",
  "attributes": { "title": "Run a 10k", "target": "complete a 10k race",
                  "measure": "official race finish time recorded", "horizon": "2026-09-30" } }
```

## 16. Acceptance criteria (runnable kit tests)

These ship in the conformance kit and are run, not asserted. All are Class D.

**AC-01.1 — Envelope rejection** (`bp01-envelope-reject`). For each required field — `id`,
`type`, `subtype`, `source`, `external_ref` (skipped for edges), `owner` (entities/activities),
`visibility`, `sensitivity`, `valid_time`, `system_time` — construct an otherwise-valid record of
each applicable primitive with that field absent, plus one record with `type: "goal"` and one
with a URN whose segments contradict `type`/`source`. Submit each to the boundary validator.
**Pass:** every invalid record is rejected with a per-field error and counted in the rejection
log; the valid control record of each primitive is accepted.

**AC-01.2 — Bitemporal backfill** (`bp01-bitemporal-roundtrip`). Emit a fact whose
`valid_time` is 2019-04-01 and whose `system_time` is now; sync it into the implementation;
export it back (BP-02 §7). **Pass:** both timestamps survive byte-identical;
`system_time ≠ valid_time` is preserved; a second record using the degenerate form
(`valid_time == system_time`) is accepted; a record omitting either field is rejected.

**AC-01.3 — Goal duality** (`bp01-goal-duality`). Submit the §15 goal as `type: entity` and as
`type: activity`; then three mutants each missing one of `target`/`measure`/`horizon`; then one
as `type: "goal"`. **Pass:** both well-formed framings are accepted and queryable as the same
logical concept; all three mutants are rejected naming the missing attribute; the `type: "goal"`
record is rejected.

**AC-01.4 — Vocabulary valve** (`bp01-vocab-opaque`). With no mapping declared, sync a record
with `subtype: "employed_by"` and one with `visibility: "shared:club"`. **Pass:** the unknown
subtype is stored and re-exported verbatim (provably never aliased to `works_for` — assert no
`works_for` record exists for it); the unknown scope is enforced as `private`; with a declared
`employed_by → works_for` mapping, the term translates and the translation is logged.

**AC-01.5 — Derivation** (`bp01-derived-activity`). Sync the §15 vehicle. **Pass:** exactly one
activity with `external_ref: "vehicle/2231#mot_due"` exists, carrying provenance to the entity's
URN; updating `mot_due` updates that same activity (no duplicate); archiving the entity cancels
or removes it; re-syncing the unchanged entity creates no second activity.

## 17. Settled questions and returns

Settled by this draft (per the council's "open to the writer" list): the subtype→sensitivity
starter table (§9, to be co-ratified with BP-07 and an early integrating system); the initial visibility scope registry
(§8); canonical JSON serialisation — omit-not-null, unknown-field pass-through, JCS only for
signing (§14); interval flattening (§6). Nothing in this draft is returned to the council.
