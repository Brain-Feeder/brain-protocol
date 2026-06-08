# The shared AI architecture (STEP 6)

Conformance (STEP 1–5) lets your system *connect*. This is what makes it the *same species of system*
— safe, predictable, and federating cleanly. For each principle: confirm your system matches it; where
it diverges, change it. (If your system has no AI layer yet, this is the pattern to build toward.)

### 1. One named orchestrator (the Director)
The user talks to exactly **one** assistant, with a name and one voice. Specialist sub-agents run
*underneath* it and never address the user directly. Same base model — different scope, tools, and
context per call. The user should never feel handed between bots.

### 2. Draft-and-confirm gate (the safety wall)
Reversible actions the assistant just does. **Irreversible** ones — pay, book, send, renew, switch,
invoice — it **proposes**; a human must say yes before anything happens. The assistant never moves
money, sends, or books on its own. This is also what makes `action.execute` safe across the federation
boundary. **If your AI can take irreversible actions autonomously, fix this first.**

### 3. The graph is the internal model (why federation is cheap)
Represent everything internally as four primitives — **Entity · Activity · Edge · Action** — not a type
per noun:
- **Activity** — anything that happens or is due: events, tasks, deadlines, reminders.
- **Entity** — the nouns: clients, projects, sites, documents, people.
- **Edge** — the links: this task *belongs to* that client.
- **Action** — the confirm-gated side-effects: reply, move, invoice.

When your internal shapes already match the wire, the agent endpoints (STEP 1) are a thin projection of
data you already hold — not a translation layer you maintain forever. Adding a new *kind* of thing you
share is cheap; adding a fifth primitive is a protocol-version event. Hold the line at four.

### 4. Scoped context
The assistant only ever sees what the asking user is allowed to see (row-level security / per-tenant).
It cannot answer beyond the asker's permissions — and the same rule holds across the federation
boundary: a hub only gets what the token's scope and the user's grant allow.

### 5. Memory
An append-only journal of what happened, plus durable facts the assistant is told to remember and
recalls later. It should feel like it knows the account over time, not just the current message.

### 6. Tools are the assistant's hands
A small, explicit tool set (create activity, propose action, query presence, …). Reversible tools run
immediately; irreversible tools route through the gate in §2. No hidden capabilities.

### 7. Cross-system etiquette
When the assistant needs another system, it **asks that system's agent** (presence/activities) rather
than scraping or copying, and proposes any cross-system action into the same confirm gate. This is
exactly the contract STEP 1 exposes — your system is on both ends of it.

### 8. Disconnection means forgetting (both ends)
Connecting is reversible from both ends, and disconnecting erases. Build for it from the start:
- **Tag provenance at write time.** Whenever your assistant stores something learned from, or an
  action taken in, a connected system, stamp it with that connection's source — otherwise you can't
  cleanly forget it later (a fact distilled into free text loses its origin).
- **Hub disconnects you:** expect (and, as a hub, perform) erasure of the system's resident data
  *and* the derived memory about it — everything by default; an actions-only audit only if the user
  opts in. Implement `connection.revoke` so a disconnecting hub can tell you to drop its token.
- **You disconnect a hub:** revoke the token you issued it. Its calls then fail and it must forget
  you. Revocation is the system-end "forget me" — no special endpoint required.
- **Prefer live queries** (presence) over sync where you can: nothing stored is nothing to forget.

---

**The through-line:** the graph (§3) makes federation cheap, the confirm gate (§2) makes it safe, the
single orchestrator (§1) makes it feel like one assistant rather than a swarm, and forgetting on
disconnect (§8) makes it trustworthy. Those are the non-negotiables; the rest is how to do them well.
