// Runs the TCK against a reference (conformant) adapter and a deliberately-broken one, to prove
// the kit passes good implementations and fails bad ones. `npm run tck`.
import { runTck, type Adapter } from './tck.js';
import { validateEntity } from '../src/validate.js';
import type { Entity, Activity, Edge, Action, AgentCard } from '../src/types.js';

const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

const card: AgentCard = {
  system_id: 'reference', name: 'Reference System', protocol_version: '0.1.0',
  auth: { type: 'oauth2.1', scopes: ['calendar', 'tasks'] },
  capabilities: [{ name: 'calendar', verbs: ['read', 'query'] }, { name: 'tasks', verbs: ['read', 'act'] }],
  endpoints: { a2a: 'https://example.com/a2a' },
};

const reference: Adapter = {
  agentCard: () => card,
  sampleEntity: (): Entity => ({ id: uuid(1), type: 'entity', kind: 'vehicle', name: 'Family car', attrs: { reg: 'AB12CDE' }, source: 'reference', external_ref: 'veh-1' }),
  sampleActivity: (): Activity => ({ id: uuid(2), type: 'activity', activity_type: 'task', title: 'Renew MOT', due_on: '2026-07-01', status: 'open', source: 'reference', external_ref: 'job-1' }),
  sampleEdge: (): Edge => ({ id: uuid(3), subject: { type: 'entity', id: uuid(1) }, predicate: 'relates_to', object: { type: 'activity', id: uuid(2) }, source: 'reference' }),
  sampleAction: (): Action => ({ id: uuid(4), type: 'renew', summary: 'Renew car insurance with Admiral', payload: {}, requires_confirm: true, status: 'proposed' }),
  acceptsInbound: (data) => validateEntity(data).ok,
};

// a broken adapter — emits an invalid entity and doesn't validate inbound
const broken: Adapter = {
  ...reference,
  sampleEntity: () => ({ id: 'nope', type: 'entity', kind: '', name: '' } as unknown as Entity),
  acceptsInbound: () => true, // never rejects — should fail the TCK
};

function print(label: string, r: ReturnType<typeof runTck>) {
  console.log(`\n${label}: ${r.pass ? 'PASS' : 'FAIL'} (${r.system} @ ${r.version})`);
  for (const c of r.checks) console.log(`  ${c.pass ? 'ok ' : 'XX '} ${c.name}${c.detail && !c.pass ? ' — ' + c.detail : ''}`);
}

const ref = runTck(reference);
const bad = runTck(broken);
print('Reference adapter', ref);
print('Broken adapter', bad);

if (!ref.pass) { console.error('\nFAIL: reference adapter should pass the TCK'); process.exit(1); }
if (bad.pass) { console.error('\nFAIL: broken adapter should NOT pass the TCK'); process.exit(1); }
console.log('\nTCK self-test passed: conformant impls pass, broken impls fail.');
