// Deterministic record fixtures (fixed seeds, BUILD-BRIEF §3.3). Valid base records the
// suites mutate into the invalid variants the boundary must reject.

import type { BrainRecord } from '../types.js';

const SYS = 'garagebrain';
let uuidCounter = 0;
/** Deterministic v4-shaped UUID so runs are reproducible. */
export function fixedUuid(): string {
  uuidCounter++;
  const h = uuidCounter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
}
export function resetUuids(): void { uuidCounter = 0; }

export function urn(system: string, rtype: string, uuid = fixedUuid()): string {
  return `urn:brain:${system}:${rtype}:${uuid}`;
}

// A genuinely unique urn for wire tests, which share a server DB that is never reset between
// tests — deterministic ids would collide on the primary key. Uses a random UUID.
export function randUrn(system: string, rtype: string): string {
  return `urn:brain:${system}:${rtype}:${crypto.randomUUID()}`;
}

const T_VALID = '2026-06-11T09:10:00Z';
const T_SYS = '2026-06-11T09:12:00Z';

export function validPerson(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn(SYS, 'entity'),
    type: 'entity', subtype: 'person', source: SYS,
    external_ref: 'customer/0871', owner: 'mem-a',
    valid_time: T_VALID, system_time: T_SYS,
    visibility: 'shared:household', sensitivity: 'S1',
    attributes: { name: 'Peter McCormack', summary: 'Account holder since 2021.' },
    ...over,
  };
}

export function validVehicle(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn(SYS, 'entity'),
    type: 'entity', subtype: 'vehicle', source: SYS,
    external_ref: 'vehicle/2231', owner: 'mem-a',
    valid_time: '2021-09-01T00:00:00Z', system_time: T_SYS,
    interval: { start: '2021-09-01T00:00:00Z' },
    visibility: 'shared:household', sensitivity: 'S1',
    attributes: { name: 'Land Rover Defender', registration: 'LD70 XKP', mot_due: '2027-03-14' },
    ...over,
  };
}

export function validActivity(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn(SYS, 'activity'),
    type: 'activity', subtype: 'task', source: SYS,
    external_ref: 'task/1', owner: 'mem-a',
    valid_time: T_VALID, system_time: T_SYS, state: 'open',
    visibility: 'shared:household', sensitivity: 'S1',
    attributes: { title: 'Service booking' },
    ...over,
  };
}

export function validEdge(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn(SYS, 'edge'),
    type: 'edge', subtype: 'related_to', source: SYS,
    subject: urn(SYS, 'activity'), object: urn(SYS, 'entity'),
    valid_time: T_SYS, system_time: T_SYS,
    visibility: 'shared:household', sensitivity: 'S1',
    ...over,
  };
}

export function validAction(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn('brainfeeder', 'action'),
    type: 'action', subtype: 'book', source: 'brainfeeder',
    external_ref: 'action/3321', owner: 'mem-a', state: 'proposed',
    summary: 'Book GP appointment, Thu 18 Jun 09:00.',
    payload: { capability: 'appointment.book', slot: '2026-06-18T09:00:00Z' },
    payload_hash: 'sha256:9e1c00000000000000000000000000000000000000000000000000000000abcd',
    requires_confirm: true,
    valid_time: T_VALID, system_time: T_SYS,
    visibility: 'shared:household', sensitivity: 'S1',
    ...over,
  };
}

export function validGoalEntity(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn('brainfeeder', 'entity'),
    type: 'entity', subtype: 'goal', source: 'manual',
    external_ref: 'goal/run-10k', owner: 'mem-a',
    valid_time: '2026-06-01T00:00:00Z', system_time: '2026-06-01T08:00:00Z',
    state: 'in_progress', visibility: 'private', sensitivity: 'S1',
    attributes: { name: 'Run a 10k', target: 'complete a 10k race', measure: 'official race finish time', horizon: '2026-09-30' },
    ...over,
  };
}

export function validGoalActivity(over: Partial<BrainRecord> = {}): BrainRecord {
  return {
    id: urn('examplefit', 'activity'),
    type: 'activity', subtype: 'goal', source: 'examplefit',
    external_ref: 'goals/10k-2026', owner: 'mem-a',
    valid_time: '2026-06-01T00:00:00Z', system_time: '2026-06-01T08:00:00Z',
    interval: { start: '2026-06-01T00:00:00Z', end: '2026-09-30T23:59:59Z' },
    state: 'in_progress', visibility: 'private', sensitivity: 'S1',
    attributes: { title: 'Run a 10k', target: 'complete a 10k race', measure: 'official race finish time', horizon: '2026-09-30' },
    ...over,
  };
}

/** Drop a key from a record (to build the missing-field variants). */
export function without(rec: BrainRecord, key: string): BrainRecord {
  const copy = structuredClone(rec);
  delete (copy as Record<string, unknown>)[key];
  return copy;
}

/** Drop a nested attributes key. */
export function withoutAttr(rec: BrainRecord, key: string): BrainRecord {
  const copy = structuredClone(rec);
  if (copy.attributes) delete (copy.attributes as Record<string, unknown>)[key];
  return copy;
}
