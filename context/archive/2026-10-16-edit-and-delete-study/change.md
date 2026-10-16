---
change_id: edit-and-delete-study
title: Edycja szkicu badania i usuwanie badania
status: archived
created: 2026-10-16
updated: 2026-10-16
archived_at: 2026-10-16T17:57:02Z
---

## Notes

Roadmap: `S-06` (`context/foundation/roadmap.md`), issue #11. Prerequisite S-05 — done (PR #32).

PRD refs: FR-017 (edycja przed rozpoczęciem), FR-018 (usunięcie badania), FR-010 (uczestnik z linkiem do usuniętego badania widzi „Badanie jest zakończone”).

Outcome: autor może edytować badanie, dopóki jest szkicem, oraz usunąć badanie na dowolnym etapie.

Ryzyko z roadmapy:

- Usunięcie trwającego badania psuje linki, które uczestnicy już dostali. PRD to akceptuje i domyka komunikatem z FR-010.
- Edycja musi być twardo zablokowana poza stanem szkicu, inaczej autor zmieniłby warianty pod oddanymi głosami.

Kontekst z wcześniejszych slice'ów (do weryfikacji w research/plan):

- RLS już pozwala na update `title`/`participant_target` i insert/update/delete wariantów tylko w `draft`. Delete na `studies` własnych działa kaskadowo (`contract-surfaces.md#tables`).
- `get_ballot` zwraca `null` i `cast_vote` zwraca `study_ended` dla usuniętego badania. Kolejność blokad study → link obowiązuje też kaskadę usuwania.
- Usunięcie i edycja to nowe akcje autora sprawdzające właściciela, więc potrzebna jest ta sama macierz izolacji (`context/archive/2026-10-06-testing-access-boundaries/research.md:139`).
- Dashboard z S-05 (`list_author_studies`) to naturalne miejsce na wejście w edycję lub usunięcie.
- Termin zamknięcia ustawiany jest tylko przy tworzeniu (brak grantu update na `closes_at`/`closes_tz` od S-04). Do rozstrzygnięcia: czy edycja szkicu obejmuje termin.
