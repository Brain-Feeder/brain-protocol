// ENV — envelope and vocabulary (BP-01). Class D, 10 tests (T-ENV-01..10).
// Driven through the system's boundary (adapter.seedAs) and round-tripped via exportAs.
// Every assertion names the spec clause (BP-01 §/AC-01.x).

import { defineTest, type TestContext } from '../harness.js';
import type { Adapter, BrainRecord, SeedResult } from '../types.js';
import {
  validPerson, validVehicle, validActivity, validEdge, validAction,
  validGoalEntity, validGoalActivity, without, withoutAttr, urn, resetUuids,
} from '../fixtures/records.js';
import { connectVerdict } from '../negotiate.js';

const CONN = 'tck-env-conn';

function adapter(ctx: TestContext): Adapter {
  if (!ctx.adapter) ctx.skip('ENV needs an adapter (the boundary + store)');
  return ctx.adapter;
}

async function seed(ctx: TestContext, recs: BrainRecord[]): Promise<SeedResult> {
  return adapter(ctx).seedAs('anon', recs, { connection: CONN });
}

// T-ENV-01 — envelope rejection (AC-01.1).
defineTest({
  id: 'T-ENV-01', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'envelope rejection', clause: 'BP-01 §5 / AC-01.1',
  async run(ctx) {
    const a = adapter(ctx);
    await a.reset();
    resetUuids();

    // Valid controls of each primitive — must be accepted.
    const controls: Record<string, BrainRecord> = {
      entity: validPerson(), activity: validActivity(), edge: validEdge(), action: validAction(),
    };
    const cres = await a.seedAs('anon', Object.values(controls), { connection: CONN });
    ctx.note('valid controls', { accepted: cres.accepted.length, rejected: cres.rejected });
    ctx.check(cres.rejected.length === 0 && cres.accepted.length === 4,
      'BP-01 §5 / AC-01.1', `valid control records of each primitive must be accepted; rejected=${JSON.stringify(cres.rejected)}`);

    // Invalid: each required field missing, per applicable primitive.
    const invalids: { label: string; rec: BrainRecord }[] = [
      { label: 'entity missing id', rec: without(validPerson(), 'id') },
      { label: 'entity missing type', rec: without(validPerson(), 'type') },
      { label: 'entity missing subtype', rec: without(validPerson(), 'subtype') },
      { label: 'entity missing source', rec: without(validPerson(), 'source') },
      { label: 'entity missing external_ref', rec: without(validPerson(), 'external_ref') },
      { label: 'entity missing owner', rec: without(validPerson(), 'owner') },
      { label: 'entity missing visibility', rec: without(validPerson(), 'visibility') },
      { label: 'entity missing sensitivity', rec: without(validPerson(), 'sensitivity') },
      { label: 'entity missing valid_time', rec: without(validPerson(), 'valid_time') },
      { label: 'entity missing system_time', rec: without(validPerson(), 'system_time') },
      { label: 'entity missing attributes.name', rec: withoutAttr(validPerson(), 'name') },
      { label: 'activity missing owner', rec: without(validActivity(), 'owner') },
      { label: 'activity missing state', rec: without(validActivity(), 'state') },
      { label: 'activity missing attributes.title', rec: withoutAttr(validActivity(), 'title') },
      { label: 'edge missing subject', rec: without(validEdge(), 'subject') },
      { label: 'edge missing object', rec: without(validEdge(), 'object') },
      { label: 'action missing summary', rec: without(validAction(), 'summary') },
      { label: 'action missing payload', rec: without(validAction(), 'payload') },
      { label: 'type goal (invalid as a primitive)', rec: validPerson({ type: 'goal' as unknown as string }) },
      { label: 'urn rtype contradicts type', rec: validPerson({ id: urn('garagebrain', 'activity') }) },
    ];

    let allRejected = true;
    const detail: unknown[] = [];
    for (const { label, rec } of invalids) {
      const r = await a.seedAs('anon', [rec], { connection: CONN });
      const rejected = r.rejected.length === 1 && r.accepted.length === 0;
      if (!rejected) allRejected = false;
      detail.push({ label, rejected, reasons: r.rejected[0]?.reasons });
    }
    ctx.note('invalid variants', detail);
    ctx.check(allRejected, 'BP-01 §5 / AC-01.1',
      `every invalid record must be rejected with a per-field error and counted; got ${JSON.stringify(detail.filter((d: any) => !d.rejected))}`);

    // Counted: rejections must increment the malformed counter.
    const counters = (await a.seedAs('anon', [without(validPerson(), 'owner')], { connection: CONN })).counters;
    ctx.check(counters.rejected_malformed > 0, 'BP-04 §9.2',
      'rejections must be counted in rejected_malformed (boundary counting)');
  },
});

