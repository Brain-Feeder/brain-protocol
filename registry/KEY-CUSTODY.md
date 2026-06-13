# Registry key custody

The registry signing key is the authority behind every conformance attestation: the public key
(committed) is what anyone uses to verify the chain, and the private key is what signs each event.
Forge the private key and you can fake an entry, which destroys the one artifact whose entire value
is that it cannot be faked. So custody is a real control, not housekeeping. Convention: hyphens not
em dashes, sentence case.

## The rules

1. **The private key is never committed.** It is git-ignored (`registry/keys/.gitignore`). Only the
   public key (`registry/keys/registry-key.pub.json`) is in the repo, and it is the verification
   anchor.
2. **The private key lives in one non-synced local file, never committed or synced.** Its home is
   `~/.config/brain-registry/registry-key.priv.json` (mode 600) — a folder iCloud/Dropbox do not
   sync. The CLI reads it via `BRAIN_REGISTRY_KEY`. It is never in the repo tree, never under
   `~/Documents` or any synced path, never committed (git-ignored). It is backed up to the
   maintainer's password manager (a secure note) plus one encrypted offline copy.
3. **The private key is never in CI.** CI only ever runs `verify`, which needs the public key alone.
   If CI could sign, CI could forge. Signing is a deliberate, local, maintainer act.
4. **It is backed up, encrypted, in two places.** A password-manager secure note plus one offline
   encrypted copy (e.g. an encrypted USB). Loss of the laptop must not lose the key.
5. **Signing is manual.** `register` and `status` are run by the maintainer, by hand, against a
   reviewed entry. There is no automated path that signs.

## Recovery and rotation

- **If the laptop dies (key lost, not leaked):** the committed public key still verifies all history.
  To register anything new you must rotate (below) and publish the new public key.
- **If the key is leaked (or custody is ever in doubt):** rotate immediately and announce.
- **Rotation procedure:**
  - *While the registry is empty (no events):* regenerate with `keygen`, commit the new
    `registry-key.pub.json`, and re-initialise `registry.json` so its embedded key matches the new
    one. Zero historical events means zero re-signing. This is the cheap window.
  - *Once the registry has events:* rotation is a one-way door. Historical events stay signed by the
    old key; new events are signed by the new key; `verify` must then accept the prior key for
    historical events and the current key going forward, recorded as an explicit, signed
    key-transition event. Design and ratify that transition before rotating a non-empty registry.

## Current state (2026-06-13)

A fresh registry key was minted on 2026-06-13 and lives at
`~/.config/brain-registry/registry-key.priv.json` (non-synced, mode 600), with `BRAIN_REGISTRY_KEY`
pointing the CLI at it; it is backed up to the maintainer's password manager. The prior keys had only
ever lived in the local/Documents tree (possibly iCloud-synced); minting fresh while the registry was
empty cost nothing and retires them, so any synced copies are now worthless. The new public key is
committed (`keys/registry-key.pub.json`) and embedded in `registry.json`; the registry is v0, live,
empty. The public key and the append-only history carry over if hosting ever moves (BP-09 §7).
