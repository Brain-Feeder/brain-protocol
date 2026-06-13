// DAT — the agent-ready data layer (BP-02). Class D, 11 tests.
// Nine are data-layer laws driven through the adapter; two (T-DAT-07 bounds, T-DAT-08 rate) are
// served-endpoint behaviour proven over the wire against --target. Every assertion runs against
// the store, not the UI (BP-02 AC-02.1) and names its spec clause.

import { defineTest, type TestContext } from '../harness.js';
import type { Adapter, BrainRecord, MemberRef } from '../types.js';
import { validPerson, validActivity, validEdge, validAction, urn, randUrn, resetUuids } from '../fixtures/records.js';
import { validateForgetReceipt } from '../validate.js';
import { WireClient } from '../peer/wire.js';

const A: MemberRef = { id: 'mem-a', role: 'adult' };
const B: MemberRef = { id: 'mem-b', role: 'adult' };
const P: MemberRef = { id: 'mem-p', role: 'adult', partnerOf: ['mem-a'] };
const CHILD: MemberRef = { id: 'mem-c', role: 'child' };

function adapter(ctx: TestContext): Adapter {
  if (!ctx.adapter) ctx.skip('DAT needs an adapter (the data layer)');
  return ctx.adapter;
}

// Build A's data at each visibility level (owner mem-a).
function levelled(): BrainRecord[] {
  return (['private', 'shared:partners', 'shared:adults', 'shared:household', 'public'] as const).map((vis, i) =>
    validPerson({ id: urn('garagebrain', 'entity'), external_ref: `cust/lvl-${i}`, owner: 'mem-a', visibility: vis }));
}

// T-DAT-01 — adversarial visibility (AC-02.1). Executed, not asserted.
defineTest({
  id: 'T-DAT-01', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'adversarial visibility', clause: 'BP-02 §3.1 / AC-02.1',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    await a.seedAs(A, levelled(), { connection: 'tck' });

    const visOf = async (who: MemberRef | 'anon') =>
      new Set((await a.queryAs(who, { type: 'entity', owner: 'mem-a' })).map((r) => r.visibility));

    const aSees = await visOf(A);
    const bSees = await visOf(B);
    const childSees = await visOf(CHILD);
    const pSees = await visOf(P);
    const anonSees = await visOf('anon');
    ctx.note('what each viewer sees', { A: [...aSees], B: [...bSees], P: [...pSees], child: [...childSees], anon: [...anonSees] });

    // A sees all own rows.
    ctx.check(aSees.size === 5, 'BP-02 §3.1', 'the owner must see all five of their own rows');
    // B (non-partner adult): adults, household, public — never private, never partners.
    ctx.check(!bSees.has('private') && !bSees.has('shared:partners') && bSees.has('shared:adults') && bSees.has('shared:household') && bSees.has('public'),
      'BP-02 §3.1', `B must see only rows at or below their sight; saw ${[...bSees]}`);
    // P (partner of A): partners, never A's private.
    ctx.check(!pSees.has('private') && pSees.has('shared:partners'),
      'BP-02 §3.1', `the partner must see shared:partners but never A's private; saw ${[...pSees]}`);
    // Child: household + public only — no private, no partners, no adults.
    ctx.check(!childSees.has('private') && !childSees.has('shared:partners') && !childSees.has('shared:adults') && childSees.has('shared:household'),
      'BP-02 §3.1', `the child must see no adult-private and nothing above shared:household; saw ${[...childSees]}`);
    // Anonymous/foreign: zero.
    ctx.check(anonSees.size === 0, 'BP-02 §3.1', `the anonymous context must receive zero rows; saw ${[...anonSees]}`);
    // Existence denied by silence: B's count of A's private rows is zero.
    const bPrivateCount = await a.countAs(B, { type: 'entity', owner: 'mem-a', visibility: 'private' });
    ctx.check(bPrivateCount === 0, 'BP-02 §3.1', 'counts must reveal no existence — B counts zero of A\'s private rows');
  },
});

