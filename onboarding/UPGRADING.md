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

### To adopt (≈ copy two files + redeploy)
1. **Re-copy** `agent/agent.ts` and `agent/protocol.ts` from the kit (they gained the OAuth helpers
   and the `authorize_url`/`token_url` card fields).
2. **Add the two new route files** from `agent/api/agent/`: `authorize/route.ts` →
   `app/api/agent/authorize/route.ts`, and `token/route.ts` → `app/api/agent/token/route.ts`. Fix the
   import paths to wherever your `agent.ts` lives.
3. **No new env vars.** `AGENT_ACCESS_TOKEN` is now the bearer your agent *issues after consent* (and
   still works as a direct dev token).
4. **(Real system)** gate the `/api/agent/authorize` consent screen behind your own login, and brand
   it — it's a page your users see.
5. **Deploy, then re-run** `npm run conform -- <your-url> <token>` → still **PASS**.

### Notes
- **No version negotiation impact** — `protocol_version` is still `0.1.0`; older hubs that only know
  the token path are unaffected and use it.
- The reference code keeps pending authorization codes **in memory** (fine for a demo). A production
  system persists them, short-lived, and rate-limits the authorize/token endpoints.
- Per `ARCHITECTURE.md`, OAuth also hands you verified identity + scoped consent + revocation, which
  retire several of the manual-token's rough edges.
