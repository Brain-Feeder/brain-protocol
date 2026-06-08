// Reference agent — the smallest complete Brain-Protocol-conformant system. Copy this folder into
// your own product (any stack), point it at your real data, and you can federate with any Brain
// Protocol hub. It passes `npm run conform -- <your-url> <token>`. Nothing here is Brainfeeder-
// specific: a hub discovers your card, negotiates the version, and asks the A2A methods below.
//
// Shapes come from the bundled `protocol.ts` (a mirror of @brainfeed/protocol) so this runs the
// moment you copy it. Once the package is on your registry, swap to: import … from '@brainfeed/protocol'.
import { createHash, randomBytes } from 'crypto';
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
    // OAuth 2.1 "Connect & Allow": the hub sends the user to authorize_url to log in + approve, then
    // exchanges the returned code at token_url for the bearer token used on every A2A call.
    auth: { type: 'oauth2.1', authorize_url: `${origin}/api/agent/authorize`, token_url: `${origin}/api/agent/token`, scopes: ['tasks', 'projects', 'presence'] },
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

// 4) OAuth 2.1 "Connect & Allow" (authorization-code + PKCE). The hub sends the user to the consent
//    screen below; on approval you issue a one-time code; the hub swaps it for the bearer token.
//    Reference store is in-memory (fine for a demo); a real system persists codes, short-lived.
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codes = new Map<string, { challenge: string; scope: string }>();

export function issueCode(challenge: string, scope: string): string {
  const code = b64url(randomBytes(24));
  codes.set(code, { challenge, scope });
  setTimeout(() => codes.delete(code), 5 * 60_000);   // expire in 5 minutes
  return code;
}

export function redeemCode(code: string, verifier: string): string | null {
  const rec = codes.get(code);
  if (!rec) return null;
  codes.delete(code);                                  // single use
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  if (challenge !== rec.challenge) return null;        // PKCE check
  return TOKEN;                                         // the bearer token the hub will use on A2A
}

// The consent screen the user is redirected to. A REAL system gates this behind its own login first
// (so the user is authenticated before approving); the reference skips login for the demo.
export function consentHtml(q: URLSearchParams): string {
  const scope = q.get('scope') ?? '';
  const client = (q.get('client_id') ?? 'A hub').replace(/[<>&]/g, '');     // who's asking (e.g. "brainfeeder")
  const hub = client.charAt(0).toUpperCase() + client.slice(1);
  const items = (scope.split(/\s+/).filter(Boolean).length ? scope.split(/\s+/).filter(Boolean) : ['basic access'])
    .map(s => `<li><svg viewBox="0 0 24 24" class="ck"><path d="M5 12l4 4 10-10"/></svg><span>${s}</span></li>`).join('');
  const approve = new URLSearchParams(q); approve.set('approve', '1');
  const deny = `${q.get('redirect_uri') ?? ''}?error=access_denied&state=${encodeURIComponent(q.get('state') ?? '')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize · ${SYSTEM_NAME}</title>
<style>
  :root{--ink:#1d1d1f;--ink2:#6e6e73;--line:#ececf0;--accent:#0071e3}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:var(--ink);
    display:grid;place-items:center;padding:24px;
    background:radial-gradient(1000px 600px at 15% -10%,#dbe7ff 0,rgba(219,231,255,0) 60%),
      radial-gradient(900px 600px at 100% 0,#ffe2d6 0,rgba(255,226,214,0) 55%),
      radial-gradient(900px 700px at 70% 110%,#e6dcff 0,rgba(230,220,255,0) 60%),linear-gradient(180deg,#f4f7fc,#f7f4f1)}
  .card{width:100%;max-width:400px;background:rgba(255,255,255,.72);backdrop-filter:blur(28px) saturate(1.4);
    -webkit-backdrop-filter:blur(28px) saturate(1.4);border:1px solid rgba(255,255,255,.7);border-radius:24px;
    padding:28px 26px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 20px 60px rgba(31,56,100,.16);text-align:center}
  .meet{display:flex;align-items:center;justify-content:center;gap:0;margin:2px 0 18px}
  .orb{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;
    box-shadow:0 4px 14px rgba(0,0,0,.16);z-index:1}
  .orb.hub{background:radial-gradient(circle at 38% 32%,#d4e6ff,#4a86ff 44%,#1846c4)}
  .orb.sys{background:radial-gradient(circle at 38% 32%,#cfeede,#46c486 46%,#1f7a4d);margin-left:-8px}
  .wire{width:46px;height:2px;background:linear-gradient(90deg,#4a86ff,#1f7a4d);position:relative;z-index:0;border-radius:2px}
  .wire::after{content:"";position:absolute;top:50%;left:50%;width:7px;height:7px;margin:-3.5px;border-radius:50%;
    background:#fff;box-shadow:0 0 0 2px rgba(74,134,255,.5);animation:run 1.4s linear infinite}
  @keyframes run{0%{left:6%}100%{left:94%}}
  h1{font-size:21px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:var(--ink2);font-size:13.5px;margin:0 0 18px;line-height:1.45}
  ul{list-style:none;padding:0;margin:0 0 18px;text-align:left}
  li{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:7px;
    font-size:14px;font-weight:500;text-transform:capitalize;background:rgba(255,255,255,.6)}
  .ck{width:17px;height:17px;flex-shrink:0;fill:none;stroke:#1f7a4d;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .note{color:#86868b;font-size:12px;margin:0 0 18px}
  .b{display:block;width:100%;padding:13px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;border:none;cursor:pointer}
  .allow{background:var(--accent);color:#fff;box-shadow:0 6px 16px rgba(0,113,227,.32)}
  .allow:hover{background:#0062c4}
  .deny{background:transparent;color:var(--ink2);margin-top:6px;font-size:13.5px;font-weight:500}
</style></head><body>
  <div class="card">
    <div class="meet"><div class="orb hub">${hub.charAt(0)}</div><div class="wire"></div><div class="orb sys">${SYSTEM_NAME.charAt(0)}</div></div>
    <h1>Connect to ${SYSTEM_NAME}?</h1>
    <p class="sub"><b>${hub}</b> wants to connect and read:</p>
    <ul>${items}</ul>
    <p class="note">Read-only · you can disconnect at any time and ${SYSTEM_NAME} is forgotten.</p>
    <a class="b allow" href="/api/agent/authorize?${approve.toString()}">Allow</a>
    <a class="b deny" href="${deny}">Not now</a>
  </div>
</body></html>`;
}
