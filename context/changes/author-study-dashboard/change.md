---
change_id: author-study-dashboard
title: Lista badań autora ze statusem i postępem „X z N”
status: impl_reviewed
created: 2026-10-15
updated: 2026-10-15
archived_at: null
---

## Notes

Roadmap: `S-05` (`context/foundation/roadmap.md`), issue #10. Prerequisite S-02 — done.

PRD refs: FR-002, FR-001 (konto jest już w baseline; plasterek zastępuje zaślepkę `src/pages/dashboard.astro` docelową listą).

Outcome: po zalogowaniu autor widzi prostą listę wyłącznie swoich badań ze statusem (szkic / trwa / zamknięte) i postępem „X z N”, z której wchodzi w konkretne badanie.

Ryzyko: to pierwsze miejsce, w którym użytkownik widzi izolację między autorami. Lista musi opierać się na politykach RLS z `F-01`, nie na filtrowaniu w aplikacji. Plasterek jest celowo płytki: PRD ograniczył dashboard do listy (runda Socrates przy FR-002).

Kontekst z S-04: dashboard czyta już status z computed field `effective_status`. Brakuje postępu „X z N” — wymaga licznika odpowiedzi per badanie (`context/archive/2026-10-06-testing-access-boundaries/research.md:139`: potrzebna ta sama macierz izolacji).
