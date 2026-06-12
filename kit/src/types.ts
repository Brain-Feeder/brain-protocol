// Brain Protocol v2 TCK — core types and the frozen adapter contract.
//
// The kit reaches a system under test two ways (BUILD-BRIEF §3.2):
//   1. As a PEER over real A2A/MCP HTTP (`--target <base-url>`) for wire-reachable
//      behaviour: handshake, signatures, bounds, errors. See src/peer/.
//   2. Through a thin ADAPTER (`--adapter <file>`) the implementer writes against their
//      own store, for data-layer laws the wire cannot prove: adversarial visibility, vault
//      invisibility, journal immutability, forget-to-zero, restore replay.
//
// This file defines the Adapter contract. It is FROZEN for suite version 2.0.0 and
// documented in kit/ADAPTER.md. Every partner writes one; keep it thin.

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A BP-01 record envelope. Deliberately loose: the boundary validator (built from
 *  schemas/) is the authority on shape, not the TypeScript type. */
export type BrainRecord = Record<string, unknown> & {
  id?: string;
  type?: string;
  subtype?: string;
  source?: string;
  external_ref?: string;
  owner?: string;
  visibility?: string;
  sensitivity?: string;
  valid_time?: string;
  system_time?: string;
  provenance?: string[];
  origin_chain?: string[];
  attributes?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Members and lenses
// ---------------------------------------------------------------------------

/** A member the kit can act as when seeding or querying. The kit needs to know each
 *  member's role and partnerships to drive the adversarial-visibility matrix (T-DAT-01/02).
 *  `anon` is the absence of a member: an anonymous / foreign / service-role context. */
export interface MemberRef {
  id: string;
  role: 'adult' | 'child';
  /** ids of members this member is a registered partner of (drives shared:partners). */
  partnerOf?: string[];
  label?: string;
}

export type Who = MemberRef | 'anon';

/** A sql-free read predicate. The kit composes these; the adapter translates them into
 *  its own store's query under the given member's data-layer lens. Every field is an
 *  exact-match conjunction except the *Contains arms, which test array membership. */
export interface QueryPredicate {
  id?: string;
  type?: string;
  subtype?: string;
  source?: string;
  externalRef?: string;
  owner?: string;
  visibility?: string;
  /** rows whose origin_chain array contains this system id (BP-02 §5.1 forget arm). */
  originChainContains?: string;
  /** rows whose provenance array contains any urn minted by this system id. */
  provenanceMintedBy?: string;
}

// ---------------------------------------------------------------------------
// Ingestion result (the boundary)
// ---------------------------------------------------------------------------

/** One rejected record from a seed/ingest attempt: which input index, and the spec
 *  clause(s) it violated. The reason strings SHOULD name the failing field. */
export interface Rejection {
  index: number;
  /** the offending record's id if it had a parseable one. */
  id?: string;
  /** human-readable, field-naming reasons (e.g. "missing required field: owner"). */
  reasons: string[];
}

/** Canonical per-exchange data-quality counters (BP-04 §9.2). The adapter reports the
 *  system's own counters after an ingest so the kit can prove rejections were *counted*,
 *  not merely refused. */
export interface Counters {
  rejected_malformed: number;
  rejected_unsigned: number;
  rejected_replayed: number;
  rejected_echo: number;
  rejected_hop_limit: number;
  rejected_ceiling: number;
  rejected_sensitivity: number;
  truncated_overcap: number;
  passed_through_unknown: number;
}

export interface SeedResult {
  /** ids (or input indices as strings) the boundary accepted. */
  accepted: string[];
  rejected: Rejection[];
  /** the system's counters after this ingest (cumulative for the connection). */
  counters: Counters;
}

// ---------------------------------------------------------------------------
// Vault, journal, audit
// ---------------------------------------------------------------------------

export interface SecretReadAttempt {
  /** true iff some value came back from the read path. For a conformant vault, false. */
  returnedSomething: boolean;
  /** the raw value if any path leaked one (the kit asserts this is empty). */
  value?: string;
}

export type StoredSecretForm = 'hash' | 'server-ciphertext' | 'plaintext' | 'none';

export interface JournalWriteAttempt {
  /** true iff the data layer refused the UPDATE/DELETE against the journal. */
  rejected: boolean;
  /** the error or reason the store gave. */
  reason?: string;
}

export interface AuditEntry {
  exchange_id?: string;
  grant_id?: string;
  peer?: string;
  direction?: 'inbound' | 'outbound';
  method?: string;
  at?: string;
  outcome?: string;
  counts?: Record<string, number>;
  classes_present?: string[];
  signature_valid?: boolean;
  /** the adapter MUST NOT return payload bodies here; the kit scans for their absence. */
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Forget / backup / restore
// ---------------------------------------------------------------------------

export interface ForgetReceipt {
  receipt_id: string;
  connection: string;
  trigger: 'user_disconnect' | 'peer_revoked' | 'token_rejected';
  started_at: string;
  completed_at: string;
  erased: {
    entities: number;
    activities: number;
    edges: number;
    actions: number;
    derived_memories: number;
    journal_rows: number;
    [k: string]: number;
  };
  keys_destroyed: { grant_keys: number; tokens_revoked: number; at: string };
  audit: { tables_scanned: number; rows_remaining: number };
  backup_window_days: number;
  [k: string]: unknown;
}

/** An opaque backup handle. The adapter owns the format; the kit only round-trips it. */
export type Snapshot = unknown;

export interface RestoreResult {
  /** true iff the restore replayed the forget log before serving any traffic (BP-02 §5.6). */
  replayedForgetLog: boolean;
  /** true iff any traffic was served before the replay completed (a conformance failure). */
  servedTrafficBeforeReplay: boolean;
}

// ---------------------------------------------------------------------------
// The frozen Adapter contract (suite 2.0.0)
// ---------------------------------------------------------------------------

/**
 * The data-layer seam. The implementer supplies this as a module exporting a default
 * factory `() => Promise<Adapter>` (or `Adapter`). It is the implementer's own code
 * against their own store; the kit never sees their credentials. Keep it thin: expose
 * data-layer primitives, let the kit compose the tests.
 */
export interface Adapter {
  /** Wipe to a clean, deterministic baseline between tests. */
  reset(): Promise<void>;
  /** Release resources (DB connections, processes). */
  close(): Promise<void>;

  /** The members the kit may act as. MUST include at least: two non-partner adults and
   *  one child, so the adversarial-visibility matrix can run (BP-02 AC-02.1). */
  members(): Promise<MemberRef[]>;

  /** Ingest records through the system's boundary validator and data layer, as `member`.
   *  Valid records land; invalid ones are rejected and counted (never partially applied).
   *  This is the ENV and DAT write path. */
  seedAs(member: Who, records: BrainRecord[], opts?: { connection?: string }): Promise<SeedResult>;

  /** Read through the data layer under `who`'s member lens (or anon/foreign context).
   *  Returns only rows the lens may see — the visibility law runs in the store, not here. */
  queryAs(who: Who, predicate: QueryPredicate): Promise<BrainRecord[]>;
  /** Count under the lens — counts MUST also reveal no existence (denial by silence). */
  countAs(who: Who, predicate: QueryPredicate): Promise<number>;
  /** Export-to-self: emit the member's own rows as BP-01 envelopes (BP-02 §7). Used to
   *  prove round-trip pass-through (T-ENV-05/08/09) and that exports honour the lens. */
  exportAs(who: Who, predicate?: QueryPredicate): Promise<BrainRecord[]>;

  // Vault (BP-02 §4)
  mintSecret(connection: string): Promise<{ shownOnce: string }>;
  /** Attempt to read the secret directly, as the owning user's own client. MUST fail. */
  readSecretAs(member: Who, connection: string): Promise<SecretReadAttempt>;
  storedSecretForm(connection: string): Promise<StoredSecretForm>;

  // Journal (BP-02 §3.4)
  /** Attempt a mutation against the append-only journal; MUST be rejected by the store. */
  journalWriteAttempt(op: 'update' | 'delete'): Promise<JournalWriteAttempt>;

  // Audit log (BP-02 §6, CD-3)
  readAuditLog(): Promise<AuditEntry[]>;

  // Forget (BP-02 §5)
  /** Disconnect a connection: purge in dependency order, audit to zero, produce a receipt. */
  disconnect(connection: string, trigger?: ForgetReceipt['trigger']): Promise<void>;
  readReceipt(connection: string): Promise<ForgetReceipt>;

  // Backup / restore (BP-02 §5.6)
  backup(): Promise<Snapshot>;
  restore(snapshot: Snapshot): Promise<RestoreResult>;
  snapshotChecksum(): Promise<string>;

  // Server-side confirm / execute for the Class D gate tests (BP-08 §2).
  // The adapter exposes the system's confirm store so the kit can prove a confirm is
  // server-side-recorded and payload-hash-bound, and that execution is impossible without it.
  /** Record a stored confirm for an action against a payload hash (the server fact). */
  recordConfirm?(actionId: string, payloadHash: string, by: string): Promise<void>;
  /** Attempt to execute an action; returns whether it executed and why not. */
  tryExecute?(actionId: string, payloadHash: string, idempotencyKey: string): Promise<ExecuteAttempt>;
}

export interface ExecuteAttempt {
  executed: boolean;
  /** reason it did not execute (e.g. "no_stored_confirm", "payload_hash_mismatch",
   *  "idempotency_replay", "expired_draft", "dark_by_default"). */
  reason?: string;
  result?: Record<string, unknown>;
}

/** Module shape the kit imports from `--adapter <file>`. */
export type AdapterFactory = () => Promise<Adapter> | Adapter;
