// GAT — human gates (BP-08). Class D subset: T-GAT-01/02/03/04/09.
// The confirm/execute laws are proven through the adapter's gate surface; dark-by-default and
// expired-draft are proven over the wire against --target.

import { defineTest, type TestContext } from '../harness.js';
import type { Adapter } from '../types.js';
import { WireClient } from '../peer/wire.js';
import { sha256Prefixed } from '../peer/crypto.js';

function gateAdapter(ctx: TestContext): Adapter {
  if (!ctx.adapter || !ctx.adapter.tryExecute || !ctx.adapter.recordConfirm)
    ctx.skip('GAT confirm/execute needs the adapter gate surface');
  return ctx.adapter;
}

const ACTION = 'urn:brain:brainfeeder:action:00000000-0000-4000-8000-00000000ga01';
const HASH_A = sha256Prefixed('payload-A');
const HASH_B = sha256Prefixed('payload-B');

// T-GAT-01 — no confirm, no execution (AC-08.1).
defineTest({
  id: 'T-GAT-01', suite: 'GAT', cls: 'D', needs: 'adapter',
  name: 'no confirm no execution', clause: 'BP-08 §2.1 / AC-08.1 (T-GAT-01)',
  async run(ctx) {
    const a = gateAdapter(ctx); await a.reset();
    const r = await a.tryExecute!(ACTION, HASH_A, `${ACTION}#k1`);
    ctx.note('execute without confirm', r);
    ctx.check(!r.executed && r.reason === 'no_stored_confirm', 'BP-08 §2.1',
      'executing without a stored server-side confirm must be impossible');
  },
});

// T-GAT-02 — hash binds the yes (AC-08.1).
defineTest({
  id: 'T-GAT-02', suite: 'GAT', cls: 'D', needs: 'adapter',
  name: 'hash binds the yes', clause: 'BP-08 §2.1 / AC-08.1 (T-GAT-02)',
  async run(ctx) {
    const a = gateAdapter(ctx); await a.reset();
    await a.recordConfirm!(ACTION, HASH_A, 'mem-a');
    const r = await a.tryExecute!(ACTION, HASH_B, `${ACTION}#k2`); // mutated payload
    ctx.note('confirm A, execute B', r);
    ctx.check(!r.executed && r.reason === 'payload_hash_mismatch', 'BP-08 §2.1',
      'a confirm replayed against a mutated payload must be invalidated by the payload hash');
  },
});

// T-GAT-03 — idempotent execution (AC-08.1).
defineTest({
  id: 'T-GAT-03', suite: 'GAT', cls: 'D', needs: 'adapter',
  name: 'idempotent execution', clause: 'BP-08 §2.1 / AC-08.1 (T-GAT-03)',
  async run(ctx) {
    const a = gateAdapter(ctx); await a.reset();
    await a.recordConfirm!(ACTION, HASH_A, 'mem-a');
    const key = `${ACTION}#idem`;
    const first = await a.tryExecute!(ACTION, HASH_A, key);
    const second = await a.tryExecute!(ACTION, HASH_A, key);
    ctx.note('double execute', { first, second });
    ctx.check(first.executed, 'BP-08 §2.1', 'a confirmed action executes once');
    ctx.check(!second.executed && second.reason === 'idempotency_replay', 'BP-08 §2.1',
      'double-execution must die on the idempotency key');
  },
});

// T-GAT-04 — expired drafts dead (AC-08 / BP-08 §2.1). Over the wire.
defineTest({
  id: 'T-GAT-04', suite: 'GAT', cls: 'D', needs: 'wire',
  name: 'expired drafts dead', clause: 'BP-08 §2.1 (T-GAT-04)',
  async run(ctx) {
    const w = new WireClient(ctx.target!);
    await w.handshake({ matrix: [{ capability: 'appointment.book', direction: 'offer', mode: 'propose', sensitivity_ceiling: 'S1' }], actionExecute: 'enabled' });
    const expired = { id: 'urn:brain:brainfeeder:action:00000000-0000-4000-8000-0000000exp1', expires_at: new Date(Date.now() - 60_000).toISOString() };
    const r = await w.call('action.execute', { action: expired });
    ctx.note('execute expired draft', { status: r.status, body: r.body });
    ctx.check(r.body?.error?.code === 'expired_draft', 'BP-08 §2.1', 'an expired draft can never execute');
  },
});

// T-GAT-09 — dark by default (AC-08.5). Over the wire.
defineTest({
  id: 'T-GAT-09', suite: 'GAT', cls: 'D', needs: 'wire',
  name: 'dark by default', clause: 'BP-08 §2.1 / AC-08.5 (T-GAT-09)',
  async run(ctx) {
    const w = new WireClient(ctx.target!);
    await w.handshake({ matrix: [{ capability: 'appointment.book', direction: 'offer', mode: 'propose', sensitivity_ceiling: 'S1' }] }); // action_execute defaults dark
    const r = await w.call('action.execute', { action: { id: 'urn:brain:brainfeeder:action:00000000-0000-4000-8000-0000000drk1' } });
    ctx.note('fresh connection action.execute', r.body);
    ctx.check(r.body?.body?.state === 'proposed', 'BP-08 §2.1',
      'a fresh connection\'s action.execute must return "proposed, not executed" until writes are enabled');
  },
});
