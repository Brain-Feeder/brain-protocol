# Medic Clinic ↔ OS Me — connector specification

A spec for building a **doctor / private-clinic system** (worked example: The Medic Clinic, Bedford)
that connects to OS Me over the **Brain Protocol**, the same way TPMS and Has It Arrived do.

It covers two things you asked for:
1. **The clinic system** — list bookable services, store patients, appointments and reports, share
   reports back.
2. **The integration** — OS Me browses and books services, shares the user's health plan, the doctor
   submits a report (e.g. a blood test), OS Me reviews it against the plan and suggests updates, the
   doctor approves or adjusts, and on approval the user is alerted and can accept the change to their plan.

> **Doctrine, up front (non-negotiable).** The clinic stays a **simple, precise data system**. All the
> *intelligence* (reading the plan, drafting suggested changes) lives in the **OS Me hub** — never in the
> clinic. The **clinician is the clinical authority**: OS Me only ever *suggests*, the doctor approves,
> and then the *user* approves. OS Me never diagnoses, prescribes or changes a plan autonomously.

---

## 0. How this maps to the protocol

The clinic is a **peer system**: it publishes an **agent card**, speaks the **A2A** methods, and
authenticates hubs. Internally it models everything as the four primitives — **Entity, Activity, Edge,
Action** — so the wire is a thin projection of data it already holds:

| Clinic concept | Primitive | On the wire |
| --- | --- | --- |
| A bookable service (blood test, GP consult…) | **Entity** (`kind: service`) | `entities.query` |
| A clinician | **Entity** (`kind: clinician`) | `entities.query` |
| A patient | **Entity** (`kind: patient`) — never shared wholesale | internal |
| An appointment / free slot | **Activity** (`activity_type: appointment`) | `activities.query` |
| A report (blood test result…) | **Entity** (`kind: report`) | submitted to the hub |
| "this appointment is for that patient" | **Edge** | internal |
| Book / cancel / submit report | **Action** | `action.execute` (gated) |

### What works today vs what to add

| Capability | Status | Mechanism |
| --- | --- | --- |
| Discover the clinic, negotiate version | ✅ today | agent card + `negotiate()` |
| Authenticate the hub | ✅ today | OAuth 2.1 "Connect & Allow" **or** hub-consent |
| List services & clinicians | ✅ today | `entities.query` (+ `describe` on the card) |
| Check availability | ✅ today | `activities.query` with typed filters (`status`, `since`, `until`) |
| Book / cancel an appointment | ✅ today | `action.execute` through the confirm gate (dark-by-default) |
| Read the patient's appointments | ✅ today | `activities.query` (scoped to the linked patient) |
| **Share the user's health plan with the clinic** | ➕ add | clinic reads it **live** from the hub via a scoped inbound grant: `health.context.query` |
| **Doctor submits a report** | ➕ add | clinic calls **into** the hub: `health.report.submit` (F5 inbound) |
| **Hub reviews report vs plan, suggests update** | ➕ add | hub returns a `PlanProposal` (draft) in the submit response |
| **Doctor approves / adjusts** | ➕ add | clinic calls `health.review.finalise` |
| **User alerted, accepts, plan updates** | ➕ add | hub-side notification + the existing draft-and-confirm gate |

Everything in the "➕ add" rows is **additive** — new *methods*, not a new primitive. Reports and
proposals are Entities/Activities; every approval is an Action through the gate. **No fifth primitive.**

---

## PART A — The clinic system

### A1. Services catalogue (the bookable list)

Seed from the real Medic Clinic service list. Each is an **Entity** `kind: service` with booking metadata.
Group as the clinic groups them:

**Clinical (the ones that matter for the health-plan loop)**
- GP Consultation · Health MOT · **Blood Tests** · Ultrasound Scanning (incl. pregnancy scans) ·
  Cardiology · Respiratory · Endocrinology / Diabetes · Gynaecology & Fertility / Women's Health ·
  Mental Health · Physiotherapy · Vitamin Infusions & Shots · NAD+ Infusions · MRI/CT scans ·
  Steroid / Corticosteroid injections · Medicals (work/travel) · Hay-fever injection ·
  Skin Surgery & Dermatology (mole/lesion removal).

**Aesthetic (bookable, but outside the clinical plan loop)**
- HydraFacial · Microneedling · Dermal Fillers & Anti-Wrinkle · PRP Therapy · Skin Treatments (peels,
  Obagi) · Skin Boosters (Profhilo, Sunekos, Jalupro) · Fat-dissolving injections.

