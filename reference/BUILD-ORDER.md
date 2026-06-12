# The reference pipe build order

*The BP-02 §8 thirteen-point Class D provider checklist is the order a CTO hands a team. This
document walks each point to exactly where it lives in the reference, so the build order teaches
itself — every law is traceable to a file, a function, and the test that proves it.*

The reference deliberately separates **the data layer** (`db/schema.sql` + `src/pipe.ts`, points
1–13 below) from **the wire** (`src/server.ts`, the BP-03/BP-04 serve obligations). Build the data
layer first; the wire composes on top without reworking it.

| # | BP-02 §8 checklist point | Where it lives | Proven by |
|---|---|---|---|
| 1 | Every life-data table carries `owner`, `visibility`, `sensitivity`, `source`, `external_ref`, `valid_time`, `system_time` at creation | `db/schema.sql` — the `entity`/`activity`/`edge`/`action` tables (extracted columns) and the full envelope in `doc`; `src/validate.ts` enforces the envelope at the boundary | `T-ENV-01`, `T-ENV-02`, `T-ENV-03` |
| 2 | Row-level security enforces visibility; deny by default; adversarial test run, not asserted | `db/schema.sql` — `enable`/`force row level security` + the `*_select` policies using `current_member_id()` / `is_member` / `is_adult` / `is_partner_of`; `src/pipe.ts` reads under `SET LOCAL ROLE brain_app` | `T-DAT-01` (5 levels × 5 viewers, executed) |
| 3 | Children's rows forced to `shared:household` at write time; no child lens exists | `db/schema.sql` — the `force_child_household()` trigger; `src/pipe.ts` `isChild()` forces the `doc` too | `T-DAT-02` |
| 4 | Derived writes without provenance are rejected at the storage layer | `db/schema.sql` — the `*_provenance_totality` CHECK constraints; `src/validate.ts` requires `provenance` on `source: derived` | `T-DAT-10`, `T-ENV` derived cases |
| 5 | Append-only journal of side-effects and derived writes; metadata only | `db/schema.sql` — the `journal` table with `grant select, insert` only to `brain_app` (no update/delete); `src/pipe.ts` `journal()` | `T-DAT-09` (UPDATE/DELETE refused), `T-DAT-11` |
| 6 | Secrets in a vault schema with zero client read paths; hashed at rest; shown once; revocable; expiring | `db/schema.sql` — `schema vault`, `revoke all`, the `store_secret`/`verify_secret`/`destroy_secrets` SECURITY DEFINER functions; `src/pipe.ts` `mintSecret`/`readSecretAs` | `T-DAT-03` |
| 7 | Forget-on-disconnect: purge in dependency order, audit to zero, receipt produced and shown | `src/pipe.ts` `disconnect()` (dependency-ordered purge over the BP-02 §5.1 predicate) + `auditResidue()` + the receipt | `T-DAT-04` (kit re-queries every arm), `T-DAT-05` |
| 8 | `401`/`403` inbound treated as disconnect | `src/server.ts` returns `unauthenticated`/`grant_revoked` on a dead grant; `disconnect(..., 'peer_revoked')` runs the forget flow | `T-HSK-05` (revocation → forget) |
| 9 | Backup window published; restores replay the forget log before serving traffic; grant keys excluded from backups | `src/pipe.ts` `backup()` / `restore()` (replays the forget log for connections forgotten since the snapshot before serving) | `T-DAT-06` |
| 10 | Size, count and rate bounds on every endpoint, both directions; `429` on over-rate; truncated-and-flagged on over-cap | `src/server.ts` — the per-grant rate window (`429`/`rate_limited`) and the export page cap (`truncated` + `cursor`) | `T-DAT-07`, `T-DAT-08` |
| 11 | Local per-exchange audit log, metadata only; no central telemetry | `db/schema.sql` — the `audit_log` table; `src/pipe.ts` `logExchange()`; the server makes no outbound call except the SSRF-guarded peer fetch | `T-DAT-11`, `T-SEC-11` |
| 12 | `records.export` emits valid BP-01 envelopes under lens and ceiling; export-to-self works with no connection at all | `src/pipe.ts` `query()` under the member lens; `adapter.exportAs`; `src/server.ts` `records.export`/`calendar.read` serve under lens + ceiling with bounds | `T-ENV-08`/`09` round-trip, `T-DAT-01` lens, `T-DAT-07` bounds |
| 13 | The dated-requirement derivation rule (BP-01 §12) runs on ingest and edit | `src/pipe.ts` `applyDerivation()` — one derived activity per dated requirement attribute, provenance to the entity, update-in-place, cancel-on-archive | `T-ENV-07` |

## The wire half (BP-03 / BP-04, served on top)

Not part of the §8 data-layer checklist, but required to be a peer: the signed agent card at the
well-known path, version + vocabulary negotiation, per-grant keys and JWS proof-of-possession, the
grant matrix, the propose-only Action relay (dark by default), the origin-chain loop guard, the
S3 wall, the SSRF guard, and the BP-04 error model — all in `src/server.ts`, proven by the
`T-HSK-*`, `T-COM-*`, `T-SEC-*`, and `T-GAT-*` suites.

## A note on commit granularity

The brief envisioned each checklist point as its own commit so the git log itself teaches the
order. This repository instead presents the order as this traceable table, because the pipe was
authored as coherent whole files and re-splitting them into thirteen partial-file commits would
mean shipping a deliberately-incomplete pipe through twelve intermediate states. The mapping above
is the same teaching, verifiable against a single working tree: each row names the law, its home in
the code, and the test that proves it green.
