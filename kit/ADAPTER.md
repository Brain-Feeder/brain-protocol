# The TCK adapter contract

*Frozen for suite version 2.0.0. Every partner who certifies a Class D system writes one of
these. The TypeScript interface is `kit/src/types.ts`; this document is its prose and its law.*

---

## Why an adapter exists

The kit reaches a system under test two ways (BUILD-BRIEF §3.2):

1. **As a peer, over the wire.** Handshake, signatures, bounds, error codes and disconnect are
   tested over real A2A/MCP HTTP against `--target <base-url>`, with the kit playing the
   counterpart system (serving its own signed card, minting grant keys, signing batches,
   replaying nonces, sending malformed envelopes). No adapter is needed for those.

2. **Through a thin adapter, in process.** The data-layer laws — adversarial visibility, vault
   invisibility, journal immutability, forget-to-zero, restore replay, the derivation rule —
   cannot be proven from the wire. They are properties of where the data lives. So the
   implementer supplies a small module the kit imports (`--adapter <file>`) that drives their
   own store directly. **The adapter is your code against your store; the kit never sees your
   credentials.**

The seam is deliberately thin. The contract exposes data-layer *primitives* — seed, query,
export, mint a secret, attempt a journal write, disconnect, back up, restore — and the kit
composes them into the tests. If the adapter contained test logic, the kit would be testing the
adapter, not the system. Keep yours boring.

## Two certification preconditions (suite 2.0.2)

These exist because a conformance test must observe the *system's own* behaviour, never the kit's.

1. **Stand up more than the batch cap of rows for the bounds test.** T-DAT-07 (BP-02 §6, served
   read-bounds) no longer seeds its own data — a read grant can never write (BP-04 §5.1), and a
   served read returns *your* rows, so no peer-side ingest can create the over-cap condition. Before
   certifying, your system must hold **more than `limits.max_batch_records` rows under the read lens
   the kit will query** (the reference stands up 520 under `mem-a` at start-up). If your live data
   doesn't naturally exceed the cap, expose a small documented conformance seed seam — not a real
   write path. The kit then reads and proves the served page is bounded (`records ≤ cap`, and
   `truncated` + a `cursor` when more rows exist).

2. **Your `--target` and adapter must delegate to your real validator.** T-COM-07 and T-ENV-01 assert
   that malformed input is rejected. If a harness-side canonical screen does the rejecting instead of
   your live wire (`validateInbound`) or store boundary, the test passes for the wrong reason — the
   same failure shape as the old T-DAT-07. Wire the `--target` to your real endpoint and make the
   adapter's `seedAs` delegate to the validator your product actually runs, so the rejection the kit
   sees is the one a real peer would hit.

## Module shape

The `--adapter` file MUST `export default` a factory returning an `Adapter` (sync or async):

```ts
import type { Adapter } from 'brain-tck/types';
export default async function createAdapter(): Promise<Adapter> {
  // open your store, return an object implementing the methods below
}
```

The kit calls the factory once per run, then `close()` at the end.

## The methods

Every method runs against the **real data layer** of the system under test, under the same
policies a member or a peer would hit. None of them is allowed to shortcut the laws.

### Lifecycle

| Method | Contract |
|---|---|
| `reset()` | Wipe to a clean, deterministic baseline. Called before each test so runs are reproducible (BUILD-BRIEF §3.3). |
| `close()` | Release resources (DB connections, child processes). |
| `members()` | Return the members the kit may act as. MUST include at least two non-partner adults and one child, so the adversarial-visibility matrix can run (BP-02 AC-02.1). |

### Ingestion — the boundary (`seedAs`)

```ts
seedAs(member: Who, records: BrainRecord[], opts?: { connection?: string }): Promise<SeedResult>
```

Ingest records through your **boundary validator and data layer**, as `member` (`'anon'` is the
anonymous / foreign / service-role context). This is the write path the ENV and DAT suites use.

- Valid records land in the store. Invalid records are **rejected and counted**, never partially
  applied (BP-01 AC-01.1, BP-04 §9.2). The boundary validates against the canonical `schemas/`.
- The returned `SeedResult` carries `accepted` (ids), `rejected` (per-record, with field-naming
  `reasons`), and your system's `counters` after the ingest. The kit proves rejections were
  *counted* by reading `rejected_malformed` and friends — refusing is not enough.
- On ingest you MUST also apply: unknown-scope-fails-closed (an unregistered `shared:<scope>`
  lands as `private`, BP-01 §8), opaque pass-through of unknown subtypes and unknown envelope
  fields (BP-01 §11/§14), and the dated-requirement derivation rule (BP-01 §12).

### Reads under the lens (`queryAs`, `countAs`, `exportAs`)

