// @brainfeed/protocol — the Brain Protocol v0.1 reference package.
// Depend on this; do not re-implement the shapes (BRAIN_PROTOCOL.md §9.1).
export * from './schema.js';
export * from './validate.js';
export type {
  Entity, Activity, Edge, Action, NodeRef, Capability, AgentCard, MigrationDescriptor, Visibility, Verb,
} from './types.js';