// T-ENV-02 — bitemporal backfill (AC-01.2).
defineTest({
  id: 'T-ENV-02', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'bitemporal backfill', clause: 'BP-01 §6 / AC-01.2 (CD-5)',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const backfilled = validPerson({ valid_time: '2019-04-01T00:00:00Z', system_time: '2026-06-11T09:12:00Z', external_ref: 'customer/backfill' });
    const s = await a.seedAs('anon', [backfilled], { connection: CONN });
    ctx.check(s.accepted.length === 1, 'BP-01 §6', 'a backfilled fact must be accepted');
    const back = await a.exportAs('anon', { externalRef: 'customer/backfill' });
    const got = back[0];
    ctx.note('round-trip', { sent: { vt: backfilled.valid_time, st: backfilled.system_time }, got: { vt: got?.valid_time, st: got?.system_time } });
    ctx.check(got?.valid_time === '2019-04-01T00:00:00Z' && got?.system_time === '2026-06-11T09:12:00Z',
      'BP-01 §6 / AC-01.2', 'both timestamps must survive byte-identical with system_time ≠ valid_time preserved');
    ctx.check(got?.valid_time !== got?.system_time, 'BP-01 §6', 'system_time ≠ valid_time must be preserved (no conflation)');
  },
});

// T-ENV-03 — degenerate bitemporal form (AC-01.2 tail).
defineTest({
  id: 'T-ENV-03', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'degenerate bitemporal form', clause: 'BP-01 §6',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const degen = validPerson({ valid_time: '2026-06-11T09:12:00Z', system_time: '2026-06-11T09:12:00Z', external_ref: 'customer/degen' });
    const ok = await a.seedAs('anon', [degen], { connection: CONN });
    ctx.check(ok.accepted.length === 1, 'BP-01 §6', 'valid_time == system_time (degenerate form) must be accepted');
    const noVt = await a.seedAs('anon', [without(validPerson({ external_ref: 'c/x' }), 'valid_time')], { connection: CONN });
    const noSt = await a.seedAs('anon', [without(validPerson({ external_ref: 'c/y' }), 'system_time')], { connection: CONN });
    ctx.check(noVt.rejected.length === 1 && noSt.rejected.length === 1, 'BP-01 §6',
      'omission of either time axis must be rejected');
  },
});

// T-ENV-04 — goal duality (AC-01.3, CD-9).
defineTest({
  id: 'T-ENV-04', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'goal duality', clause: 'BP-01 §3.2 / AC-01.3 (CD-9)',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const asEntity = validGoalEntity();
    const asActivity = validGoalActivity();
    const both = await a.seedAs('anon', [asEntity, asActivity], { connection: CONN });
    ctx.check(both.accepted.length === 2, 'BP-01 §3.2', 'a goal must be accepted as either entity or activity');

    // Both queryable as the same logical concept (same target/measure/horizon).
    const ex = await a.exportAs('anon');
    const goals = ex.filter((r) => r.subtype === 'goal');
    ctx.note('goals stored', goals.map((g) => ({ type: g.type, target: (g.attributes as any)?.target })));
    ctx.check(goals.length === 2 && goals.every((g) => (g.attributes as any)?.target === 'complete a 10k race'),
      'BP-01 §3.2', 'both framings must be queryable as the same logical concept');

    // Mutants missing each of target/measure/horizon — rejected naming the attribute.
    for (const attr of ['target', 'measure', 'horizon']) {
      const mutant = withoutAttr(validGoalEntity({ external_ref: `goal/m-${attr}` }), attr);
      const r = await a.seedAs('anon', [mutant], { connection: CONN });
      ctx.check(r.rejected.length === 1, 'BP-01 §3.2 / AC-01.3', `a goal missing ${attr} must be rejected`);
    }
    // type:"goal" rejected.
    const asPrim = await a.seedAs('anon', [validGoalEntity({ type: 'goal' as unknown as string, external_ref: 'goal/prim' })], { connection: CONN });
    ctx.check(asPrim.rejected.length === 1, 'BP-01 §3.1', 'type "goal" must be rejected — goal is never a fifth primitive');
  },
});

