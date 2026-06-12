# BP-02 — Agent-Ready Systems

*Status: draft 0.1 · Brain Protocol v2 suite · Editor: Peter McCormack. Encodes the council
decisions of 11 June 2026 (`COUNCIL-BRIEFS.md`), `11-PARTNER-BRIEF.md` §3–4, and
`01-PLATFORM.md` §3.3. Suite context in `BP-00-OVERVIEW.md`. Record shapes per BP-01.*

---

## 1. Introduction and scope

This is the specification a CTO reads first. It defines what any system must enforce **in its
data layer** before any agent exists — the properties that make data ready for agentic life. A
plain database with these properties, plus the provider profile of BP-03/BP-04, is a full peer
on the mesh (conformance Class D): no AI, no chatbot, full trust.

The thesis is structural: **the laws live in the data layer, not in prompts or UI.** A
permission checked only in an interface, a provenance stamp added only by convention, a secret
readable by a client that promises not to look — none of these survive the first agent, the
first compromised peer, or the first subpoena of your own logs. Build the four laws into
storage now and every later layer (BP-03 through BP-08) composes on top without rework.

Every normative clause in this specification applies to **all conformance classes (D, A, H)**.

## 2. Requirement words

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

## 3. The storage laws

### 3.1 Visibility enforced at the data layer

Every row that describes a person's life carries a `visibility` (grammar and registered scopes
per BP-01 §8). Enforcement MUST be in the data layer — row-level security or equivalent — such
that a query executed as a given member **physically cannot return** rows above their sight. A
UI filter is not conformance. Reference pattern (PostgreSQL RLS):

```sql
alter table activity enable row level security;
alter table activity force row level security;   -- binds the table owner too

create policy activity_select on activity for select using (
  owner_member = current_member_id()                                        -- private
  or (visibility = 'shared:partners'  and is_partner_of(owner_member, current_member_id()))
  or (visibility = 'shared:adults'    and is_adult(current_member_id()))
  or (visibility = 'shared:household' and is_member(current_member_id()))
  or (visibility = 'public'           and is_member(current_member_id()))
);
-- No insert/update/delete policy is shown: absent policy = denied. Deny by default.
```

`current_member_id()` resolves from the authenticated session (e.g. a JWT claim), never from a
client-supplied parameter. There is **no privileged read path for prompts or context assembly**
(BP-05): an agent reads through the same policies as the member it serves.

Further rules:

- **Existence denied by silence.** A record the asker cannot see does not exist for them: query
  results, counts, error messages and agent answers MUST be indistinguishable from the record's
  absence — never "I can't tell you about that".
- **Children's rows.** Anything a child creates is forced to `shared:household` at write time
  (trigger or equivalent — not application courtesy); children cannot hold private rows and
  never see adults' private rows. Children's data never crosses the federation boundary, and no
  grant may use a child lens (BP-03).