**Service entity shape**
```json
{
  "id": "uuid", "type": "entity", "kind": "service",
  "name": "Blood Test — Full Health Check",
  "summary": "Comprehensive panel; results in 24–48h, reviewed by a GP.",
  "attrs": {
    "category": "blood_test",            // gp | blood_test | health_mot | ultrasound | cardiology | ...
    "duration_min": 15,
    "price_gbp": 129,
    "produces_report": true,             // ← drives the report loop
    "clinician_kinds": ["gp", "phlebotomist"],
    "prep": "No fasting required for most panels.",
    "booking_url": "https://medicclinic.co.uk/booking/"
  },
  "source": "medic-clinic", "external_ref": "svc-bloods-full"
}
```

### A2. Patients, appointments, reports (stored clinic-side)

- **Patient** (`kind: patient`) — name, DOB, contact, and the **OS Me link** (`osme_member_ref`) once a
  user connects and consents. Patient PII is **never** returned wholesale on the wire; the hub only ever
  references *its own* member, and the clinic resolves to the patient internally via the Edge.
- **Appointment** (`activity_type: appointment`) — service, clinician, datetime, status, patient Edge.
- **Free slot** — the same Activity shape with `status: "available"` and no patient Edge.
- **Report** (`kind: report`) — produced after an appointment; structured result + a clinician note.
  Shared by the clinic *submitting it to the hub* (A4), not by the hub polling.

**Appointment activity shape (status uses the shared vocabulary)**
```json
{
  "id": "uuid", "type": "activity", "activity_type": "appointment",
  "title": "Blood Test — Full Health Check with Dr Khan",
  "starts_at": "2026-06-20T09:30:00Z", "ends_at": "2026-06-20T09:45:00Z",
  "status": "scheduled",                 // available | scheduled | completed | cancelled
  "attrs": { "service_ref": "svc-bloods-full", "clinician_ref": "clin-khan", "price_gbp": 129 },
  "source": "medic-clinic", "external_ref": "appt-88213"
}
```

### A3. The clinic's agent card

Self-describing, so the hub's model knows how to query it with no bespoke wiring:
```json
{
  "system_id": "medic-clinic",
  "name": "The Medic Clinic, Bedford",
  "protocol_version": "0.1.0",
  "summary": "Private GP & clinic — bookable services, appointments and clinician reports.",
  "auth": { "type": "oauth2.1",
            "authorize_url": "https://api.medicclinic.co.uk/agent/authorize",
            "token_url": "https://api.medicclinic.co.uk/agent/token",
            "scopes": ["services", "appointments", "reports"] },
  "capabilities": [
    { "name": "services", "verbs": ["read", "query"],
      "describe": { "summary": "Bookable clinical and aesthetic services with price and prep.",
        "fields": ["name", "category", "price_gbp", "duration_min", "produces_report"],
        "query_params": ["q", "status"],
        "examples": ["what blood tests do you offer?", "is a Health MOT available?"] } },
    { "name": "appointments", "verbs": ["read", "query", "act"],
      "describe": { "summary": "Availability and the linked patient's appointments.",
        "statuses": ["available", "scheduled", "completed", "cancelled"],
        "query_params": ["status", "since", "until", "q"],
        "examples": ["any blood-test slots next week?", "what have I got booked?"] } },
    { "name": "reports", "verbs": ["read"],
      "describe": { "summary": "Clinician reports produced after appointments (shared to the hub on completion)." } }
  ],
  "endpoints": { "a2a": "https://api.medicclinic.co.uk/agent/a2a" }
}
```

### A4. A2A methods the clinic must implement (its endpoints)

Standard conformance (the clinic *answers* these):
- `presence.query` → next available slot summary ("Next GP slot: tomorrow 11:20").
- `entities.query` → services + clinicians (honour `q`, `status` filters).
- `activities.query` → availability + the linked patient's appointments (honour `status`, `since`, `until`).
- `action.execute` → `book_appointment`, `cancel_appointment` (dark-by-default; see §Security).
- `connection.revoke` → drop the hub's token and the OS Me link, and stop sharing.

### A5. Doctor-facing UI (what the clinic staff use)

1. **Services manager** — CRUD the bookable list (the entities in A1), set price/duration/prep, toggle
   `produces_report`.
2. **Diary / availability** — clinician calendars; free slots become `available` activities.
3. **Patients** — records, and the OS Me connection status per patient.
4. **Appointments** — book/cancel/complete; completing a report-producing appointment opens →
5. **Report builder** — structured entry (e.g. blood panel: analyte, value, unit, range, flag) + a
   clinician note. On submit, the clinic calls the hub (A4 of Part B) and receives OS Me's **suggested
   plan update**, which lands in →
6. **Review queue** — the clinician sees OS Me's suggestion *next to* their report, and **Approves**,
   **Edits then approves**, or **Declines**. Approve/Edit calls `health.review.finalise`. Nothing reaches
   the user until the clinician approves.

---

## PART B — The integration flows

Numbered request/response sketches. "Hub" = OS Me; "Clinic" = the doctor system.

