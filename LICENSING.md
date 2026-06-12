# Licensing

This repository uses a two-licence split, common for open standards:

| What | Licence | File |
|---|---|---|
| Specification texts — everything under `v2/` (BP-00…BP-09, COUNCIL-BRIEFS, INDEX) and future spec prose | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | [`LICENSE-SPEC`](LICENSE-SPEC) |
| Schemas (`schemas/`), examples (`examples/`), and any future reference code or conformance kit | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | [`LICENSE`](LICENSE) |

**Why the split.** CC-BY-4.0 lets anyone reproduce, translate, and quote the
specification with attribution — the right terms for a document people read and
cite. Apache-2.0 is the right terms for artefacts people embed in products: it
permits commercial use and modification and carries an explicit patent grant,
so implementers can ship the schemas and reference code without legal review
friction.

**What this means in practice.** You may implement the Brain Protocol in any
product, open or closed, without permission or payment. If you republish the
spec texts (in docs, a book, a translation), attribute the Brain Protocol
project. Conformance *claims* are governed by BP-09 §3.3, not by these
licences: only "Brain Protocol v2 Class {D|A|H} {self-certified | certified},
suite {version}", backed by a live registry entry.

Archived v0.1 material under `archive/` is historical and not separately
licensed for reuse; treat the v2 suite as the public artefact.
