# Integration notes — what the Brainfeeder hub sends (OAuth 2.1 "Connect & Allow")

If you're implementing the OAuth flow against the Brainfeeder hub, these are the exact contracts the
hub uses, so you can match and lock down your side. All of it is derived from the hub's own client
(`app/lib/server/oauth.ts` + `app/app/api/systems/oauth/*`). Nothing here changes the protocol — it's
the concrete shape of the kit's OAuth flow.

## 1. Redirect / callback URL (allow-list these)
The **path is always** `/api/systems/oauth/callback`. The **host is derived at runtime from whichever
Brainfeeder deployment the user is on when they connect** — so the same hub will send different
`redirect_uri` values from production vs. staging vs. a preview build. Allow-list the **full set**, not
just production:

```
https://brainfeeder.ai/api/systems/oauth/callback          ← canonical PRODUCTION (real connections)
https://dev.brainfeeder.ai/api/systems/oauth/callback       ← staging
https://brainfeeder.vercel.app/api/systems/oauth/callback   ← raw Vercel deploy domain (preview/testing)
```

- **`brainfeeder.ai` is canonical production** — real end-user connections originate there. The other
  two are for testing; keep them allow-listed but treat `brainfeeder.ai` as primary.
- The hub sends `redirect_uri` **both** in the authorize redirect **and** again in the token exchange;
  they're identical, so one allow-list entry covers both.
- Match **character-for-character**: scheme, host, path, no trailing slash.

> **Troubleshooting `invalid/unregistered redirect_uri`:** this means the host the user connected from
> isn't on your allow-list. Don't guess — read the actual `redirect_uri` query param on the authorize
> request that failed and allow-list **that exact host** (it's almost always a preview/staging domain
> like `*.vercel.app` you hadn't listed). This is the single most common first-connect snag.

## 2. Authorize request (what the hub sends the user to)
`GET <your authorize_url>?` with query params:

| param | value |
|---|---|
| `response_type` | `code` |
| `client_id` | `brainfeeder` (public string; **no secret**) |
| `redirect_uri` | `https://<hub-host>/api/systems/oauth/callback` |
| `scope` | the capability names from your card, space-joined (e.g. `tasks projects presence`) |
| `state` | opaque, single-use, unguessable — **echo it back unchanged** |
| `code_challenge` | `base64url(sha256(code_verifier))` |
| `code_challenge_method` | `S256` |

On approval, redirect back to `redirect_uri` with `?code=...&state=...`.
On denial, redirect back with `?error=access_denied&state=...`.

## 3. Token exchange (what the hub POSTs to your token_url)
`POST <your token_url>` with **`Content-Type: application/json`** (not form-urlencoded) and body:
```json
{
  "grant_type": "authorization_code",
  "client_id": "brainfeeder",
  "redirect_uri": "https://<hub-host>/api/systems/oauth/callback",
  "code": "...",
  "code_verifier": "..."
}
```
- **There is no `client_secret`.** `client_id` is the public string `brainfeeder`; validate it if you
  wish, but there's nothing secret to check.
- **Read the body as JSON.** The most common interop bug is a `/token` handler that only parses
  form-encoded bodies — the hub sends JSON. The kit reference does `await req.json()`.
- Respond `200` with `{ "access_token": "...", "token_type": "bearer" }`. The hub reads
  `access_token` only.

## 4. PKCE
Authorization-code + **PKCE S256**. Verify `base64url(sha256(code_verifier)) === code_challenge` before
issuing the token. Treat the `code` as single-use and short-lived (the reference: 5-minute expiry).

## 5. Access token — prefer per-connection + revocable
The hub stores the returned `access_token` and sends it as `Authorization: Bearer <token>` on every
A2A call. A single shared token works, but **mint a per-connection, revocable token** if you can — it's
what makes `connection.revoke` and forget-on-disconnect enforceable: when you invalidate that token,
the hub's calls start 401ing and it drops your data. A shared secret can't be revoked per-hub.

## 6. Token lifetime / refresh
The hub does **not** implement refresh yet — it ignores `expires_in` / `refresh_token`. So:
- **Long-lived tokens are correct for v1.**
- The hub treats a **401 on any A2A call as revocation** and forgets the connection. Don't expire
  tokens on a timer until refresh ships, or a connected hub will silently drop mid-session. Expire only
  when you intend to disconnect.

## Don't trust a green `conform` for this
A bearer-auth card still passes conformance. After you deploy the OAuth change, **eyeball the live
card**: `GET https://<your-system>/api/agent/card` must show
`"auth": { "type": "oauth2.1", "authorize_url": "...", "token_url": "..." }`. If it still says
`"type": "bearer"`, your new `agent.ts` isn't deployed yet — see `UPGRADING.md`.