### B1. Connect & link the patient to the OS Me user (consent)
1. User taps **Apps → Add a system → Medic Clinic** in OS Me.
2. OS Me discovers the card, negotiates the version, runs **OAuth Connect & Allow**: the user logs in at
   the clinic and approves scopes `services appointments reports`. The clinic links its **patient record**
   to the OS Me member and issues the hub a bearer token.
3. **Health-data consent is explicit and separate**: the approval screen states the clinic will *receive
   reports' context from* and *share reports with* OS Me, that this is **special-category health data**,
   and that disconnecting erases it both ends.

### B2. Browse services & availability (read — works today)
- "What blood tests can I book?" → Director calls `entities.query {q:"blood"}` on the clinic.
- "Any slots next week?" → `activities.query {status:["available"], since, until}`.

### B3. Book an appointment (action through the gate — works today)
1. Director proposes: *"Book Blood Test — Full Health Check, Sat 20 Jun 09:30, £129?"* → into the
   **confirm gate**. Nothing happens yet.
2. User taps yes → hub calls `action.execute {action:{type:"book_appointment", service_ref, slot_ref}}`.
3. Clinic books, returns the confirmed appointment; OS Me files it in the Health zone diary.

### B4. Share the health plan with the clinic (live read — minimisation)
- The clinic is granted a **scoped inbound token** to the hub (F5). When preparing a report, the clinic
  calls the hub: `health.context.query {member_ref}` → returns the user's **active plan summary** (goal,
  type, key targets, current diet/nutrition/training items) **and a consent flag**.
- **Live, not stored.** The clinic reads context at report time and does not retain it — "nothing stored
  is nothing to forget." If consent is absent, the hub returns `{shared:false}` and the loop runs without
  plan context (the suggestion step is skipped; see B7).

### B5. Doctor submits a report (clinic → hub; the new inbound call)
```
POST  {hub}/api/agent/a2a     Authorization: Bearer <clinic-grant-token>
{ "method": "health.report.submit",
  "report": {
    "id": "uuid", "type": "entity", "kind": "report",
    "member_ref": "<osme-member>", "report_type": "blood_test",
    "title": "Full Health Check — 20 Jun 2026",
    "results": [
      {"analyte":"HbA1c","value":44,"unit":"mmol/mol","range":"20–41","flag":"high"},
      {"analyte":"LDL cholesterol","value":3.6,"unit":"mmol/L","range":"<3.0","flag":"high"},
      {"analyte":"Vitamin D","value":38,"unit":"nmol/L","range":"50–125","flag":"low"}
    ],
    "clinician_note": "Borderline glycaemia and raised LDL; vitamin D insufficient.",
    "clinician_ref": "clin-khan",
    "source": "medic-clinic", "external_ref": "rep-55120" } }
```

### B6. Hub reviews the report against the plan, returns a suggested update
The hub stores the report (provenance-tagged `source: medic-clinic`), then runs a **guarded** review of
the report **against the active plan** and returns a **draft `PlanProposal`** in the response — *for the
clinician to review*, never applied yet:
```json
{ "result": {
    "review_id": "uuid",
    "had_plan": true,
    "proposal": {
      "status": "suggested",
      "rationale": "HbA1c and LDL are above range and vitamin D is low; the active plan's nutrition and movement targets can be nudged to support these.",
      "suggested_changes": [
        {"area":"nutrition","change":"Lower refined-sugar intake; emphasise high-fibre, lower-GI meals.","links_to":"HbA1c"},
        {"area":"movement","change":"Add one zone-2 cardio session/week.","links_to":"LDL"},
        {"area":"supplement","change":"Discuss vitamin D 1000–2000 IU/day with the clinician.","links_to":"Vitamin D"}
      ],
      "safety_notes": ["Suggestions only — for clinician review.","Not a diagnosis; medication decisions are the clinician's."]
    } } }
```
- If `had_plan:false`, `proposal` is replaced with `suggest_start_plan: true` and a one-line starter
  rationale (see B9).

### B7. Doctor approves or adjusts (clinic → hub)
The clinician sees the report **and** OS Me's suggestion in the **review queue**, then finalises:
```
POST {hub}/api/agent/a2a   { "method":"health.review.finalise",
  "review_id":"uuid",
  "decision":"approved",                  // approved | edited | declined
  "clinician_changes":[ ... edited list if "edited" ... ],
  "clinician_ref":"clin-khan" }
```
- `declined` → the loop ends; the report is still saved and visible to the user, with no plan change.

### B8. User is alerted, accepts, plan updates (hub-side; the existing gate)
1. On `approved`/`edited`, the hub raises an **alert** to the user: *"New report from The Medic Clinic —
   and a suggested update to your health plan."*
2. The user opens it: the report, the clinician-approved changes, and **Accept** / **Decline** /
   **Ask a question**. This is the **draft-and-confirm gate** — nothing changes until the user says yes.
