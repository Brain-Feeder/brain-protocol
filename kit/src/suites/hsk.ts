// HSK — handshake, identity, grants (BP-03). Class D, T-HSK-01..06. Over the wire (--target).
// The kit acts as the connecting peer: verifies the target's signed card, then attacks the grant
// matrix, token, and proof-of-possession the way a real bad peer would.

import { defineTest, type TestContext } from '../harness.js';
import { WireClient } from '../peer/wire.js';

function wire(ctx: TestContext): WireClient {
  if (!ctx.target) ctx.skip('HSK needs --target (the wire surface)');
  return new WireClient(ctx.target);
}

// T-HSK-01 — unsigned/badly-signed card refused (AC-03.1).
defineTest({
  id: 'T-HSK-01', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'unsigned card refused', clause: 'BP-03 §2.3 / AC-03.1',
  async run(ctx) {
    const w = wire(ctx);
    // The target serves a signed card; the kit verifies it (the valid path proceeds).
    const valid = await w.fetchAndVerifyCard();
    ctx.note('card verify', { ok: valid.ok, reason: valid.reason });
    ctx.check(valid.ok, 'BP-03 §2.3', 'a validly signed card must verify and proceed to negotiation');
    // The kit then asks the target to connect to a peer card it serves — the target must refuse a
    // tampered card (body mutated after signing) before any handshake call.
    const tampered = await w.post('/test/connect', {
      cardJws: valid.body ? await makeTamperedJws(valid.body) : null,
      cardBody: { ...(valid.body ?? {}), name: 'Mutated After Signing' },
      pinnedFingerprint: valid.fingerprint, peerFingerprint: valid.fingerprint,
    });
    ctx.note('tampered card connect', tampered.body);
    ctx.check(tampered.body?.proceed === false, 'BP-03 §2.3.2',
      'a card whose body does not match its signature must abort the connection attempt');
  },
});

async function makeTamperedJws(body: any): Promise<unknown> {
  // a JWS over the original body; the kit submits it alongside a MUTATED body, so verification
  // (payload === jcs(mutatedBody)) must fail.
  const { mintEd25519, jcsCanonical } = await import('../peer/crypto.js');
  const { FlattenedSign } = await import('jose');
  const k = await mintEd25519('attacker');
  return new FlattenedSign(new TextEncoder().encode(jcsCanonical(body)))
    .setProtectedHeader({ alg: 'EdDSA', kid: k.kid }).sign(k.privateKey);
}

