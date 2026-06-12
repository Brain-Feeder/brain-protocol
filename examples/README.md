# Examples

Worked JSON pulled directly from the v2 specifications. Each file is valid
standalone JSON; truncated key material and hashes from the spec text are
expanded to full-length placeholders.

| File | One line | Source |
|---|---|---|
| [`vehicle-and-mot.json`](vehicle-and-mot.json) | A person, their car, the derived MOT-deadline activity (the dated-requirement rule), and the linking edge | BP-01 §15 |
| [`goal-both-forms.json`](goal-both-forms.json) | The same goal emitted as an entity and as an activity — receivers must accept both framings (CD-9) | BP-01 §15 |
| [`clinic-grant-pair.json`](clinic-grant-pair.json) | The two grants of a clinic↔hub connection: propose-only bookings, S1 reads, an S2 summary under elevated consent | BP-03 §9 |
| [`dual-gate-action.json`](dual-gate-action.json) | A dual-gated booking end to end: guardian gate + clinic gate, `needs_human` park, execution only when all gates confirm | BP-08 §4.2 |
| [`forget-receipt.json`](forget-receipt.json) | The receipt a user sees after forget-on-disconnect: per-type counts, the key-destruction line, audit to zero | BP-02 §5.4 |
