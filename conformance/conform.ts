// Live conformance runner (BRAIN_PROTOCOL.md §9.2). Point it at ANY independent system's URL and
// it checks, over the network, that the system really speaks the protocol: a valid agent card, a
// compatible version, authentication that actually rejects, and A2A responses that validate against
// the shared vocabulary. This is how a system you've never met proves it can connect — no trust,
// just the wire.
//
//   npm run conform -- https://my-system.example <access-token>
//
// Exit 0 = conformant (safe to connect). Exit 1 = not yet. Read-only: it never calls action.execute.
import { validateAgentCard, validateActivity, validateEntity, negotiate, PROTOCOL_VERSION } from '../src/validate.js';
import type { AgentCard } from '../src/types.js';

const [, , baseArg, token] = process.argv;
if (!baseArg) {
  console.error('usage: npm run conform -- <base_url> [access_token]');
  process.exit(2);
}
const origin = new URL(baseArg).origin;
const TIMEOUT = 9000;

interface Check { name: string; pass: boolean; detail?: string }
const checks: Check[] = [];
const ok = (name: string, cond: boolean, detail?: string) => checks.push({ name, pass: !!cond, detail });

async function http(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(`${origin}${path}`, { ...init, signal: ac.signal, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: { error: (e as Error).message } };
  } finally { clearTimeout(t); }
}
const a2a = (method: string, withToken = true) => http('/api/agent/a2a', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(withToken && token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ method }),
});

async function main() {
  // 1) discovery — the card is reachable, valid, and a compatible major version
  const card = await http('/api/agent/card');
  const cv = validateAgentCard(card.body);
  ok('agent card reachable + valid', card.status === 200 && cv.ok, card.status !== 200 ? `HTTP ${card.status}` : cv.errors?.join('; '));
  const ac = cv.value as AgentCard | undefined;
  ok('protocol major matches kit', !!ac && ac.protocol_version.split('.')[0] === PROTOCOL_VERSION.split('.')[0],
    ac ? `card ${ac.protocol_version} vs kit ${PROTOCOL_VERSION}` : undefined);
  const neg = ac ? negotiate(PROTOCOL_VERSION, ['tasks', 'projects', 'presence'], ac) : null;
  ok('negotiates a common version', !!neg?.compatible, neg?.reason);

  // 2) authentication actually rejects an unauthenticated call
  const noauth = await a2a('presence.query', false);
  ok('rejects unauthenticated A2A', noauth.status === 401 || noauth.status === 403, `got HTTP ${noauth.status}`);

  if (!token) {
    ok('token provided for authed checks', false, 'pass a token as the 2nd arg to test the A2A methods');
  } else {
    // 3) presence — narrow, computed answer
    const p = await a2a('presence.query');
    ok('presence.query returns a summary', p.status === 200 && typeof p.body?.result?.summary === 'string', `HTTP ${p.status}`);

    // 4) activities — returns a list, and every item validates against the vocabulary
    const act = await a2a('activities.query');
    const list: unknown[] = Array.isArray(act.body?.result?.activities) ? act.body.result.activities : [];
    ok('activities.query returns activities', act.status === 200 && list.length > 0, `HTTP ${act.status}, ${list.length} items`);
    const bad = list.map(validateActivity).find(r => !r.ok);
    ok('every activity validates', list.length > 0 && !bad, bad?.errors?.join('; '));

    // 5) entities — optional capability; if offered, every item must validate
    const ent = await a2a('entities.query');
    if (ent.status === 200) {
      const el: unknown[] = Array.isArray(ent.body?.result?.entities) ? ent.body.result.entities : [];
      const badE = el.map(validateEntity).find(r => !r.ok);
      ok('every entity validates (entities offered)', !badE, badE?.errors?.join('; '));
    }

    // 6) an unknown method is rejected at the boundary
    const bogus = await a2a('definitely.notamethod');
    ok('rejects unknown method', bogus.status >= 400, `got HTTP ${bogus.status}`);
  }

  const pass = checks.every(c => c.pass);
  console.log(`\nBrain Protocol conformance — ${origin}`);
  console.log(`system: ${ac?.name ?? '?'} (${ac?.system_id ?? '?'}) @ ${ac?.protocol_version ?? '?'}  ·  kit ${PROTOCOL_VERSION}\n`);
  for (const c of checks) console.log(`  ${c.pass ? 'ok ' : 'XX '} ${c.name}${c.detail && !c.pass ? '  — ' + c.detail : ''}`);
  console.log(`\n${pass ? 'PASS — conformant. Safe to connect.' : 'FAIL — not conformant yet. Fix the XX lines above.'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('conformance run errored:', e); process.exit(2); });