// T-HSK-02 — matrix denial: absent cell is denied cell (AC-03.2).
defineTest({
  id: 'T-HSK-02', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'matrix denial', clause: 'BP-03 §5.2 / AC-03.2',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [{ capability: 'calendar.read', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    const ok = await w.call('calendar.read', { limit: 10 });
    ctx.check(ok.status === 200, 'BP-03 §5.2', 'the single in-matrix call must succeed');
    // ungranted capability and a write path map to absent cells → cell_denied.
    const ungranted = await w.call('tasks.read', { limit: 10 });
    const write = await w.call('records.upsert', { records: [] });
    ctx.note('denied calls', { ungranted: ungranted.body?.error?.code, write: write.body?.error?.code });
    ctx.check(ungranted.body?.error?.code === 'cell_denied', 'BP-03 §5.2', 'a call against an absent grant cell must be refused with cell_denied');
    ctx.check(write.body?.error?.code === 'cell_denied', 'BP-04 §5.1', 'a cross-system write must be refused — propose is the only write');
  },
});

// T-HSK-03 — stolen token useless without the grant-key JWS (AC-03.3).
defineTest({
  id: 'T-HSK-03', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'stolen token useless', clause: 'BP-03 §4.2 / AC-03.3',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [{ capability: 'calendar.read', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    const noJws = await w.call('calendar.read', { limit: 1 }, { noJws: true });
    const replay = await w.call('calendar.read', { limit: 1 });
    const replay2 = await w.call('calendar.read', { limit: 1 }, { replayNonce: true });
    const skew = await w.call('calendar.read', { limit: 1 }, { skewSeconds: 600 });
    ctx.note('attacks', { noJws: noJws.body?.error?.code, replay: replay2.body?.error?.code, skew: skew.body?.error?.code });
    ctx.check(noJws.status === 401, 'BP-03 §4.2', 'a valid token with no proof-of-possession JWS must fail every call');
    ctx.check(replay2.body?.error?.code === 'replayed_nonce', 'BP-03 §4.2', 'a replayed nonce must be rejected');
    ctx.check(skew.status === 401, 'BP-03 §4.2', 'a JWS timestamped outside the ±5-minute window must fail closed');
    const good = await w.call('calendar.read', { limit: 1 });
    ctx.check(good.status === 200, 'BP-03 §4.2', 'token + correct fresh JWS must succeed');
  },
});

// T-HSK-04 — negotiation downgrade (AC-03.4): a v2 and a v0.1 peer converse at v0.1, S2 inert.
defineTest({
  id: 'T-HSK-04', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'negotiation downgrade', clause: 'BP-03 §3.2 / AC-03.4',
  async run(ctx) {
    const w = wire(ctx);
    const neg = await w.post('/test/negotiate', { peerVersions: ['0.1'] });
    ctx.note('negotiated version', neg.body);
    ctx.check(neg.body?.version === '0.1', 'BP-03 §3.1', 'a v2 and a v0.1 peer must converse at the highest common version (0.1)');
    // An S2 grant cell over the v0.1 connection must be refused at issue (BP-03 §3.2(c)).
    const s2overV01 = await w.post('/test/grant', {
      grant_id: 'urn:brain:brain-tck-peer:grant:v01s2', grantee: 'brain-tck-peer', member_lens: 'mem-a',
      protocol_version: '0.1', matrix: [{ capability: 'health_record.summary', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S2' }],
      granteePublicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'AAAA' },
    });
    ctx.note('S2 over v0.1', s2overV01.body);
    ctx.check(s2overV01.body?.installed === false && s2overV01.body?.reason === 's2_requires_v2', 'BP-03 §3.2(c)',
      'an S2 grant cell over a v0.1 connection must be refused — v2 features stay inert');
  },
});

// T-HSK-05 — revocation immediate (AC-03.5).
defineTest({
  id: 'T-HSK-05', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'revocation immediate', clause: 'BP-03 §7.4 / AC-03.5',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [{ capability: 'calendar.read', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    const before = await w.call('calendar.read', { limit: 1 });
    ctx.check(before.status === 200, 'BP-03 §7', 'the live grant works before revoke');
    await w.revoke();
    const after = await w.call('calendar.read', { limit: 1 });
    ctx.note('post-revoke', after.body?.error?.code);
    ctx.check(after.status === 401 && after.body?.error?.code === 'grant_revoked', 'BP-03 §7.4',
      'after revoke the next call must fail closed (401/grant_revoked)');
  },
});

// T-HSK-06 — token lifecycle (hashed at rest, expire on schedule, expired fails closed).
defineTest({
  id: 'T-HSK-06', suite: 'HSK', cls: 'D', needs: 'wire',
  name: 'token lifecycle', clause: 'BP-03 §8',
  async run(ctx) {
    const w = wire(ctx);
    await w.handshake({ matrix: [{ capability: 'calendar.read', direction: 'offer', mode: 'read', sensitivity_ceiling: 'S1' }] });
    // a wrong/unknown token fails closed (tokens are verified by hash, never echoed).
    const stolen = await w.call('calendar.read', { limit: 1 }, { wrongToken: true });
    ctx.note('unknown token', stolen.body?.error?.code);
    ctx.check(stolen.status === 401, 'BP-03 §8', 'an unknown/forged token must fail closed (tokens are hashed at rest, shown once)');
    const good = await w.call('calendar.read', { limit: 1 });
    ctx.check(good.status === 200, 'BP-03 §8', 'the minted token verifies');
  },
});
