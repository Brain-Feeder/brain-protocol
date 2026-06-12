// Brain Protocol v0.1 — vendored types + validators, zero dependencies. Bundled with the reference
// agent so it runs the moment you copy it, before @brainfeed/protocol is on your registry. It is a
// faithful mirror of the package; once you can `npm i @brainfeed/protocol`, replace this file with
// that import. The shapes here are the CONTRACT — do not change them. (The conformance runner
// validates against the real package, so any drift from this mirror is caught at the gate.)

export const PROTOCOL_VERSION = '0.1.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Entity {
  id: string; type: 'entity'; kind: string; name: string;
  summary?: string | null; attrs?: Record<string, unknown>;
  source: string; external_ref: string;
}
export interface Activity {
  id: string; type: 'activity'; activity_type: string; title: string;
  starts_at?: string | null; ends_at?: string | null; due_on?: string | null;
  status?: string | null; amount?: number | null; location?: string | null;
  source: string; external_ref: string;
}
// A capability a hub may ask for. `name` + `verbs` are the contract; `describe` is OPTIONAL,
// model-readable semantics — the card teaching a hub's model how to query this system, so no
// bespoke per-system wiring is needed. A minimal card omits it and still works via the generic list.
export interface Capability {
  name: string; verbs: string[];
  describe?: {
    summary?: string;         // one plain-English line: what this capability answers
    statuses?: string[];      // the status words items here actually use (see ACTIVITY_STATUS)
    fields?: string[];        // notable fields a hub can rely on
    examples?: string[];      // example natural-language questions this capability can answer
    query_params?: string[];  // which ActivityQuery filters this capability honours, e.g. ['status','q','since']
  };
}
export interface AgentCard {
  system_id: string; name: string; protocol_version: string; summary?: string;
  auth: { type: string; authorize_url?: string; token_url?: string; scopes?: string[] };
  capabilities: Capability[];
  endpoints: { a2a?: string };
}

// ── Shared status vocabulary ──────────────────────────────────────────────────────────────────
// One set of words so "outstanding" means the same thing in every system. A system MAY use its own
// status strings, but SHOULD map onto these where they fit, so a hub can reason across systems with
// no per-system rules. Two groups: "outstanding" (still in flight / needs the user) and "settled"
// (closed). Anything unknown is treated as outstanding — safer to surface than to silently hide.
export const ACTIVITY_STATUS = {
  outstanding: ['ordered', 'on_the_way', 'out_for_delivery', 'to_collect', 'open', 'in_progress', 'scheduled', 'waiting'],
  settled: ['delivered', 'arrived', 'collected', 'done', 'completed', 'cancelled', 'returned', 'refunded', 'failed'],
} as const;
export const ACTIVITY_STATUS_VOCAB: string[] = [...ACTIVITY_STATUS.outstanding, ...ACTIVITY_STATUS.settled];

/** True if a status means "still needs attention / not closed". Unknown statuses count as outstanding. */
export function isOutstanding(status?: string | null): boolean {
  return !status || !(ACTIVITY_STATUS.settled as readonly string[]).includes(status);
}

// ── Typed activity query (the precise question on the wire) ─────────────────────────────────────
// activities.query MAY accept these filters so a hub asks a precise question instead of pulling the
// whole list and filtering in its head. All optional: a minimal agent ignores them and returns the
// full list (the hub still filters). status: match any; since/until: ISO-date bounds on due_on or
// starts_at; q: case-insensitive substring over title; limit: cap the count.
export interface ActivityQuery {
  status?: string[]; since?: string; until?: string; q?: string; limit?: number;
}

/** Reference filter a self-describing agent applies to honour an ActivityQuery. Pure + reusable. */
export function filterActivities(items: Activity[], query: ActivityQuery = {}): Activity[] {
  const { status, since, until, q, limit } = query;
  const dateOf = (a: Activity) => a.due_on ?? a.starts_at ?? null;
  let out = items;
  if (status?.length) out = out.filter(a => a.status != null && status.includes(a.status));
  if (q) { const needle = q.toLowerCase(); out = out.filter(a => a.title.toLowerCase().includes(needle)); }
  if (since) out = out.filter(a => { const d = dateOf(a); return d != null && d >= since; });
  if (until) out = out.filter(a => { const d = dateOf(a); return d != null && d <= until; });
  if (limit != null && limit >= 0) out = out.slice(0, limit);
  return out;
}

export interface Result<T> { ok: boolean; value?: T; errors?: string[] }
const str = (v: unknown) => typeof v === 'string' && v.length > 0;

export function validateEntity(d: unknown): Result<Entity> {
  const e = d as Record<string, unknown>; const errs: string[] = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: ['not an object'] };
  if (!str(e.id) || !UUID.test(String(e.id))) errs.push('id: invalid uuid');
  if (e.type !== 'entity') errs.push('type: must be "entity"');
  if (!str(e.kind)) errs.push('kind: required');
  if (!str(e.name)) errs.push('name: required');
  if (!str(e.source)) errs.push('source: required');
  if (!str(e.external_ref)) errs.push('external_ref: required');
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: e as unknown as Entity };
}

export function validateActivity(d: unknown): Result<Activity> {
  const a = d as Record<string, unknown>; const errs: string[] = [];
  if (!a || typeof a !== 'object') return { ok: false, errors: ['not an object'] };
  if (!str(a.id) || !UUID.test(String(a.id))) errs.push('id: invalid uuid');
  if (a.type !== 'activity') errs.push('type: must be "activity"');
  if (!str(a.activity_type)) errs.push('activity_type: required');
  if (!str(a.title)) errs.push('title: required');
  if (!str(a.source)) errs.push('source: required');
  if (!str(a.external_ref)) errs.push('external_ref: required');
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: a as unknown as Activity };
}
