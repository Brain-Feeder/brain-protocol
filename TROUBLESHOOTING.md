# Troubleshooting — where providers actually get stuck

Every entry below is a real problem hit during a live provider onboarding, not a hypothetical.
Each is **symptom → cause → fix**. If you're stuck, scan the symptoms first.

Start at [PROVIDERS.md](./PROVIDERS.md); pass the kit from [kit/README.md](./kit/README.md); the laws
are in [v2/](./v2/).

---

## Connecting

### `no_member_lens` when a hub connects to you
**Symptom:** a consumer's connect fails with `no_member_lens`; their side refuses the grant.
**Cause:** your node returned a grant with no `member_lens`. A grant MUST bind exactly one member
(BP-03 §5.4.2) — even for public S0 data. You have no approved member binding for the consumer's
`(grantee_system_id, member_hint)`, so you couldn't resolve a member.
**Fix:** approve a binding on your side mapping that exact pair to one of your members, then have them
reconnect. The consumer's `member_hint` only *selects among approved bindings* — it never asserts
identity, so the binding has to exist first. For public `fixtures.read` it can map to any member (even
a default); the lens just has to be present. Tip: let them run one connect first, read the real
`grantee_system_id` and `member_hint` out of your grants table, and bind exactly those — don't guess.

### The consumer never reaches your handshake
**Symptom:** connect fails before any grant — card fetch or a2a call errors.
**Cause:** usually the card (see hosting) or an a2a URL mismatch.
**Fix:** confirm your served card's `endpoints.a2a` resolves and answers; verify the card with
`node kit/scripts/card-check.mjs <your-card-url>` from outside your own network.

---

## Hosting & the card

### Your card URL returns nothing, or the connect hangs
**Symptom:** `GET /.well-known/brain-protocol/card.json` returns an empty body or hangs forever; a
real browser never finishes loading it.
**Cause:** the card is served by an app whose catch-all routing swallows the `/.well-known/` path, or
the deploy hasn't propagated / the identity key isn't set yet so the signing route errors.
**Fix:** serve the card as a fast, **no-auth, no-redirect** route, not behind an SPA. Set the identity
key and let the deploy propagate. **Verify from outside your own infrastructure** (not localhost, not a
preview build) with `card-check` before you submit — if it hangs for an outside caller, no hub can
connect regardless of your conformance.

### Don't put your node on the hub's domain (or your admin app's)
**Symptom:** confusion about where to deploy; risk of overwriting a live system.
**Cause:** co-locating the provider on a domain that already serves something else.
**Fix:** give your node its **own** origin you control (e.g. `node.yourorg.com` via a custom domain),
on its own deployment. Its `endpoints.a2a` must be that final origin, not a `*.vercel.app` preview, or
consumers pin/verify against a mismatch. See PROVIDERS.md → "Where to run your node".

---

## Conformance & the kit

### The kit calls `calendar.read` / `/api/agent/a2a` but my node uses different names
**Symptom:** the wire half of the suite fails with 404s or `cell_denied`, even though your product works.
**Cause:** the kit drives a **fixed conformance harness contract** — fixed endpoints
(`/api/agent/a2a`, `/oauth/token`, `/test/*`) and a fixed vocabulary (`calendar.read`, `records.*`,
`appointment.book`, `action.execute`), read as member `mem-a`. It does **not** use your card's
endpoints or your real capability names.
**Fix:** stand up a conformance build that exposes the harness endpoints and vocabulary **over your
own data layer** — separate from your production `/api/bp/*` surface. The reference conformance server
shows the exact shape. Your real `fixtures.read`/`brain.read` are what production consumers use; the
kit never calls them.

### I vendored the reference server and passed — am I certified?
**Symptom:** green 46/46, but the wire half ran against the vendored reference, not your code.
**Cause:** the kit's doctrine ("observe the system's *own* behaviour") applies to the wire surface
too. Vendoring the reference server certifies the *reference*.
**Fix:** put **your** code under the harness — your crypto (card signing + PoP verify), your boundary
validator, your wire policy (nonce/replay, rate, loop guard, **SSRF**, sensitivity floors,
dark-by-default). These must be the *same modules production runs*, not a conformance-only copy. SSRF
especially: a harness-only SSRF guard means a passing cert **and** an exposed production node.

### My results say `2.0.3` but they were rejected / didn't match
**Symptom:** suite version looks right, but the maintainer can't reconcile your run.
**Cause:** a suite version can ship under multiple commits.
**Fix:** pin the **exact accepted `kit_commit`** (the maintainer publishes it); re-clone fresh and
confirm `results.json` stamps that commit.

---

## Registering

### I added my entry file but I'm not in the registry
**Symptom:** `your-entry.json` is in the repo, but `registry.json` still doesn't list you.
**Cause:** committing the entry file is **not** registration. The signed, hash-chained event in
`registry.json` is what counts, and it wasn't written.
**Fix:** the maintainer runs `register <your-entry.json>` with the registry key — that signs you into
the chain. Putting the file in the repo does nothing on its own.

### Where is the registry signing key?
**Symptom:** `register` errors with "registry private key not found".
**Cause:** the private key is git-ignored and lives only where it was generated or backed up.
**Fix:** recover the original (password manager, the machine you keygen'd on, a backup). Confirm it by
matching its public `x` to the committed public key. **Never** run `keygen` again — a new key has a
different `x`, fails verification against the chain, and locks you out of your own registry.

---

## Data layer (Class D)

### `schema.sql` breaks on managed Postgres (Supabase/Neon/RDS)
**Symptom:** the data plane won't stand up on a managed platform.
**Cause:** name and pooling collisions.
**Fix:** the `vault` schema collides with Supabase's built-in `vault` — namespace yours (e.g.
`bp_vault`). Keep `SET LOCAL ROLE` transaction-scoped and the member GUC off the platform's
PostgREST/JWT-RLS path. Confirm your plan allows `create role` and a custom GUC.

### Forgotten data comes back after a sync
**Symptom:** you ran forget-on-disconnect, the kit passed, but residue reappears later.
**Cause:** you project/derive copies, deleted the rows on disconnect, but left the connection's sync
feed live — the next sync re-hydrates the forgotten data (same failure class as restoring a backup
without replaying the forget log).
**Fix:** tear down the connection's **projection feed** as part of the purge, and tag every
projected/derived record with the `connection`/`provenance` so the forget predicate can find it.

---

## CI & deploys

### My CI workflow never runs / the merge is blocked on a missing check
**Symptom:** a required check never reports, or the workflow doesn't trigger.
**Cause:** GitHub Actions only discovers workflows at `<repo-root>/.github/workflows/`. A workflow in
a subfolder (a monorepo `product/website/.github/...`) won't run.
**Fix:** move the workflow to the repo root with `working-directory` set, or make the subfolder its
own repo.

### I pushed but my live site didn't update
**Symptom:** the change is committed and pushed, but production looks unchanged.
**Cause:** production builds from a different branch than you pushed to (commonly `main`, while you
pushed `dev`).
**Fix:** confirm your production branch and get the change onto it. To ship *only* a small change
without dragging an unready branch along, branch off the production branch and apply just that change.
