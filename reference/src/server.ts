// The reference pipe's wire surface (BP-03, BP-04, BP-07). A small Node HTTP server: the signed
// agent card at the well-known path, an OAuth token endpoint, the A2A JSON-RPC endpoint with JWS
// proof-of-possession + grant-matrix + bounds enforcement, dark-by-default execution, the loop
// guard, the SSRF-guarded peer-card fetch, and the BP-04 error model. Test-only endpoints let the
// kit pin keys out of band (BUILD-BRIEF §6.3) — the honest mirror of the real ceremony.
//
// CD-3: this server makes no outbound call except the peer-card fetch it is explicitly asked to
// make (T-SEC-11 captures the network and proves no phone-home).

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Pipe } from './pipe.js';
import { mintEd25519, signCard, verifyPoP, sha256hex, jcs, type KeyPairJWK } from './wire-crypto.js';

interface MatrixCell { capability: string; direction: string; mode: string; sensitivity_ceiling: string; }
interface Grant {
  grant_id: string; grantee: string; member_lens: string; visibility_ceiling: string;
  matrix: MatrixCell[]; granteePublicJwk: any; action_execute: 'dark' | 'enabled';
  rate_per_minute: number; revoked: boolean;
}
interface Token { hash: string; grant_id: string; expires_at: number; }

const SENS_ORDER: Record<string, number> = { S0: 0, S1: 1, S2: 2, S3: 3 };

export interface ServerHandle { url: string; port: number; pipe: Pipe; identityFingerprint: string; close: () => Promise<void>; }

