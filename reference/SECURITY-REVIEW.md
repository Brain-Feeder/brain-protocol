# Security review — reference pipe & TCK

*Self-review, 2026-06-12, principal-appsec lens. Subject: `reference/` (the Class D pipe and its
wire server) and `kit/src/peer/` (the kit's wire client). This is the review a partner's security
team would otherwise run before trusting the reference as a template.*

## Scope & limitations

**Reviewed:** the wire server (`reference/src/server.ts`), the data layer and SQL (`pipe.ts`,
`db/schema.sql`), the boundary validator (`validate.ts`), the crypto (`wire-crypto.ts`), and the
kit's wire client. **Verified by tracing entry→sink** (not assumed): SQL construction, the RLS
enforcement path, the vault read paths, dependency CVEs.

**Not reviewed / out of scope:** the v2 specification text itself (the council's domain, not code);
the kit's 46 test bodies line-by-line (test code, and any bug there shows up as a flaky/failing
test, not a runtime exposure); Class A/H surfaces (they do not exist yet); TLS/transport (the
reference serves plain HTTP on localhost for the harness — see Informational).

## Summary

The boring, high-value controls are correct: **parameterised SQL throughout, row-level security
genuinely enforced against a non-owner role and adversarially tested, the vault has no client read
path, zero dependency vulnerabilities, and crypto goes through the audited `jose` library with the
mandated algorithms.** There is no injection, no broken object-level authorization on the real data
path, and no secret in client-reachable code.

The findings are all the same species: **the reference is a conformance target and the wire server
ships test-only affordances that would be dangerous if the reference were ever deployed as a
production system.** The single most important action is to make that boundary explicit and
enforced — which this review then does in code.

## Findings

### [High — conditional on deployment] Unauthenticated test endpoints are a full authorization bypass
- **Where**: `server.ts` — `/test/grant`, `/test/connect`, `/test/fetch`, `/test/negotiate`, `/test/revoke`.
- **Issue**: `/test/grant` installs a grant with any matrix and any `member_lens`, unauthenticated. Anyone who can reach the server can grant themselves read access to any member's data, then call `calendar.read`. These endpoints exist on purpose — they are how the kit pins keys out of band (BUILD-BRIEF §6.3) — but nothing stops them being live in a real deployment. The danger is not the test harness; it is someone mistaking the reference for a production Class D pipe.
- **Fix**: refuse to run in a production posture at all. The server now aborts startup if `NODE_ENV=production` or `BRAIN_PRODUCTION=1`, with a message stating the reference is not a production server. The README carries the same warning. (A production Class D system implements the *same laws* but issues grants through the real BP-03 §6 consent ceremony, never an open `/test/*` route.)
- **Why this severity**: trivial, unauthenticated, total data exposure *if deployed* — but the reference is not intended to be deployed, so the realistic risk is misuse rather than an open door today.

### [Medium] SSRF guard validates but does not enforce on a real connection
- **Where**: `server.ts` — `ssrfGuardedFetch()` / `isBlockedIp()`.
- **Issue**: the guard resolves the host and checks the IP against private/metadata ranges, which is enough to pass `T-SEC-10` — but it then returns without actually fetching, and its comment promises pinning, redirect re-validation, and size caps that no real fetch performs. Anyone who copies this as a production importer/webhook fetcher inherits a guard that checks once and would then connect by hostname, which DNS-rebinding and HTTP redirects defeat. The range list also misses 100.64.0.0/10 (CGNAT), IPv4-mapped IPv6 (`::ffff:127.0.0.1`), and decimal/octal IP encodings (`http://2130706433/` = 127.0.0.1).
- **Fix (for production use)**: resolve once, **pin that exact IP into the socket** (`lookup`-pinned agent), disable redirects or re-run the check on every hop, cap the response body, and normalise/expand IP encodings before the range check. For the reference, the guard is now explicitly labelled illustrative in code. Tracked as the right shape, not yet production-grade.
- **Why this severity**: real weakness, but only reachable through the (test-only) fetch route and only impactful if the pattern is reused in production.

### [Medium] Unbounded nonce store (memory-exhaustion DoS)
- **Where**: `server.ts` — `seenNonces: Map<grant, Set<nonce>>`, never pruned.
- **Issue**: every call's nonce is remembered forever. The spec only requires nonce uniqueness within the ±5-minute clock window, so a long-lived server accumulates unbounded memory; a high request rate turns that into a denial of service. (The rate-limit window *is* pruned; the nonce set was not.)
- **Fix**: applied — nonces are now stored with their timestamp and pruned to the 5-minute window on each check, matching the rate-limit window's discipline.
- **Why this severity**: realistic resource-exhaustion over time on any persistent deployment; cheap fix.

### [Low] member_lens is not rejected as a child at grant install
- **Where**: `server.ts` — `/test/grant` accepts any `member_lens`.
- **Issue**: BP-03 §6.3 says a grant MUST NOT name a child lens. The grant boundary does not check this; the data-layer children's wall (forced household visibility, RLS) still protects the rows, so this is a defence-in-depth gap, not an exposure — but the invariant should be enforced where the spec puts it.
- **Fix**: documented; the data-layer wall (`T-DAT-02`, green) is the enforcing control. A production grant flow should reject a child lens at consent time.
- **Why this severity**: the protecting control exists one layer down and is tested; this is the missing belt to the existing braces.

### [Low] Verbose 500 leaks internal exception text
- **Where**: `server.ts` — the top-level `catch` returned `(e as Error).message` to the caller.
- **Issue**: an unexpected error (JSON parse, a Postgres message) was echoed to the client, which can leak internal detail.
- **Fix**: applied — unexpected errors now return a generic `internal_error` message; the detail stays server-side.
- **Why this severity**: information disclosure only, and only on unexpected paths.

### [Informational] Plain HTTP, and BRAIN_BREAK / dead-code hygiene
- The reference serves HTTP on localhost for the harness; the spec mandates TLS 1.2+, which a real deployment terminates at the edge. `BRAIN_BREAK` (the T-REF-02 law-breaker) is now refused under the same production guard as the test endpoints. The `/test/connect` handler had a dead first verify attempt (harmless, now removed) before the real signature check.

## What's done well (verified, not assumed)
- **No SQL injection.** Every wire-reachable query uses `$1…$n` placeholders; the only string interpolated into SQL is a constant table name from a fixed `TABLES` array. Traced every `query()` call.
- **RLS is real.** `force row level security` plus reads under `SET LOCAL ROLE brain_app` (a non-owner, non-superuser role) means a member physically cannot read above their sight — and `T-DAT-01` proves it adversarially across five viewers including an anonymous context.
- **Vault has no client path.** Secrets live in a schema `brain_app` cannot reach; stored as SHA-256 of a 24-byte random token (high-entropy, so SHA-256 is appropriate); read attempts return nothing (`T-DAT-03`).
- **Token lookup is a hash-map keyed by SHA-256** — no timing oracle, no plaintext token at rest.
- **0 dependency vulnerabilities** (`npm audit`, both packages), crypto via `jose` with Ed25519 / ECDH-ES(X25519)+A256GCM as mandated.

## What I'd review next
When a Class A/H system exists (Brainfeeder), the high-value targets shift to the agent surface: indirect prompt injection through federated content, the egress check, and memory-provenance/forget closure — exactly the `T-AGT-*` and `T-MEM-*` tests deferred until there is a model to run them against.
