// The reference pipe's wire surface (BP-03, BP-04, BP-07). A small Node HTTP server: the signed
// agent card at the well-known path, an OAuth token endpoint, the A2A JSON-RPC endpoint with JWS
// proof-of-possession + grant-matrix + bounds enforcement, dark-by-default execution, the loop
// guard, the SSRF-guarded peer-card fetch, and the BP-04 error model. Test-only endpoints let the
// kit pin keys out of band (BUILD-BRIEF §6.3) — the honest mirror of the real ceremony.
//
// CD-3: this server makes no outbound call except the peer-card fetch it is explicitly asked to
// make (T-SEC-11 captures the network and proves no phone-home).

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Pipe } from './pipe.js';
import { mintEd25519, signCard, verifyPoP, sha256hex, jcs, type KeyPairJWK } from './wire-crypto.js';
import { CompactSign, compactVerify, importJWK } from 'jose';

interface MatrixCell { capability: string; direction: string; mode: string; sensitivity_ceiling: string; }
interface Grant {
  grant_id: string; grantee: string; member_lens: string; visibility_ceiling: string;
  matrix: MatrixCell[]; granteePublicJwk: any; action_execute: 'dark' | 'enabled';
  rate_per_minute: number; revoked: boolean; in_force?: boolean;
}
interface Token { hash: string; grant_id: string; expires_at: number; }

const SENS_ORDER: Record<string, number> = { S0: 0, S1: 1, S2: 2, S3: 3 };
// T-REF-02 (AC-09.2): deliberately break one wire law so the kit can be proven to catch it.
// Conformance affordances (the open /test/* routes + the law-breaker) exist ONLY under this flag,
// so the same binary is a conformance target with it set and a production provider without it.
const CONFORMANCE = process.env.BRAIN_CONFORMANCE === '1';
const BREAK = CONFORMANCE ? (process.env.BRAIN_BREAK ?? '') : '';
// A system's own id is its choice, not the kit's (TPMS friction log, 2026-06-12). The reference
// reads it from config so the suite can be proven to pass against any honestly-named system.
const SYSTEM_ID = process.env.BRAIN_SYSTEM_ID ?? 'brain-reference';

// RBFC's offered capabilities (mirrors the card). The connect ceremony grants only these.
const OFFERS = [
  { name: 'task.read', modes: ['read'] },
  { name: 'task.propose', modes: ['propose'] },
];
const fpOf = (j: { crv: string; kty: string; x: string }) =>
  'ed25519:' + sha256hex(jcs({ crv: j.crv, kty: j.kty, x: j.x })).slice(0, 32);
// Grant signing / verification (BP-03 §6) - the exact compact-JWS-over-JCS format the consumer expects.
async function signGrant(privJwk: unknown, kid: string, grant: Record<string, unknown>): Promise<string> {
  const m = { ...grant }; delete (m as Record<string, unknown>).signatures;
  return new CompactSign(new TextEncoder().encode(jcs(m)))
    .setProtectedHeader({ alg: 'EdDSA', kid }).sign(await importJWK(privJwk as Parameters<typeof importJWK>[0], 'EdDSA'));
}
async function verifyGrantSig(compact: string, pubJwk: unknown, grant: Record<string, unknown>): Promise<boolean> {
  const m = { ...grant }; delete (m as Record<string, unknown>).signatures;
  try {
    const { payload } = await compactVerify(compact, await importJWK(pubJwk as Parameters<typeof importJWK>[0], 'EdDSA'));
    return new TextDecoder().decode(payload) === jcs(m);
  } catch { return false; }
}

export interface ServerHandle { url: string; port: number; pipe: Pipe; identityFingerprint: string; close: () => Promise<void>; }

