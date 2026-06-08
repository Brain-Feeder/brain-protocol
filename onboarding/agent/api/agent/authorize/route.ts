// → place at:  app/api/agent/authorize/route.ts   (Next.js App Router)
// GET /api/agent/authorize — the "Allow" screen a hub sends the user to. Renders consent; on Allow
// (approve=1) it issues a one-time code and redirects back to the hub's redirect_uri with code+state.
// A real system would require the user to be logged in here BEFORE showing consent.
import { consentHtml, issueCode } from '@/lib/agent';   // ← adjust import path to your agent.ts

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const redirect = q.get('redirect_uri');
  if (!redirect) return new Response('missing redirect_uri', { status: 400 });

  if (q.get('approve') === '1') {
    const code = issueCode(q.get('code_challenge') ?? '', q.get('scope') ?? '');
    const u = new URL(redirect);
    u.searchParams.set('code', code);
    u.searchParams.set('state', q.get('state') ?? '');
    return Response.redirect(u.toString(), 302);
  }
  return new Response(consentHtml(q), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
