// Technical Compatibility Kit (BRAIN_PROTOCOL.md §9.2). A system claims "Brain Protocol v0.x
// support" only by passing this. It runs against an Adapter the system implements — the kit
// checks that what the system *produces* validates, that it *rejects* malformed input at its
// boundary, that its agent card is valid, and that it negotiates versions correctly.
import {
  validateEntity, validateActivity, validateEdge, validateAction, validateAgentCard,
  negotiate, PROTOCOL_VERSION,
} from '../src/validate.js';
import type { Entity, Activity, Edge, Action, AgentCard } from '../src/types.js';

// The contract each system implements to be tested.
export interface Adapter {
  agentCard(): AgentCard;
  sampleEntity(): Entity;
  sampleActivity(): Activity;
  sampleEdge(): Edge;
  sampleAction(): Action;
  /** the system's own boundary validator — must reject malformed input */
  acceptsInbound(data: unknown): boolean;
}

export interface Check { name: string; pass: boolean; detail?: string }
export interface Report { system: string; version: string; pass: boolean; checks: Check[] }

const BAD_ENTITY = { id: 'not-a-uuid', type: 'entity', kind: '', name: 'x' }; // invalid on purpose

export function runTck(adapter: Adapter): Report {
  const checks: Check[] = [];
  const ok = (name: string, cond: boolean, detail?: string) => checks.push({ name, pass: cond, detail });

  // 1. agent card is valid + version-compatible
  const card = adapter.agentCard();
  const cardV = validateAgentCard(card);
  ok('agent card validates', cardV.ok, cardV.errors?.join('; '));
  ok('agent card major matches kit', card?.protocol_version?.split('.')[0] === PROTOCOL_VERSION.split('.')[0],
    `card ${card?.protocol_version} vs kit ${PROTOCOL_VERSION}`);

  // 2. the system's own objects validate (round-trip to the shared vocabulary)
  const e = validateEntity(adapter.sampleEntity()); ok('produces a valid entity', e.ok, e.errors?.join('; '));
  const a = validateActivity(adapter.sampleActivity()); ok('produces a valid activity', a.ok, a.errors?.join('; '));
  const g = validateEdge(adapter.sampleEdge()); ok('produces a valid edge', g.ok, g.errors?.join('; '));
  const c = validateAction(adapter.sampleAction()); ok('produces a valid action', c.ok, c.errors?.join('; '));

  // 3. boundary rejects malformed input, accepts valid input (§9.3)
  ok('rejects malformed inbound', adapter.acceptsInbound(BAD_ENTITY) === false);
  ok('accepts valid inbound', adapter.acceptsInbound(adapter.sampleEntity()) === true);

  // 4. version negotiation: an older peer drops both to the lower version
  const olderPeer: AgentCard = { ...card, protocol_version: '0.1.0', capabilities: card.capabilities };
  const neg = negotiate(PROTOCOL_VERSION, card.capabilities.map(x => x.name), olderPeer);
  ok('negotiates a common version', neg.compatible && neg.version === '0.1.0', neg.reason);

  // 5. major mismatch is correctly rejected
  const future: AgentCard = { ...card, protocol_version: '9.0.0' };
  ok('rejects incompatible major', negotiate(PROTOCOL_VERSION, [], future).compatible === false);

  return {
    system: card?.system_id ?? 'unknown',
    version: card?.protocol_version ?? '?',
    pass: checks.every(c => c.pass),
    checks,
  };
}
