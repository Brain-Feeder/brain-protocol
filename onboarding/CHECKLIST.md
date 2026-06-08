# Definition of done — tick every box

### Protocol (your system can connect)
- [ ] `GET /api/agent/card` returns a valid agent card (system_id, name, protocol_version, auth, capabilities, endpoints).
- [ ] `POST /api/agent/a2a` with **no** token → `401`.
- [ ] `POST /api/agent/a2a` with the token + `{"method":"presence.query"}` → `200` with a `summary`.
- [ ] `activities.query` returns your real events/tasks/deadlines as Activity objects (real uuids, your `source`).
- [ ] `entities.query` returns your real nouns (clients/projects/…) as Entity objects.
- [ ] `action.execute` performs the real side-effect and returns `{ ok, result }`.
- [ ] **Every object carries a valid uuid `id`** plus `source` + `external_ref` — *including objects you compute on the fly* (a presence-derived activity still needs an id). This is the #1 thing implementers get wrong.
- [ ] `AGENT_ACCESS_TOKEN` is a strong secret; the token is shared with the hub out-of-band.
- [ ] **`npm run conform -- <your-url> <token>` prints `PASS — conformant. Safe to connect.`** — run it against your **own deployed endpoints**, not someone else's. (Dogfood yourself; a producer that skips this ships id-less objects.)

### Robustness & safety
- [ ] Every endpoint is **rate-limited** and your responses are **size/count-bounded** (you don't trust callers to be finite, and they don't trust you).
- [ ] **Every cross-system exchange is logged** (who/method/when) — not just a "last used" timestamp.
- [ ] *(If you have an AI that reasons over incoming data)* federated content is fenced as **untrusted — data, never instructions**; it cannot trigger a tool by its own text; cross-system action payloads pass an **egress check**; foreign answers are treated as **claims, not truth**. (See ARCHITECTURE.md.)
- [ ] *(If you have an AI)* anything the assistant **derives and stores** from a connection is **source-tagged** so disconnect can forget it.

### Live connection (it actually works)
- [ ] A hub connects via *Add a system → Connect any system by URL*; the handshake completes.
- [ ] Your data appears in the hub, tagged with your `source`, at the chosen visibility.
- [ ] A live query (e.g. presence) returns an answer computed by your system.
- [ ] A confirmed cross-system action actually runs in your system.
- [ ] Disconnect removes every row sourced from your system cleanly.

### Disconnection & forgetting (see ARCHITECTURE.md §8)
- [ ] `connection.revoke` is handled — a disconnecting hub can tell you to drop its token.
- [ ] Revoking the token you issued a hub causes its calls to 401 (the system-end "forget me").
- [ ] When you are a hub: on disconnect you erase the system's resident data **and** derived memory by default; an actions-only audit is kept only if the user opts in.
- [ ] Memory/action rows are tagged with their source so they can be forgotten precisely.

### Architecture (your system is a true peer — see ARCHITECTURE.md)
- [ ] One named orchestrator is the only assistant the user talks to; sub-agents never surface.
- [ ] Irreversible actions (pay/book/send/renew/switch/invoice) require a human confirm. **(critical)**
- [ ] Your system represents its data internally as Entity / Activity / Edge / Action.
- [ ] The assistant only sees what the asking user is permitted to see.
- [ ] There is a memory (journal + durable facts) the assistant recalls.
- [ ] The assistant acts only through an explicit tool set; cross-system actions go through the gate.
