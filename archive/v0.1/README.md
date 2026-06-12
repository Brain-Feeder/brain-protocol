# @brainfeed/protocol

The **Brain Protocol** v0.1 reference package — the neutral interoperability standard for the
Brain Feeder ecosystem. The spec is `docs/BRAIN_PROTOCOL.md`; this package is its executable form.

> **This package should live in its own repo** (`brain-protocol`), not inside Brainfeeder.
> It is drafted here for convenience; lift it out before briefing it into other systems, so the
> standard sits *above* every system (Brainfeeder included) rather than inside one of them.

## What it gives you
- **Schemas + types** (`src/schema.ts`, `src/types.ts`) — entity · activity · edge · action ·
  capability · agent card · migration descriptor. One source for both runtime validation and
  TypeScript types (Zod), so a system can't drift on the shapes.
- **Validators** (`src/validate.ts`) — `validateEntity/Activity/Edge/Action/AgentCard`, plus
  `negotiate()` (version + capability handshake) and `canAutoAdopt()` (the upgrade gate).
- **Conformance kit / TCK** (`conformance/tck.ts`) — the executable gate every system runs in CI.

## Use it (the §11 onboarding checklist, in code)
```ts
import { validateEntity, negotiate, PROTOCOL_VERSION } from '@brainfeed/protocol';

// at your boundary — reject what doesn't conform (§9.3)
const r = validateEntity(incoming);
if (!r.ok) throw new Error('non-conformant: ' + r.errors!.join('; '));

// on handshake — find the common ground (§8)
const deal = negotiate(PROTOCOL_VERSION, ['calendar','tasks'], remoteAgentCard);
```

## Build a connector — make any system connectable
A system that lives entirely separate from any hub, run by anyone, becomes connectable in an
afternoon. Three things make that self-serve:

- **`onboarding/agent/`** — the smallest complete conformant system: two endpoints
  (`GET /api/agent/card`, `POST /api/agent/a2a`). Copy it into your product (any stack — the
  handler bodies are plain Web Fetch API), wire the four methods to your real data, issue a token.
  Its `README.md` is the step-by-step guide.
- **`npm run conform -- <url> <token>`** — the live conformance runner. Point it at your *deployed*
  system and it checks, over the wire, that your card is valid and version-compatible, that auth
  actually rejects, and that every object you return validates against the vocabulary. **PASS =
  safe to connect.** This is the gate a hub itself runs before trusting your handshake — so passing
  it locally means you *will* connect.
- **`npm run tck`** — the in-process self-test (reference adapter PASSES, broken adapter FAILS),
  for unit-testing an `Adapter` in CI.

```bash
npm run conform -- https://your-system.example  YOUR_TOKEN   # over the network, against a live URL
npm run tck                                                   # in-process, in CI
```

A system claims "Brain Protocol v0.1 support" only when it passes. Green is your release gate —
and your ticket to connect to any hub in the ecosystem.

## Versioning (§7–8)
Semver. Additive = MINOR (safe, forward-compatible: unknown fields/kinds pass through). Breaking
= MAJOR (support N and N-1 across a migration window). `negotiate()` drops two peers to their
highest common version, so systems upgrade independently. Breaking upgrades require a human
(`canAutoAdopt()` returns false); additive ones may auto-adopt.

## Layering
This package is the **semantics**. The **wire** is A2A (agent-to-agent) + MCP (agent-to-tool) —
not redefined here. See `docs/BRAIN_PROTOCOL.md` and `docs/FEDERATION.md`.
