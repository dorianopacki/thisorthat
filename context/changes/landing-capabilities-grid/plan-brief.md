# Landing ThisOrThat w układzie bento — Plan Brief

> Full plan: `context/changes/landing-capabilities-grid/plan.md`
> Research: `context/changes/landing-capabilities-grid/research.md`

## What & Why

Strona główna `/` to wciąż angielski szablon „10x Astro Starter”, więc nowy użytkownik nie dowiaduje się, czym jest ThisOrThat. Zastępujemy ją polskim landingiem w układzie bento-grid, który opowiada o pełnej pętli produktu dowiezionej w M-1: badanie → jednorazowe linki → głosowanie bez konta → wyniki na żywo → zamknięcie.

## Starting Point

`src/pages/index.astro` renderuje `Welcome.astro` (szablon startowy). `Layout` ma `lang="en"` i tytuł „10x Astro Starter”, a anonimowy `Topbar` jest po angielsku. Logowanie przekierowuje na `/`, więc zalogowany autor też trafia na stronę główną. Styl aplikacji (`bg-cosmic`, szklane panele, fioletowe CTA) jest ustalony na `/dashboard`.

## Desired End State

Każdy pod `/` widzi polską stronę ThisOrThat: hero z obietnicą, 7 kafelków bento (duży „Wyniki na żywo” ze statyczną makietą rankingu i „X z N”) oraz CTA zależne od sesji. Anonim dostaje rejestrację i logowanie, zalogowany dostaje „Twoje badania” i „Nowe badanie”. Wszystkie strony mają `lang="pl"`, a pasek anonima jest po polsku. Kod szablonu startowego jest usunięty.

## Key Decisions Made

| Decision          | Choice                                                                               | Why (1 sentence)                                                                    | Source          |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------- |
| Język i zakres    | Polski landing + `lang="pl"`, domyślny tytuł „ThisOrThat”, polski anonimowy `Topbar` | `Topbar` jest na landingu, więc angielskie „Sign in” kłóciłoby się z polską treścią | Plan            |
| Zalogowany na `/` | Ten sam landing, inne CTA (`/dashboard`, `/studies/new`)                             | Zero zmian w auth i testach smoke/HTTP, które oczekują signin → `/`                 | Research + Plan |
| Treść             | Wszystkie 7 grup możliwości (FR-001…FR-019, NFR)                                     | Pełna opowieść o pętli, a 1 duży + 6 małych domyka grid 3-kolumnowy                 | Plan            |
| Wizualia          | Ikony lucide + statyczna makieta wyników w dużym kafelku                             | Bento „mówi” obrazem bez nowych zasobów i JS                                        | Plan            |
| Technologia       | Czyste Astro + Tailwind, lokalne komponenty `landing/`, bez shadcn Card              | Tokeny shadcn nie pasują do kosmicznego stylu, a strona nie potrzebuje interakcji   | Research        |
| Sprzątanie        | Usunąć `Welcome.astro` i `LibBadge.astro`, zostawić `template.png`                   | Martwy kod, a obrazek jest używany w README                                         | Research + Plan |

## Scope

**In scope:**

- `Layout.astro`: `lang="pl"`, domyślny tytuł, opcjonalny `description`
- Anonimowa gałąź `Topbar.astro` po polsku
- `src/components/landing/` (`FeatureTile`, `ResultsMockup`, `Hero`) i nowy `index.astro`
- Usunięcie `Welcome.astro` i `LibBadge.astro`

**Out of scope:**

- Zmiana przekierowania po logowaniu i middleware
- Polonizacja stron auth i formularzy
- shadcn Card, nowe zależności, tokeny `global.css`, tryb dark
- Tagi OG, obrazy, animacje, nowe testy e2e i visual diff

## Architecture / Approach

SSR w Astro bez hydratacji. `index.astro` składa ramę (`bg-cosmic` + `Topbar`), `Hero` (CTA z `Astro.locals.user`) i sekcję z gridem `grid-cols-1 md:grid-cols-3`. Duży kafelek ma `md:col-span-2 md:row-span-2`. Kafelki to jeden komponent `FeatureTile` z ikoną lucide (SSR jako inline SVG) i slotem na `ResultsMockup`.

## Phases at a Glance

| Phase                              | What it delivers                                                           | Key risk                                                          |
| ---------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Polonizacja współdzielonej ramy | `lang="pl"`, tytuł ThisOrThat, meta description, polski anonimowy `Topbar` | Zmiana dotyka wszystkich stron (tylko teksty, brak testów na nie) |
| 2. Landing bento-grid              | Hero + 7 kafelków + makieta, CTA zależne od sesji, usunięty szablon        | Copy obiecujące coś spoza PRD; grid z dziurami na desktopie       |

**Prerequisites:** nowa gałąź od `main` (bieżąca `chore/drop-text-variant-wrappers` jest zarchiwizowana). Do testów HTTP i smoke potrzebny lokalny Supabase (Docker).
**Estimated effort:** ~1 sesja, 2 małe fazy.

## Open Risks & Assumptions

- Zakładamy, że limity z roadmapy (2–6 wariantów, N 1–100) odpowiadają walidacji w kodzie. Implementer powinien je potwierdzić przed wpisaniem do copy.
- Makieta wyników może z czasem rozjechać się z prawdziwym ekranem wyników, bo jest statyczna i świadomie poza testami.

## Success Criteria (Summary)

- Nowy odwiedzający w 10 sekund rozumie, czym jest ThisOrThat, i ma jeden oczywisty krok: „Załóż konto”.
- Zalogowany autor po wejściu na `/` jednym kliknięciem wraca do swoich badań.
- Wszystkie istniejące bramki (lint, build, unit, http, smoke) przechodzą bez zmian w testach.
