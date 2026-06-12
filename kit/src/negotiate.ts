// Connect-time vocabulary negotiation (BP-01 §11, BP-03 §3.3, CD-6).
//
// A connection only joins semantically if both sides speak the base vocabulary or have
// declared an explicit mapping. A connection where either side's terms are neither
// base-vocabulary nor mapped MUST NOT proceed to sync; live query MAY proceed for
// base-vocabulary capabilities only. This is the canonical rule the kit checks (T-ENV-10)
// and the reference pipe applies at handshake.

import { isKnownTerm } from './validate.js';

export interface MappingEntry {
  field: 'subtype' | 'state' | 'visibility_scope';
  local: string;
  base: string;
  direction: 'emit' | 'accept' | 'both';
}

export interface VocabularyDeclaration {
  vocabulary_version: string;
  /** local terms this side emits or expects, by field. */
  terms: { subtype?: string[]; edge?: string[] };
  mappings?: MappingEntry[];
}

export type ConnectVerdict = 'sync' | 'live-query-only' | 'no-connection';

/** Decide whether a connection may proceed to sync, given one side's declaration. */
export function connectVerdict(decl: VocabularyDeclaration): {
  verdict: ConnectVerdict;
  unmapped: string[];
} {
  const mapped = new Set(
    (decl.mappings ?? [])
      .filter((m) => m.field === 'subtype')
      .map((m) => m.local),
  );
  const unmapped: string[] = [];
  for (const term of decl.terms.subtype ?? []) {
    if (!isKnownTerm('subtype', term) && !mapped.has(term)) unmapped.push(term);
  }
  for (const term of decl.terms.edge ?? []) {
    if (!isKnownTerm('edge', term) && !mapped.has(term)) unmapped.push(term);
  }
  // Terms neither base nor mapped block sync. Base-vocabulary live query MAY still proceed,
  // but a load-bearing unmapped term means the safe verdict is no-connection for sync paths.
  if (unmapped.length === 0) return { verdict: 'sync', unmapped };
  return { verdict: 'no-connection', unmapped };
}