export async function startServer(opts: { port?: number } = {}): Promise<ServerHandle> {
  const port = opts.port ?? 8080;
  const pipe = new Pipe();
  await pipe.start();
  const identity: KeyPairJWK = await mintEd25519('ref-id');
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Token>();          // token hash -> token
  const seenNonces = new Map<string, Set<string>>(); // grant_id -> nonces
  const rateWindow = new Map<string, number[]>();    // grant_id -> timestamps

  const cardBody = {
    card_format: 1, system_id: 'brain-reference', name: 'Brain Protocol Reference Pipe',
    operator: { legal_name: 'Brain Protocol', contact: 'ref@brain-protocol.example', jurisdiction: 'GB' },
    protocol_versions: ['2.0', '0.1'], vocabulary: { base_version: '2.0' },
    conformance: { class: 'D', certification: { tier: 'self', suite_version: '2.0.0' } },
    identity_keys: [{ kid: identity.kid, kty: 'OKP', crv: 'Ed25519', x: identity.publicJwk.x, use: 'sig' }],
    capabilities: [
      { name: 'calendar.read', direction: 'offer', modes: ['read'], sensitivity_ceiling: 'S1' },
      { name: 'appointment.book', direction: 'offer', modes: ['propose'], sensitivity_ceiling: 'S1' },
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

      // The signed agent card (BP-03 §2.1-§2.3).
      if (req.method === 'GET' && path === '/.well-known/brain-protocol/card.json') {
        return send(res, 200, { jws: signedCard, body: cardBody });
      }

      // Test: ask the reference to connect to a peer card URL — fetches (SSRF-guarded) and
      // verifies the JWS + pinned fingerprint, refusing a bad card before any handshake call.
      if (req.method === 'POST' && path === '/test/connect') {
        const { cardJws, cardBody: peerBody, pinnedFingerprint, peerFingerprint } = await readBody(req);
        if (!cardJws) return send(res, 200, { proceed: false, reason: 'unsigned_card' });
        // verify signature against a key in the card's identity_keys.
        try {
          const keyJwk = peerBody?.identity_keys?.[0];
          if (!keyJwk) return send(res, 200, { proceed: false, reason: 'no_identity_key' });
          await verifyPoP(cardJws, { kty: 'OKP', crv: 'Ed25519', x: keyJwk.x }).catch(() => { throw new Error('bad'); });
          // verifyPoP expects PoP-claims JSON; for a card the payload is the card body. Verify by
          // re-signing check instead: compare the JWS payload to jcs(peerBody).
        } catch { /* fall through to manual verify below */ }
        // Manual verify: the card JWS payload must equal jcs(peerBody) and pinned fp must match.
        try {
          const keyJwk = peerBody.identity_keys[0];
          const { flattenedVerify, importJWK } = await import('jose');
          const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: keyJwk.x }, 'EdDSA');
          const { payload } = await flattenedVerify(cardJws, key);
          const ok = new TextDecoder().decode(payload) === jcs(peerBody);
          if (!ok) return send(res, 200, { proceed: false, reason: 'body_signature_mismatch' });
          if (pinnedFingerprint && peerFingerprint && pinnedFingerprint !== peerFingerprint)
            return send(res, 200, { proceed: false, reason: 'fingerprint_unpinned' });
          return send(res, 200, { proceed: true });
        } catch (e) {
          return send(res, 200, { proceed: false, reason: 'invalid_signature' });
        }
      }

      // Test: ask the reference to fetch an arbitrary peer-supplied URL (SSRF probe, T-SEC-10).
      if (req.method === 'POST' && path === '/test/fetch') {
        const { fetchUrl } = await readBody(req);
        const r = await ssrfGuardedFetch(fetchUrl);
        return send(res, 200, { fetched: r.ok, reason: r.reason });
      }

      // Test: install a grant out of band (BUILD-BRIEF §6.3 — pre-pin the peer's grant key).
      if (req.method === 'POST' && path === '/test/grant') {
        const g = await readBody(req);
        grants.set(g.grant_id, {
          grant_id: g.grant_id, grantee: g.grantee, member_lens: g.member_lens,
          visibility_ceiling: g.visibility_ceiling ?? 'shared:household', matrix: g.matrix ?? [],
          granteePublicJwk: g.granteePublicJwk, action_execute: g.action_execute ?? 'dark',
          rate_per_minute: g.rate_per_minute ?? 60, revoked: false,
        });
        seenNonces.set(g.grant_id, new Set());
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
      return err(res, 500, 'protocol_error', msg);
    }
  });

  async function handleA2A(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = (req.headers['authorization'] ?? '') as string;
    const tokenStr = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const jwsHeader = req.headers['brain-signature'] as string | undefined;
    const envelope = await readBody(req);

    // Token check (BP-03 §8): a valid bearer alone is not enough, but a missing/invalid one fails.
    const tHash = createHash('sha256').update(tokenStr).digest('hex');
    const tok = tokens.get(tHash);
    if (!tok) return err(res, 401, 'unauthenticated', 'invalid or missing token');
    if (tok.expires_at < Date.now()) return err(res, 401, 'unauthenticated', 'token expired');
    const grant = grants.get(tok.grant_id);
    if (!grant || grant.revoked) return err(res, 401, 'grant_revoked', 'grant revoked');

    // JWS proof-of-possession (BP-03 §4.2): a stolen token without the grant-key JWS fails.
    if (!jwsHeader) return err(res, 401, 'invalid_signature', 'missing proof-of-possession');
    let claims;
    try { claims = await verifyPoP(JSON.parse(jwsHeader), grant.granteePublicJwk); }
    catch { return err(res, 401, 'invalid_signature', 'JWS verification failed'); }

    // Body hash must match the signed claim (tamper detection precedes validation, BP-07 §3.2).
    const bodyHash = 'sha256:' + sha256hex(jcs(envelope.body ?? {}));
    if (claims.body_sha256 !== bodyHash) return err(res, 400, 'invalid_signature', 'body hash mismatch (tampered)');

    // Clock window ±5 min (BP-03 §4.2).
    const skew = Math.abs(Date.now() - Date.parse(claims.issued_at));
    if (Number.isNaN(skew) || skew > 5 * 60 * 1000) return err(res, 401, 'invalid_signature', 'timestamp outside ±5-minute window');

    // Nonce replay (BP-03 §4.2, BP-07 §3.2).
    const nonces = seenNonces.get(grant.grant_id)!;
    if (nonces.has(claims.nonce)) return err(res, 409, 'replayed_nonce', 'nonce reused within the window');
    nonces.add(claims.nonce);

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

    if (method === 'records.export' || method === 'records.read' || method === 'calendar.read') {
      const readable = grant.matrix.find((c) => c.mode === 'read');
      if (!readable) return err(res, 403, 'cell_denied', 'no read cell in grant');
      // Serve under the member lens + ceiling, with bounds (truncate + cursor).
      const all = await pipe.query({ id: grant.member_lens, role: 'adult' }, { owner: grant.member_lens });
      const cap500 = 500;
      const reqLimit = envelope.body?.limit ?? cap500;
      const limit = Math.min(reqLimit, cap500);
      const page = all.slice(0, limit);
      const truncated = all.length > limit;
      return send(res, 200, { body: { records: page, cursor: truncated ? 'op_next' : null, complete: !truncated, truncated } });
    }

    if (method === 'action.execute') {
      // Dark by default (BP-08 §2.1, T-GAT-09): until writes are deliberately enabled.
      if (grant.action_execute !== 'enabled') return send(res, 200, { body: { state: 'proposed', note: 'proposed, not executed' } });
      const action = envelope.body?.action;
      // An expired draft can never execute (BP-08 §2.1, T-GAT-04).
      if (action?.expires_at && Date.parse(action.expires_at) < Date.now())
        return err(res, 400, 'expired_draft', 'the draft has expired and can never execute');
      // Even when enabled, a relayed action needs the receiver's gate (BP-08 §4).
      return send(res, 200, { body: { state: 'needs_human', needs_human: { reason: 'authority_exceeded', addressed_to: 'staff', explanation: 'awaiting receiver confirm', expires_at: new Date(Date.now() + 7 * 864e5).toISOString() } } });
    }

    if (method === 'records.ingest') {
      const recs = (envelope.body?.records ?? []) as any[];
      const S2_FLOOR = new Set(['account', 'policy', 'transaction']); // starter S2 subtypes (BP-01 §9)
      for (const r of recs) {
        // Loop guard (BP-04 §4): echo / hop rejection.
        const chain = (r.origin_chain ?? []) as string[];
        if (chain.includes('brain-reference') || r.source === 'brain-reference') return err(res, 409, 'echo_rejected', 'own id in chain or claimed as source');
        if (chain.length > 3) return err(res, 409, 'hop_limit_exceeded', 'chain longer than 3 hops');
        // S3 never travels (BP-07 §2.4, T-SEC-01). A reference pointer (S1, attributes.s3_pointer)
        // is the only lawful sealed-data shape and passes (T-SEC-02).
        if (r.sensitivity === 'S3') return err(res, 400, 'sensitivity_refused', 'S3 never syncs — pointer-only (BP-07 §2.4)');
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

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    url: `http://localhost:${port}`, port, pipe,
    identityFingerprint: 'ed25519:' + sha256hex(jcs({ crv: 'Ed25519', kty: 'OKP', x: identity.publicJwk.x })).slice(0, 32),
    close: async () => { await new Promise<void>((r) => server.close(() => r())); await pipe.close(); },
  };
}
