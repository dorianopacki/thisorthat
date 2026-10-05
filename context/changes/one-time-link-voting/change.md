---
change_id: one-time-link-voting
title: Participant votes through a one-time link with optional comments
status: implemented
created: 2026-10-05
updated: 2026-10-05
archived_at: null
---

## Notes

S-02 from context/foundation/roadmap.md (issue #7).

Decided in planning (2026-10-05):
- Reopening a used link: the ballot read never reveals `used`; a link-scoped cookie shows „Twój głos został już oddany” in the same browser, other devices learn it on submit.
- Comments: collapsed per variant („Dodaj komentarz”) — resolves the roadmap S-02 mobile unknown.
- Variant order: shuffled per link, deterministic from the token.
- Submit: select then send, no extra confirmation.