// T-DAT-02 — children's wall, local (BP-02 §3.1).
defineTest({
  id: 'T-DAT-02', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'childrens wall (local)', clause: 'BP-02 §3.1',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const childRow = validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'cust/child', owner: 'mem-c', visibility: 'private' });
    const adultPrivate = validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'cust/ap', owner: 'mem-a', visibility: 'private' });
    await a.seedAs(CHILD, [childRow], { connection: 'tck' });
    await a.seedAs(A, [adultPrivate], { connection: 'tck' });

    const stored = (await a.exportAs(A, { externalRef: 'cust/child' }))[0];
    ctx.note('child row visibility', stored?.visibility);
    ctx.check(stored?.visibility === 'shared:household', 'BP-02 §3.1',
      `a child's created row must be forced to shared:household at write time; got ${stored?.visibility}`);
    const childSeesAdultPrivate = await a.countAs(CHILD, { externalRef: 'cust/ap' });
    ctx.check(childSeesAdultPrivate === 0, 'BP-02 §3.1', 'a child query must return no adult-private rows');
  },
});

// T-DAT-03 — vault invisibility (AC-02.3).
defineTest({
  id: 'T-DAT-03', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'vault invisibility', clause: 'BP-02 §4 / AC-02.3',
  async run(ctx) {
    const a = adapter(ctx); await a.reset();
    if (!a.mintSecret) ctx.skip('adapter has no vault surface');
    const { shownOnce } = await a.mintSecret('tck-vault');
    ctx.check(typeof shownOnce === 'string' && shownOnce.length > 0, 'BP-02 §4', 'a secret is shown once at mint');
    const read = await a.readSecretAs(A, 'tck-vault');
    ctx.note('direct read attempt', read);
    ctx.check(!read.returnedSomething, 'BP-02 §4 / AC-02.3',
      'the secret must be unreadable even to the owning user\'s own client — no path exists');
    const form = await a.storedSecretForm('tck-vault');
    ctx.check(form === 'hash' || form === 'server-ciphertext', 'BP-02 §4',
      `the stored form must be a hash or server-key ciphertext, never plaintext; got ${form}`);
  },
});

// Seed rows traceable to a connection via each forget arm (BP-02 §5.1).
const FCONN = 'tck-forget-conn';
function forgetRows(): BrainRecord[] {
  const provUrn = urn(FCONN, 'entity'); // a urn minted by the connection
  return [
    // source arm: source = FCONN (urn system segment must match source).
    validPerson({ id: urn(FCONN, 'entity'), source: FCONN, external_ref: 'f/source', owner: 'mem-a' }),
    // origin_chain arm: chain contains FCONN, different source/tag.
    validActivity({ id: urn('garagebrain', 'activity'), source: 'garagebrain', external_ref: 'f/chain', owner: 'mem-a', origin_chain: ['garagebrain', FCONN] }),
    // provenance arm: derived record whose provenance is minted by FCONN.
    validPerson({ id: urn('brainfeeder', 'entity'), source: 'derived', subtype: 'fact', external_ref: 'f/prov', owner: 'mem-a', provenance: [provUrn] }),
    // an edge and action tagged by the connection (the connection arm via opts.connection).
    validEdge({ id: urn('garagebrain', 'edge') }),
    validAction({ id: urn('brainfeeder', 'action'), external_ref: 'f/action', owner: 'mem-a' }),
  ];
}

// T-DAT-04 — forget-to-zero (AC-02.2). Re-queried by the kit, not self-reported.
defineTest({
  id: 'T-DAT-04', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'forget-to-zero', clause: 'BP-02 §5 / AC-02.2',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    await a.seedAs(A, [validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'keep/me', owner: 'mem-a' })], { connection: 'other-conn' });
    await a.seedAs(A, forgetRows(), { connection: FCONN });

    const before = await a.exportAs(A, {});
    ctx.note('seeded before forget', before.length);
    await a.disconnect(FCONN, 'user_disconnect');

    const sourceResidue = await a.exportAs(A, { source: FCONN });
    const chainResidue = await a.exportAs(A, { originChainContains: FCONN });
    const provResidue = await a.exportAs(A, { provenanceMintedBy: FCONN });
    ctx.note('residue by arm', { source: sourceResidue.length, chain: chainResidue.length, provenance: provResidue.length });
    ctx.check(sourceResidue.length === 0 && chainResidue.length === 0 && provResidue.length === 0,
      'BP-02 §5.1 / AC-02.2', 'zero rows may remain traceable under the source, origin-chain, or provenance arms');

    const control = await a.exportAs(A, { externalRef: 'keep/me' });
    ctx.check(control.length === 1, 'BP-02 §5.2', 'rows unrelated to the connection must survive the purge');
  },
});

