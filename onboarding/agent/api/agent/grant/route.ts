// → place at:  app/api/agent/grant/route.ts   (Next.js App Router)
// POST /api/agent/grant — trusted-hub consent (HUB-CONSENT.md). A hub you trust has collected the
// user's consent in its own UI and now mints a token over this server-to-server call, authenticated
// with the shared secret you issued it. No browser, no redirect. Only enable this for trusted hubs.
import { hubGrant } from '@/lib/agent';   // ← adjust import path to your agent.ts

export async function POST(req: Request) {
  const { scopes } = await req.json().catch(() => ({} as Record<string, unknown>));
  const out = hubGrant(req.headers.get('authorization'), Array.isArray(scopes) ? scopes as string[] : []);
  if (!out) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json(out);
}
