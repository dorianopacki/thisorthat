---
change_id: create-and-start-study
title: Author creates a text study, sets N, starts it and copies N one-time links
status: impl_reviewed
created: 2026-10-05
updated: 2026-10-05
archived_at: null
---

## Notes

S-01 from context/foundation/roadmap.md

Decided limits (2026-10-05, see roadmap S-01 Unknowns):
- Variants per study: 2–6 (enforced at "Rozpocznij"; wizard validates too).
- N (`participant_target`): 1–100; the cap covers total links, so S-07 must respect it.
- Current schema only has `participant_target > 0` and no variant-count limit — S-01 adds the bounds.
