// SEC — security, privacy, sensitivity (BP-07). Class D: T-SEC-01/02/05/06/07/08/10/11.
// Over the wire (--target). The kit signs (or refuses to sign) batches and probes the target's
// SSRF guard the way a real attacker would; verification precedes validation (BP-07 §3.2).

import { defineTest, type TestContext } from '../harness.js';
import { WireClient } from '../peer/wire.js';
import { randUrn as urn, resetUuids, validPerson } from '../fixtures/records.js';

function wire(ctx: TestContext): WireClient {
  if (!ctx.target) ctx.skip('SEC needs --target (the wire surface)');
  return new WireClient(ctx.target);
}

const READ_CELL = { capability: 'calendar.read', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S2' };
const INGEST_CELL = { capability: 'records', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S2' };

// T-SEC-01 — S3 never on the wire.
defineTest({
  id: 'T-SEC-01', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'S3 never-on-wire scan', clause: 'BP-07 §2.4 / AC-07.1 (T-SEC-01)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [READ_CELL, INGEST_CELL] });
    const s3 = validPerson({ id: urn('garagebrain', 'entity'), subtype: 'document', external_ref: 's3/passport', owner: 'mem-a', sensitivity: 'S3', attributes: { name: 'Passport — Emma' } });
    const r = await w.call('records.ingest', { records: [s3] });
    ctx.note('S3 ingest', r.body);
    ctx.check(r.body?.error?.code === 'sensitivity_refused', 'BP-07 §2.4', 'any S3 record on the wire must fail');
  },
});

// T-SEC-02 — pointer passes.
defineTest({
  id: 'T-SEC-02', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'pointer passes', clause: 'BP-07 §2.4 / AC-07.1 (T-SEC-02)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [READ_CELL, INGEST_CELL] });
    const pointer = validPerson({
      id: urn('garagebrain', 'entity'), subtype: 'document', external_ref: 's3/pointer', owner: 'mem-a',
      sensitivity: 'S1', attributes: { name: 'Passport — Emma', s3_pointer: { class: 'S3', label: 'Passport', exists: true, holder: 'garagebrain', access: 'human_mediated' } },
    });
    const r = await w.call('records.ingest', { records: [pointer] });
    ctx.note('pointer ingest', r.body);
    ctx.check(r.status === 200 && r.body?.body?.accepted === 1, 'BP-07 §2.4', 'a conformant S3 reference pointer (S1) must cross');
  },
});

// T-SEC-05 — no downgrade.
defineTest({
  id: 'T-SEC-05', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'no downgrade', clause: 'BP-07 §2.2 / AC-07.2 (T-SEC-05)',
  async run(ctx) {
    const w = wire(ctx); resetUuids();
    await w.handshake({ matrix: [READ_CELL, INGEST_CELL] });
    const downgraded = { id: urn('garagebrain', 'activity'), type: 'activity', subtype: 'transaction', source: 'garagebrain', external_ref: 'tx/1', owner: 'mem-a', state: 'done', valid_time: '2026-06-01T00:00:00Z', system_time: '2026-06-01T00:00:00Z', visibility: 'shared:household', sensitivity: 'S1', attributes: { title: 'Payment' } };
    const r = await w.call('records.ingest', { records: [downgraded] });
    ctx.note('downgrade attempt', r.body);
    ctx.check(r.body?.error?.code === 'sensitivity_refused', 'BP-07 §2.2', 'a class-downgrade attempt must be rejected and logged');
  },
});

// T-SEC-06 — unsigned batch rejected before validation.
defineTest({
  id: 'T-SEC-06', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'unsigned batch rejected', clause: 'BP-07 §3.2 / AC-07.3 (T-SEC-06)',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [READ_CELL] });
    const r = await w.call('calendar.read', { limit: 1 }, { noJws: true });
    ctx.note('unsigned', r.body?.error?.code);
    ctx.check(r.status === 401 && r.body?.error?.code === 'invalid_signature', 'BP-07 §3.2',
      'an unsigned batch must be rejected before boundary validation');
  },
});

// T-SEC-07 — tampered batch rejected.
defineTest({
  id: 'T-SEC-07', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'tampered batch rejected', clause: 'BP-07 §3.2 / AC-07.3 (T-SEC-07)',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [READ_CELL] });
    const r = await w.call('calendar.read', { limit: 1 }, { tamperBody: true });
    ctx.note('tampered', r.body?.error?.code);
    ctx.check(r.body?.error?.code === 'invalid_signature', 'BP-07 §3.2', 'a batch altered after signing must be rejected (body-hash mismatch)');
  },
});

// T-SEC-08 — replay rejected.
defineTest({
  id: 'T-SEC-08', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'replay rejected', clause: 'BP-07 §3.2 / AC-07.3 (T-SEC-08)',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [READ_CELL] });
    await w.call('calendar.read', { limit: 1 });
    const replay = await w.call('calendar.read', { limit: 1 }, { replayNonce: true });
    ctx.note('replay', replay.body?.error?.code);
    ctx.check(replay.body?.error?.code === 'replayed_nonce', 'BP-07 §3.2', 'a replayed nonce must be rejected');
  },
});

// T-SEC-10 — SSRF closed.
defineTest({
  id: 'T-SEC-10', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'SSRF closed', clause: 'BP-07 §5 / AC-07.5 (T-SEC-10)',
  async run(ctx) {
    const w = wire(ctx);
    const targets = [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:5432/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[fd00::1]/',
    ];
    const results: Record<string, boolean> = {};
    for (const t of targets) {
      const r = await w.post('/test/fetch', { fetchUrl: t });
      results[t] = !!r.body?.fetched;
    }
    ctx.note('ssrf probes', results);
    ctx.check(Object.values(results).every((fetched) => fetched === false), 'BP-07 §5',
      'metadata IPs, RFC 1918/4193 ranges and loopback must all be blocked on every peer-supplied URL fetch');
  },
});

// T-SEC-11 — no central telemetry (CD-3).
defineTest({
  id: 'T-SEC-11', suite: 'SEC', cls: 'D', needs: 'wire',
  name: 'no central telemetry', clause: 'CD-3 / AC (T-SEC-11)',
  async run(ctx) {
    const targetHost = new URL(ctx.target!).host;
    const contacted = new Set<string>();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = typeof input === 'string' ? input : input.url;
      try { contacted.add(new URL(u).host); } catch { /* */ }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const w = wire(ctx);
      await w.fetchAndVerifyCard();
      await w.handshake({ matrix: [READ_CELL] });
      await w.call('calendar.read', { limit: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
    ctx.note('hosts contacted', [...contacted]);
    ctx.check([...contacted].every((h) => h === targetHost), 'CD-3',
      `a full session must show zero traffic to any non-peer host; contacted ${[...contacted]}`);
  },
});
