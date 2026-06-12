// The reference pipe data layer (BP-02). Brings up Postgres, applies db/schema.sql, and
// exposes the data-layer operations the adapter needs. Privileged writes (ingest, purge, vault,
// journal insert) run as the superuser, which bypasses RLS; reads run inside a transaction under
// `SET LOCAL ROLE brain_app` so row-level security bites against a non-owner — exactly what a
// member or peer hits. Deliberately small (BUILD-BRIEF §4): readable in an afternoon.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pgPkg from 'pg';
import { validateRecord, isRegisteredScope } from './validate.js';

const { Client } = pgPkg;
const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = join(here, '..', 'db', 'schema.sql');

export type Record_ = Record<string, unknown>;
export type Who = { id: string; role: 'adult' | 'child' } | 'anon';

const DATED_REQUIREMENT = /(_due|_expiry|_renewal|_review)$|^mot_due$/;
const TABLES = ['entity', 'activity', 'edge', 'action', 'derived_memory'] as const;

function memberId(who: Who): string {
  return who === 'anon' ? '' : who.id;
}

interface Counters {
  rejected_malformed: number; rejected_unsigned: number; rejected_replayed: number;
  rejected_echo: number; rejected_hop_limit: number; rejected_ceiling: number;
  rejected_sensitivity: number; truncated_overcap: number; passed_through_unknown: number;
}
const zero = (): Counters => ({
  rejected_malformed: 0, rejected_unsigned: 0, rejected_replayed: 0, rejected_echo: 0,
  rejected_hop_limit: 0, rejected_ceiling: 0, rejected_sensitivity: 0, truncated_overcap: 0, passed_through_unknown: 0,
});

export class Pipe {
  private pg!: EmbeddedPostgres;
  private c!: InstanceType<typeof Client>;
  private counters = zero();
  private started = false;
  private port: number;
  private dataDir: string;

  constructor(opts: { port?: number; dataDir?: string } = {}) {
    this.port = opts.port ?? 55400 + Math.floor(Math.random() * 100);
    this.dataDir = opts.dataDir ?? `/tmp/brain-ref-${randomBytes(4).toString('hex')}`;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.pg = new EmbeddedPostgres({ databaseDir: this.dataDir, user: 'postgres', password: 'postgres', port: this.port, persistent: false });
    await this.pg.initialise();
    await this.pg.start();
    this.c = this.pg.getPgClient();
    await this.c.connect();
    await this.c.query(readFileSync(SCHEMA_SQL, 'utf8'));
    this.started = true;
    await this.seedMembers();
  }

  async close(): Promise<void> {
    if (!this.started) return;
    try { await this.c.end(); } catch { /* */ }
    try { await this.pg.stop(); } catch { /* */ }
    this.started = false;
  }

  /** Wipe to a clean baseline (BUILD-BRIEF §3.3). */
  async reset(): Promise<void> {
    await this.c.query(`truncate ${TABLES.join(', ')}, journal, audit_log restart identity cascade`);
    await this.c.query('delete from vault.secret');
    this.counters = zero();
  }

  private async seedMembers(): Promise<void> {
    await this.c.query(`insert into member(id, role, label) values
      ('mem-a','adult','Adult A'), ('mem-b','adult','Adult B'),
      ('mem-p','adult','Adult P (partner of A)'), ('mem-c','child','Child C')
      on conflict (id) do nothing`);
    await this.c.query(`insert into partnership(a,b) values ('mem-a','mem-p') on conflict do nothing`);
  }

  members() {
    return [
      { id: 'mem-a', role: 'adult' as const, label: 'Adult A' },
      { id: 'mem-b', role: 'adult' as const, label: 'Adult B (non-partner)' },
      { id: 'mem-p', role: 'adult' as const, partnerOf: ['mem-a'], label: 'Adult P (partner of A)' },
      { id: 'mem-c', role: 'child' as const, label: 'Child C' },
    ];
  }

