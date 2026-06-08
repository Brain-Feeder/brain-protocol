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

## Prove conformance
Implement the `Adapter` interface (`conformance/tck.ts`) for your system and run the kit in CI:
```bash
npm run tck   # self-test: reference adapter PASSES, broken adapter FAILS
```
Green is your release gate. A system claims "Brain Protocol v0.1 support" only when its adapter
passes the TCK.

## Versioning (§7–8)
Semver. Additive = MINOR (safe, forward-compatible: unknown fields/kinds pass through). Breaking
= MAJOR (support N and N-1 across a migration window). `negotiate()` drops two peers to their
highest common version, so systems upgrade independently. Breaking upgrades require a human
(`canAutoAdopt()` returns false); additive ones may auto-adopt.

## Layering
This package is the **semantics**. The **wire** is A2A (agent-to-agent) + MCP (agent-to-tool) —
not redefined here. See `docs/BRAIN_PROTOCOL.md` and `docs/FEDERATION.md`.
