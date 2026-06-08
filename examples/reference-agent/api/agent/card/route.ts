// GET /api/agent/card — public discovery. A hub fetches this first to learn what you are and how
// to talk to you. No auth, no secrets. (Next.js App Router shown; the body is plain Web Fetch API,
// so the same three lines port to Express, Hono, Cloudflare Workers, Deno, etc.)
import { agentCard } from '../../../agent';

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json(agentCard(origin), { headers: { 'cache-control': 'public, max-age=300' } });
}
