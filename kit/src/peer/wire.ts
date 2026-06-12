// The kit's wire client: drives the system under test over HTTP as a peer (BP-03/BP-04).
// It fetches and verifies the target's card, installs a grant out of band (pinning the kit-peer's
// grant signing key — the honest mirror of the real ceremony, BUILD-BRIEF §6.3), mints a token,
// and makes JWS-signed calls, with hooks to misbehave (no JWS, tampered body, replayed nonce,
// skewed clock) for the attack tests. Talks only to --target (CD-3).

import { importJWK, flattenedVerify } from 'jose';
import { signBatch, jcsCanonical, sha256Prefixed, randomNonce, mintEd25519, mintX25519, type KeyPairJWK } from './crypto.js';

export interface WireCallResult { status: number; body: any; headers: Headers; }

export class WireClient {
  private grantId = `urn:brain:brain-tck-peer:grant:${randomNonce()}`;
  private token = '';
  private signKey!: KeyPairJWK;
  private encKey!: KeyPairJWK;
  private usedNonce = '';
  clockSkewSeconds = 0;

  constructor(public target: string) {}

  /** GET the card and verify its JWS against a key in identity_keys (BP-03 §2.3). */
  async fetchAndVerifyCard(): Promise<{ ok: boolean; reason?: string; body?: any; fingerprint?: string }> {
    const r = await fetch(`${this.target}/.well-known/brain-protocol/card.json`);
    const { jws, body } = (await r.json()) as { jws: any; body: any };
    if (!jws) return { ok: false, reason: 'unsigned' };
    try {
      const k = body.identity_keys[0];
      const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: k.x }, 'EdDSA');
      const { payload } = await flattenedVerify(jws, key);
      if (new TextDecoder().decode(payload) !== jcsCanonical(body)) return { ok: false, reason: 'body_mismatch', body };
      const { sha256 } = await import('./crypto.js');
      return { ok: true, body, fingerprint: 'ed25519:' + sha256(jcsCanonical({ crv: 'Ed25519', kty: 'OKP', x: k.x })).slice(0, 32) };
    } catch { return { ok: false, reason: 'invalid_signature', body }; }
  }

  /** Install a grant on the target (out-of-band pin) and mint a token. */
  async handshake(opts: { matrix: any[]; actionExecute?: 'dark' | 'enabled'; ratePerMinute?: number; memberLens?: string }): Promise<void> {
    this.signKey = await mintEd25519('g-sign');
    this.encKey = await mintX25519('g-enc');
    await this.post('/test/grant', {
      grant_id: this.grantId, grantee: 'brain-tck-peer', member_lens: opts.memberLens ?? 'mem-a',
      visibility_ceiling: 'shared:household', matrix: opts.matrix,
      granteePublicJwk: this.signKey.publicJwk, action_execute: opts.actionExecute ?? 'dark',
      rate_per_minute: opts.ratePerMinute ?? 60,
    });
    const tok = await this.post('/oauth/token', { grant_id: this.grantId });
    this.token = tok.body.access_token;
  }

  async revoke(): Promise<void> { await this.post('/test/revoke', { grant_id: this.grantId }); }

  /** A signed A2A call, with optional misbehaviour for the attack tests. */
  async call(method: string, body: unknown, attack: {
    noJws?: boolean; tamperBody?: boolean; replayNonce?: boolean; skewSeconds?: number; wrongToken?: boolean;
  } = {}): Promise<WireCallResult> {
    const envelope = { envelope_format: 1, protocol_version: '2.0', grant_id: this.grantId, method, body };
    const nonce = attack.replayNonce && this.usedNonce ? this.usedNonce : randomNonce();
    this.usedNonce = nonce;
    const issuedAt = new Date(Date.now() + (attack.skewSeconds ?? 0) * 1000).toISOString();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    headers['authorization'] = `Bearer ${attack.wrongToken ? 'stolen-token' : this.token}`;
    if (!attack.noJws) {
      const signed = attack.tamperBody
        ? await this.signClaims(method, { tampered: true }, nonce, issuedAt) // sign a DIFFERENT body
        : await signBatch(this.signKey, method, body, { nonce, issuedAt });
      headers['brain-signature'] = JSON.stringify(signed.jws);
    }
    const res = await fetch(`${this.target}/api/agent/a2a`, { method: 'POST', headers, body: JSON.stringify(envelope) });
    let parsed: any = {};
    try { parsed = await res.json(); } catch { /* */ }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  private async signClaims(method: string, body: unknown, nonce: string, issuedAt: string) {
    return signBatch(this.signKey, method, body, { nonce, issuedAt });
  }

  async post(path: string, body: unknown): Promise<WireCallResult> {
    const res = await fetch(`${this.target}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let parsed: any = {};
    try { parsed = await res.json(); } catch { /* */ }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get encryptionKey() { return this.encKey; }
}