// T-DAT-05 — forget receipt (AC-02.2 tail, BP-07 §3.6).
defineTest({
  id: 'T-DAT-05', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'forget receipt', clause: 'BP-02 §5.4 / BP-07 §3.6',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    await a.seedAs(A, forgetRows(), { connection: FCONN });
    await a.disconnect(FCONN, 'user_disconnect');
    const receipt = await a.readReceipt(FCONN);
    ctx.note('receipt', receipt);
    const v = validateForgetReceipt(receipt);
    ctx.check(v.valid, 'BP-02 §5.4', `the receipt must validate against forget-receipt.schema.json; ${v.reasons.join('; ')}`);
    ctx.check(receipt.audit.rows_remaining === 0, 'BP-02 §5.3', 'the receipt must record rows_remaining: 0');
    ctx.check(typeof receipt.erased.derived_memories === 'number', 'BP-02 §5.4', 'the receipt must carry an explicit derived_memories line');
    ctx.check(!!receipt.keys_destroyed && typeof receipt.keys_destroyed.at === 'string', 'BP-07 §3.6', 'the receipt must carry the key-destruction line');
  },
});

// T-DAT-06 — restore replay (AC-02.4).
defineTest({
  id: 'T-DAT-06', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'restore replay', clause: 'BP-02 §5.6 / AC-02.4',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    if (!a.backup) ctx.skip('adapter has no backup/restore surface');
    await a.seedAs(A, forgetRows(), { connection: FCONN });
    const snapshot = await a.backup();
    await a.disconnect(FCONN, 'user_disconnect');
    const restore = await a.restore(snapshot);
    ctx.note('restore', restore);
    ctx.check(restore.replayedForgetLog, 'BP-02 §5.6', 'a restore must replay the forget log before serving traffic');
    ctx.check(!restore.servedTrafficBeforeReplay, 'BP-02 §5.6', 'no traffic may be served before the forget replay completes');
    const residue = await a.exportAs(A, { source: FCONN });
    ctx.check(residue.length === 0, 'BP-02 §5.6 / AC-02.4', 'the forget audit must re-pass at zero on the restored instance');
  },
});

