# Definition of done — tick every box

### Protocol (your system can connect)
- [ ] `GET /api/agent/card` returns a valid agent card (system_id, name, protocol_version, auth, capabilities, endpoints).
- [ ] `POST /api/agent/a2a` with **no** token → `401`.
- [ ] `POST /api/agent/a2a` with the token + `{"method":"presence.query"}` → `200` with a `summary`.
- [ ] `activities.query` returns your real events/tasks/deadlines as Activity objects (real uuids, your `source`).
- [ ] `entities.query` returns your real nouns (clients/projects/…) as Entity objects.
- [ ] `action.execute` performs the real side-effect and returns `{ ok, result }`.
- [ ] `AGENT_ACCESS_TOKEN` is a strong secret; the token is shared with the hub out-of-band.
- [ ] **`npm run conform -- <your-url> <token>` prints `PASS — conformant. Safe to connect.`**

### Live connection (it actually works)
- [ ] A hub connects via *Add a system → Connect any system by URL*; the handshake completes.
- [ ] Your data appears in the hub, tagged with your `source`, at the chosen visibility.
- [ ] A live query (e.g. presence) returns an answer computed by your system.
- [ ] A confirmed cross-system action actually runs in your system.
- [ ] Disconnect removes every row sourced from your system cleanly.

### Architecture (your system is a true peer — see ARCHITECTURE.md)
- [ ] One named orchestrator is the only assistant the user talks to; sub-agents never surface.
- [ ] Irreversible actions (pay/book/send/renew/switch/invoice) require a human confirm. **(critical)**
- [ ] Your system represents its data internally as Entity / Activity / Edge / Action.
- [ ] The assistant only sees what the asking user is permitted to see.
- [ ] There is a memory (journal + durable facts) the assistant recalls.
- [ ] The assistant acts only through an explicit tool set; cross-system actions go through the gate.