```ts
queryAs(who: Who, predicate: QueryPredicate): Promise<BrainRecord[]>
countAs(who: Who, predicate: QueryPredicate): Promise<number>
exportAs(who: Who, predicate?: QueryPredicate): Promise<BrainRecord[]>
```

Read **through the data layer under `who`'s member lens** (or anon/foreign). The visibility law
runs in your store, not in the adapter: `queryAs(memberB, …)` physically cannot return member A's
private rows (BP-02 §3.1). `countAs` MUST also reveal no existence — denial by silence. `exportAs`
is export-to-self emitting BP-01 envelopes (BP-02 §7); it honours the lens and proves round-trip
pass-through (unknown fields/subtypes survive byte-intact).

`QueryPredicate` is sql-free: exact-match fields (`id`, `subtype`, `owner`, …) plus two forget
arms — `originChainContains` and `provenanceMintedBy` — so the kit can re-query for any residue
traceable to a disconnected system (BP-02 §5.1) and verify the forget audit itself, rather than
trusting your self-reported zero.

### Vault (`mintSecret`, `readSecretAs`, `storedSecretForm`)

The vault law (BP-02 §4): secrets live server-side only, with zero client read paths.

- `mintSecret(connection)` mints a secret and returns it **shown once**.
- `readSecretAs(member, connection)` attempts to read it back *as the owning user's own client*.
  For a conformant vault this returns nothing — not a filtered subset, no path at all.
- `storedSecretForm(connection)` reports whether the stored form is a `hash`,
  `server-ciphertext`, or (a failure) `plaintext`.

### Journal (`journalWriteAttempt`)

```ts
journalWriteAttempt(op: 'update' | 'delete'): Promise<JournalWriteAttempt>
```

Attempt an `UPDATE`/`DELETE` against the append-only journal. The **data layer** MUST refuse it
(`rejected: true`) — a revoked grant, not an application convention (BP-02 §3.4).

### Audit log (`readAuditLog`)

Return the local per-exchange audit log: who, method, when, outcome — **metadata only, never
payload bodies** (BP-02 §6, CD-3). The kit scans the returned entries for the absence of payload
bodies, tokens, and S2 plaintext.

### Forget (`disconnect`, `readReceipt`)

- `disconnect(connection, trigger?)` runs the full purge in dependency order, the audit to zero,
  and produces the receipt (BP-02 §5). `trigger` defaults to `user_disconnect`; `token_rejected`
  models the 401-as-disconnect path.
- `readReceipt(connection)` returns the forget receipt (validated against
  `schemas/forget-receipt.schema.json`), including the explicit `derived_memories` line and the
  `keys_destroyed` line (BP-07 §3.6).

After `disconnect`, the kit independently calls `queryAs`/`exportAs` with the forget-arm
predicates to confirm zero residue. The receipt is the system's claim; the re-query is the proof.

### Backup / restore (`backup`, `restore`, `snapshotChecksum`)

- `backup()` returns an opaque snapshot handle (your format).
- `restore(snapshot)` restores it and reports whether it **replayed the forget log before serving
  traffic** and whether any traffic was served before the replay (a failure). Resurrected
  forgotten data is an incident, not an ops event (BP-02 §5.6). A documented manual restore
  procedure is permitted (BUILD-BRIEF §6.2) provided the kit can verify the post-restore state.
- `snapshotChecksum()` returns a stable checksum of the served read model, so the kit can prove a
  crashed sync left prior state byte-intact (BP-04 AC-04.1).

### Gates, Class D (`recordConfirm`, `tryExecute`) — optional

For the Class D gate tests (BP-08 §2): `recordConfirm(actionId, payloadHash, by)` writes a
server-side confirm; `tryExecute(actionId, payloadHash, idempotencyKey)` attempts execution and
reports whether it ran and, if not, why (`no_stored_confirm`, `payload_hash_mismatch`,
`idempotency_replay`, `expired_draft`, `dark_by_default`). These prove execution is impossible
without a stored, hash-bound confirm, that double-execution dies on the idempotency key, and that
`action.execute` is dark by default. A system whose Class D gate surface is purely wire-driven may
omit these and the kit drives the same checks over `--target`.

## What the kit guarantees you

- **It runs locally and transmits nothing except to `--target`** (CD-3; T-SEC-11 captures the
  network during a full session and fails on any non-peer egress).
- It never asks for your credentials; the adapter holds them.
- Fixed seeds and stable test ids; the same inputs every run.

## The frozen surface

These method signatures are the 2.0.0 contract and will not change within suite major version 2.
New methods, if ever needed, arrive as optional members by MINOR version (the same additive rule
BP-09 §5.2 applies to the protocol). Build to this interface once; it is stable for the life of
the major.
