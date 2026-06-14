# Brain Protocol reference provider

A small, runnable provider: it publishes a signed agent card, accepts the consumer-initiated
**connect handshake** (BP-03 §6.4), issues a dual-signed grant, and serves a capability
(`notes.read`) under a bearer token plus a per-call proof-of-possession. Copy this folder, swap the
identity, capabilities and data, deploy — and any conformant hub can connect to you.

## Run it

```bash
npm install
npm start          # serves on :8400 (PORT, BP_SYSTEM_ID to override)
npm test           # starts the server and runs the consumer end to end
```

`npm test` connects, reads, and checks that a stolen token (no proof) and an unoffered capability
are both refused.

## What it implements

- **`GET /.well-known/brain-protocol/card.json`** — the signed card (`{ jws, body }`), advertising
  the identity key, protocol version, capabilities and the A2A endpoint (BP-03 §2).
- **`POST /a2a`** — the wire endpoint:
  - `connect.request` → verify the requester's proof-of-possession against its identity key, pin its
    fingerprint, check the requested capabilities are offered, then mint a per-grant key, build the
    grant, sign it (`signatures.grantor`), mint a token, respond `pending_grantee_signature`.
  - `connect.confirm` → verify the consumer's counter-signature; the grant is now in force.
  - capability calls (e.g. `notes.read`) → require the token **and** a fresh per-grant proof; a
    stolen token alone is useless. Serve the answer through your own data and permissions.

## To make it yours

1. **Identity** — replace the boot-time `mint()` with a long-lived Ed25519 key loaded from your
   vault/secret store. Publish its fingerprint so peers can pin it out of band.
2. **Capabilities** — change `offers` and add a handler per capability. `offer`/`read` serves data;
   `offer`/`propose` should land an Action in your own confirm gate (propose-only — never auto-write).
3. **Pinning** — this reference trusts-on-first-use and logs it. In production, confirm the
   consumer's fingerprint out of band (or via the BP-09 registry) before issuing.
4. **Storage** — persist grants and the token **hash** (never the token); destroy keys on disconnect.
5. **Consent** — auto-approve only S0/S1; park S2 and first-contact for a human (BP-03 §6.2, §6.4).

The consumer half lives in `connect-client.mjs` — that is what a hub like Brainfeeder runs.
