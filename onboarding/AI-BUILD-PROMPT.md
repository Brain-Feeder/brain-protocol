# Paste this into your system's own AI build session

*Open a build session (Claude Code / Cowork) on your repository, make sure this `onboarding/` folder
and `agent/` are available to it, and paste everything below the line.*

---

You are upgrading **this system** to join the Brain Feeder ecosystem by speaking the Brain Protocol.
A complete kit is in `onboarding/` and `agent/`. Do the steps in order. After each,
state what you did and how you verified it. **Stop at STEP 4 (conformance) and STEP 6 and wait for the
human** — do not connect to a real hub or change irreversible-action behaviour without a human
confirming.

**STEP 1 — Endpoints.** Copy the whole `agent/` folder (`protocol.ts` is bundled — no install needed)
into our server (suggest a path, match our conventions), fixing import paths. Verify: `GET
/api/agent/card` returns JSON; `POST /api/agent/a2a` with no token returns 401.

**STEP 2 — Identity + real data.** Set `SYSTEM_ID` and `SYSTEM_NAME` in `agent.ts`. Replace the four
sample functions with our real data, mapped onto the four primitives in `ARCHITECTURE.md` §3. Keep the
shapes exactly; `id` must be a real uuid, `source` is our system id, `external_ref` is our record id.
For `action.execute`, perform the real side-effect and return what happened.

**STEP 3 — Token.** Add an `AGENT_ACCESS_TOKEN` env secret. Verify an authenticated `presence.query`
returns 200 with a summary.

**STEP 4 — Conformance (GATE — stop).** Tell the human to run, from the `brain-protocol` repo:
`npm run conform -- <our-deployed-url> <token>`. Fix anything until it prints PASS. Do not proceed until
the human confirms green.

**STEP 5 — (human connects from a hub).**

**STEP 6 — Architecture alignment (GATE — propose, don't apply).** Read `ARCHITECTURE.md`. Audit our
system against all seven principles and produce a short report: for each, do we comply, and if not, the
exact change. **Treat principle 2 (draft-and-confirm gate) as critical** — if our AI can take
irreversible actions without a human yes, flag it loudly. Propose changes and wait for the human before
applying any.

Constraints: never weaken the confirm gate; never expose secrets in the agent card; keep the four
primitives — do not invent a fifth; depend on `@brainfeed/protocol`, do not redefine the shapes.
