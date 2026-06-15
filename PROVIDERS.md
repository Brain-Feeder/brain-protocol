# Become a Brain Protocol provider - start here

This is the sequenced path from nothing to a connectable, conformant provider. Each step links the
document or tool that owns the detail; follow them in order. You do not need an AI of your own - a
provider is a responder, not an agent.

## What you are building

A provider exposes a signed **card** (a menu of capabilities you are willing to share) and answers
read requests over an **agent-to-agent (a2a)** endpoint. A consumer (a private brain, or a hub like
Brainfeeder) verifies your card, runs a consent handshake to get a scoped **grant**, and then reads
within that grant. You never have to trust the consumer: the grant and each capability's
**sensitivity ceiling** bound what can ever cross, regardless of who is asking.

Two ideas to hold from the start, because they shape every capability you design:

- **Sensitivity ceiling** - the most secret class a capability may ever serve. It is a worst-case
  promise you set, not a classifier. The most secret class never crosses on an automatic path.
- **Projection over content** - share the *impact*, not the body. A calendar can share "busy
  2-3pm" as a generic block without sharing the meeting's contents. Design capabilities to emit the
  affordance, and keep the detail home. Pair this with the audience model: declare what may be
  shared and at what tier; the user picks the audience at connect.

## The path

1. **Read the overview and the data model.** `v2/BP-00-OVERVIEW.md` for the shape of the standard,
   then `v2/BP-01-DATA-MODEL.md` for the four primitives (entity, activity, edge, action) you map
   your data into, and `v2/BP-02-AGENT-READY-SYSTEMS.md` for the provider role and the visibility
   law. If you read nothing else normative, read these three.

2. **Copy the reference provider.** `reference-provider/` is a small, runnable provider: it
   publishes a signed card, accepts the connect handshake (BP-03 §6.4), issues a dual-signed grant,
   and serves a capability under a bearer token plus a per-call proof of possession. Copy the
   folder and swap in your data. Its `README.md` is the hands-on walkthrough. `reference-provider/`
   is the wire surface; for the data-layer laws (the eleven T-DAT tests - visibility, vault, journal,
   forget, bounds) study `reference/`, whose `BUILD-ORDER.md` traces each law to the exact code. Copy
   `reference-provider/` for the responder and `reference/` for the data layer.

3. **Shape your card.** Declare each capability with a direction, a mode (`read`, later `propose`),
   and a sensitivity ceiling, against the schema in `schemas/agent-card.schema.json`. Decide your
   projections here: what does each capability emit, and at what shareable tier. Where a capability
   can be shared at more than one tier, declare its `audiences` (the ascending tiers, e.g. `private`,
   `shared:household`) so the consumer can offer a per-capability audience picker; omit it and the
   consumer falls back to a single default (BP-03 §2.2). For a scheduled event, set `attributes.tz`
   to the event's IANA timezone so a consumer renders a stable local clock time across DST (BP-01
   §6). Honesty in the card is a provider obligation - it is what every consumer relies on.

4. **Check your card before anyone connects.** Run the protocol-native checker from this repo:
   `node kit/scripts/card-check.mjs <your-card-url>`. It works against `http://localhost:<port>`
   while you build and against your public URL once deployed, and verifies exactly what a consumer
   will see: a safe public HTTPS endpoint, a card signature that verifies against an identity key,
   the pinned fingerprint, a body that matches `schemas/agent-card.schema.json`, a supported protocol
   version, and at least one offered capability. A hosted sandbox a hub operates does the same over
   the web if you prefer not to run anything locally. Green means a consumer can reach you, and you
   never have to clone a consumer's code.

5. **Meet the security bar.** `v2/BP-07-SECURITY-PRIVACY.md` is the normative security and privacy
   specification; `reference/SECURITY-REVIEW.md` is the appsec review a partner's security team
   would otherwise run, written against the reference as a template. At minimum: sign every card and
   response, validate every inbound object at your boundary, never put secrets in a card, scope and
   expire tokens, and honour forget-on-disconnect.

6. **Pass the conformance kit (TCK).** Trust on the network is demonstrated, not asserted. Run the
   Class D kit from a clean clone (`run-conformance.sh`; `kit/README.md` is the walkthrough,
   `kit/ADAPTER.md` is the adapter contract you implement). It seeds, attacks, and asserts, then
   emits a machine-readable results file you publish for self-certification. A clean 46/46 from a
   "true stranger" clone is the precondition for connecting - it is the documented proof you meet
   the safety and oversight bar.

7. **Connect.** With a green card and a green kit run, complete the handshake. The consumer (a hub)
   runs the consumer side and initiates; your provider is the grantor and responds to
   `connect.request`/`connect.confirm`, exactly as `reference-provider/server.mjs` shows. The
   consumer verifies and pins your card out of band (BP-03 §2.3.3), then initiates; you exchange keys
   and issue the scoped grant, it is counter-signed, and reads begin within the grant. Before going
   live, smoke-test your responder against the reference consumer (`reference-provider/connect-client.mjs`),
   and against a real hub's staging endpoint if it offers one (`reference-provider/connect-to-brainfeeder.mjs`
   is a worked client to adapt).

## Your responsibilities, stated plainly

As a provider you are responsible for what you share, your own lawful basis for sharing it, and the
honesty of your card. The consumer is responsible for the reasoning it performs and the human gate
on any action. This split is the governance contract of every connection; per-connection
controller/processor terms make it explicit.

## Where to get help

- Conceptual questions: `FAQ.md`.
- The normative specifications: `v2/INDEX.md` lists BP-00 through BP-10.
- Security issues: report privately per the security policy, never as a public issue.
