# Make your system connectable — in an afternoon

This is the **reference agent**: the smallest complete Brain-Protocol system. Copy it into your
product, point it at your real data, and any Brain Protocol hub (Brainfeeder is the first) can
federate with you — discover you, agree permissions, sync your activities, ask you live questions,
and run actions you confirm. No bespoke integration, no one to ask permission from. You implement
the spec; you pass the conformance runner; you connect.

The whole surface is **two endpoints**.

## 1. The vocabulary

The shapes are **bundled** as `protocol.ts` so this runs the moment you copy it — no install needed.
It's a faithful mirror of the canonical package; once `@brainfeed/protocol` is on your registry, swap
`./protocol` for `@brainfeed/protocol` in `agent.ts`. Either way, don't re-implement the shapes — the
conformance runner validates against the real package, so any drift is caught at the gate.

## 2. Expose two endpoints

Copy `agent.ts` and the two route files. They're plain Web Fetch API handlers (shown here as
Next.js App Router `route.ts`, but the bodies port verbatim to Express, Hono, Workers, Deno…).

- `GET /api/agent/card` → your **agent card**: who you are, the protocol version, how to
  authenticate, and which capabilities you offer. Public, no secrets.
- `POST /api/agent/a2a` → the **authenticated method endpoint**. A hub presents the token you
  issued it and calls one method:

  | method | capability | returns | side effect |
  |---|---|---|---|
  | `presence.query` | presence | `{ summary, busy_until }` | none |
  | `activities.query` | tasks | `{ activities: Activity[] }` | none |
  | `entities.query` | projects | `{ entities: Entity[] }` | none |
  | `action.execute` | tasks (act) | `{ ok, result }` | **yes** — the hub only calls this after a human on its side confirms |

Wire the four `handleA2A` cases to your real data and your real "do the thing" code. That's it.

## 3. Issue a token

A hub authenticates as the token-bearer. The reference uses one static token from
`AGENT_ACCESS_TOKEN`; a real multi-tenant system maps a token → tenant and scopes it. The shape on
the wire is identical: `Authorization: Bearer <token>`.

## 4. Prove it — the conformance runner

From the `brain-protocol` repo, point the runner at your deployed system:

```bash
npm run conform -- https://your-system.example  YOUR_ACCESS_TOKEN
```

It checks, over the network: the card is valid and version-compatible, unauthenticated calls are
rejected, and every object you return validates against the shared vocabulary. **PASS = safe to
connect.** Fix any `XX` lines until it's green. This is the gate — passing it is what "supports
Brain Protocol v0.x" means, and it's the same check a hub runs before it trusts your handshake.

## 5. Connect

In the hub (Brainfeeder: *Work → Add a system → Connect any system by URL*), paste your system's
address and the token. The two assistants shake hands, you choose what it may share and who can see
it, and your world flows in. Disconnect removes every synced row cleanly.

## Staying in lockstep

Subscribe to protocol releases (BRAIN_PROTOCOL.md §13). Additive upgrades you can adopt
automatically; breaking ones come with a migration window and need a human. Re-run `npm run conform`
after any upgrade to confirm you're still green.