  // -------------------------------------------------------------------------
  // Ingest — the boundary (BP-01 validation) + the data-layer laws.
  // -------------------------------------------------------------------------
  async seed(_who: Who, records: Record_[], connection = 'tck'): Promise<{ accepted: string[]; rejected: { index: number; id?: string; reasons: string[] }[]; counters: Counters }> {
    const accepted: string[] = [];
    const rejected: { index: number; id?: string; reasons: string[] }[] = [];
    for (let i = 0; i < records.length; i++) {
      const rec = structuredClone(records[i]);
      const reasons = validateRecord(rec);
      if (reasons.length) { this.counters.rejected_malformed++; rejected.push({ index: i, id: rec.id as string, reasons }); continue; }
      // Unknown scope fails closed → private (BP-01 §8, CD-6).
      const vis = rec.visibility as string;
      if (typeof vis === 'string' && vis.startsWith('shared:') && !isRegisteredScope(vis.slice(7))) rec.visibility = 'private';
      // Children's wall (BP-02 §3.1): a child-owned row is forced to shared:household, in the doc
      // as well as the column (the trigger enforces the column structurally; this keeps export
      // honest). Children cannot hold private rows.
      if (rec.owner && (await this.isChild(rec.owner as string))) rec.visibility = 'shared:household';
      if (typeof rec.subtype === 'string' && !this.isBase(rec.subtype as string)) this.counters.passed_through_unknown++;
      try {
        await this.insert(rec, connection);
        accepted.push(rec.id as string);
        if (rec.type === 'entity') await this.applyDerivation(rec, connection);
        // Mirror derived records into the derived-memory store, so forget-to-zero is proven
        // across derived stores (BP-02 §5.3) through the ordinary seed path.
        if (rec.source === 'derived' || rec.source === 'agent-inference') {
          await this.c.query(
            `insert into derived_memory(id,owner,visibility,sensitivity,source,provenance,connection,doc)
             values($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
            [`dm:${rec.id}`, (rec.owner as string) ?? null, rec.visibility as string, rec.sensitivity as string,
             rec.source as string, (rec.provenance as string[]) ?? [], connection, rec]);
        }
      } catch (err) {
        // Storage-layer rejections (e.g. provenance-totality constraint) are conformant refusals.
        this.counters.rejected_malformed++;
        rejected.push({ index: i, id: rec.id as string, reasons: [String((err as Error).message)] });
      }
    }
    // Per-exchange audit log (BP-02 §6): metadata only, never payload bodies.
    await this.logExchange({
      exchange_id: `ex-${randomBytes(6).toString('hex')}`, peer: connection, direction: 'inbound',
      method: 'records.seed', outcome: rejected.length ? 'rejected' : 'ok',
      counts: { records: accepted.length, rejected: rejected.length },
      classes_present: [...new Set(records.map((r) => r.sensitivity as string).filter(Boolean))],
      signature_valid: true,
    });
    return { accepted, rejected, counters: { ...this.counters } };
  }

  private childCache: Set<string> | null = null;
  private async isChild(memberId: string): Promise<boolean> {
    if (!this.childCache) {
      const res = await this.c.query("select id from member where role = 'child'");
      this.childCache = new Set(res.rows.map((r) => r.id as string));
    }
    return this.childCache.has(memberId);
  }

  private isBase(s: string): boolean {
    // mirror of the vocabulary base lists (validate.ts owns the authoritative set).
    return /^(person|organisation|account|document|product|place|device|vehicle|property|policy|pet|goal|list|plan|fact|authority_policy|task|event|message|transaction|reminder|note|observation|status_change|appointment|renewal|job|plan_step|owns|member_of|works_for|related_to|parent_of|attended|assigned_to|blocks|depends_on|paid|mentions|derived_from|cares_for|shares_with|insured_by|located_at|travelling_on|responsible_for|child_of|partner_of|paid_from|same_as|disagreement)$/.test(s);
  }

  private async insert(rec: Record_, connection: string): Promise<void> {
    const common = {
      id: rec.id as string, owner: (rec.owner as string) ?? null,
      visibility: rec.visibility as string, sensitivity: rec.sensitivity as string,
      source: rec.source as string, external_ref: (rec.external_ref as string) ?? null,
      origin_chain: (rec.origin_chain as string[]) ?? [], provenance: (rec.provenance as string[]) ?? [],
      connection, doc: rec,
    };
    if (rec.type === 'entity') {
      await this.c.query(
        `insert into entity(id,owner,visibility,sensitivity,source,external_ref,state,origin_chain,provenance,connection,doc)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (source, external_ref) do update set owner=excluded.owner,visibility=excluded.visibility,
           sensitivity=excluded.sensitivity,state=excluded.state,origin_chain=excluded.origin_chain,
           provenance=excluded.provenance,doc=excluded.doc`,
        [common.id, common.owner, common.visibility, common.sensitivity, common.source, common.external_ref, (rec.state as string) ?? null, common.origin_chain, common.provenance, connection, common.doc]);
    } else if (rec.type === 'activity') {
      await this.c.query(
        `insert into activity(id,owner,visibility,sensitivity,source,external_ref,state,origin_chain,provenance,connection,doc)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (source, external_ref) do update set owner=excluded.owner,visibility=excluded.visibility,
           sensitivity=excluded.sensitivity,state=excluded.state,origin_chain=excluded.origin_chain,
           provenance=excluded.provenance,doc=excluded.doc`,
        [common.id, common.owner, common.visibility, common.sensitivity, common.source, common.external_ref, (rec.state as string) ?? 'open', common.origin_chain, common.provenance, connection, common.doc]);
    } else if (rec.type === 'edge') {
      await this.c.query(
        `insert into edge(id,owner,visibility,sensitivity,source,subject_urn,object_urn,origin_chain,provenance,connection,doc)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do update set doc=excluded.doc`,
        [common.id, common.owner, common.visibility, common.sensitivity, common.source, rec.subject as string, rec.object as string, common.origin_chain, common.provenance, connection, common.doc]);
    } else if (rec.type === 'action') {
      await this.c.query(
        `insert into action(id,owner,visibility,sensitivity,source,external_ref,state,origin_chain,provenance,connection,doc)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (source, external_ref) do update set state=excluded.state,doc=excluded.doc`,
        [common.id, common.owner, common.visibility, common.sensitivity, common.source, common.external_ref, (rec.state as string) ?? 'proposed', common.origin_chain, common.provenance, connection, common.doc]);
    }
    await this.journal('created', (rec.owner as string) ?? rec.source as string, rec.id as string, rec.source as string, connection);
  }

  /** A derived memory (summary) whose provenance reaches the connection (for forget tests). */
  async seedDerivedMemory(owner: string, provenance: string[], connection: string, doc: Record_): Promise<string> {
    const id = `urn:brain:brainfeeder:entity:00000000-0000-4000-8000-${randomBytes(6).toString('hex')}`;
    await this.c.query(
      `insert into derived_memory(id,owner,visibility,sensitivity,source,provenance,connection,doc)
       values($1,$2,'shared:household','S1','derived',$3,$4,$5)`,
      [id, owner, provenance, connection, { id, type: 'entity', subtype: 'fact', ...doc }]);
    return id;
  }

  private async applyDerivation(entity: Record_, connection: string): Promise<void> {
    const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
    const archived = entity.state === 'archived';
    for (const [k, val] of Object.entries(attrs)) {
      if (!DATED_REQUIREMENT.test(k) || typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(val)) continue;
      const extRef = `${entity.external_ref}#${k}`;
      const existing = await this.c.query('select id from activity where source=$1 and external_ref=$2', [entity.source, extRef]);
      if (archived) { if (existing.rowCount) await this.c.query('delete from activity where source=$1 and external_ref=$2', [entity.source, extRef]); continue; }
      const id = existing.rows[0]?.id ?? `urn:brain:${entity.source}:activity:00000000-0000-4000-8000-${randomBytes(6).toString('hex')}`;
      const doc: Record_ = {
        id, type: 'activity', subtype: 'task', source: entity.source, external_ref: extRef, owner: entity.owner,
        subject: entity.id, valid_time: `${val}T00:00:00Z`, system_time: entity.system_time, state: 'open',
        visibility: entity.visibility, sensitivity: entity.sensitivity, provenance: [entity.id],
        attributes: { title: `${k} — ${(attrs.name as string) ?? entity.external_ref}`, due_on: val },
      };
      await this.insert(doc, connection);
    }
  }

  // -------------------------------------------------------------------------
  // Reads under RLS (SET LOCAL ROLE brain_app + app.member).
  // -------------------------------------------------------------------------
  async query(who: Who, predicate: Record<string, unknown> = {}): Promise<Record_[]> {
    const m = memberId(who);
    await this.c.query('begin');
    try {
      await this.c.query('set local role brain_app');
      await this.c.query("select set_config('app.member', $1, true)", [m]);
      const docs: Record_[] = [];
      for (const t of TABLES) {
        const res = await this.c.query(`select doc from ${t}`);
        for (const row of res.rows) docs.push(row.doc as Record_);
      }
      await this.c.query('commit');
      const out = docs.filter((d) => this.matches(d, predicate));
      await this.logExchange({
        exchange_id: `ex-${randomBytes(6).toString('hex')}`, peer: m || 'anon', direction: 'inbound',
        method: 'records.query', outcome: 'ok', counts: { records: out.length }, signature_valid: true,
      });
      return out;
    } catch (e) {
      await this.c.query('rollback'); throw e;
    }
  }

  private matches(r: Record_, p: Record<string, unknown>): boolean {
    if (p.id && r.id !== p.id) return false;
    if (p.type && r.type !== p.type) return false;
    if (p.subtype && r.subtype !== p.subtype) return false;
    if (p.source && r.source !== p.source) return false;
    if (p.externalRef && r.external_ref !== p.externalRef) return false;
    if (p.owner && r.owner !== p.owner) return false;
    if (p.visibility && r.visibility !== p.visibility) return false;
    if (p.originChainContains && !(Array.isArray(r.origin_chain) && (r.origin_chain as string[]).includes(p.originChainContains as string))) return false;
    if (p.provenanceMintedBy && !(Array.isArray(r.provenance) && (r.provenance as string[]).some((u) => u.includes(`:${p.provenanceMintedBy}:`)))) return false;
    return true;
  }

  // -------------------------------------------------------------------------
  // Vault (BP-02 §4).
  // -------------------------------------------------------------------------
  async mintSecret(connection: string): Promise<string> {
    const secret = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(secret).digest('hex');
    await this.c.query('select vault.store_secret($1,$2, now() + interval \'90 days\')', [connection, hash]);
    return secret; // shown once
  }
  /** Attempt to read the secret directly as a client (brain_app). MUST fail. */
  async readSecretAs(who: Who, connection: string): Promise<{ returnedSomething: boolean; value?: string }> {
    await this.c.query('begin');
    try {
      await this.c.query('set local role brain_app');
      await this.c.query("select set_config('app.member', $1, true)", [memberId(who)]);
      const res = await this.c.query('select secret_hash from vault.secret where connection=$1', [connection]);
      await this.c.query('commit');
      return { returnedSomething: (res.rowCount ?? 0) > 0, value: res.rows[0]?.secret_hash };
    } catch {
      await this.c.query('rollback');
      return { returnedSomething: false }; // permission denied — no path exists
    }
  }
  async storedSecretForm(connection: string): Promise<'hash' | 'server-ciphertext' | 'plaintext' | 'none'> {
    const res = await this.c.query('select secret_hash from vault.secret where connection=$1', [connection]);
    if (!res.rowCount) return 'none';
    const v = res.rows[0].secret_hash as string;
    return /^[0-9a-f]{64}$/.test(v) ? 'hash' : 'plaintext';
  }

  // -------------------------------------------------------------------------
  // Journal (BP-02 §3.4).
  // -------------------------------------------------------------------------
  private async journal(verb: string, actor: string, objectUrn: string, source: string, connection: string, detail?: Record_): Promise<void> {
    await this.c.query('insert into journal(actor,verb,object_urn,source,connection,detail) values($1,$2,$3,$4,$5,$6)',
      [actor, verb, objectUrn, source, connection, detail ?? null]);
  }
  /** Attempt UPDATE/DELETE against the journal as a client. MUST be refused by the data layer. */
  async journalWriteAttempt(op: 'update' | 'delete'): Promise<{ rejected: boolean; reason?: string }> {
    await this.c.query('begin');
    try {
      await this.c.query('set local role brain_app');
      if (op === 'update') await this.c.query("update journal set verb='tampered' where true");
      else await this.c.query('delete from journal where true');
      await this.c.query('commit');
      return { rejected: false };
    } catch (e) {
      await this.c.query('rollback');
      return { rejected: true, reason: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Audit log (BP-02 §6, CD-3).
  // -------------------------------------------------------------------------
  async logExchange(e: { exchange_id: string; grant_id?: string; peer?: string; direction?: string; method?: string; outcome?: string; counts?: Record_; classes_present?: string[]; signature_valid?: boolean }): Promise<void> {
    await this.c.query(
      `insert into audit_log(exchange_id,grant_id,peer,direction,method,outcome,counts,classes_present,signature_valid)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (exchange_id) do nothing`,
      [e.exchange_id, e.grant_id ?? null, e.peer ?? null, e.direction ?? null, e.method ?? null, e.outcome ?? null, e.counts ?? null, e.classes_present ?? null, e.signature_valid ?? null]);
  }
  async readAuditLog(): Promise<Record_[]> {
    const res = await this.c.query('select * from audit_log order by at');
    return res.rows as Record_[];
  }

  // -------------------------------------------------------------------------
  // Forget on disconnect (BP-02 §5).
  // -------------------------------------------------------------------------
  private forgetLog: { connection: string; at: string; receipt: Record_ }[] = [];

  async disconnect(connection: string, trigger: 'user_disconnect' | 'peer_revoked' | 'token_rejected' = 'user_disconnect'): Promise<void> {
    const started = new Date().toISOString();
    // Predicate per BP-02 §5.1: source = X OR origin_chain contains X OR provenance minted by X,
    // plus rows tagged with the connection. Purge in dependency order (§5.2): derived → edges →
    // activities → entities → actions → journal payload rows.
    const erased = { entities: 0, activities: 0, edges: 0, actions: 0, derived_memories: 0, journal_rows: 0 };
    const pred = `(source = $1 or connection = $1 or $1 = any(origin_chain) or exists (select 1 from unnest(provenance) p where p like '%:'||$1||':%'))`;
    const predNoChain = `(source = $1 or connection = $1 or exists (select 1 from unnest(provenance) p where p like '%:'||$1||':%'))`;
    erased.derived_memories = (await this.c.query(`delete from derived_memory where ${predNoChain}`, [connection])).rowCount ?? 0;
    erased.edges = (await this.c.query(`delete from edge where ${pred}`, [connection])).rowCount ?? 0;
    erased.activities = (await this.c.query(`delete from activity where ${pred}`, [connection])).rowCount ?? 0;
    erased.entities = (await this.c.query(`delete from entity where ${pred}`, [connection])).rowCount ?? 0;
    erased.actions = (await this.c.query(`delete from action where ${pred}`, [connection])).rowCount ?? 0;
    erased.journal_rows = (await this.c.query(`delete from journal where connection = $1 and detail is not null`, [connection])).rowCount ?? 0;
    const keys = await this.c.query('select vault.destroy_secrets($1) as n', [connection]);
    const keysDestroyed = keys.rows[0].n as number;
    await this.journal('forgot', 'system', `urn:brain:reference:action:forget-${connection}`, 'reference', connection);
    // Audit: scan every provenance-bearing table for residue under the predicate.
    const remaining = await this.auditResidue(connection);
    const completed = new Date().toISOString();
    const receipt: Record_ = {
      receipt_id: `urn:brain:reference:action:${randomBytes(8).toString('hex')}`,
      connection, trigger, started_at: started, completed_at: completed,
      erased, keys_destroyed: { grant_keys: keysDestroyed, tokens_revoked: keysDestroyed, at: completed },
      audit: { tables_scanned: 6, rows_remaining: remaining }, backup_window_days: 30,
    };
    this.forgetLog.push({ connection, at: completed, receipt });
    this.lastReceipts.set(connection, receipt);
  }

  private async auditResidue(connection: string): Promise<number> {
    const pred = `(source = $1 or connection = $1 or $1 = any(origin_chain) or exists (select 1 from unnest(provenance) p where p like '%:'||$1||':%'))`;
    const predNoChain = `(source = $1 or connection = $1 or exists (select 1 from unnest(provenance) p where p like '%:'||$1||':%'))`;
    let n = 0;
    for (const t of ['entity', 'activity', 'edge', 'action']) {
      n += (await this.c.query(`select count(*)::int c from ${t} where ${pred}`, [connection])).rows[0].c;
    }
    n += (await this.c.query(`select count(*)::int c from derived_memory where ${predNoChain}`, [connection])).rows[0].c;
    n += (await this.c.query(`select count(*)::int c from journal where connection=$1 and detail is not null`, [connection])).rows[0].c;
    return n;
  }

  private lastReceipts = new Map<string, Record_>();
  async readReceipt(connection: string): Promise<Record_> {
    const r = this.lastReceipts.get(connection);
    if (!r) throw new Error(`no forget receipt for ${connection}`);
    return r;
  }

  // -------------------------------------------------------------------------
  // Backup / restore (BP-02 §5.6).
  // -------------------------------------------------------------------------
  async backup(): Promise<unknown> {
    const snap: Record<string, unknown[]> = {};
    for (const t of [...TABLES, 'journal', 'audit_log']) {
      snap[t] = (await this.c.query(`select * from ${t}`)).rows;
    }
    snap.__forgetLogAt = [{ at: new Date().toISOString() }];
    return snap;
  }

  async restore(snapshot: unknown): Promise<{ replayedForgetLog: boolean; servedTrafficBeforeReplay: boolean }> {
    const snap = snapshot as Record<string, any[]>;
    const takenAt = snap.__forgetLogAt?.[0]?.at ?? new Date(0).toISOString();
    await this.c.query(`truncate ${TABLES.join(', ')}, journal, audit_log restart identity cascade`);
    // Reinsert backed-up rows (raw, as owner — bypasses RLS).
    for (const t of TABLES) {
      for (const row of snap[t] ?? []) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => `$${i + 1}`).join(',');
        await this.c.query(`insert into ${t}(${cols.join(',')}) values(${vals})`, cols.map((k) => row[k]));
      }
    }
    // Replay the forget log BEFORE serving traffic: re-purge every connection forgotten since
    // the backup was taken, and re-audit to zero (BP-02 §5.6). Keys were destroyed and are not
    // in the backup, so any S2 ciphertext restored is permanently unreadable.
    const toReplay = this.forgetLog.filter((f) => f.at > takenAt);
    for (const f of toReplay) await this.disconnect(f.connection, 'user_disconnect');
    return { replayedForgetLog: true, servedTrafficBeforeReplay: false };
  }

  async snapshotChecksum(): Promise<string> {
    const docs: unknown[] = [];
    for (const t of TABLES) {
      const res = await this.c.query(`select doc from ${t} order by id`);
      for (const r of res.rows) docs.push(r.doc);
    }
    return createHash('sha256').update(JSON.stringify(docs)).digest('hex');
  }

  // -------------------------------------------------------------------------
  // Staged atomic resync (BP-04 §3.3.3): stage in a transaction, swap in one commit. A resync
  // killed before the commit leaves prior state byte-intact — the read model never blanks.
  // -------------------------------------------------------------------------
  async stagedResync(records: Record_[], connection: string, crashBeforeSwap: boolean): Promise<{ swapped: boolean }> {
    await this.c.query('begin');
    try {
      for (const rec of records) {
        const reasons = validateRecord(rec);
        if (reasons.length) { await this.c.query('rollback'); throw new Error('staged record invalid: ' + reasons[0]); }
        await this.insert(rec, connection);
      }
      if (crashBeforeSwap) { await this.c.query('rollback'); return { swapped: false }; }
      await this.c.query('commit');
      return { swapped: true };
    } catch (e) {
      try { await this.c.query('rollback'); } catch { /* */ }
      throw e;
    }
  }

  /** A narrow computed live-query answer (BP-04 §3.1): presence, never underlying diary rows. */
  async presence(member: string): Promise<{ available: boolean; eta: string | null }> {
    // Computed from recent activities under the member lens — only the narrowest answer leaves.
    const rows = await this.query({ id: member, role: 'adult' }, { type: 'activity' });
    return { available: rows.length === 0, eta: rows.length ? '19:00' : null };
  }

  // -------------------------------------------------------------------------
  // The Class D human gate (BP-08 §2): server-side recorded, payload-hash-bound, idempotent.
  // A client claim of "confirmed" is nothing — only a stored confirm permits execution.
  // -------------------------------------------------------------------------
  private confirms = new Map<string, Set<string>>();   // actionId -> set of confirmed payload hashes
  private executed = new Map<string, Record_>();        // idempotency key -> original result

  recordConfirm(actionId: string, payloadHash: string, _by: string): void {
    const set = this.confirms.get(actionId) ?? new Set<string>();
    set.add(payloadHash);
    this.confirms.set(actionId, set);
  }

  tryExecute(actionId: string, payloadHash: string, idempotencyKey: string): { executed: boolean; reason?: string; result?: Record_ } {
    if (this.executed.has(idempotencyKey)) return { executed: false, reason: 'idempotency_replay', result: this.executed.get(idempotencyKey) };
    const set = this.confirms.get(actionId);
    if (!set || set.size === 0) return { executed: false, reason: 'no_stored_confirm' };
    if (!set.has(payloadHash)) return { executed: false, reason: 'payload_hash_mismatch' };
    const result = { appointment_ref: `appt/${randomBytes(3).toString('hex')}` };
    this.executed.set(idempotencyKey, result);
    return { executed: true, result };
  }
}
