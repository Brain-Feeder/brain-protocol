# Contributing to the Brain Protocol

Thank you for caring about how families' data moves. This document is the
practical version of the governance rules in
[BP-09 §5](v2/BP-09-CONFORMANCE-GOVERNANCE.md).

## The rule of the repository

**Proposal: anyone. Ratification: the council.**

Anyone may propose new kinds, subtypes, edge predicates, capabilities, states,
`needs_human` reasons, ciphersuites, or optional envelope fields. The
maintainer council (the editor plus the council seats named in BP-00)
ratifies. No spec text overrides a council decision (CD-1…CD-10) without
returning to the council.

## The RFC process

1. **Open an RFC issue first** (use the *RFC proposal* template). Sketch the
   change, why existing vocabulary or mapping tables can't express it, and the
   borrow check: does Schema.org, iCalendar, or ActivityStreams already name
   this? We never coin a synonym for a thing the web already names (BP-01 §13).
2. **Submit a pull request** containing, together:
   - the spec text change (and/or `schemas/` change);
   - the vocabulary entry with the borrow check documented;
   - TCK test additions covering the new behaviour;
   - a `CHANGELOG.md` entry under *Unreleased*.
3. **The pipeline is mechanical:** PR → TCK green → editor approval → version
   bump → CHANGELOG. Brainfeeder is the canary — every change lands in the
   reference node first; if it fails the reference conformance run, it does
   not ship.
4. Releases follow semver as one suite train (`2.MINOR.PATCH`). Additive =
   MINOR. Clarifications and errata = PATCH. Deprecations are announced at
   least one MINOR ahead and flagged by the TCK as warnings before they
   become failures.

## The frozen-primitives rule

The four primitives — **Entity, Activity, Edge, Action** — are frozen. A
**MAJOR** version is required for: a fifth primitive; removal or renaming of
any envelope MUST field; any change that makes a previously conformant emitter
non-conformant. Do not open a PR for any of these without an RFC issue and a
council discussion first; "it would be convenient" is not an argument that has
ever survived contact with the council. If a concept does not fit the four
primitives, it is almost certainly a new *subtype* of one of them (BP-01 §3.3).

## Issue etiquette

- **One issue, one concern.** A vocabulary proposal and a spec bug are two
  issues.
- **Spec bugs** (use the *Spec bug* template): cite the spec, section, and the
  exact sentence; say whether it's a contradiction, an ambiguity, or an error;
  propose wording if you can. Contradictions *between* specs are
  highest-priority — the suite must never disagree with itself silently.
- **Implementation questions** are welcome as issues, but check the relevant
  spec's *Settled questions* section first — many "why" questions are answered
  there with the reasoning.
- Security-sensitive findings (a way to defeat the visibility law, the forget
  audit, the gates, or the S2/S3 walls): do not open a public issue; contact
  the editor privately first.

## What gets declined

- New base vocabulary that a mapping table (BP-01 §11) already handles.
- Speculative fields and "might need later" structures — the suite is built
  YAGNI.
- Anything that lowers a floor: the BP-08 authority floors, the children's
  wall, S3 never-on-wire, propose-only writes, and default-deny grants are not
  open to weakening PRs at any version.

## Conduct

All participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