// T-ENV-05 — vocabulary valve (AC-01.4).
defineTest({
  id: 'T-ENV-05', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'vocabulary valve', clause: 'BP-01 §11 / AC-01.4 (CD-6)',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    // Unknown subtype, no mapping declared — must pass through opaquely.
    const unknown = validEdge({ subtype: 'employed_by', external_ref: 'edge/emp' });
    const s = await a.seedAs('anon', [unknown], { connection: CONN });
    ctx.check(s.accepted.length === 1, 'BP-01 §11', 'an unmapped unknown subtype must pass through opaquely, not be rejected');
    const ex = await a.exportAs('anon');
    const re = ex.find((r) => r.id === unknown.id);
    ctx.check(re?.subtype === 'employed_by', 'BP-01 §11', 'the unknown subtype must be re-exported verbatim');
    // Provably never aliased to works_for.
    const aliased = ex.some((r) => r.id === unknown.id && r.subtype === 'works_for');
    ctx.check(!aliased, 'BP-01 §11 / CD-6', 'the unknown subtype must never be silently aliased to works_for');
  },
});

// T-ENV-06 — unknown scope fails closed.
defineTest({
  id: 'T-ENV-06', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'unknown scope fails closed', clause: 'BP-01 §8 (CD-6)',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const odd = validPerson({ visibility: 'shared:club', external_ref: 'customer/club' });
    const s = await a.seedAs('anon', [odd], { connection: CONN });
    ctx.check(s.accepted.length === 1, 'BP-01 §8', 'an unknown scope must not cause rejection — it lands as private');
    const ex = await a.exportAs('anon', { externalRef: 'customer/club' });
    ctx.note('stored visibility', ex[0]?.visibility);
    ctx.check(ex[0]?.visibility === 'private', 'BP-01 §8 / CD-6',
      `an unknown visibility scope MUST be enforced as private (fail closed); got ${ex[0]?.visibility}`);
  },
});

// T-ENV-07 — derivation rule (AC-01.5, the MOT rule, BP-01 §12).
defineTest({
  id: 'T-ENV-07', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'derivation rule', clause: 'BP-01 §12 / AC-01.5',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const vehicle = validVehicle();
    await a.seedAs('anon', [vehicle], { connection: CONN });
    let ex = await a.exportAs('anon');
    let derived = ex.filter((r) => r.external_ref === 'vehicle/2231#mot_due');
    ctx.check(derived.length === 1, 'BP-01 §12', `exactly one derived activity must exist; got ${derived.length}`);
    ctx.check(Array.isArray(derived[0]?.provenance) && (derived[0]!.provenance as string[]).includes(vehicle.id!),
      'BP-01 §12', 'the derived activity must carry provenance to the entity URN');

    // Re-sync unchanged — no duplicate.
    await a.seedAs('anon', [vehicle], { connection: CONN });
    ex = await a.exportAs('anon');
    derived = ex.filter((r) => r.external_ref === 'vehicle/2231#mot_due');
    ctx.check(derived.length === 1, 'BP-01 §12', 're-syncing the unchanged entity must create no second activity');

    // Edit the date — updates in place.
    const edited = validVehicle({ id: vehicle.id, attributes: { name: 'Land Rover Defender', registration: 'LD70 XKP', mot_due: '2028-03-14' } });
    await a.seedAs('anon', [edited], { connection: CONN });
    ex = await a.exportAs('anon');
    derived = ex.filter((r) => r.external_ref === 'vehicle/2231#mot_due');
    ctx.check(derived.length === 1 && (derived[0]?.valid_time?.startsWith('2028') ?? false),
      'BP-01 §12', 'editing the attribute must update the same derived activity in place');

    // Archive the entity — cancels/removes the activity.
    await a.seedAs('anon', [validVehicle({ id: vehicle.id, state: 'archived' })], { connection: CONN });
    ex = await a.exportAs('anon');
    derived = ex.filter((r) => r.external_ref === 'vehicle/2231#mot_due' && r.state !== 'cancelled');
    ctx.check(derived.length === 0, 'BP-01 §12', 'archiving the entity must cancel or remove the derived activity');
  },
});

