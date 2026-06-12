---
name: RFC proposal
about: Propose a new subtype, predicate, capability, state, needs_human reason, ciphersuite, or optional field
title: "RFC: "
labels: rfc
---

## What is proposed

<!-- One paragraph. Name the exact term/field and which spec(s) it touches. -->

## Why a mapping table can't express it

<!-- Mapping tables (BP-01 §11) are the only extension valve short of new base
vocabulary. Explain why this must be base vocabulary. -->

## The borrow check (required)

<!-- Does Schema.org, iCalendar, or ActivityStreams already name this concept?
If yes, the proposal must use that name (BP-01 §13). State what you checked. -->

## Compatibility

- [ ] Additive (MINOR) — no previously conformant emitter becomes non-conformant
- [ ] Touches a frozen primitive or a MUST envelope field (MAJOR — discuss before PR)
- [ ] Does NOT lower any floor (BP-08 floors, children's wall, S3 wall, propose-only, default-deny)

## TCK impact

<!-- Which new or changed tests would prove this behaviour? -->
