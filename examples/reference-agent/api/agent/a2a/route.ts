// POST /api/agent/a2a — the authenticated method endpoint. A hub presents the token you issued it
// and calls one method: { "method": "presence.query" | "activities.query" | "entities.query" |
// "action.execute", ...params }. You answer in Brain Protocol shapes. This is the whole surface.
import { authenticate, handleA2A } from '../../../agent';

export async function POST(req: Request) {
  if (!authenticate(req.headers.get('authorization'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { method, ...params } = await req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof method !== 'string') {
    return Response.json({ error: 'method required' }, { status: 400 });
  }
  const out = handleA2A(method, params);
  return Response.json(out.body, { status: out.status });
}
