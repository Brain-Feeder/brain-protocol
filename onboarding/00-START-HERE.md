# Connect your system to the Brain Feeder ecosystem — START HERE

A complete, ordered kit for making **any** system speak the Brain Protocol and federate with any hub.
Nothing here is hub- or vendor-specific. Follow the steps top to bottom; each has a **DONE WHEN**
gate — don't move on until it's met. A person or an AI agent can run this verbatim.

You're doing two things: (A) **speak the protocol** so any hub can federate with you, and (B)
**adopt the shared AI architecture** so your system behaves like a true peer.

```
this kit:
  onboarding/00-START-HERE.md     ← the runbook (here)
  onboarding/ARCHITECTURE.md      ← the AI doctrine to align to
  onboarding/AI-BUILD-PROMPT.md   ← paste into your own AI build session to do it automatically
  onboarding/CHECKLIST.md         ← the definition of done
  agent/       ← the code you copy: card + a2a endpoints, wired to your data
```

Throughout, `<SYSTEM>` is your system's short id (e.g. `acme`), `<SYSTEM NAME>` its display name.

---

## STEP 1 — Drop in the two endpoints
Copy the whole `agent/` folder into your server: `protocol.ts` (the vocabulary, bundled — no install
needed), `agent.ts`, and the two route files. They expose `GET /api/agent/card` and
`POST /api/agent/a2a`. (Not Next.js? The handler bodies are plain Web Fetch API — port the few lines.)

**DONE WHEN:** `GET /api/agent/card` returns JSON, and `POST /api/agent/a2a` with no token → `401`.

## STEP 2 — Set your identity and wire the four methods to your data
Set your identity (`AGENT_SYSTEM_ID` / `AGENT_SYSTEM_NAME` env vars, or edit the consts at the top of
`agent.ts`), then replace the sample functions with your real data, mapped onto the **four primitives**
(see ARCHITECTURE.md §3):
- `activities.query` → your events / tasks / deadlines / reminders as **Activity** objects.
- `entities.query` → your nouns (clients, projects, documents, people) as **Entity** objects.
- `presence.query` → a live, computed answer ("free after 5pm"). Not stored data.
- `action.execute` → actually perform the action in your system; return what happened.

Keep the shapes exactly: `id` is a real uuid, `source` is `<SYSTEM>`, `external_ref` is your own id.

**DONE WHEN:** each method returns your own data in the protocol shapes.

## STEP 3 — Issue the hub a token
Set `AGENT_ACCESS_TOKEN` to a strong secret — the token you hand a hub. (One static token is fine to
start; per-hub tokens later.)

**DONE WHEN:** `POST /api/agent/a2a` with `Authorization: Bearer <token>` + `{"method":"presence.query"}`
returns `200` with a summary.

## STEP 4 — Prove conformance (the gate)
From the `brain-protocol` repo, against your **deployed** URL:
```
npm run conform -- https://your-system.example  THE_TOKEN
```
**DONE WHEN:** it prints `PASS — conformant. Safe to connect.` Fix any `XX` line first; don't skip this.

## STEP 5 — Connect from a hub
In the hub (in Brainfeeder: *Work → Add a system → Connect any system by URL*), paste your URL + the
token, choose what to share and who can see it, connect.

**DONE WHEN:** your data appears in the hub tagged `<SYSTEM>`, and a live query (e.g. presence) returns
an answer from your system.

## STEP 6 — Align the AI architecture
Work through `ARCHITECTURE.md` (seven principles). If your system has an AI layer, this is alignment;
if not, it's the recommended pattern. Flag anywhere you diverge — especially any path where the AI can
take an irreversible action without a human confirming.

**DONE WHEN:** `CHECKLIST.md` is fully ticked.

---

### Shortcut: hand it to your own AI
Open a build session on your repo with this kit available and paste `AI-BUILD-PROMPT.md`. It runs the
sequence and stops at the gates for you to verify.
