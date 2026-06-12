# The conformance registry (v0)

*Implements BP-09 §4. A signed, append-only, publicly-readable record of conformance attestations,
hosted from this repository. It records what systems attest; it observes nothing (CD-3) — there is
no telemetry, no callback, no tracking. Anyone can verify it; only the maintainer can sign it.*

## What this is

A conformant system's published TCK results are *evidence*; a **registry entry** referencing them
is what makes a conformance *claim* legitimate (BP-09 §3.1, §3.3). Without an entry, "Brain Protocol
v2 Class D self-certified" is non-conformant marketing. This registry is the missing piece: the
place a system's attestation lives, signed so it can't be forged and chained so its history can't be
quietly rewritten.

- `registry.json` — the signed, append-only event log and the registry public key. Current state is
  a fold of the events; a status change (suspend, revoke) is a **new event**, never an overwrite
  (BP-09 §4.1).
- `keys/registry-key.pub.json` — the registry public key. Committed; anyone uses it to verify.
- `keys/registry-key.priv.json` — the private key. **Git-ignored; the maintainer's custody.** Set
  `BRAIN_REGISTRY_KEY=/path/to/priv.json` to sign from elsewhere.
- `schemas/registry-entry.schema.json` (repo root) — the normative entry shape (BP-09 §4.1).
- `examples/` — an example entry showing the shape a registering system submits.

## Integrity model

Each event is hash-chained to its predecessor (`prev_hash`) and the hash is signed by the registry
key. `verify` checks, for the whole file: the chain links unbroken, every event's content matches
its hash (tamper detection), every signature is valid, every folded entry validates against the
schema, and the CD-2 invariant holds (any S2 capability ⇒ verified certification). Tampering with a
stored entry — even one field — breaks its hash and fails verification. CI runs `verify` on every
push, so a malformed or tampered registry cannot land.

## Using it

```bash
cd registry && npm install

# one-time, maintainer only — mint the registry key (public committed, private kept secret)
npx tsx src/cli.ts keygen

# add a system that has published conformant results (validated, then signed + chained)
npx tsx src/cli.ts register path/to/their-entry.json

# change a system's status later — appended as a new event, history preserved
npx tsx src/cli.ts status <system_id> suspended
REASON="upheld dispute, see evidence" EVIDENCE_URL=https://… npx tsx src/cli.ts status <system_id> revoked

# verify the whole registry (the CI gate) / print current entries
npx tsx src/cli.ts verify
npx tsx src/cli.ts show
```

## How a system registers (the self-certification path, Class D)

1. Pass the Class D suite 46/46 and **publish your `results.json`** at a stable URL.
2. Serve your signed agent card at your well-known path; have your identity-key fingerprint
   verified out of band (BP-03 §2.3.3 — the one legitimate manual step).
3. Submit an entry (see `examples/`) with your `card_url`, pinned `card_key_fingerprint`, class,
   suite version, and `results_url`. The maintainer validates it, then signs it into the registry.
4. Your claim is now live and backed: *"Brain Protocol v2 Class D self-certified, suite 2.0.1."*

Verified certification (Classes A/H, or any S2 capability at any class) additionally requires the
editor's signature plus a certified Class H peer's, recorded in the entry's `certification.signatures`
(BP-09 §3.1). That path opens once a Class H system is itself verified.

## Status

**v0, live, empty.** The registry exists with its key and zero entries — ready for the first system
to publish results and register. Hosting note (BP-09 §7): served from this repository's
infrastructure at v2.0; the key and the append-only history carry over if hosting ever moves.
