// → place at:  app/api/agent/token/route.ts   (Next.js App Router)
// POST /api/agent/token — the hub exchanges its one-time code (+ PKCE verifier) for the bearer token.
// Server-to-server; the token then authenticates every A2A call.
import { redeemCode } from '@/lib/agent';   // ← adjust import path to your agent.ts

export async function POST(req: Request) {
  const { code, code_verifier } = await req.json().catch(() => ({} as Record<string, string>));
  const token = (typeof code === 'string' && typeof code_verifier === 'string') ? redeemCode(code, code_verifier) : null;
  if (!token) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json({ access_token: token, token_type: 'bearer' });
}
