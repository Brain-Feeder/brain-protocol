# Upgrading a connected system

## token-only → OAuth 2.1 "Connect & Allow"  (additive — no breaking change)

This upgrade is **additive**. The protocol version is unchanged (`0.1.0`), there is **no data
migration**, and **nothing breaks**: a hub that already holds your token keeps working exactly as
before. Adopting OAuth only *adds* the nicer connect experience — the user approves on **your** screen
instead of pasting a token.

### What changed in the kit
- The agent card now advertises `auth.type: "oauth2.1"` with `authorize_url` + `token_url`.
- Two new endpoints: `GET /api/agent/authorize` (a branded consent screen → one-time code) and
  `POST /api/agent/token` (PKCE → bearer token).
- `action.execute` is dark by default (unchanged from the prior kit).

### To adopt (graft two additions into your agent + add two routes + redeploy)

> ⚠️ **Do NOT overwrite your `agent.ts` with the kit's copy.** By now you've customised `agent.ts`
> with your own identity and your real `activities.query` / `entities.query` / `presence.query` data —
> the kit's `agent.ts` is a generic stub and would wipe all of that. Make the two *additive* edits
> below instead. (Only if your `agent.ts` is still the untouched reference may you re-copy it wholesale.)

1. **`protocol.ts` — safe to re-copy.** It's shared vocabulary/types, not customised. The new version
   widens the card's `auth` type to allow `authorize_url` / `token_url` / `scopes`. Overwrite it.

2. **`agent.ts` — make two additive edits, don't overwrite:**

   **(a) Change the card's `auth` field.** Find:
   ```ts
   auth: { type: 'bearer', scopes: ['tasks', 'projects', 'presence'] },
   ```
   and replace with (mirror however your `agentCard` builds its `a2a` URL for `origin`):
   ```ts
   auth: { type: 'oauth2.1', authorize_url: `${origin}/api/agent/authorize`, token_url: `${origin}/api/agent/token`, scopes: ['tasks', 'projects', 'presence'] },
   ```

   **(b) Add the three functions the new routes call.** Add to the imports at the top:
   ```ts
   import { createHash, randomBytes } from 'crypto';
   ```
   and paste this at the bottom of `agent.ts` (it reuses your existing `TOKEN` and `SYSTEM_NAME`):
   ```ts
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
     return TOKEN;
   }
   export function consentHtml(q: URLSearchParams): string {
     const scope = q.get('scope') ?? '';
     const items = scope.split(/\s+/).filter(Boolean).map(s => `<li>${s}</li>`).join('') || '<li>basic access</li>';
     const approve = new URLSearchParams(q); approve.set('approve', '1');
     const deny = `${q.get('redirect_uri') ?? ''}?error=access_denied&state=${encodeURIComponent(q.get('state') ?? '')}`;
     return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize</title>
   <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:12vh auto;padding:24px;color:#1d1d1f}
   h1{font-size:20px;margin:0 0 4px}ul{color:#424245;line-height:1.7}.note{color:#86868b;font-size:13px}
   .b{display:inline-block;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px}
   .allow{background:#0071e3;color:#fff}.deny{color:#6e6e73}</style></head><body>
   <h1>${SYSTEM_NAME}</h1><p><b>Brainfeeder</b> wants to connect and access:</p>
   <ul>${items}</ul>
   <p class="note">Read-only, and you can disconnect at any time.</p>
   <p><a class="b allow" href="/api/agent/authorize?${approve.toString()}">Allow</a>
   &nbsp;<a class="b deny" href="${deny}">Deny</a></p></body></html>`;
   }
   ```
   (You can copy these verbatim from the kit's `agent/agent.ts` — they're the OAuth section at the bottom.)

3. **Add the two new route files** from `agent/api/agent/`: `authorize/route.ts` →
   `app/api/agent/authorize/route.ts`, and `token/route.ts` → `app/api/agent/token/route.ts`. Fix the
   import path at the top of each (`@/lib/agent`) to wherever your `agent.ts` lives.

4. **No new env vars.** `AGENT_ACCESS_TOKEN` is now the bearer your agent *issues after consent* (and
   still works as a direct dev token).

5. **(Real system)** gate the `/api/agent/authorize` consent screen behind your own login, and brand
   it — it's a page your users see.

6. **Deploy** (push/redeploy — local edits don't change the live site), then **verify the live card
   flipped**: fetch `https://your-system/api/agent/card` and confirm `"type": "oauth2.1"` with
   `authorize_url`/`token_url`. A green `conform` PASS alone does **not** prove this — a bearer card
   still passes conformance, so always eyeball the live card's `auth` block. Finally re-run
   `npm run conform -- <your-url> <token>` → still **PASS**.

### Notes
- **No version negotiation impact** — `protocol_version` is still `0.1.0`; older hubs that only know
  the token path are unaffected and use it.
- The reference code keeps pending authorization codes **in memory** (fine for a demo). A production
  system persists them, short-lived, and rate-limits the authorize/token endpoints.
- Per `ARCHITECTURE.md`, OAuth also hands you verified identity + scoped consent + revocation, which
  retire several of the manual-token's rough edges.
