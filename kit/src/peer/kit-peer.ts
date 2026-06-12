// The kit-peer: the counterpart system the kit plays on the wire (BUILD-BRIEF §3.2).
//
// It serves its own signed agent card, mints per-grant Ed25519 signing + X25519 encryption
// keys, signs batches with proof-of-possession, and can deliberately misbehave (unsigned
// card, tampered body, wrong-key signature, replayed nonce, skewed clock) so the wire suites
// can attack the target the way a real bad peer would. CD-3: it transmits only to the target.

import {
  mintEd25519,
  mintX25519,
  signBatch,
  jcsCanonical,
  keyFingerprint,
  randomNonce,
  type KeyPairJWK,
} from './crypto.js';
import { FlattenedSign } from 'jose';

export interface KitPeerOptions {
  systemId?: string;
  /** seconds to add to issued_at on signed batches, to test the ±5-minute window. */
  clockSkewSeconds?: number;
}

export type CardVariant = 'valid' | 'unsigned' | 'tampered' | 'wrong-key';

export class KitPeer {
  readonly systemId: string;
  clockSkewSeconds: number;
  identityKey!: KeyPairJWK;
  /** an attacker key NOT listed in the card's identity_keys (for the wrong-key card test). */
  private foreignKey!: KeyPairJWK;
  /** per-grant key material, by grant id. */
  readonly grantKeys = new Map<string, { sign: KeyPairJWK; enc: KeyPairJWK }>();
  private usedNonces = new Set<string>();

  private constructor(systemId: string, clockSkewSeconds: number) {
    this.systemId = systemId;
    this.clockSkewSeconds = clockSkewSeconds;
  }

  static async create(opts: KitPeerOptions = {}): Promise<KitPeer> {
    const peer = new KitPeer(opts.systemId ?? 'brain-tck-peer', opts.clockSkewSeconds ?? 0);
    peer.identityKey = await mintEd25519('id');
    peer.foreignKey = await mintEd25519('foreign');
    return peer;
  }

  /** The card body (unsigned JSON), schema-valid per agent-card.schema.json. */
  cardBody(): Record<string, unknown> {
    return {
      card_format: 1,
      system_id: this.systemId,
      name: 'Brain Protocol TCK Peer',
      operator: { legal_name: 'Brain Protocol TCK', contact: 'tck@brain-protocol.example', jurisdiction: 'GB' },
      protocol_versions: ['2.0', '0.1'],
      vocabulary: { base_version: '2.0' },
      conformance: { class: 'H', certification: { tier: 'verified', suite_version: '2.0.0' } },
      identity_keys: [
        { kid: this.identityKey.kid, kty: 'OKP', crv: 'Ed25519', x: this.identityKey.publicJwk.x, use: 'sig' },
      ],
      capabilities: [
        { name: 'calendar.read', direction: 'offer', modes: ['read'], sensitivity_ceiling: 'S1' },
        { name: 'appointment.book', direction: 'consume', modes: ['propose'], sensitivity_ceiling: 'S1' },
      ],
      auth: { type: 'oauth2.1', token_url: 'https://tck.example/oauth/token' },
      endpoints: { a2a: 'https://tck.example/api/agent/a2a' },
      limits: { max_batch_records: 500, max_batch_bytes: 1048576, rate_per_minute: 60 },
    };
  }

  get identityFingerprint(): string {
    return keyFingerprint(this.identityKey.publicJwk);
  }

  /** Produce a JWS-signed card, or a deliberately broken variant (BP-03 §2.3, AC-03.1). */
  async signedCard(variant: CardVariant = 'valid'): Promise<{ jws: any; body: Record<string, unknown> } | { unsigned: Record<string, unknown> }> {
    const body = this.cardBody();
    if (variant === 'unsigned') return { unsigned: body };
    const signingKey = variant === 'wrong-key' ? this.foreignKey : this.identityKey;
    const signedBody = variant === 'tampered' ? body : body;
    const jws = await new FlattenedSign(new TextEncoder().encode(jcsCanonical(signedBody)))
      .setProtectedHeader({ alg: 'EdDSA', kid: signingKey.kid })
      .sign(signingKey.privateKey);
    if (variant === 'tampered') {
      // mutate the body after signing so body no longer matches the signature.
      const mutated = { ...body, name: 'Tampered Peer' };
      return { jws, body: mutated };
    }
    return { jws, body };
  }

  /** Mint per-grant key pairs (Ed25519 sign + X25519 enc), as a real handshake does. */
  async mintGrantKeys(grantId: string): Promise<{ sign: KeyPairJWK; enc: KeyPairJWK }> {
    const sign = await mintEd25519('g-sign');
    const enc = await mintX25519('g-enc');
    this.grantKeys.set(grantId, { sign, enc });
    return { sign, enc };
  }

  /** Sign a batch under a grant, applying the configured clock skew. */
  async signFor(grantId: string, method: string, body: unknown, opts: { nonce?: string; replayNonce?: string } = {}) {
    const keys = this.grantKeys.get(grantId);
    if (!keys) throw new Error(`no grant keys for ${grantId}`);
    const nonce = opts.replayNonce ?? opts.nonce ?? randomNonce();
    const issuedAt = new Date(Date.now() + this.clockSkewSeconds * 1000).toISOString();
    this.usedNonces.add(nonce);
    return signBatch(keys.sign, method, body, { nonce, issuedAt });
  }

  reset(): void {
    this.usedNonces.clear();
    this.clockSkewSeconds = 0;
  }
}