3. On **Accept**, OS Me applies the changes to the active `health_plan` (new version, old one retained),
   logs it to the journal (provenance: this report), and confirms. On **Decline**, the plan is untouched
   and the report stays on file.

### B9. No plan yet → suggest starting one
If `had_plan:false`, the user's alert says: *"Your blood test suggests a few small changes would help —
want to start a simple health plan?"* → one tap opens the **guided plan creation** flow (Health zone),
pre-seeded from the report's flagged areas. Decline is always a first-class option.

### Review state machine (shared object)
```
suggested ─(clinician approves/edits)→ clinician_approved ─(user accepts)→ applied
    │                                          │                              
    └─(clinician declines)→ declined           └─(user declines)→ dismissed
```

---

## New protocol methods to add (the additive set)

On the **hub's** inbound A2A (F5), gated by the clinic's scoped grant token:
- `health.context.query { member_ref } → { shared, plan_summary? }` — live plan context, minimised.
- `health.report.submit { report } → { review_id, had_plan, proposal | suggest_start_plan }`.
- `health.review.finalise { review_id, decision, clinician_changes?, clinician_ref } → { ok }`.

Optional (nicer UX, still additive):
- `health.review.get { review_id }` — clinic re-fetches a proposal (e.g. async UI).
- A hub→clinic **webhook** `report.acknowledged { review_id, user_decision }` so the clinic can show
  "patient accepted/declined" in its record.

Add a matching **capability** to *the hub's* card (`health_reporting`, with `describe`) so the clinic
learns the methods from the card.

---

## Security, privacy & consent (this is health data — treat it as such)

- **Special-category data (UK GDPR Art. 9).** Blood results, diagnoses and plans are special-category.
  Lawful basis + **explicit, separate consent** at connect (B1). Spell out what's shared, both directions.
- **Scope minimisation.** The clinic's grant to the hub is read-limited to `health.context.query` for the
  *linked member only*; the hub's token to the clinic is limited to `services appointments reports`.
- **Data minimisation / live-first.** Clinic reads plan context live at report time and does not retain
  it (B4). The hub stores reports provenance-tagged so they can be cleanly forgotten.
- **Forget on disconnect (§8).** Disconnecting erases both ends: the clinic drops the hub token and the
  OS Me link; the hub deletes the clinic's resident data **and** derived memory (the proposals), keeping
  an actions-only audit only if the user opted in. Implement `connection.revoke` both ways.
- **Untrusted content (§9).** A submitted report is **foreign content** entering the hub's model. Fence
  it: the AI review treats results + clinician notes as *data, never instructions*; the proposal is a
  *suggestion to a clinician*, and the user gate is the backstop. Egress-check before any cross-system action.
- **Dark-by-default writes (§10).** `action.execute` (booking) returns "proposed, not executed" until the
  clinic flips a reviewed write flag. Connect read-only first.
- **Transport & secrets.** HTTPS only; tokens in a server-side vault, never the client; no PII in URLs;
  audit every report submission and every plan change.

## Clinical safety guardrails (build these in, not on)

- **OS Me never diagnoses, prescribes or treats.** It *organises* and *suggests*; the **clinician is the
  clinical authority** and approves every suggestion; the **user** then approves the plan change.
- **The suggestion is bounded** to lifestyle/plan areas (nutrition, movement, sleep, habits, "discuss X
  with your clinician") — never medication doses, never a diagnosis from a result.
- **Red-flag routing.** If a report contains values in a critical range, the hub does **not** quietly
  suggest a plan tweak — it flags "please contact the clinic / seek urgent advice" and routes to the
  clinician, not the plan engine.
- **Positioning.** This is a wellbeing-organisation tool, **not a medical device**; the report review is
  decision-*support* for a clinician, with a human in the loop at both approvals.

## Build order (phases)

1. **Conformance, read-only.** Card + `entities/activities/presence.query` + dark `action.execute`. Pass
   the conformance kit (`npm run conform -- <url> <token>`). Connect to OS Me; browse services.
2. **Booking.** Flip the reviewed write flag; `book_appointment` / `cancel_appointment` through the gate.
3. **Report loop.** Hub adds `health.context.query` / `report.submit` / `review.finalise`; clinic adds the
   report builder + review queue; wire the user alert + accept gate. Turn on §8/§9 (you're now storing
   derived data and reasoning over foreign content).
4. **Polish.** Webhook acknowledgements, async review UI, audit dashboards.

---

*This connector is a peer like TPMS: simple and precise on the clinic side, with the intelligence and the
two human approvals (clinician, then user) on the OS Me side. It extends the protocol with a small health
capability set — no fifth primitive — and is safe by construction: dark-by-default writes, forget-on-
disconnect, fenced foreign content, and a clinician-then-user gate on every change to a person's health plan.*