// T-DAT-07 — bounds hold (AC-02.5). Served-endpoint behaviour, over the wire. The kit does NOT
// seed: a read grant can never write (BP-04 §5.1), and a served read returns the provider's OWN
// rows, so no peer-side ingest can manufacture the over-cap state. The provider stands up more
// than the batch cap of its own rows under the read lens as a certification precondition (see
// ADAPTER.md); the kit only reads and proves the served page is bounded.
// 2.0.2: the prior fixture seeded 600 rows via wire records.ingest and only "passed" against a
// reference that accepted unauthenticated ingest. A correctly-hardened provider (write-gated
// ingest, own-source reads, a batch DoS guard) refused it — TPMS friction log, 2026-06-13.
defineTest({
  id: 'T-DAT-07', suite: 'DAT', cls: 'D', needs: 'wire',
  name: 'bounds hold', clause: 'BP-02 §6 / AC-02.5',
  async run(ctx) {
    const w = new WireClient(ctx.target!); resetUuids();
    await w.handshake({ matrix: [{ capability: 'calendar', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    const CAP = ctx.targetCap ?? 500; // the provider's advertised page cap, read from its card (BP-02 §6 default)
    const page = await w.call('calendar.read', { limit: CAP * 8 });
    const recs = page.body?.body?.records ?? [];
    const truncated = page.body?.body?.truncated;
    const cursor = page.body?.body?.cursor;
    ctx.note('served page', { cap: CAP, count: recs.length, truncated, cursor, complete: page.body?.body?.complete });
    ctx.check(recs.length <= CAP, 'BP-02 §6', `a served page must never exceed the batch cap (${CAP}); got ${recs.length}`);
    ctx.check(truncated === true && !!cursor, 'BP-02 §6',
      'with more than a page standing under the lens, an over-cap response must be flagged truncated and carry a cursor — never silently dropped');
  },
});

// T-DAT-08 — rate limits (AC-02.5). Over the wire.
defineTest({
  id: 'T-DAT-08', suite: 'DAT', cls: 'D', needs: 'wire',
  name: 'rate limits', clause: 'BP-02 §6 / AC-02.5',
  async run(ctx) {
    const w = new WireClient(ctx.target!);
    await w.handshake({ matrix: [{ capability: 'calendar', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }], ratePerMinute: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await w.call('calendar.read', { limit: 1 })).status);
    ctx.note('status sequence', codes);
    ctx.check(codes.includes(429), 'BP-02 §6', 'an over-rate caller must receive 429, never a silent drop');
  },
});

// T-DAT-09 — journal immutability (BP-02 §3.4).
defineTest({
  id: 'T-DAT-09', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'journal immutability', clause: 'BP-02 §3.4',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    await a.seedAs(A, [validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'j/1', owner: 'mem-a' })], { connection: 'tck' });
    const upd = await a.journalWriteAttempt('update');
    const del = await a.journalWriteAttempt('delete');
    ctx.note('journal write attempts', { upd, del });
    ctx.check(upd.rejected && del.rejected, 'BP-02 §3.4',
      'UPDATE/DELETE against the journal must be rejected at the data layer (append-only)');
  },
});

// T-DAT-10 — provenance totality (BP-02 §3.3).
defineTest({
  id: 'T-DAT-10', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'provenance totality', clause: 'BP-02 §3.3',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    const derivedNoProv = validPerson({ id: urn('brainfeeder', 'entity'), source: 'derived', subtype: 'fact', external_ref: 'd/noprov', owner: 'mem-a' });
    const r = await a.seedAs(A, [derivedNoProv], { connection: 'tck' });
    ctx.note('derived-without-provenance', r.rejected);
    ctx.check(r.rejected.length === 1 && r.accepted.length === 0, 'BP-02 §3.3',
      'a derived write without attributable provenance must be rejected at the storage layer');
    const ok = await a.seedAs(A, [validPerson({ id: urn('brainfeeder', 'entity'), source: 'derived', subtype: 'fact', external_ref: 'd/prov', owner: 'mem-a', provenance: [urn('garagebrain', 'entity')] })], { connection: 'tck' });
    ctx.check(ok.accepted.length === 1, 'BP-02 §3.3', 'a derived write with provenance is accepted');
  },
});

// T-DAT-11 — local audit log (CD-3).
defineTest({
  id: 'T-DAT-11', suite: 'DAT', cls: 'D', needs: 'adapter',
  name: 'local audit log', clause: 'BP-02 §6 / CD-3',
  async run(ctx) {
    const a = adapter(ctx); await a.reset(); resetUuids();
    await a.seedAs(A, [validPerson({ id: urn('garagebrain', 'entity'), external_ref: 'al/1', owner: 'mem-a' })], { connection: 'tck' });
    await a.queryAs(A, { type: 'entity' });
    const log = await a.readAuditLog();
    ctx.note('audit entries', log.length);
    ctx.check(log.length >= 2, 'BP-02 §6', 'every exchange must appear in the local audit log');
    for (const e of log) {
      ctx.check(!!e.method && !!e.at && !!e.outcome, 'BP-02 §6', 'each entry must record who/method/when/outcome');
    }
    const blob = JSON.stringify(log);
    ctx.check(!/"attributes"|"payload"|"secret_hash"|"name":"Peter/.test(blob), 'CD-3',
      'the audit log must contain metadata only — never payload bodies');
  },
});
