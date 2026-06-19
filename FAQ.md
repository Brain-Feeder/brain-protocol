# Brain Protocol and Brainfeeder - Frequently Asked Questions

A plain-language companion to the specifications. For exact requirements, the BP-00..BP-10 documents govern. Last updated 2026-06-14.

## The basics

**What is the Brain Protocol?**
An open standard that lets any app safely feed a "brain" - an AI that reasons across your life. An app joins by exposing a signed *card* (a menu of what it is willing to share) and answering read requests; it does not need an AI of its own. The standard is open: anyone can build a provider, a private brain, or a competing hub.

**What is Brainfeeder?**
The flagship hub on the protocol - a household assistant that pulls your connected apps into one picture, reasons over a governed subset, and proposes actions. Brainfeeder is the strongest node on the network, never a required one. The protocol works without it.

**Why open, instead of a walled product?**
Because trust comes from not being a trap. We do not lock your apps in or claim to own your data. The strategy in a line: build the open standard, operate the most valuable hub on it. Defensibility comes from the quality of the brain and the network of connected systems, not from lock-in.

## Your data and your safety

**Does the AI read everything I connect?**
No. The architecture separates two things that are usually conflated: *custody* (holding data) and *cognition* (thinking about it). Custody is total and zero-knowledge - the system can hold data the AI never reads, with the most sensitive material in a vault only you can unlock. Cognition is a minimal, projected subset: the assistant is shown the affordance, not the body. It can know you are busy at 2pm without reading who you are meeting or why.

**What does "projection" mean in practice?**
A connected system shares the *impact* of something, not its contents. Your podcast calendar can tell the household "Peter is busy 2-3pm" as a generic busy-block, while you alone see the full entry with the guest and location. The household sees what affects them; the detail stays with you.

**Who in my household sees what?**
Visibility runs on a ladder - private, shared with partners, shared with adults, shared with the household, public - and every read is filtered through the asking person's lens. A child's view never returns an adult-only row. You choose the audience for each connection when you connect it, and the hub clamps every read to that choice, so a "just me" setting cannot leak a shared projection even if a provider sends one.

**What happens when I disconnect an app?**
It is forgotten. Connected reads are live-only - nothing read from a provider is stored - so disconnecting deletes the grant and its keys, and the system audits to zero stored records. Disconnection is a real delete, not a flag.

**Can the assistant do things on its own - pay, book, send?**
No. Every irreversible action requires your explicit yes. The assistant can only *propose*; a human confirms. This is a hard line built into the system, and it is exactly why you can trust it with the numbers.

**What about my most sensitive secrets?**
The most secret class of data never crosses the wire automatically, at all. Sensitivity ceilings are no-downgrade: a capability serves at or below its ceiling and cannot be tricked into downgrading a record to leak it.

**Could a malicious app trick the AI into leaking my data?**
The defence is structural, not a guessing game. Even a fully-fooled model hits a wall: there is nothing to exfiltrate (cognition is minimal), nowhere to send it (the model has no egress), and it cannot act alone (the human gate). Connected data enters the model fenced as untrusted data, never as instructions. The federation surface is additionally guarded against server-side request forgery and rate-limited.

## Children, health, money

**How is children's data handled?**
The household is the unit, but the children's wall is enforced in the database: a child's lens never sees adult-only data, and money amounts are never shown to a child. Health detail for a child is kept to habit-language summaries.

**Does it give medical or financial advice?**
No. It organises - appointments, reminders, bills, to-dos - but it does not diagnose, prescribe, set targets, recommend investments, or move money. Those are hard rails, both for your safety and to stay on the right side of regulation. It will point you to a professional where that is the right call.

## Building on the protocol

**How do I make my app a provider?**
Expose a signed card at a well-known URL declaring the capabilities you offer, each with a direction, a mode, and a sensitivity ceiling, and answer read requests over the agent-to-agent endpoint. The reference provider and the ADAPTER guide in the kit walk you through it; you can build a provider without writing any AI.

**How do I know my card is correct before anyone connects?**
Run the card checker against your own endpoint (`node scripts/bp-card-check.mjs <your-card-url>`); it verifies exactly what a consumer will see - that your URL is safe and public, your signature verifies, your version is supported, and your offered capabilities parse.

**What is the conformance kit (TCK), and do I have to pass it?**
The TCK is how you earn trust: a system claims Brain-Protocol support only by passing the kit from a clean clone, certified as a "true stranger." The hub validates objects at its boundary regardless of what a card claims, but passing the TCK is the documented proof that you meet the safety and oversight bar. Run it with `run-conformance.sh`; the kit's README is the walkthrough.

**What gets exchanged when two systems connect?**
A handshake: the consumer verifies your card and pins your fingerprint, you both exchange keys, you issue a scoped grant (a per-capability consent with an audience ceiling), and it is counter-signed. From then the consumer reads within that grant; you never have to trust the consumer, because the grant and the sensitivity ceiling bound the read regardless.

## Governance and law

**Is this compliant with the EU AI Act and GDPR?**
Brainfeeder treats itself as a limited-risk AI system under the EU AI Act, meeting the transparency duty (you always know you are dealing with a named, artificial assistant), with human oversight, data minimisation, and record-keeping enforced in code. A Data Protection Impact Assessment governs the personal-data processing, and the conformance kit serves as a governance control. The classification has named tripwires - touching diagnosis, credit decisions, or child-welfare determinations - that force a reassessment before any such feature ships.

**Who is responsible for what across a connection?**
The split is explicit: a provider is responsible for what it shares, its own lawful basis, and its card's honesty; a hub is responsible for the reasoning it performs and the oversight gate on actions. This is written into the onboarding terms for every connection.

**Where do I report a problem or a security issue?**
See the security policy in the kit. Security issues should be reported privately first, never as a public issue.
