# Trusted-hub consent — approve entirely inside the hub (no redirect)

Most systems should use OAuth "Connect & Allow" (the user approves on *your* domain). But for a hub you
**explicitly trust** — your own products, or a partner you have an agreement with — you can let the user
approve **inside the hub** and skip the redirect/popup entirely. The handshake, the Allow screen, and
the confirmation all happen on the hub's page; your system just mints a token over a server-to-server
call. This is opt-in and trust-scoped: an unknown hub cannot use it.

## When to use it
- ✅ The hub and your system are the **same owner** (e.g. TPMS ↔ Brainfeeder), or you have a deliberate
  trust relationship.
- ❌ Arms-length third parties. They can't verify the user actually consented — keep them on OAuth.

## How the trust works
You issue the hub a **shared secret**. The hub presents it on a server-to-server call to your grant
endpoint; you verify it and return a token. The secret lives only on both servers — it never touches a
browser. If you stop trusting the hub, rotate the secret and its tokens stop working.

## To enable it (≈ one endpoint + a card change + a shared secret)
1. **Add the grant function + route** from the kit: `hubGrant()` is already in `agent.ts`; copy
   `agent/api/agent/grant/route.ts` → `app/api/agent/grant/route.ts` (fix the import path).
2. **Set a shared secret**: `HUB_GRANT_SECRET=<a strong random string>` in your env. Give the *same*
   value to the hub (in Brainfeeder: `HUB_TRUSTED_SECRETS={"<your-system-id>":"<that secret>"}`).
3. **Switch your card's `auth`** to advertise hub_consent:
   ```ts
   auth: { type: 'hub_consent', grant_url: `${origin}/api/agent/grant`, scopes: ['tasks','projects','presence'] },
   ```
4. **Deploy.** In the hub, connecting your system now stays fully in-app: handshake animation → Allow +
   scopes → connected, no redirect.

## The contract
`POST <grant_url>` with header `Authorization: Bearer <shared-secret>` and JSON body `{ "scopes": [...] }`
→ `200 { "access_token": "...", "scopes": [...] }` on success, `403` if the secret is wrong. The
returned token is the bearer the hub uses on every A2A call (same as the OAuth/token paths).

## Notes
- **No protocol-version bump** — `hub_consent` is just another `auth.type`; hubs that don't recognise it
  fall back to OAuth/token.
- The reference returns the static `AGENT_ACCESS_TOKEN`. A production system should mint a
  **per-connection, revocable** token here and record which hub holds it (so disconnect/forget is enforceable).
- Conformance still passes on OAuth; hub_consent is an additional, opt-in path.
