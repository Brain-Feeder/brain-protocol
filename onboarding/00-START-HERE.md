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
  onboarding/UPGRADING.md         ← already connected on tokens? how to add OAuth without breaking
  onboarding/INTEGRATION-NOTES.md ← exact contracts the Brainfeeder hub sends (redirect, PKCE, token)
  agent/       ← the code you copy: card + a2a endpoints, wired to your data
```

Throughout, `<SYSTEM>` is your system's short id (e.g. `acme`), `<SYSTEM NAME>` its display name.

---

## STEP 1 — Drop in the endpoints
Copy the whole `agent/` folder into your server: `protocol.ts` (the vocabulary, bundled — no install
needed), `agent.ts`, and the route files. They expose four endpoints:
`GET /api/agent/card`, `POST /api/agent/a2a`, and the OAuth "Connect & Allow" pair
`GET /api/agent/authorize` (consent screen) + `POST /api/agent/token`. (Not Next.js? The handler
bodies are plain Web Fetch API — port the few lines.)

**DONE WHEN:** `GET /api/agent/card` returns JSON (with `auth.type: "oauth2.1"`), and
`POST /api/agent/a2a` with no token → `401`.

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

## STEP 3 — Auth: Connect & Allow (OAuth), token as fallback
The kit ships **OAuth 2.1 "Connect & Allow"** out of the box: a hub sends the user to your
`/api/agent/authorize` consent screen ("Allow Brainfeeder to access tasks · presence"), and on
approval the kit issues a one-time code that the hub swaps for a bearer token at `/api/agent/token`
(PKCE-protected). **The user never copies a token.** A real system gates the consent screen behind its
own login first; brand it as your own. The bearer token returned is `AGENT_ACCESS_TOKEN` — set it to a
strong secret. (A hub can also still use that token directly for a quick dev connect, the fallback path.)

**DONE WHEN:** `GET /api/agent/authorize?...` shows a consent page, and an authenticated
`POST /api/agent/a2a` `{"method":"presence.query"}` returns `200` with a summary.

## STEP 4 — Prove conformance (the gate)
From the **kit root** (the folder that holds `package.json` and `conformance/` — a sibling of
`onboarding/`), against **your own deployed** URL — dogfood yourself, don't assume:
```
npm install                                          # on the SAME machine you'll run conform from
npm run conform -- https://your-system.example  THE_TOKEN
```
> **Run `npm install` here, on the machine you run conform from — never copy `node_modules` between
> machines.** The runner uses `tsx`/esbuild, which ships native per-platform binaries; a
> `node_modules` built on Linux won't run on a Mac. If you hit an `@esbuild/<platform>` error, delete
> `node_modules` + `package-lock.json` and re-run `npm install`.

Reading the output:
- **"could not reach <url> — NOT a protocol failure"** → a URL/DNS/deploy problem, not the protocol.
  Fix the address or wait for the deploy; nothing was tested.
- The most common *real* failure is **id-less objects**: every activity/entity needs a real uuid
  `id`, even ones you compute on the fly. The runner catches it — that's the point.

**DONE WHEN:** it prints `PASS — conformant. Safe to connect.` Fix any `XX` line first; don't skip this.

## STEP 5 — Connect from a hub
In the hub (in Brainfeeder: *Work → Add a system*), paste your URL and choose who can see it. Because
your card advertises OAuth, the hub sends the user to **your** "Allow" screen to approve — no token to
copy. (If a system only speaks the older token auth, the hub falls back to asking for the token.)

**DONE WHEN:** your data appears in the hub tagged `<SYSTEM>`, and a live query (e.g. presence) returns
an answer from your system.

## STEP 6 — Align the AI architecture (OPTIONAL)
**Only if your system has, or is deliberately adding, a user-facing assistant.** A data-only system
that just feeds information back and forth is already a complete peer after STEP 5 — you are done; do
**not** build a master agent to connect. If you *do* have a conversational assistant, work through
`ARCHITECTURE.md` to align **that** assistant (never a second one) — especially the draft-and-confirm
gate, so it can't take an irreversible action without a human.

**DONE WHEN:** the protocol section of `CHECKLIST.md` is ticked (and, if you have an assistant, the
architecture section too).

---

### Shortcut: hand it to your own AI
Open a build session on your repo with this kit available and paste `AI-BUILD-PROMPT.md`. It runs the
sequence and stops at the gates for you to verify.
