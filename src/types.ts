// TypeScript types inferred from the schemas — one source of truth, no drift between the
// validators and the types a system codes against.
import { z } from 'zod';
import {
  Entity, Activity, Edge, Action, NodeRef, Capability, AgentCard, MigrationDescriptor, Visibility,
} from './schema.js';

export type Entity = z.infer<typeof Entity>;
export type Activity = z.infer<typeof Activity>;
export type Edge = z.infer<typeof Edge>;
export type Action = z.infer<typeof Action>;
export type NodeRef = z.infer<typeof NodeRef>;
export type Capability = z.infer<typeof Capability>;
export type AgentCard = z.infer<typeof AgentCard>;
export type MigrationDescriptor = z.infer<typeof MigrationDescriptor>;
export type Visibility = z.infer<typeof Visibility>;
export type Verb = 'read' | 'query' | 'subscribe' | 'act';