- **Single-user degeneration** (settling the open question). A system without members (one human,
  no space) MUST still stamp and store `visibility` on every row and MUST still enforce it at the
  data layer. Locally the audiences collapse to one person, but the stamps govern the wire (the
  grant's visibility ceiling filters on them) and the enforcement proves itself the day a second
  member, or a connection, arrives. The adversarial test degenerates to: any non-owner context —
  anonymous, another tenant, a service role acting for a peer — returns zero rows.

> **Anti-pattern — UI-only permissions.** The interface hides Dad's salary card from the kids,
> but `select * from activities` as any authenticated user returns it. The first agent, export
> job, or API consumer added to this system leaks everything the UI politely hid. If a permission
> is not expressed where the data lives, the system does not have that permission — it has a
> drawing of one.

### 3.2 Owner stamps

Every entity and activity MUST carry `owner` — whose life the row belongs to — at creation. The
owner anchors the visibility law (§3.1), the member lens and visibility ceiling on every grant
(BP-03), and the egress check (BP-05). A row without an owner cannot be safely shared, filtered,
or exported; writes without one MUST be rejected.

### 3.3 Provenance totality

Every row says where it came from. No exceptions.

- Every entity and activity carries `source` + `external_ref`; every edge, journal entry and
  derived record carries at least `source`. This includes records computed on the fly.
- **A derived write without attributable provenance MUST be rejected at the storage layer** —
  not logged and accepted. Anything an AI or pipeline distils from other records carries
  `provenance` (the source records' URNs, BP-01 §5.2). An untagged derived row is a forget leak
  (§5) and a conformance failure.
- Provenance is what makes idempotent sync (upsert by `(source, external_ref)`), entity
  resolution, and forget-on-disconnect possible. A row without provenance can never be safely
  synced, deduplicated, or erased.

> **Anti-pattern — provenance-free ingestion.** An import script copies a partner's rows in with
> `source = 'import'` and no `external_ref`. Six months later the partner disconnects and asks to
> be forgotten — and nothing can prove which rows were theirs. The forget audit cannot reach
> zero, every resync duplicates, and the only honest remedies are "delete everything" or "keep
> what we promised to erase". Provenance is cheap on day one and unrecoverable on day two
> hundred.

### 3.4 The journal of side-effects

Every side-effect and derived write is additionally recorded in an **append-only journal**: what
happened, by whom, from where — ActivityStreams-style past-tense verbs (`created`, `updated`,
`completed`, `confirmed`, `declined`, `forgot`; BP-01 §13). Reference shape:

```sql
create table journal (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,          -- member ref or agent id
  verb        text not null,          -- ActivityStreams-style, past tense
  object_urn  text not null,
  source      text not null,          -- provenance, like every other table
  detail      jsonb                   -- metadata only; never secrets, never S2 bodies
);
revoke update, delete on journal from public;   -- and from every application role
```

The journal is the substrate of BP-08's recorded confirms (who said yes, when, against which
payload hash) and BP-06's correction trails. It MUST NOT contain secret material or S2 payload
bodies.

### 3.5 Bitemporal storage

Per CD-5 the wire requires both time axes on every record; storage MUST therefore keep them
distinct: `valid_time` (when the fact happened or became true) and `system_time` (when this
system learned it). `system_time` defaults to the row's insertion time; `valid_time` never
does so implicitly — it is asserted. The degenerate form (`valid_time = system_time`) is
permitted where the two genuinely coincide. Migrating an existing store is additive: backfill
`system_time` from `created_at` and derive `valid_time` from the most occurrence-like column
available, forward-only.

> **Anti-pattern — conflated time axes.** One `created_at` column doubles as "when the row
> appeared" and "when the thing happened". Then a clinic backfills March's appointments in June,
> every one stamped today, and the agent confidently reports a March of empty afternoons. History
> silently corrupted is worse than history missing: nothing looks wrong. Two columns, one line of
> code, and backfill becomes honest.

## 4. The vault law

Secrets — tokens, grant keys, credentials, anything that authenticates or unlocks — live
**server-side only**, with **zero client read paths**:

1. Secret-bearing tables are unreadable by every client-facing role, **including the owning
   user's own authenticated client**. Not "RLS-filtered" — no grant, no policy, no path.
2. Store the **hash**, not the secret: show the value once at mint, then keep only enough to
   verify. Where the secret must be used outbound (a peer's token), store it encrypted with a
   server-held key, never plaintext, and decrypt only inside server code.
3. Every secret is **revocable** (one user action) and SHOULD expire (90-day default,
   renewable). Expired or revoked fails closed.
4. No secret ever appears in a browser, a mobile client, a log line, an error message, or an
   export.

Reference pattern (PostgreSQL):

```sql
create schema vault;
revoke all on schema vault from public, authenticated, anon;

create table vault.secret (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  secret_hash   text not null,            -- verify-only; value shown once at mint
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
-- Access exclusively via security-definer server functions that VERIFY or USE the
-- secret and never return it. There is no select path for any client role.
```

S3 sealed items (BP-07) follow the same pattern: the payload stays in the vault or sealed store;
only reference pointers (existence, label, expiry) are ever serialised.

## 5. Forgetting

Either end may disconnect at any time, and disconnecting means forgetting — provably.

### 5.1 The traceability requirement

Everything that entered or grew from a connection MUST be traceable to it, at all times, as a
property of the data (this is §3.3 doing its second job). The erasable set for a disconnecting
system `X` is every row where `source = X`, **or** `origin_chain` contains `X`, **or**
`provenance` contains any URN minted by `X` — applied transitively through derived records. If
this set cannot be computed, the system cannot forget, and a system that cannot forget MUST NOT
connect.

### 5.2 The purge and its order

On disconnect, purge the erasable set in dependency order — referencing rows before their
referents, leaves to roots:

1. derived stores and AI memories (anything whose `provenance` reaches `X`);
2. edges anchored on doomed records;
3. activities, then entities, from `X`;
4. parked or proposed actions originating from the connection;
5. vault material: tokens revoked, grant keys destroyed (recorded — BP-07's cryptographic
   forgetting);
6. journal rows whose `source` is the connection and which carry payload detail;
7. finally, append the forget event itself to the journal (counts and outcome only, no content).

For non-relational stores the same logical order applies: anything holding a reference to a
doomed record is purged before it, and the audit (§5.3) — not the storage engine — is the proof.

### 5.3 The forget audit

After every purge, scan **every table that can carry provenance** — including derived-memory
stores — for any row still traceable to the disconnected system under the §5.1 predicate. The
result MUST be zero. The counts erased and the zero result are recorded and shown to the user as
the receipt.

### 5.4 The forget receipt

Minimum fields (settling the open question), as JSON:

```jsonc
{
  "receipt_id":   "urn:brain:ourhub:action:0e3c7b9a-…",
  "connection":   "garagebrain",
  "trigger":      "user_disconnect",        // user_disconnect | peer_revoked | token_rejected
  "started_at":   "2026-06-11T10:02:11Z",
  "completed_at": "2026-06-11T10:02:14Z",
  "erased": { "entities": 37, "activities": 214, "edges": 51,
              "actions": 4, "derived_memories": 12, "journal_rows": 96 },
  "keys_destroyed": { "grant_keys": 2, "tokens_revoked": 1,
                      "at": "2026-06-11T10:02:13Z" },          // BP-07 crypto-forget line
  "audit": { "tables_scanned": 9, "rows_remaining": 0 },
  "backup_window_days": 30
}
```

The receipt is user-visible in plain language ("Erased: 214 activities, 37 entities, 51 edges,
12 memories. Zero rows remain."), retained in the journal, and `derived_memories` is always an
explicit line — derived memory is where forgetting fails silently.

### 5.5 Revocation signals

A `401`/`403` on an outbound call is the other side revoking you: treat it as a disconnect and
trigger the same purge, audit and receipt. Token revocation *is* the system-end "forget me";
`connection.revoke` (BP-03) is a courtesy that makes it immediate.

### 5.6 Backups and cryptographic forgetting

Backups lag; the spec makes the lag honest and harmless:

- The backup window MUST be published (and stated in the receipt). Any restore from backup MUST
  replay the forget log — every receipt issued since the backup was taken — and re-pass the
  audit **before serving traffic**. Resurrected forgotten data is an incident, not an ops event.
- Grant private keys MUST NOT be included in general backups; if key escrow exists, the escrow
  copy is destroyed at disconnect and the destruction recorded in the receipt. *(Co-ratified
  line, stated identically in BP-07 §3.6.)* Consequence: S2 ciphertext restored from a backup is
  permanently unreadable (BP-07) — cryptographic forgetting covers the window that physical
  deletion cannot.

## 6. Bounds

Neither side trusts the other to be finite, and a system bounds itself before any agent exists.

- **Size and count.** Cap response sizes and records per sync batch in both directions
  (RECOMMENDED defaults: 500 records or 1 MiB per batch, matching BP-04 §3.3.2's page cap). An over-cap result is truncated and
  flagged `"truncated": true` with a cursor — never silently dropped, never unbounded.
- **Rate.** Rate-limit every endpoint per connection (RECOMMENDED default: 60 requests/minute).
  An over-rate caller receives `429` with `Retry-After` — never a silent drop, never a stall.
- **Resource caps.** A connection SHOULD carry a storage quota; hitting it parks further sync
  with a flagged partial state rather than evicting silently.
- **Retention defaults** (guidance, settling the open question): S0 ambient answers and all
  live-query results are never stored by default; expired action drafts are purged after 90
  days; the journal is retained for the life of the space; the audit log (below) is retained at
  least 12 months.
- **The local audit log (CD-3).** Every conformant system MUST keep a local per-exchange audit
  log — who called, which method, when, outcome — **metadata only, never payload bodies**.
  Central or vendor telemetry is prohibited by this specification; sharing audit summaries is
  voluntary and grant-scoped. Forensics without surveillance.

## 7. The export requirement

A system MUST be able to emit its records as BP-01 envelopes. This is what makes a plain
database a peer: if the data cannot leave in the common shape, nothing upstream of it matters.

- The export surface is the `read` verb of each granted capability (BP-03/BP-04), served at the
  system's A2A/MCP endpoint. Shape (JSON-RPC method `records.export`):

```jsonc
// request
{ "capability": "calendar", "since": "2026-06-01T00:00:00Z",
  "cursor": null, "limit": 500 }

// response
{ "records": [ /* BP-01 envelopes, validated before emission */ ],
  "cursor": "opaque-continuation-token", "complete": false,
  "as_of": "2026-06-11T10:00:00Z", "truncated": false }
```

- Every emitted record validates against BP-01 (the kit rejects an exporter that emits invalid
  envelopes). Pagination by opaque cursor; bounds per §6; batches signed per BP-07.
- The export runs **through the data layer under the grant's member lens and visibility
  ceiling** (§3.1): what the grant cannot see, the export cannot contain.
- **Export-to-self MUST exist** independently of any connection: the user can take their own
  data out as BP-01 envelopes at any time. Portability is not a peer privilege.

## 8. Class D provider profile checklist

The data-layer half of the Class D profile (BP-03/BP-04 add the card, handshake and serve
obligations). A CTO can hand this list to a team as the build order:

1. Every life-data table carries `owner`, `visibility`, `sensitivity`, `source`,
   `external_ref`, `valid_time`, `system_time` at creation.
2. Row-level security (or equivalent) enforces visibility; deny by default; adversarial test
   run, not asserted (AC-02.1).
3. Children's rows forced to `shared:household` at write time; no child lens exists.
4. Derived writes without provenance are rejected at the storage layer.
5. Append-only journal of side-effects and derived writes; metadata only.
6. Secrets in a vault schema with zero client read paths; hashed at rest; shown once;
   revocable; expiring.
7. Forget-on-disconnect: purge in dependency order, audit to zero, receipt produced and shown.
8. `401`/`403` inbound treated as disconnect.
9. Backup window published; restores replay the forget log before serving traffic; grant keys
   excluded from backups.
10. Size, count and rate bounds on every endpoint, both directions; `429` on over-rate;
    truncated-and-flagged on over-cap.
11. Local per-exchange audit log, metadata only; no central telemetry.
12. `records.export` emits valid BP-01 envelopes under lens and ceiling; export-to-self works
    with no connection at all.
13. The dated-requirement derivation rule (BP-01 §12) runs on ingest and edit.

## 9. Acceptance criteria (runnable kit tests)

These ship in the conformance kit and are run, not asserted. All are Class D.

**AC-02.1 — Adversarial visibility** (`bp02-visibility-adversarial`). Seed member A's data at
each visibility level (`private`, each registered scope, `public`); authenticate as member B (a
non-partner adult), as a child member, and as an anonymous/foreign context; attempt direct
selects, aggregate counts, and the export endpoint for each. **Pass:** B receives only rows at
or below their sight; the child receives no adult-private rows and no row above
`shared:household`; the anonymous context receives zero rows; counts and errors reveal no
existence; A's private rows return zero everywhere except to A. Run against the database, not
the UI.

**AC-02.2 — Forget-to-zero** (`bp02-forget-audit`). Seed tagged rows from a test connection into
**every** provenance-bearing table — entities, activities, edges, actions, journal, and at least
one derived-memory store (a summary whose `provenance` reaches the connection). Execute
disconnect. **Pass:** the audit scans every such table and returns zero rows traceable under the
§5.1 predicate (source, origin-chain and provenance arms all exercised); a receipt is produced
containing per-type counts, an explicit `derived_memories` line, the keys-destroyed line, and
`rows_remaining: 0`.

**AC-02.3 — Vault invisibility** (`bp02-vault-client-zero`). Mint a secret for a test
connection. As the owning user's own authenticated client credentials, attempt to read the
secret-bearing tables directly, via any API the client can reach, and via the export endpoint;
inspect server logs and a forced error response for the period. **Pass:** every read path
returns nothing (not a filtered subset — no path exists); the secret value appears in no log
line, error, or export; the stored form is a hash or server-key ciphertext, never plaintext.

**AC-02.4 — Restore replay** (`bp02-backup-replay`). Take a backup; afterwards execute a
disconnect (producing a receipt); restore the backup into a staging instance. **Pass:** the
restore procedure replays the forget log before the instance serves any traffic; the forget
audit re-passes at zero on the restored instance; any S2 ciphertext present in the backup is
unreadable because the grant keys were destroyed and were not in the backup; first-served
traffic never observes a forgotten row.

**AC-02.5 — Bounds hold** (`bp02-bounds`). Request a sync exceeding the batch cap; then call any
endpoint above the rate limit. **Pass:** the over-cap response is truncated, flagged
`"truncated": true`, and carries a cursor that completes the set across subsequent calls — no
silent drop, no unbounded response; the over-rate caller receives `429` with `Retry-After` and
the refused calls appear in the local audit log with outcome recorded and no payload bodies.

## 10. Settled questions and returns

Settled by this draft (per the council's "open to the writer" list): the reference purge
ordering, stated logically so it binds non-Postgres stores (§5.2); the receipt's minimum fields
(§5.4); single-user degeneration of the visibility law (§3.1); retention guidance defaults
(§6). Grant-key exclusion from backups (§5.6) is co-ratified with BP-07's key-lifecycle text
(BP-07 §3.6 carries the same line). Nothing in this draft is returned to the council.
