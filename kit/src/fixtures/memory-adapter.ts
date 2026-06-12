// A minimal in-memory conformant adapter — the kit's own self-test fixture for Wave A.
//
// It implements the boundary (the schemas/ validator), unknown-field/subtype pass-through,
// unknown-scope-fails-closed, and the BP-01 §12 derivation rule, so the ENV suite can run
// end-to-end and be proven green before the real Postgres reference pipe exists (Wave B).
// It is NOT the reference implementation: it has no RLS, vault, or forget. Data-layer suites
// (DAT, SEC, GAT) run against reference/adapter.ts, not this.

import type {
  Adapter, BrainRecord, Counters, MemberRef, QueryPredicate, SeedResult, Who,
  SecretReadAttempt, StoredSecretForm, JournalWriteAttempt, AuditEntry, ForgetReceipt,
  Snapshot, RestoreResult,
} from '../types.js';
import { validateRecord, isRegisteredScope } from '../validate.js';

const zeroCounters = (): Counters => ({
  rejected_malformed: 0, rejected_unsigned: 0, rejected_replayed: 0, rejected_echo: 0,
  rejected_hop_limit: 0, rejected_ceiling: 0, rejected_sensitivity: 0,
  truncated_overcap: 0, passed_through_unknown: 0,
});

const DATED_REQUIREMENT = /(_due|_expiry|_renewal|_review)$|^mot_due$/;

export class MemoryAdapter implements Adapter {
  private store = new Map<string, BrainRecord>();
  private counters = zeroCounters();

  async reset(): Promise<void> { this.store.clear(); this.counters = zeroCounters(); }
  async close(): Promise<void> { /* nothing */ }

  async members(): Promise<MemberRef[]> {
    return [
      { id: 'mem-a', role: 'adult', label: 'Adult A' },
      { id: 'mem-b', role: 'adult', label: 'Adult B (non-partner)' },
      { id: 'mem-c', role: 'child', label: 'Child C' },
    ];
  }

  async seedAs(_who: Who, records: BrainRecord[], _opts?: { connection?: string }): Promise<SeedResult> {
    const accepted: string[] = [];
    const rejected: SeedResult['rejected'] = [];
    records.forEach((rec, index) => {
      const v = validateRecord(rec);
      if (!v.valid) {
        this.counters.rejected_malformed++;
        rejected.push({ index, id: typeof rec.id === 'string' ? rec.id : undefined, reasons: v.reasons });
        return;
      }
      const stored = structuredClone(rec);
      // Unknown scope fails closed → private (BP-01 §8, CD-6).
      const vis = stored.visibility;
      if (typeof vis === 'string' && vis.startsWith('shared:')) {
        const scope = vis.slice('shared:'.length);
        if (!isRegisteredScope(scope)) stored.visibility = 'private';
      }
      // Count opaque pass-through of unknown terms.
      if (typeof stored.subtype === 'string' && !this.isBaseSubtype(stored.subtype)) {
        this.counters.passed_through_unknown++;
      }
      this.store.set(stored.id as string, stored);
      accepted.push(stored.id as string);
      // Derivation rule (BP-01 §12).
      if (stored.type === 'entity') this.applyDerivation(stored);
    });
    return { accepted, rejected, counters: { ...this.counters } };
  }

  private isBaseSubtype(s: string): boolean {
    // Mirror of vocabulary base lists; unknown ⇒ opaque pass-through.
    const base = new Set<string>([
      'person','organisation','account','document','product','place','device','vehicle','property',
      'policy','pet','goal','list','plan','fact','authority_policy','task','event','message','transaction',
      'reminder','note','observation','status_change','appointment','renewal','job','plan_step',
      'owns','member_of','works_for','related_to','parent_of','attended','assigned_to','blocks','depends_on',
      'paid','mentions','derived_from','cares_for','shares_with','insured_by','located_at','travelling_on',
      'responsible_for','child_of','partner_of','paid_from','same_as','disagreement',
    ]);
    return base.has(s);
  }