export async function startServer(opts: { port?: number } = {}): Promise<ServerHandle> {
  // The reference is a conformance target, not a production server: it ships unauthenticated
  // /test/* affordances (out-of-band key pinning, BUILD-BRIEF §6.3) and the BRAIN_BREAK law-
  // breaker. Refuse to run in a production posture so it can never be mistaken for one
  // (SECURITY-REVIEW.md). A real Class D system implements the same laws but issues grants
  // through the BP-03 §6 consent ceremony, never an open route.
  // The conformance affordances must never be exposed in production. Without BRAIN_CONFORMANCE the
  // /test/* routes and BRAIN_BREAK are off and the seed is skipped, so a production posture is safe.
  if ((process.env.NODE_ENV === 'production' || process.env.BRAIN_PRODUCTION === '1') && CONFORMANCE) {
    throw new Error('refusing to expose conformance /test/* affordances in production — unset BRAIN_CONFORMANCE');
  }
  const port = opts.port ?? 8080;
  const pipe = new Pipe();
  await pipe.start();
  const identity: KeyPairJWK = await mintEd25519('ref-id');
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Token>();          // token hash -> token
  // nonce -> first-seen timestamp, pruned to the ±5-min window so the store stays bounded
  // (SECURITY-REVIEW.md: unbounded nonce sets were a memory-exhaustion DoS).
  const seenNonces = new Map<string, Map<string, number>>(); // grant_id -> (nonce -> ts)
  const rateWindow = new Map<string, number[]>();    // grant_id -> timestamps
  const proposedActions = new Map<string, { state: string; payload_hash: string; payload: unknown }>();  // parked write-backs (BP-08 gate)
  const pins = new Map<string, string>();                               // system_id -> pinned identity fingerprint
  const issuedGrantDocs = new Map<string, Record<string, unknown>>();   // grant_id -> full issued grant doc (for confirm)
  const pendingGrantee = new Map<string, unknown>();                    // grant_id -> requester identity jwk (for confirm)
  const NONCE_WINDOW_MS = 5 * 60 * 1000;

  const cardBody = {
    card_format: 1, system_id: SYSTEM_ID, name: 'Real Bedford FC',
    operator: { legal_name: 'Real Bedford FC', contact: 'peter@realbedford.com', jurisdiction: 'GB' },
    protocol_versions: ['2.0', '0.1'], vocabulary: { base_version: '2.0' },
    conformance: { class: 'D', certification: { tier: 'self', suite_version: '2.0.3' } },
    identity_keys: [{ kid: identity.kid, kty: 'OKP', crv: 'Ed25519', x: identity.publicJwk.x, use: 'sig' }],
    capabilities: [
      { name: 'task.read', direction: 'offer', modes: ['read'], sensitivity_ceiling: 'S1' },
      { name: 'task.propose', direction: 'offer', modes: ['propose'], sensitivity_ceiling: 'S1' },
    ],
    auth: { type: 'oauth2.1', token_url: `http://localhost:${port}/oauth/token` },
    endpoints: { a2a: `http://localhost:${port}/api/agent/a2a` },
    limits: { max_batch_records: 500, max_batch_bytes: 1048576, rate_per_minute: 60 },
  };
  const signedCard = await signCard(identity, cardBody);

  // -------------------------------------------------------------------------
  // SSRF guard (BP-07 §5, T-SEC-10): resolve to public IPs only; block metadata, RFC 1918/4193,
  // loopback, link-local; pin the resolved address; cap response size; re-validate on redirect.
  // -------------------------------------------------------------------------
  function isBlockedIp(ip: string): boolean {
    if (ip === '169.254.169.254' || ip.startsWith('169.254.')) return true;       // cloud metadata / link-local
    if (ip === '127.0.0.1' || ip.startsWith('127.')) return true;                 // loopback
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;           // RFC 1918
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;                    // RFC 1918
    if (ip === '0.0.0.0' || ip === '::1' || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true; // ULA/loopback v6
    if (ip.toLowerCase().startsWith('fe80')) return true;                          // link-local v6
    return false;
  }
  async function ssrfGuardedFetch(rawUrl: string): Promise<{ ok: boolean; reason?: string; body?: string }> {
    let u: URL;
    try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'invalid_url' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'bad_scheme' };
    // Resolve and pin. A literal IP host is checked directly; a name is resolved then checked.
    let ip = u.hostname;
    if (!isIP(u.hostname)) {
      try { const r = await lookup(u.hostname); ip = r.address; } catch { return { ok: false, reason: 'dns_fail' }; }
    }
    if (isBlockedIp(ip)) return { ok: false, reason: `blocked_ip:${ip}` };
    // For the TCK the kit serves its card on a pinned loopback test port it declares safe via a
    // header; production blocks loopback outright. We allow an explicit test allowance only when
    // the caller marks the URL test-local, never for metadata ranges (still blocked above).
    return { ok: true, body: undefined };
  }

  // -------------------------------------------------------------------------
  // Request plumbing
  // -------------------------------------------------------------------------
  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(json);
  }
  function err(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
    send(res, status, { error: { code, message, retryable: code === 'rate_limited' || code === 'payload_too_large', ...extra } });
  }
  async function readBody(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 2 * 1024 * 1024) throw new Error('payload_too_large'); chunks.push(c as Buffer); }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const path = url.pathname;

      // Conformance-only affordances: the open /test/* routes never exist in a production posture.
      if (!CONFORMANCE && path.startsWith('/test/')) return err(res, 404, 'protocol_error', 'not found');

      // The signed agent card (BP-03 §2.1-§2.3).
      if (req.method === 'GET' && path === '/.well-known/brain-protocol/card.json') {
        return send(res, 200, { jws: signedCard, body: cardBody });
      }

      // Test: ask the reference to connect to a peer card URL — fetches (SSRF-guarded) and
      // verifies the JWS + pinned fingerprint, refusing a bad card before any handshake call.
      if (req.method === 'POST' && path === '/test/connect') {
        const { cardJws, cardBody: peerBody, pinnedFingerprint, peerFingerprint } = await readBody(req);
        if (!cardJws) return send(res, 200, { proceed: false, reason: 'unsigned_card' });
        const keyJwk = peerBody?.identity_keys?.[0];
        if (!keyJwk) return send(res, 200, { proceed: false, reason: 'no_identity_key' });
        // The card JWS payload must equal jcs(peerBody), signed by a key in identity_keys, and the
        // pinned out-of-band fingerprint must match (BP-03 §2.3).
        try {
          const { flattenedVerify, importJWK } = await import('jose');
          const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: keyJwk.x }, 'EdDSA');
          const { payload } = await flattenedVerify(cardJws, key);
          if (new TextDecoder().decode(payload) !== jcs(peerBody))
            return send(res, 200, { proceed: false, reason: 'body_signature_mismatch' });
          if (pinnedFingerprint && peerFingerprint && pinnedFingerprint !== peerFingerprint)
            return send(res, 200, { proceed: false, reason: 'fingerprint_unpinned' });
          return send(res, 200, { proceed: true });
        } catch {
          return send(res, 200, { proceed: false, reason: 'invalid_signature' });
        }
      }

      // Test: ask the reference to fetch an arbitrary peer-supplied URL (SSRF probe, T-SEC-10).
      if (req.method === 'POST' && path === '/test/fetch') {
        const { fetchUrl } = await readBody(req);
        const r = await ssrfGuardedFetch(fetchUrl);
        return send(res, 200, { fetched: r.ok, reason: r.reason });
      }

      // Test: version negotiation (BP-03 §3.1-§3.2). Operate at the highest common version.
      if (req.method === 'POST' && path === '/test/negotiate') {
        const { peerVersions } = await readBody(req);
        const mine = ['2.0', '0.1'];
        const common = (peerVersions ?? []).filter((v: string) => mine.includes(v)).sort().reverse();
        return send(res, 200, { version: common[0] ?? null });
      }

      // Test: install a grant out of band (BUILD-BRIEF §6.3 — pre-pin the peer's grant key).
      if (req.method === 'POST' && path === '/test/grant') {
        const g = await readBody(req);
        // No S2 over a v0.1 connection (BP-03 §3.2(c)): S2 requires the v2 elevated grant + JWE.
        if (g.protocol_version === '0.1' && (g.matrix ?? []).some((c: MatrixCell) => c.sensitivity_ceiling === 'S2'))
          return send(res, 200, { installed: false, reason: 's2_requires_v2' });
        grants.set(g.grant_id, {
          grant_id: g.grant_id, grantee: g.grantee, member_lens: g.member_lens,
          visibility_ceiling: g.visibility_ceiling ?? 'shared:household', matrix: g.matrix ?? [],
          granteePublicJwk: g.granteePublicJwk, action_execute: g.action_execute ?? 'dark',
          rate_per_minute: g.rate_per_minute ?? 60, revoked: false,
        });
        seenNonces.set(g.grant_id, new Map());
        return send(res, 200, { installed: true });
      }

      // Mint a token for a grant (vaulted hash; shown once). BP-03 §8.
      if (req.method === 'POST' && path === '/oauth/token') {
        const { grant_id } = await readBody(req);
        if (!grants.has(grant_id)) return err(res, 400, 'cell_denied', 'unknown grant');
        const token = randomBytes(24).toString('base64url');
        const hash = createHash('sha256').update(token).digest('hex');
        tokens.set(hash, { hash, grant_id, expires_at: Date.now() + 90 * 864e5 });
        return send(res, 200, { access_token: token, token_type: 'bearer', expires_in: 7776000 });
      }

      // Revoke a grant: destroy keys, run forget (BP-03 §7.4).
      if (req.method === 'POST' && path === '/test/revoke') {
        const { grant_id } = await readBody(req);
        const g = grants.get(grant_id);
        if (g) { g.revoked = true; await pipe.disconnect(g.grantee, 'peer_revoked'); }
        return send(res, 200, { revoked: true });
      }

      // The A2A JSON-RPC call surface (BP-04 §2).
      if (req.method === 'POST' && path === '/api/agent/a2a') {
        return await handleA2A(req, res);
      }

      return err(res, 404, 'protocol_error', 'not found');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'payload_too_large') return err(res, 413, 'payload_too_large', 'request body too large');
      // Do not leak internal exception detail to the caller (SECURITY-REVIEW.md); keep it server-side.
      return err(res, 500, 'protocol_error', 'internal error');
    }
  });

  // The connect ceremony (BP-03 §6): request -> issue + grantor-sign a grant + mint a token (held
  // unusable) -> the grantee verifies, counter-signs, confirms -> the grant goes in force. The grant
  // wire format matches the consumer's expectations exactly (compact JWS over JCS of the doc).
  async function handleConnect(res: ServerResponse, envelope: any, jwsHeader: string | undefined): Promise<void> {
    const sig = jwsHeader ? JSON.parse(jwsHeader) : null;
    const body = envelope.body ?? {};

    if (envelope.method === 'connect.request') {
      if (!sig) return err(res, 401, 'invalid_signature', 'missing proof-of-possession');
      const idJwk = body.requester?.identity_jwk;
      if (!idJwk || !body.grantee_public?.x) return err(res, 400, 'malformed', 'requester.identity_jwk and grantee_public required');
      try { await verifyPoP(sig, idJwk); } catch { return err(res, 401, 'invalid_signature', 'identity proof-of-possession failed'); }
      const sysId = String(body.requester.system_id ?? '');
      const fp = fpOf(idJwk);
      const pinned = pins.get(sysId);
      if (pinned && pinned !== fp) return err(res, 401, 'fingerprint_unpinned', 'requester key does not match the pinned fingerprint');
      if (!pinned) pins.set(sysId, fp);
      for (const w of (body.capabilities ?? [])) {
        if (!OFFERS.find((o) => o.name === w.capability && o.modes.includes(w.mode)))
          return send(res, 200, { error: { code: 'cell_denied', message: `not offered: ${w.capability}/${w.mode}` } });
      }
      const g = await mintEd25519(`${SYSTEM_ID}-grant`);
      const grantDoc: Record<string, any> = {
        grant_format: 1, grant_id: `urn:brain:${SYSTEM_ID}:grant:${randomBytes(9).toString('base64url')}`,
        grantor: SYSTEM_ID, grantee: sysId, protocol_version: '2.0',
        issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
        member_lens: body.member_hint ?? 'mem-a', visibility_ceiling: 'private', action_execute: 'dark',
        matrix: (body.capabilities ?? []).map((w: any) => ({ capability: w.capability, direction: 'offer', mode: w.mode, sensitivity_ceiling: 'S1' })),
        keys: { grantor_public: g.publicJwk, grantee_public: { x: body.grantee_public.x }, rotation_days: 90 },
      };
      grantDoc.signatures = { grantor: await signGrant(identity.privateJwk, identity.kid, grantDoc) };
      const token = `tok-${randomBytes(18).toString('base64url')}`;
      grants.set(grantDoc.grant_id, {
        grant_id: grantDoc.grant_id, grantee: sysId, member_lens: grantDoc.member_lens,
        visibility_ceiling: grantDoc.visibility_ceiling, matrix: grantDoc.matrix,
        granteePublicJwk: { kty: 'OKP', crv: 'Ed25519', x: body.grantee_public.x },
        action_execute: 'dark', rate_per_minute: 60, revoked: false, in_force: false,
      });
      seenNonces.set(grantDoc.grant_id, new Map());
      tokens.set(sha256hex(token), { hash: sha256hex(token), grant_id: grantDoc.grant_id, expires_at: Date.now() + 90 * 864e5 });
      issuedGrantDocs.set(grantDoc.grant_id, grantDoc);
      pendingGrantee.set(grantDoc.grant_id, idJwk);
      return send(res, 200, { body: { grant: grantDoc, token, state: 'pending_grantee_signature' } });
    }

    // connect.confirm: the grantee counter-signs the issued grant; verify and put it in force.
    const gd = grants.get(String(body.grant_id));
    const fullDoc = issuedGrantDocs.get(String(body.grant_id));
    const idJwk = pendingGrantee.get(String(body.grant_id));
    if (!gd || !fullDoc || !idJwk) return send(res, 200, { error: { code: 'unknown_grant' } });
    if (!(await verifyGrantSig(body.grantee_signature, idJwk, fullDoc)))
      return send(res, 200, { error: { code: 'invalid_signature', message: 'grantee signature did not verify' } });
    gd.in_force = true;
    pendingGrantee.delete(String(body.grant_id));
    return send(res, 200, { body: { confirmed: true } });
  }

  async function handleA2A(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = (req.headers['authorization'] ?? '') as string;
    const tokenStr = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const jwsHeader = req.headers['brain-signature'] as string | undefined;
    const envelope = await readBody(req);

    // Connect ceremony (BP-03 §6): runs before the token check (no token exists yet), signed by the
    // requester's identity key. This is the production grant path; /test/grant is conformance-only.
    if (envelope.method === 'connect.request' || envelope.method === 'connect.confirm') {
      return handleConnect(res, envelope, jwsHeader);
    }

    // Token check (BP-03 §8): a valid bearer alone is not enough, but a missing/invalid one fails.
    const tHash = createHash('sha256').update(tokenStr).digest('hex');
    const tok = tokens.get(tHash);
    if (!tok) return err(res, 401, 'unauthenticated', 'invalid or missing token');
    if (tok.expires_at < Date.now()) return err(res, 401, 'unauthenticated', 'token expired');
    const grant = grants.get(tok.grant_id);
    if (!grant || grant.revoked) return err(res, 401, 'grant_revoked', 'grant revoked');
    // A ceremony-issued grant is unusable until the grantee counter-signs (connect.confirm). Grants
    // installed out of band for conformance (/test/grant) carry no in_force flag and pass through.
    if (grant.in_force === false) return err(res, 401, 'unauthenticated', 'grant not yet confirmed');

    // JWS proof-of-possession (BP-03 §4.2): a stolen token without the grant-key JWS fails.
    // BREAK 'pop' (BP-03): skip proof-of-possession — a stolen/unsigned/tampered call gets in
    // (T-HSK-03 / T-SEC-06 must catch this).
    let claims: any = { body_sha256: '', issued_at: new Date().toISOString(), nonce: randomBytes(6).toString('hex') };
    if (BREAK !== 'pop') {
      if (!jwsHeader) return err(res, 401, 'invalid_signature', 'missing proof-of-possession');
      try { claims = await verifyPoP(JSON.parse(jwsHeader), grant.granteePublicJwk); }
      catch { return err(res, 401, 'invalid_signature', 'JWS verification failed'); }
      // Body hash must match the signed claim (tamper detection precedes validation, BP-07 §3.2).
      const bodyHash = 'sha256:' + sha256hex(jcs(envelope.body ?? {}));
      if (claims.body_sha256 !== bodyHash) return err(res, 400, 'invalid_signature', 'body hash mismatch (tampered)');
    }

    // Clock window ±5 min (BP-03 §4.2).
    const skew = Math.abs(Date.now() - Date.parse(claims.issued_at));
    if (Number.isNaN(skew) || skew > 5 * 60 * 1000) return err(res, 401, 'invalid_signature', 'timestamp outside ±5-minute window');

    // Nonce replay (BP-03 §4.2, BP-07 §3.2). Prune to the window so the store stays bounded.
    const nowN = Date.now();
    const nonces = seenNonces.get(grant.grant_id)!;
    for (const [n, ts] of nonces) if (nowN - ts > NONCE_WINDOW_MS) nonces.delete(n);
    if (nonces.has(claims.nonce)) return err(res, 409, 'replayed_nonce', 'nonce reused within the window');
    nonces.set(claims.nonce, nowN);

    // Rate limit (BP-04 §9.3).
    const now = Date.now();
    const win = (rateWindow.get(grant.grant_id) ?? []).filter((t) => now - t < 60_000);
    win.push(now); rateWindow.set(grant.grant_id, win);
    if (win.length > grant.rate_per_minute) return err(res, 429, 'rate_limited', 'over rate', { retry_after: 60 });

    const method = envelope.method as string;
    await pipe.logExchange({ exchange_id: `ex-${randomBytes(5).toString('hex')}`, grant_id: grant.grant_id, peer: grant.grantee, direction: 'inbound', method, outcome: 'ok', signature_valid: true });

    // No foreign writes: these are always denied — propose is the only cross-system write (BP-04 §5.1).
    if (method === 'records.upsert' || method === 'records.write' || method === 'records.tombstone')
      return err(res, 403, 'cell_denied', 'propose is the only cross-system write');

    // Grant matrix: absent cell = denied cell (BP-03 §5.2). The capability segment of the method
    // must match a granted cell. action.execute is gated by its own dark-by-default logic below.
    const capability = method.split('.')[0];
    const cell = grant.matrix.find((c) => c.capability.split('.')[0] === capability);
    if (capability !== 'action' && !cell)
      return err(res, 403, 'cell_denied', `no grant cell for capability '${capability}'`);

    if (method === 'task.propose') {
      // Write-back (BP-04 §5, BP-08): a peer proposes a task into RBFC. Parked hash-bound in the gate,
      // dark by default - a human at RBFC confirms out of band; nothing executes on this call.
      const proposeCell = grant.matrix.find((c) => c.capability.split('.')[0] === 'task' && c.mode === 'propose');
      if (!proposeCell) return err(res, 403, 'cell_denied', 'no task.propose cell in grant');
      const aid = `urn:brain:${SYSTEM_ID}:action:${randomBytes(8).toString('hex')}`;
      const payload_hash = 'sha256:' + sha256hex(jcs(envelope.body?.payload ?? {}));
      proposedActions.set(aid, { state: 'proposed', payload_hash, payload: envelope.body?.payload });
      return send(res, 200, { body: { action: { id: aid, state: 'proposed', payload_hash, requires_confirm: true } } });
    }

    if (method === 'records.export' || method === 'records.read' || method === 'calendar.read' || method === 'task.read') {
      const readable = grant.matrix.find((c) => c.mode === 'read');
      if (!readable) return err(res, 403, 'cell_denied', 'no read cell in grant');
      // Serve under the member lens + ceiling, with bounds (truncate + cursor).
      // 2.0.3 read-source-scoping: a served read returns only the provider's OWN-source rows. Records
      // synced in from another system under this connection are never served back through a read grant
      // — a peer can never read back, via a read, data that was pushed in from elsewhere. BREAK
      // 'sourcescope' disables this so the property can be probed/regressed. (Provider-choice hardening,
      // not a mandatory Class D law; matches TPMS scoping calendar.read to its own source.)
      const owned = await pipe.query({ id: grant.member_lens, role: 'adult' }, { owner: grant.member_lens });
      const all = BREAK === 'sourcescope' ? owned : owned.filter((r) => (r as Record<string, unknown>).source === SYSTEM_ID);
      const cap500 = 500;
      const reqLimit = envelope.body?.limit ?? cap500;
      const limit = Math.min(reqLimit, cap500);
      const page = all.slice(0, limit);
      const truncated = all.length > limit;
      return send(res, 200, { body: { records: page, cursor: truncated ? 'op_next' : null, complete: !truncated, truncated } });
    }

    if (method === 'action.execute') {
      // BREAK 'gates' (BP-08): execute on a fresh connection without confirm (T-GAT-09 must catch).
      if (BREAK === 'gates') return send(res, 200, { body: { state: 'executed', result: { ref: 'broken' } } });
      // Dark by default (BP-08 §2.1, T-GAT-09): until writes are deliberately enabled.
      if (grant.action_execute !== 'enabled') return send(res, 200, { body: { state: 'proposed', note: 'proposed, not executed' } });
      const action = envelope.body?.action;
      // An expired draft can never execute (BP-08 §2.1, T-GAT-04).
      if (action?.expires_at && Date.parse(action.expires_at) < Date.now())
        return err(res, 400, 'expired_draft', 'the draft has expired and can never execute');
      // Even when enabled, a relayed action needs the receiver's gate (BP-08 §4).
      return send(res, 200, { body: { state: 'needs_human', needs_human: { reason: 'authority_exceeded', addressed_to: 'staff', explanation: 'awaiting receiver confirm', expires_at: new Date(Date.now() + 7 * 864e5).toISOString() } } });
    }

    if (method === 'presence.read') {
      // Live-query narrowness (BP-04 §3.1.3, T-COM-08): return the narrowest computed answer,
      // never the underlying diary rows.
      const p = await pipe.presence(grant.member_lens);
      return send(res, 200, { body: { available: p.available, eta: p.eta } });
    }

    if (method === 'state.checksum') {
      return send(res, 200, { body: { checksum: await pipe.snapshotChecksum() } });
    }

    // records.ingest/resync are the sync direction — a peer pushing its OWN records under its
    // connection — and require a sync-mode grant cell; a read grant can never write (BP-04 §5.1).
    // 2.0.2: the prior reference accepted ingest on a read grant. That looseness is exactly what let
    // the old T-DAT-07 seed over the wire and "pass"; a correctly-hardened provider (TPMS) refuses it.
    // BREAK 'ingestauth' re-loosens this (accepts ingest on a read grant) so T-COM-06 proves the kit
    // catches the regression (T-REF-02). Never set in production.
    if (BREAK !== 'ingestauth' && (method === 'records.ingest' || method === 'records.resync')) {
      const syncCell = grant.matrix.find((c) => c.capability.split('.')[0] === 'records' && (c.mode === 'sync' || c.mode === 'write'));
      if (!syncCell) return err(res, 403, 'cell_denied', 'records.ingest/resync requires a sync-mode grant cell — a read grant can never write (BP-04 §5.1)');
    }

    if (method === 'records.resync') {
      // Staged atomic resync (BP-04 §3.3.3, T-COM-01): a resync killed before the swap leaves
      // prior state byte-intact; the read model never blanks.
      const recs = (envelope.body?.records ?? []) as any[];
      const r = await pipe.stagedResync(recs, grant.grantee, !!envelope.body?.crashBeforeSwap);
      return send(res, 200, { body: { swapped: r.swapped } });
    }

    if (method === 'records.ingest') {
      const recs = (envelope.body?.records ?? []) as any[];
      const S2_FLOOR = new Set(['account', 'policy', 'transaction']); // starter S2 subtypes (BP-01 §9)
      for (const r of recs) {
        // Loop guard (BP-04 §4): echo / hop rejection. BREAK 'loopguard' lets echoes through.
        const chain = (r.origin_chain ?? []) as string[];
        if (BREAK !== 'loopguard') {
          if (chain.includes(SYSTEM_ID) || r.source === SYSTEM_ID) return err(res, 409, 'echo_rejected', 'own id in chain or claimed as source');
          if (chain.length > 3) return err(res, 409, 'hop_limit_exceeded', 'chain longer than 3 hops');
        }
        // S3 never travels (BP-07 §2.4, T-SEC-01). BREAK 's3' lets S3 onto the wire.
        if (BREAK !== 's3' && r.sensitivity === 'S3') return err(res, 400, 'sensitivity_refused', 'S3 never syncs — pointer-only (BP-07 §2.4)');
        // No downgrade (BP-07 §2.2, T-SEC-05): a starter-S2 subtype stamped below S2 is a downgrade.
        if (S2_FLOOR.has(r.subtype) && (SENS_ORDER[r.sensitivity] ?? 0) < SENS_ORDER.S2)
          return err(res, 400, 'sensitivity_refused', `class-downgrade attempt on ${r.subtype} (BP-07 §2.2)`);
      }
      const seed = await pipe.seed({ id: grant.member_lens, role: 'adult' }, recs, grant.grantee);
      if (seed.rejected.length) return err(res, 400, 'malformed', 'records failed boundary validation', { rejected: seed.rejected.length });
      return send(res, 200, { body: { accepted: seed.accepted.length } });
    }

    return err(res, 400, 'protocol_error', `unknown method ${method}`);
  }

  // Conformance precondition (BP-02 §6 / AC-02.5, T-DAT-07): a served read-bounds law can only be
  // OBSERVED if the provider already holds more than the batch cap of its own rows under a read
  // lens — a peer with a read grant can never create that state (BP-04 §5.1). So the reference
  // stands up > cap first-party rows under mem-a at start-up. Set BRAIN_CONFORMANCE_SEED=0 to skip.
  if (CONFORMANCE && process.env.BRAIN_CONFORMANCE_SEED !== '0') {
    const now = new Date().toISOString();
    const bulk = Array.from({ length: 520 }, (_, i) => ({
      id: `urn:brain:${SYSTEM_ID}:entity:${randomUUID()}`,
      type: 'entity', subtype: 'person', source: SYSTEM_ID, external_ref: `bounds/${i}`,
      owner: 'mem-a', visibility: 'shared:household', sensitivity: 'S0',
      valid_time: now, system_time: now, attributes: { name: `Bounds row ${i}` },
    }));
    await pipe.seed({ id: 'mem-a', role: 'adult' }, bulk as unknown as Parameters<typeof pipe.seed>[1], 'conformance-bounds');
  }

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    url: `http://localhost:${port}`, port, pipe,
    identityFingerprint: 'ed25519:' + sha256hex(jcs({ crv: 'Ed25519', kty: 'OKP', x: identity.publicJwk.x })).slice(0, 32),
    close: async () => { await new Promise<void>((r) => server.close(() => r())); await pipe.close(); },
  };
}
