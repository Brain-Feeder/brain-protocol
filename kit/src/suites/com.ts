// COM — communications and sync (BP-04). Class D: T-COM-01/02/03/06/07/08.
// The loop guard, no-foreign-writes and malformed-batch laws are proven over the wire; the
// staged-resync crash test and live-query narrowness need surfaces deferred to the Wave C
// remainder and skip honestly.

import { defineTest, type TestContext } from '../harness.js';
import { WireClient } from '../peer/wire.js';
import { randUrn as urn, resetUuids, validPerson, validActivity, without } from '../fixtures/records.js';

function wire(ctx: TestContext): WireClient {
  if (!ctx.target) ctx.skip('COM needs --target (the wire surface)');
  return new WireClient(ctx.target);
}
// Ingest is the sync direction — pushing our own records under our connection — so the seeding
// cell is mode 'sync' (2.0.2): a read grant can never write (BP-04 §5.1). Foreign writes
// (upsert/write/tombstone) stay denied regardless of grant.
const CELL = { capability: 'records', direction: 'offer', mode: 'sync', sensitivity_ceiling: 'S1' };

// T-COM-01 — staged-resync crash test (AC-04.1).
defineTest({
  id: 'T-COM-01', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'staged-resync crash test', clause: 'BP-04 §3.3.3 / AC-04.1 (T-COM-01)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [
      { capability: 'records', direction: 'offer', mode: 'sync', sensitivity_ceiling: 'S1' },
      { capability: 'state', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' },
    ] });
    // Seed a known-good committed state.
    await w.call('records.ingest', { records: [validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'sync/base', owner: 'mem-a' })] });
    const c0 = (await w.call('state.checksum', {})).body?.body?.checksum;
    // A resync killed before the swap: stage new records, then crash before commit.
    const newRecs = [validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'sync/new', owner: 'mem-a' })];
    const crashed = await w.call('records.resync', { records: newRecs, crashBeforeSwap: true });
    const c1 = (await w.call('state.checksum', {})).body?.body?.checksum;
    ctx.note('checksums', { c0, afterCrash: c1, swapped: crashed.body?.body?.swapped });
    ctx.check(crashed.body?.body?.swapped === false, 'BP-04 §3.3.3', 'a resync killed before the swap must not swap');
    ctx.check(c0 === c1 && !!c0, 'BP-04 §3.3.3 / AC-04.1',
      'the read model must equal the pre-sync state byte-for-byte after a mid-run crash (never blanks)');
    // A clean resync then commits.
    const ok = await w.call('records.resync', { records: newRecs });
    ctx.check(ok.body?.body?.swapped === true, 'BP-04 §3.3.3', 'a clean staged resync swaps atomically');
  },
});

// T-COM-02 — loop-guard echo test (AC-04.2).
defineTest({
  id: 'T-COM-02', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'loop-guard echo test', clause: 'BP-04 §4.3 / AC-04.2 (T-COM-02)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    // The echo is the TARGET's own id reflected back — learned from its card, never assumed
    // (TPMS friction log, 2026-06-12). A system honestly named anything must pass this test.
    const sid = ctx.targetSystemId;
    if (!sid) return ctx.skip('could not determine the target system id (its card carried no system_id, and no --system-id was given)');
    await w.handshake({ matrix: [CELL] });
    // own id in chain.
    const echoChain = validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'e/chain', owner: 'mem-a', origin_chain: ['garagebrain', sid] });
    // claims the target as its source.
    const echoSource = validPerson({ id: urn(sid, 'entity'), source: sid, external_ref: 'e/src', owner: 'mem-a' });
    const r1 = await w.call('records.ingest', { records: [echoChain] });
    const r2 = await w.call('records.ingest', { records: [echoSource] });
    ctx.note('echo', { chain: r1.body?.error?.code, source: r2.body?.error?.code });
    ctx.check(r1.body?.error?.code === 'echo_rejected' && r2.body?.error?.code === 'echo_rejected', 'BP-04 §4.3',
      'a record with the target in its chain, or claiming it as source, must be rejected with echo_rejected');
  },
});

// T-COM-03 — hop cap (AC-04.2).
defineTest({
  id: 'T-COM-03', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'hop cap', clause: 'BP-04 §4.3 / AC-04.2 (T-COM-03)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [CELL] });
    const fourHops = validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'h/4', owner: 'mem-a', origin_chain: ['a', 'b', 'c', 'd'] });
    const r = await w.call('records.ingest', { records: [fourHops] });
    ctx.note('hop', r.body?.error?.code);
    ctx.check(r.body?.error?.code === 'hop_limit_exceeded', 'BP-04 §4.3', 'a chain longer than 3 hops must be rejected');
  },
});

// T-COM-06 — no foreign writes (AC-04.4).
defineTest({
  id: 'T-COM-06', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'no foreign writes', clause: 'BP-04 §5.1 / AC-04.4 (T-COM-06)',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [CELL] });
    const upsert = await w.call('records.upsert', { records: [] });
    const write = await w.call('records.write', { records: [] });
    const tombstone = await w.call('records.tombstone', { id: 'urn:brain:garagebrain:activity:00000000-0000-4000-8000-000000000001' });
    ctx.note('foreign write attempts', { upsert: upsert.body?.error?.code, write: write.body?.error?.code, tombstone: tombstone.body?.error?.code });
    ctx.check([upsert, write, tombstone].every((r) => r.body?.error?.code === 'cell_denied'), 'BP-04 §5.1',
      'every cross-system mutation other than a proposed Action must be refused — propose is the only write');
    // A read grant can never write: records.ingest under a read-only grant must be refused (BP-04 §5.1).
    // Pins the 2.0.2 reference tightening so the unauthenticated-ingest looseness cannot silently return.
    const ro = wire(ctx);
    await ro.handshake({ matrix: [{ capability: 'records', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    const roIngest = await ro.call('records.ingest', { records: [] });
    ctx.note('read-only ingest', roIngest.body?.error?.code ?? roIngest.body);
    ctx.check(roIngest.body?.error?.code === 'cell_denied', 'BP-04 §5.1',
      'records.ingest under a read-only grant must be refused — a read grant can never write');
  },
});

// T-COM-07 — malformed batch handling (AC-04.x).
defineTest({
  id: 'T-COM-07', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'malformed batch handling', clause: 'BP-04 §2.5 / AC-04 (T-COM-07)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [CELL] });
    const malformed = without(validActivity({ id: urn('garagebrain', 'activity'), external_ref: 'm/1', owner: 'mem-a' }), 'owner');
    const r = await w.call('records.ingest', { records: [malformed] });
    ctx.note('malformed', r.body);
    ctx.check(r.body?.error?.code === 'malformed', 'BP-04 §2.5',
      'a schema-invalid batch must be rejected and counted, never partially applied');
  },
});

// T-COM-08 — live-query narrowness (BP-04 §3.1.3).
defineTest({
  id: 'T-COM-08', suite: 'COM', cls: 'D', needs: 'wire',
  name: 'live-query narrowness', clause: 'BP-04 §3.1.3 (T-COM-08)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [{ capability: 'presence', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S0' }] });
    const r = await w.call('presence.read', { question: 'home by 18:00?' });
    ctx.note('presence answer', r.body);
    const body = r.body?.body ?? {};
    // The narrowest computed answer only — never the underlying diary rows.
    ctx.check(typeof body.available === 'boolean', 'BP-04 §3.1.3', 'a presence query must return the narrowest computed answer');
    ctx.check(!('records' in body) && !Array.isArray((body as any).diary), 'BP-04 §3.1.3',
      'a presence query must never return underlying diary rows');
  },
});