// T-ENV-08 — urn round-trip.
defineTest({
  id: 'T-ENV-08', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'urn round-trip', clause: 'BP-01 §4',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const rec = validPerson({ external_ref: 'customer/urn' });
    await a.seedAs('anon', [rec], { connection: CONN });
    const ex = await a.exportAs('anon', { externalRef: 'customer/urn' });
    ctx.note('urn', { sent: rec.id, got: ex[0]?.id });
    ctx.check(ex[0]?.id === rec.id, 'BP-01 §4', 'the urn id must encode/decode losslessly (internal storage form is the implementer\'s business)');
  },
});

// T-ENV-09 — forward compatibility.
defineTest({
  id: 'T-ENV-09', suite: 'ENV', cls: 'D', needs: 'adapter',
  name: 'forward compatibility', clause: 'BP-01 §14.3',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const rec = validPerson({ external_ref: 'customer/fwd', future_field: { speculative: true } } as BrainRecord);
    const s = await a.seedAs('anon', [rec], { connection: CONN });
    ctx.check(s.accepted.length === 1, 'BP-01 §14.3', 'an unknown envelope field must never cause rejection');
    const ex = await a.exportAs('anon', { externalRef: 'customer/fwd' });
    ctx.note('pass-through', ex[0]?.future_field);
    ctx.check((ex[0] as any)?.future_field?.speculative === true,
      'BP-01 §14.3', 'unknown fields must be preserved on pass-through');
  },
});

// T-ENV-10 — connect-time semantics (CD-6).
defineTest({
  id: 'T-ENV-10', suite: 'ENV', cls: 'D', needs: 'none',
  name: 'connect-time semantics', clause: 'BP-01 §11 / BP-03 §3.3 (CD-6)',
  async run(ctx) {
    // A connection whose declared terms are neither base nor mapped must not proceed to sync.
    const blocked = connectVerdict({ vocabulary_version: '2.0', terms: { subtype: ['employed_by'] } });
    ctx.note('unmapped declaration', blocked);
    ctx.check(blocked.verdict === 'no-connection' && blocked.unmapped.includes('employed_by'),
      'BP-03 §3.3 / CD-6', 'a connection with an unmapped non-base term must not proceed to sync');
    // With a mapping declared, it proceeds.
    const mapped = connectVerdict({
      vocabulary_version: '2.0', terms: { subtype: ['employed_by'] },
      mappings: [{ field: 'subtype', local: 'employed_by', base: 'works_for', direction: 'both' }],
    });
    ctx.check(mapped.verdict === 'sync', 'BP-03 §3.3', 'a declared mapping must let the connection proceed to sync');
    // Base-vocabulary only — proceeds.
    const base = connectVerdict({ vocabulary_version: '2.0', terms: { subtype: ['person', 'task'] } });
    ctx.check(base.verdict === 'sync', 'BP-03 §3.3', 'a base-vocabulary connection proceeds to sync');
  },
});