  private applyDerivation(entity: BrainRecord): void {
    const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
    const archived = entity.state === 'archived';
    for (const [k, val] of Object.entries(attrs)) {
      if (!DATED_REQUIREMENT.test(k)) continue;
      if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(val)) continue;
      const extRef = `${entity.external_ref}#${k}`;
      // find existing derived activity by external_ref
      const existing = [...this.store.values()].find((r) => r.type === 'activity' && r.external_ref === extRef);
      if (archived) {
        if (existing) this.store.delete(existing.id as string);
        continue;
      }
      const id = existing?.id ?? `urn:brain:${entity.source}:activity:00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
      const derived: BrainRecord = {
        id, type: 'activity', subtype: 'task', source: entity.source,
        external_ref: extRef, owner: entity.owner,
        subject: entity.id,
        valid_time: `${val}T00:00:00Z`, system_time: entity.system_time, state: 'open',
        visibility: entity.visibility, sensitivity: entity.sensitivity,
        provenance: [entity.id as string],
        attributes: { title: `${k} — ${(attrs.name as string) ?? entity.external_ref}`, due_on: val },
      };
      this.store.set(id, derived);
    }
  }

  async queryAs(_who: Who, predicate: QueryPredicate): Promise<BrainRecord[]> {
    return [...this.store.values()].filter((r) => this.matches(r, predicate)).map((r) => structuredClone(r));
  }
  async countAs(who: Who, predicate: QueryPredicate): Promise<number> {
    return (await this.queryAs(who, predicate)).length;
  }
  async exportAs(_who: Who, predicate?: QueryPredicate): Promise<BrainRecord[]> {
    const all = [...this.store.values()];
    const sel = predicate ? all.filter((r) => this.matches(r, predicate)) : all;
    return sel.map((r) => structuredClone(r));
  }

  private matches(r: BrainRecord, p: QueryPredicate): boolean {
    if (p.id && r.id !== p.id) return false;
    if (p.type && r.type !== p.type) return false;
    if (p.subtype && r.subtype !== p.subtype) return false;
    if (p.source && r.source !== p.source) return false;
    if (p.externalRef && r.external_ref !== p.externalRef) return false;
    if (p.owner && r.owner !== p.owner) return false;
    if (p.visibility && r.visibility !== p.visibility) return false;
    if (p.originChainContains && !(Array.isArray(r.origin_chain) && r.origin_chain.includes(p.originChainContains))) return false;
    if (p.provenanceMintedBy && !(Array.isArray(r.provenance) && (r.provenance as string[]).some((u) => u.includes(`:${p.provenanceMintedBy}:`)))) return false;
    return true;
  }

  // Data-layer surfaces this fixture does not implement (DAT/SEC/GAT use reference/adapter.ts).
  private notImpl(): never { throw new Error('memory adapter: not implemented (use reference/adapter.ts for data-layer suites)'); }
  async mintSecret(): Promise<{ shownOnce: string }> { return this.notImpl(); }
  async readSecretAs(): Promise<SecretReadAttempt> { return this.notImpl(); }
  async storedSecretForm(): Promise<StoredSecretForm> { return this.notImpl(); }
  async journalWriteAttempt(): Promise<JournalWriteAttempt> { return this.notImpl(); }
  async readAuditLog(): Promise<AuditEntry[]> { return this.notImpl(); }
  async disconnect(): Promise<void> { return this.notImpl(); }
  async readReceipt(): Promise<ForgetReceipt> { return this.notImpl(); }
  async backup(): Promise<Snapshot> { return this.notImpl(); }
  async restore(): Promise<RestoreResult> { return this.notImpl(); }
  async snapshotChecksum(): Promise<string> { return this.notImpl(); }
}

export default async function createMemoryAdapter(): Promise<Adapter> {
  return new MemoryAdapter();
}
