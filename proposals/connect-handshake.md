# Proposal: the connect handshake (consumer-initiated grant establishment)

Status: **folded into BP-03 §6.4 + AC-03.6 (2026-06-13)** — the normative text now lives in the spec;
this document is kept as the design rationale. Additive, MINOR (new wire methods, no change to the
grant document, the four primitives, or any law). Awaiting editorial/council sign-off and the Class A
kit tests for AC-03.6. Editor: Peter McCormack.

## Why

BP-03 §6.1 describes consent as "a human of the grantor's space initiates," and §5.3 fixes the grant
document, but nothing defines the **wire exchange** by which a consumer asks to connect and a grantor
issues a grant. In practice the experience must be: a system (or its human) asks to connect to another;
the grantor consents (automatically by policy, or via a human gate); grants are issued; data can flow.
Without a defined handshake every connection is a manual, out-of-band paste of signed documents. This
proposal defines that handshake. It changes no law: writes stay propose-only, secrets stay vaulted,
grants stay dual-signed and default-deny, and S2 still requires elevated consent.

## Roles

- **Consumer** — the system that wants to read/propose (here, the Brainfeeder hub).
- **Grantor** — the system that owns the capability and issues the grant (here, TPMS, which offers
  `calendar.read`). The grantor is always the one that consents; asking is not granting.

Both sides MUST have a long-lived identity key (BP-03 §4) and SHOULD publish a signed card (§2). The
consumer is a named, signature-bearing party — not an anonymous caller.

## The exchange (three signed A2A messages)

All three are normal BP-04 §2 envelopes, each carrying a proof-of-possession JWS. The
`connect.request`/`connect.confirm` PoP is signed by the **consumer's identity key** (it is proving who
it is, before any per-grant key is trusted); later capability calls use the per-grant key as usual.

### 1. `connect.request` — consumer → grantor

```jsonc
{ "method": "connect.request",
  "body": {
    "requester": { "system_id": "brainfeeder-mccormack",
                   "card_url": "https://brainfeeder.../.well-known/brain-protocol/card.json" },
    "capabilities": [ { "capability": "calendar.read", "mode": "read" } ],
    "member_hint": "peter",                 // who, in the grantor's terms; grantor resolves the lens
    "grantee_public": { "kid": "g-bf-1", "kty": "OKP", "crv": "Ed25519", "x": "…" },
    "requested_visibility_ceiling": "private",
    "nonce": "…", "issued_at": "2026-06-13T…Z" } }
```

The grantor MUST fetch and verify the requester's card (§2.3), and on first contact MUST pin the
requester's identity fingerprint — out of band, or trust-on-first-use surfaced to the grantor's human
for confirmation (operator policy). A request for a capability the grantor does not `offer`, or in a
mode it does not offer, is refused `cell_denied`.

### 2. `connect.issue` — grantor → consumer (response)

The grantor runs consent: **auto-approve by policy for S0/S1**, or park `needs_human(consent_required)`
for S2 or first-time connections (BP-08). On approval it mints its per-grant key, mints `grant_id`,
builds the grant document (matrix = approved cells, `member_lens` resolved, `action_execute: "dark"`,
both per-grant public keys in `keys`), signs `signatures.grantor` with its identity key over the
canonical body, and mints a token.

```jsonc
{ "method": "connect.issue",
  "body": {
    "grant": { /* full BP-03 §5.3 grant doc, signatures.grantor present, signatures.grantee absent */ },
    "token": "…",                           // shown once; grantor stores only its SHA-256 hash (§8.2)
    "state": "pending_grantee_signature" } }
```

If consent parks, the response is `state: "needs_human"` with a `needs_human` block (BP-08); the consumer
polls or is notified, and the issue completes once the grantor's human approves.

### 3. `connect.confirm` — consumer → grantor

The consumer verifies the issued grant: grantor signature valid against the **pinned** card key; the
`grantee_public` is exactly the key it minted; the matrix is a subset of what it requested; no
`write-direct` cell; `action_execute` is `dark`; `member_lens` present (a child lens is refused, §6.3).
It then signs `signatures.grantee` over the same canonical body with its identity key, stores the
HeldGrant (per-grant private key + token + grant doc) behind the vault wall, and confirms:

```jsonc
{ "method": "connect.confirm",
  "body": { "grant_id": "urn:brain:tpms:grant:…", "grantee_signature": "eyJ…" } }
```

The grantor attaches the grantee signature; the grant is now dual-signed and **in force** (§5.4, §7.1)
and the token is activated. Both sides journal `connect`.

## After connect

The consumer makes capability calls (e.g. `calendar.read`) with the token + per-grant PoP (BP-04 §2);
nothing about live query, sync, propose-only, errors, or 401-as-disconnect changes. Disconnect/forget is
unchanged (BP-03 §7.4, BP-04 §8): revoking destroys keys and the connection's data audits to zero.

## Invariant check

No new primitive. Writes remain propose-only (this establishes read/propose grants only; it never
grants `write-direct`). Secrets (per-grant keys, token) stay vaulted. It works in a mesh — any consumer
can connect to any grantor that offers a capability, with no central hop. Default-deny holds: an
unrequested or unoffered cell never appears in the issued matrix.

## Failure modes

- Card/identity verify fails, or fingerprint unpinned → abort before issue (`invalid_signature` /
  `fingerprint_unpinned`).
- Requested capability not offered / wrong mode → `cell_denied`.
- Consent declined or parked-then-rejected → `connect_declined`; no grant, no keys retained.
- S2 requested without elevated consent path → parks `needs_human`; never auto-issues (§6.2).
- `connect.confirm` never arrives → the issued-but-unconfirmed grant expires (grantor TTL, SHOULD ≤ 1h);
  no half-open grant lingers.

## Conformance

Adds Class A handshake tests (consumer initiates, grantor issues, both signatures verified, declined
path, S2-parks path). Class D providers that only serve under a pre-installed grant are unaffected.
