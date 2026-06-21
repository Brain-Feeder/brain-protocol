// The reference pipe's TCK adapter (BUILD-BRIEF §3.2, §7). This is what `--adapter` loads:
//   brain-tck run --class D --target http://localhost:8080 --adapter ../reference/adapter.ts
// It is the implementer's code against their own store — here, the reference Postgres pipe.
// It implements the frozen contract in kit/src/types.ts, thinly: every method delegates to the
// pipe's data layer, which is where the laws actually live.

import { Pipe } from './src/pipe.js';
import type {
  Adapter, BrainRecord, MemberRef, QueryPredicate, SeedResult, Who, SecretReadAttempt,
  StoredSecretForm, JournalWriteAttempt, AuditEntry, ForgetReceipt, Snapshot, RestoreResult,
} from '../../kit/src/types.js';

class ReferenceAdapter implements Adapter {
  constructor(private pipe: Pipe) {}

  async reset(): Promise<void> { await this.pipe.reset(); }
  async close(): Promise<void> { await this.pipe.close(); }
  async members(): Promise<MemberRef[]> { return this.pipe.members(); }

  async seedAs(member: Who, records: BrainRecord[], opts?: { connection?: string }): Promise<SeedResult> {
    const r = await this.pipe.seed(member as any, records as any, opts?.connection ?? 'tck');
    return r as unknown as SeedResult;
  }
  async queryAs(who: Who, predicate: QueryPredicate): Promise<BrainRecord[]> {
    return (await this.pipe.query(who as any, predicate as any)) as BrainRecord[];
  }
  async countAs(who: Who, predicate: QueryPredicate): Promise<number> {
    return (await this.pipe.query(who as any, predicate as any)).length;
  }
  async exportAs(who: Who, predicate?: QueryPredicate): Promise<BrainRecord[]> {
    return (await this.pipe.query(who as any, (predicate ?? {}) as any)) as BrainRecord[];
  }

  async mintSecret(connection: string): Promise<{ shownOnce: string }> {
    return { shownOnce: await this.pipe.mintSecret(connection) };
  }
  async readSecretAs(member: Who, connection: string): Promise<SecretReadAttempt> {
    return this.pipe.readSecretAs(member as any, connection);
  }
  async storedSecretForm(connection: string): Promise<StoredSecretForm> {
    return this.pipe.storedSecretForm(connection);
  }

  async journalWriteAttempt(op: 'update' | 'delete'): Promise<JournalWriteAttempt> {
    return this.pipe.journalWriteAttempt(op);
  }
  async readAuditLog(): Promise<AuditEntry[]> {
    return (await this.pipe.readAuditLog()) as AuditEntry[];
  }

  async disconnect(connection: string, trigger?: ForgetReceipt['trigger']): Promise<void> {
    await this.pipe.disconnect(connection, trigger);
  }
  async readReceipt(connection: string): Promise<ForgetReceipt> {
    return (await this.pipe.readReceipt(connection)) as unknown as ForgetReceipt;
  }

  async backup(): Promise<Snapshot> { return this.pipe.backup(); }
  async restore(snapshot: Snapshot): Promise<RestoreResult> { return this.pipe.restore(snapshot); }
  async snapshotChecksum(): Promise<string> { return this.pipe.snapshotChecksum(); }

  async recordConfirm(actionId: string, payloadHash: string, by: string): Promise<void> {
    this.pipe.recordConfirm(actionId, payloadHash, by);
  }
  async tryExecute(actionId: string, payloadHash: string, idempotencyKey: string) {
    return this.pipe.tryExecute(actionId, payloadHash, idempotencyKey);
  }

  /** Helpers the kit may call for forget tests: seed a derived memory whose provenance reaches
   *  the connection (so forget-to-zero is proven across derived stores, BP-02 §5.3). */
  async seedDerivedMemory(owner: string, provenance: string[], connection: string): Promise<string> {
    return this.pipe.seedDerivedMemory(owner, provenance, connection, { attributes: { summary: 'derived from connection' } });
  }
}

export default async function createAdapter(): Promise<Adapter> {
  const pipe = new Pipe();
  await pipe.start();
  return new ReferenceAdapter(pipe);
}
