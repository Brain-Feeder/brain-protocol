// Reference agent — the smallest complete Brain-Protocol-conformant system. Copy this folder into
// your own product (any stack), point it at your real data, and you can federate with any Brain
// Protocol hub. It passes `npm run conform -- <your-url> <token>`. Nothing here is Brainfeeder-
// specific: a hub discovers your card, negotiates the version, and asks the A2A methods below.
//
// Shapes come from the bundled `protocol.ts` (a mirror of @brainfeed/protocol) so this runs the
// moment you copy it. Once the package is on your registry, swap to: import … from '@brainfeed/protocol'.
import type { AgentCard, Activity, Entity } from './protocol';
import { PROTOCOL_VERSION } from './protocol';

// Issue this token to each hub you let read you (here: one static token from the environment).
// In a real system you'd map a token → tenant and scope it; the shape stays the same.
const TOKEN = process.env.AGENT_ACCESS_TOKEN ?? 'dev-reference-token';
// Recommended safe posture: action.execute is CONFORMANT BUT DARK BY DEFAULT. It returns a valid
// "proposed, not executed" result so you pass conformance and connect read-only first; real side
// effects only happen once a human sets AGENT_ALLOW_WRITES=true after reviewing. Connect, prove
// yourself, THEN enable writes deliberately.
const ALLOW_WRITES = process.env.AGENT_ALLOW_WRITES === 'true';
const SYSTEM_ID = process.env.AGENT_SYSTEM_ID ?? 'reference';
const SYSTEM_NAME = process.env.AGENT_SYSTEM_NAME ?? 'Reference System';

// 1) DISCOVERY — your public agent card. Declares who you are, the protocol version you speak,
//    how to authenticate, and which capabilities a hub may ask for. No secrets here.
export function agentCard(origin: string): AgentCard {
  return {
    system_id: SYSTEM_ID,
    name: SYSTEM_NAME,
    protocol_version: PROTOCOL_VERSION,
    auth: { type: 'bearer', scopes: ['tasks', 'projects', 'presence'] },
    capabilities: [
      { name: 'tasks', verbs: ['read', 'query', 'act'] },   // → activities.query + action.execute
      { name: 'projects', verbs: ['read'] },                 // → entities.query
      { name: 'presence', verbs: ['query'] },                // → presence.query
    ],
    endpoints: { a2a: `${origin}/api/agent/a2a` },
  };
}

// 2) AUTH — a hub presents the token you issued it. Reject everything else.
export function authenticate(authHeader: string | null): boolean {
  const t = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return !!t && t === TOKEN;
}

// --- your real data goes here; this stub returns protocol-valid sample objects --------------------
const uuid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const soon = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

function myActivities(): Activity[] {
  return [
    { id: uuid(1), type: 'activity', activity_type: 'task', title: 'Board pack to finalise', due_on: soon(2), status: 'open', source: SYSTEM_ID, external_ref: 'job-1' },
    { id: uuid(2), type: 'activity', activity_type: 'task', title: 'Sponsor renewal call', due_on: soon(5), status: 'open', source: SYSTEM_ID, external_ref: 'job-2' },
  ];
}
function myEntities(): Entity[] {
  return [
    { id: uuid(10), type: 'entity', kind: 'org', name: 'Acme Client', summary: 'Key account', attrs: { sector: 'retail' }, source: SYSTEM_ID, external_ref: 'client-1' },
  ];
}
function myPresence() {
  return { summary: 'In a client meeting until ~5pm today.', busy_until: '17:00' };
}

// 3) A2A — answer the methods a hub calls. Each returns { result: ... } in Brain Protocol shapes.
//    Read methods are safe; action.execute is the ONLY one with a side effect, and a well-behaved
//    hub only calls it after a human on its side has confirmed.
export interface A2AResult { status: number; body: unknown }

export function handleA2A(method: string, params: Record<string, unknown>): A2AResult {
  switch (method) {
    case 'presence.query':
      return { status: 200, body: { result: myPresence() } };
    case 'activities.query':
      return { status: 200, body: { result: { activities: myActivities() } } };
    case 'entities.query':
      return { status: 200, body: { result: { entities: myEntities() } } };
    case 'action.execute': {
      const a = (params.action ?? {}) as { summary?: string };
      if (!ALLOW_WRITES) {
        // dark by default: valid response, NO side effect — passes conformance, stays safe
        return { status: 200, body: { result: { ok: true, executed: false, result: `Proposed, not executed (writes disabled): ${a.summary ?? 'action'}` } } };
      }
      // writes enabled by a human → perform the real side effect in your system here, then report:
      return { status: 200, body: { result: { ok: true, executed: true, result: `Done in ${SYSTEM_NAME}: ${a.summary ?? 'action'}` } } };
    }
    case 'connection.revoke':
      // a hub is disconnecting and asking you to forget it: invalidate the token you issued it and
      // drop any hub-specific state. (Stub: nothing persisted here.) The reciprocal also holds — if
      // YOU revoke the token a hub holds, its calls will 401 and it must forget your data.
      return { status: 200, body: { result: { ok: true } } };
    default:
      return { status: 400, body: { error: `unknown method '${method}'` } };
  }
}
