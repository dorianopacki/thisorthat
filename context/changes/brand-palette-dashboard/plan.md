# Paleta marki, nowy Topbar i dashboard na tokenach — plan implementacji

## Overview

Porządkujemy kontrakt design-systemu. Ciemny motyw staje się jedynym zestawem tokenów w `:root`, a paleta marki #A853CA / #CA53B0 / #CA5375 trafia do ról (`primary`, `accent`, `brand-3`) w wartościach skorygowanych pod WCAG AA. Tło wszystkich stron dostaje ciemny fiolet marki. Nowy `Topbar` i widok `/dashboard` czytają wyłącznie tokeny i komponenty z `src/components/ui/`. Kończymy macierzą 7 stanów, zrzutami ekranu i zabezpieczeniem (test i reguła), które utrzyma kolejnych agentów przy tokenach. Zarzuty C1–C5 pochodzą z `research.md` § Charges.

## Current State Analysis

- `src/styles/global.css:6-39` — `:root` ma jasny motyw shadcn; `:41-73` — blok `.dark` nigdy nie jest aktywny; `:113-115` — `bg-cosmic` z hexami granatu; `:117-124` — warstwa bazowa (`outline-ring/50`, `bg-background text-foreground`).
- W całym `src/` tokenów używa tylko `src/components/ui/button.tsx:7-36`, który eksportuje `Button` i `buttonVariants` (cva). `SubmitButton.tsx:29` nadpisuje wariant `default` przez `bg-purple-600`.
- `src/pages/dashboard.astro:20-61` i `src/components/Topbar.astro:5-31` zawierają wyłącznie literały palety Tailwinda (15 trafień skanu łącznie). Nie ma `focus-visible`, a tekst pustego stanu ma kontrast 4,03:1.
- `Topbar` jest renderowany na `dashboard.astro:21` i `index.astro:18`.
- Statusy (`src/lib/study-status.ts:10-14`) są zwykłym tekstem bez rozróżnienia.

## Desired End State

- `global.css` ma jeden ciemny zestaw wartości w `:root` (z `color-scheme: dark`), role z paletą marki, tokeny tła `--background` i `--background-2` oraz tokeny `--brand-1`, `--brand-2`, `--brand-3` i `--link`, wszystkie opublikowane przez `@theme inline`. Bloku `.dark` nie ma. `bg-cosmic` buduje gradient z tokenów.
- Wszystkie 9 stron z `bg-cosmic` ma ciemnofioletowe tło. Przyciski `SubmitButton` (formularze auth, kreator, głosowanie, akcje badania) mają kolor `primary`.
- `Topbar` pokazuje markę „ThisOrThat”, nawigację z `aria-current` i konto. Zawija się na ~375 px i zawiera zero literałów palety.
- `/dashboard` ma zero literałów palety i odznaki statusów z tokenów. Wszystkie stany z macierzy są pokazane albo oznaczone jako N/A z powodem.
- Zrzuty ekranu (desktop i Pixel 7) leżą w folderze change'a. Test jednostkowy blokuje powrót literałów w oczyszczonych plikach, a `AGENTS.md` ma blok UI.

Weryfikacja: `npm run lint`, `npx astro check`, `npm run build`, `npm run test:unit`, testy HTTP i smoke na preview, e2e `seed`, skan literałów (0 trafień w oczyszczonych plikach) oraz przegląd zrzutów.

### Key Discoveries:

- `button.tsx:7-36` eksportuje `buttonVariants`. Linki w `.astro` mogą dostać klasy przycisku przez `buttonVariants({ variant, size })` bez wyspy React. Ten sam wzorzec obsłuży `badgeVariants` z shadcn `badge`.
- Testy, które muszą przejść bez zmian:
  - `tests/e2e/auth.setup.ts:27` i `tests/e2e/seed.spec.ts:12` — h1 „Twoje badania” (level 1);
  - `seed.spec.ts:13` — e-mail widoczny jako osobny element (`exact: true`);
  - `tests/http/author-isolation.test.ts:147-169` — ciągły tekst „Planowana liczba uczestników: N” i brak „Odpowiedziało” dla szkicu;
  - `tests/http/edit-and-delete-study.test.ts:191-196` — „Badanie zostało usunięte.”.
- Kontrast policzono w sesji planowania wzorem WCAG 2.x na tłach `#120B1D` i `#1A1028` oraz na panelu `white/8`. Kolory marki jako tekst na ciemnym tle mają 3,3–4,6:1, więc linki używają osobnego tokenu `--link`.
- `test-plan.md:171` wyklucza snapshoty wyglądu w CI, więc bramka wizualna to zrzuty w folderze change'a.

## What We're NOT Doing

- Nie przepinamy na tokeny innych widoków (landing `landing/*`, `auth/*`, `studies/*`, `v/[token]`). Zmienią się w nich tylko te elementy, które już korzystają z tokenów lub z `bg-cosmic` i `SubmitButton`. Pozostałe literały trafią do kolejnych change'y, po jednym widoku na change.
- Nie dodajemy `Topbar` do stron `studies/*` (decyzja z wywiadu).
- Nie dodajemy jasnego motywu ani przełącznika motywów. Usuwamy blok `.dark`. Warianty `dark:` w `button.tsx` zostają jak są (nieaktywne).
- Nie ruszamy `Banner.astro` (hexy info/warning/error). Zarzut jest odłożony: osobny komponent z innymi rolami.
- Nie dodajemy `toHaveScreenshot` ani strony kitchen-sink (decyzja z wywiadu, `test-plan.md:171`).
- Nie zmieniamy tekstów, tras, danych, ładowania (`list_author_studies`) ani logiki statusów i postępu.
- Nie logujemy błędu zapytania dashboardu. To temat observability, nie UI.

## Implementation Approach

Kolejność według `/10x-ui`: najpierw środowisko i tokeny, potem komponent, potem jeden widok, na końcu stany. Wartości lądują najpierw w `global.css` i w `palette.md` w folderze change'a, żeby kolejna sesja ich nie wymyślała. Widoki odwołują się wyłącznie do ról. Przyciski i odznaki to warianty cva z `src/components/ui/`, używane w Astro przez funkcje wariantów, a w React przez komponenty.

## Critical Implementation Details

- **Tokeny i kontrast** (wartości docelowe; implementer może zapisać je w oklch, o ile kontrast się nie pogorszy):

  | Token                                 | Wartość                                         | Uzasadnienie                                                                      |
  | ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
  | `--background` / `--background-2`     | `#120B1D` / `#1A1028`                           | ciemny fiolet marki, gradient `bg-cosmic`: background → background-2 → background |
  | `--foreground`                        | `#F5F0FA`                                       | 13,3:1 na panelu                                                                  |
  | `--card` / `--card-foreground`        | `oklch(1 0 0 / 8%)` / `--foreground`            | panel szklany jak dziś                                                            |
  | `--muted`                             | `oklch(1 0 0 / 5%)`                             | wiersze, tła pomocnicze                                                           |
  | `--muted-foreground`                  | `#B8ADC9`                                       | 7,0:1 na panelu, 6,0:1 na wierszu                                                 |
  | `--primary` / `--primary-foreground`  | `#A74FC9` (`#A853CA` −0,5% L) / `#FFFFFF`       | biały na primary 4,56:1                                                           |
  | `--accent` / `--accent-foreground`    | `#C440A8` (`#CA53B0` przyciemniony) / `#FFFFFF` | biały na accent 4,52:1                                                            |
  | `--brand-1`, `--brand-2`, `--brand-3` | `#A853CA`, `#CA53B0`, `#CA5375` (oryginały)     | tylko do gradientów i dekoracji, nie pod tekst                                    |
  | `--link`                              | `#D3A6E4`                                       | linki na ciemnym tle, 7,3:1 na panelu                                             |
  | `--ring`                              | `#C58CDC`                                       | ≥3:1 na każdym tle (5,0–7,5)                                                      |
  | `--destructive`                       | `#F87171`                                       | tekst błędu na ciemnym tle, 5,4:1 na panelu; wyraźnie inny niż `brand-3`          |
  | `--border` / `--input`                | `oklch(1 0 0 / 15%)` / `oklch(1 0 0 / 20%)`     | jak dziś `white/10–20`                                                            |

  Hover `primary` w `buttonVariants` to `bg-primary/90`. Na ciemnym tle przyciemnia, a nie rozjaśnia, co jest akceptowalne i zgodne z shadcn.

- **Tekst postępu musi zostać ciągły.** Etykietę statusu można przenieść do odznaki, ale `progressLabel(study)` renderujemy jako jeden ciągły tekst (`author-isolation.test.ts:147-169` sprawdza go w surowym HTML).
- **E-mail w `Topbar`** zostaje osobnym elementem z `truncate`, nigdy `hidden`/`sr-only` (`seed.spec.ts:13`).

## Faza 1: Tokeny i baza

### Overview

Jeden ciemny zestaw tokenów z paletą marki, tło z tokenów, shadcn `badge` i `SubmitButton` bez nadpisań. Rozwiązuje C1 i część C3.

### Changes Required:

#### 1. Tokeny

**File**: `src/styles/global.css`

**Intent**: Zastąpić jasny `:root` ciemnymi wartościami z tabeli w Critical Implementation Details, usunąć martwy blok `.dark`, dodać tokeny tła, marki i linku oraz opublikować je przez `@theme inline`. `bg-cosmic` ma budować gradient z tokenów zamiast z hexów. Nad blokiem komentarz z pochodzeniem wartości (paleta użytkownika z 2026-10-20 i link do `palette.md`).

**Contract**: `:root` zawiera wszystkie dotychczasowe role shadcn (z nowymi wartościami) oraz `--background-2`, `--brand-1..3`, `--link` i `color-scheme: dark`. `@theme inline` publikuje `--color-background-2`, `--color-brand-1..3` i `--color-link`, więc istnieją klasy `bg-background-2`, `from-brand-1`, `text-link` itd. Bloku `.dark` brak. `@utility bg-cosmic` odwołuje się do `var(--background)` i `var(--background-2)`. Tokeny `chart-*` i `sidebar-*` mogą zostać, z wartościami neutralnymi dla ciemnego motywu.

#### 2. Odznaka

**File**: `src/components/ui/badge.tsx` (nowy, przez `npx shadcn@latest add badge`)

**Intent**: Wspólny komponent odznaki dla statusów, dodany ścieżką shadcn zamiast ręcznego `span`. Jeśli CLI nie zadziała (sieć), skopiować oficjalny `badge` new-york ręcznie i zapisać to w commicie.

**Contract**: Eksport `Badge` i `badgeVariants` (cva) z wariantami `default` (primary), `secondary`, `outline`, `destructive`. Klasy oparte wyłącznie na tokenach.

#### 3. SubmitButton bez nadpisań

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Usunąć literały koloru z `className`, żeby przycisk przyjął wariant `default` (`bg-primary`). Zostają tylko klasy układu (szerokość).

**Contract**: `className` nie zawiera klas z palety Tailwinda. Zachowanie (`pending`, `disabled`, spinner) bez zmian.

#### 4. Wartości w repo

**File**: `context/changes/brand-palette-dashboard/palette.md` (nowy)

**Intent**: Zapisać surowe wartości palety, ich korekty pod AA i tabelę kontrastu, żeby kolejna sesja ich nie wymyślała.

**Contract**: Wejście użytkownika (3 hexy), mapowanie na tokeny i tabela kontrastu z Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- Testy jednostkowe przechodzą: `npm run test:unit`
- `global.css` nie zawiera selektora `.dark {`, a `bg-cosmic` nie zawiera hexów
- `src/components/ui/badge.tsx` istnieje i eksportuje `badgeVariants`

#### Manual Verification:

- Strony `/`, `/auth/signin`, `/dashboard`, `/studies/new` mają ciemnofioletowe tło. Przyciski formularzy (np. „Sign in”) są w kolorze `primary`, z czytelnym białym tekstem
- Nic nie zrobiło się nieczytelne na stronach poza zakresem (np. tekst bez własnej klasy jest teraz jasny, a nie czarny)

**Implementation Note**: Po weryfikacji automatycznej poczekaj na potwierdzenie ręcznych kroków przed kolejną fazą.

---

## Faza 2: Nowy Topbar

### Overview

Pasek z marką, nawigacją i kontem, zbudowany z tokenów i wariantów przycisku. Rozwiązuje C5 w zakresie landingu i dashboardu oraz część C2 i C4.

### Changes Required:

#### 1. Topbar

**File**: `src/components/Topbar.astro`

**Intent**: Przebudować pasek. Po lewej marka „ThisOrThat” (link do `/`, tekst z gradientem `brand-1 → brand-2 → brand-3`). Po prawej, dla zalogowanego: „Twoje badania” (link do `/dashboard`, `aria-current="page"` na `/dashboard`), e-mail (`muted-foreground`, `truncate`) i „Wyloguj” (`<button>` w formularzu POST, wariant `ghost`). Dla anonima: „Zaloguj się” (wariant `ghost` lub `link`) i „Załóż konto” (wariant `default`). Kontener zawija się na wąskim ekranie (`flex-wrap`, `gap`, `min-w-0`).

**Contract**:

- Zachowane adresy i metody: `/dashboard`, `/auth/signin`, `/auth/signup`, `POST /api/auth/signout`.
- Zachowane teksty: „Twoje badania”, „Wyloguj”, „Nie zalogowano” (może zostać dla czytników ekranu albo wizualnie), „Zaloguj się”, „Załóż konto”.
- E-mail jest osobnym elementem z dokładnie samym adresem jako tekstem.
- Klasy przycisków pochodzą z `buttonVariants`, kolory tylko z tokenów (`card`, `border`, `muted-foreground`, `link`, `brand-*`), zero literałów palety.
- `aria-current` ustala się z `Astro.url.pathname`.
- Pasek to element `<header>` z `<nav aria-label="…">`.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build przechodzą: `npm run lint`, `npx astro check`, `npm run build`
- Skan literałów na `src/components/Topbar.astro` zwraca 0 trafień
- e2e seed przechodzi (h1 i e-mail widoczne): `npx playwright test tests/e2e/seed.spec.ts`

#### Manual Verification:

- Na `/` (anonim) i `/dashboard` (zalogowany) pasek pokazuje markę, właściwe akcje i działające linki. „Wyloguj” wylogowuje
- Na ~375 px pasek zawija się bez poziomego scrolla, a długi e-mail jest skracany
- Zrzuty paska (desktop i Pixel 7) zapisane w `context/changes/brand-palette-dashboard/screenshots/`

---

## Faza 3: Dashboard na tokenach

### Overview

Przepięcie widoku `/dashboard` na tokeny, `buttonVariants` i `badgeVariants`. Rozwiązuje C2 i resztę C3.

### Changes Required:

#### 1. Widok

**File**: `src/pages/dashboard.astro`

**Intent**: Zastąpić każdy literał z tabeli „Widok → źródło” w `research.md` rolą:

- panel: `bg-card text-card-foreground border-border`;
- h1: gradient `brand-1 → brand-3`;
- „Nowe badanie”: `buttonVariants()` na `<a>`;
- komunikat po usunięciu: `muted` + `foreground`;
- błąd: `text-destructive`;
- wiersz: `border-border bg-muted hover:bg-accent/…`;
- status: `Badge` przez `badgeVariants` (szkic → `secondary`, trwa → `default`, zakończone → `outline`);
- postęp: `text-muted-foreground`.

**Contract**:

- h1 „Twoje badania” zostaje elementem `<h1>`.
- `progressLabel(study)` zostaje jednym ciągłym tekstem.
- „Badanie zostało usunięte.” bez zmian.
- Etykiety statusów z `STATUS_LABELS` bez zmian.
- Mapowanie status → wariant żyje przy widoku albo w `src/lib/study-status.ts` jako stała obok `STATUS_LABELS`.
- Zero literałów palety w pliku.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build przechodzą: `npm run lint`, `npx astro check`, `npm run build`
- Skan literałów na `src/pages/dashboard.astro` zwraca 0 trafień
- Testy HTTP i smoke przechodzą na preview: `BASE_URL=http://localhost:4321 npm run test:http` i `node scripts/smoke.mjs`
- e2e seed przechodzi: `npx playwright test tests/e2e/seed.spec.ts`

#### Manual Verification:

- Lista badań w trzech statusach pokazuje odróżnialne odznaki z etykietą tekstową i postępem „X z N”
- Zrzuty dashboardu z badaniami (desktop i Pixel 7) zapisane w `screenshots/`

---

## Faza 4: Stany i zabezpieczenie

### Overview

Domknięcie macierzy 7 stanów dla dashboardu i `Topbar` oraz zabezpieczenia, które utrzymają kontrakt. Rozwiązuje C4 i pustą część C2 (kontrast pustego stanu).

### Changes Required:

#### 1. Stany widoku

**File**: `src/pages/dashboard.astro`

**Intent**:

- **Focus:** każdy link wiersza, CTA i element `Topbar` ma widoczny `focus-visible` oparty na `--ring`. Przyciski mają go z `buttonVariants`, wiersze i marka dostają ten sam ring.
- **Błąd:** komunikat ma `role="alert"` i token `destructive`, a dodatkowo ikonę lub prefiks, żeby nie polegać na samym kolorze.
- **Pusty stan:** „Nie masz jeszcze żadnych badań.” w `muted-foreground` (≥4,5:1) z krótką zachętą i CTA „Utwórz pierwsze badanie” do `/studies/new` (`buttonVariants`).

**Contract**: Macierz stanów:

- default ✓, hover ✓, focus-visible ✓, error ✓, empty ✓;
- disabled — N/A (widok nie ma kontrolek wyłączanych);
- loading — N/A (SSR, HTML wysyłany dopiero po zapytaniu).

Nowe teksty nie kolidują z asercjami testów.

#### 2. Zabezpieczenie: test literałów

**File**: `tests/unit/design-tokens.test.ts` (nowy)

**Intent**: Test jednostkowy czyta oczyszczone pliki i nie przepuszcza literałów palety Tailwinda ani kolorów w CSS. Dzięki temu powrót literału zatrzymują CI i pre-commit (`vitest related`).

**Contract**:

- Lista plików: `src/pages/dashboard.astro`, `src/components/Topbar.astro`, `src/components/auth/SubmitButton.tsx`.
- Wzorzec: skan z `/10x-ui` (hex, `rgb(`, `hsl(`, `oklch(`, `-[Npx]`, klasy `bg|text|border|ring|outline|from|via|to|…-(slate|…|white|black)`).
- Komunikat błędu wskazuje plik, linię i token do użycia.
- Dopisanie pliku do listy to jedna linia.

#### 3. Zabezpieczenie: reguła dla agenta

**File**: `AGENTS.md`

**Intent**: Dodać krótki blok „UI / design tokens”:

- tokeny żyją w `src/styles/global.css` (`:root` + `@theme inline`), wartości są opisane w `context/changes/brand-palette-dashboard/palette.md`, a po archiwizacji w `context/archive/…`;
- komponenty żyją w `src/components/ui/`; przed dodaniem nowego sprawdź katalog, brakujące dodawaj przez `npx shadcn@latest add <name>`;
- w `.astro` używaj `buttonVariants` / `badgeVariants`;
- żadnych literałów kolorów ani wartości arbitralnych w widokach;
- linki na ciemnym tle mają `text-link`, kolory marki tylko do gradientów;
- `tests/unit/design-tokens.test.ts` pilnuje oczyszczonych plików, a każdy oczyszczony widok dopisuje się do jego listy.

Blok trafia poza znaczniki `<!-- BEGIN @przeprogramowani/10x-cli -->` … `<!-- END … -->`, jeśli są w pliku.

**Contract**: Jeden plik reguł (`AGENTS.md`, do którego odsyła `CLAUDE.md`). Bez tworzenia drugiego.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build przechodzą: `npm run lint`, `npx astro check`, `npm run build`
- Testy jednostkowe przechodzą, w tym nowy `tests/unit/design-tokens.test.ts`: `npm run test:unit`
- Kontrola celowego zepsucia: wstawienie `text-purple-300` do `Topbar.astro` czerwieni `design-tokens.test.ts`
- Testy HTTP i smoke przechodzą na preview
- e2e seed przechodzi: `npx playwright test tests/e2e/seed.spec.ts`

#### Manual Verification:

- Tab przez `/dashboard` pokazuje widoczny ring na marce, linkach, „Wyloguj”, CTA i każdym wierszu
- Pusty stan (konto bez badań) jest czytelny i ma działające CTA. Stan po usunięciu (`?deleted=1`) wygląda poprawnie
- Zrzuty stanów (pusty, z badaniami, po usunięciu, focus) dla desktopu i Pixel 7 leżą w `screenshots/`, a lista stanów z macierzy jest uzupełniona w `palette.md` lub opisie PR

---

## Testing Strategy

### Unit Tests:

- `tests/unit/design-tokens.test.ts`: brak literałów w oczyszczonych plikach, z kontrolą celowego zepsucia.
- Istniejące `tests/unit/*` bez zmian (klasyfikacja tras, hooki).

### Integration Tests:

- `tests/http/author-isolation.test.ts`, `tests/http/edit-and-delete-study.test.ts`, `tests/http/route-access.test.ts` i `scripts/smoke.mjs` muszą przejść bez zmian, bo pilnują tekstów dashboardu.
- e2e `tests/e2e/seed.spec.ts` (h1 i e-mail) oraz `auth.setup.ts`.

### Manual Testing Steps:

1. `npm run build && npm run preview`, otwórz `/` i `/auth/signin` jako anonim: fioletowe tło, przycisk primary.
2. Zaloguj się na konto bez badań: pusty stan i CTA. Utwórz szkic, uruchom badanie i zamknij inne, a potem sprawdź trzy odznaki.
3. Tab przez dashboard: ring na każdym elemencie.
4. DevTools Pixel 7 (412 px) i 375 px: zawijanie paska i brak poziomego scrolla.
5. Zrzuty z `playwright-cli` (desktop i Pixel 7) do `screenshots/`.

## Performance Considerations

Bez wpływu. Klasy Tailwinda i zmienne CSS, bez nowego JS po stronie klienta. Shadcn `badge` w Astro jest używany przez `badgeVariants` (sam string klas), bez hydratacji.

## Migration Notes

Zmiana `:root` i `bg-cosmic` działa natychmiast na wszystkich 9 stronach. Wycofanie to revert commitu Fazy 1. Brak danych do migrowania.

## References

- Research i zarzuty: `context/changes/brand-palette-dashboard/research.md` (§ Charges C1–C5, § Paleta marki — kontrast)
- Wzorzec przycisku: `src/components/ui/button.tsx:7-36`
- Poprzedni change: `context/archive/2026-10-20-landing-capabilities-grid/`
- Checklista skilla UI: `/10x-ui` references `ui-quality-checklist.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tokeny i baza

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint` — 858dfde
- [x] 1.2 Typy przechodzą: `npx astro check` — 858dfde
- [x] 1.3 Build przechodzi: `npm run build` — 858dfde
- [x] 1.4 Testy jednostkowe przechodzą: `npm run test:unit` — 858dfde
- [x] 1.5 `global.css` bez `.dark {`, `bg-cosmic` bez hexów — 858dfde
- [x] 1.6 `src/components/ui/badge.tsx` istnieje i eksportuje `badgeVariants` — 858dfde

#### Manual

- [x] 1.7 Fioletowe tło na `/`, `/auth/signin`, `/dashboard`, `/studies/new`; przyciski formularzy w kolorze `primary`, czytelne — 858dfde
- [x] 1.8 Nic nieczytelnego na stronach poza zakresem — 858dfde

### Phase 2: Nowy Topbar

#### Automated

- [x] 2.1 Lint, typy, build przechodzą — 4753151
- [x] 2.2 Skan literałów na `Topbar.astro` = 0 — 4753151
- [ ] 2.3 e2e seed przechodzi

#### Manual

- [ ] 2.4 Pasek na `/` i `/dashboard`: marka, akcje, działające linki, „Wyloguj” wylogowuje
- [ ] 2.5 Na ~375 px pasek się zawija, długi e-mail skracany, brak poziomego scrolla
- [ ] 2.6 Zrzuty paska (desktop i Pixel 7) w `screenshots/`

### Phase 3: Dashboard na tokenach

#### Automated

- [x] 3.1 Lint, typy, build przechodzą — 29e9656
- [x] 3.2 Skan literałów na `dashboard.astro` = 0 — 29e9656
- [ ] 3.3 Testy HTTP i smoke przechodzą na preview
- [ ] 3.4 e2e seed przechodzi

#### Manual

- [ ] 3.5 Trzy statusy mają odróżnialne odznaki z etykietą i postępem „X z N”
- [ ] 3.6 Zrzuty dashboardu z badaniami (desktop i Pixel 7) w `screenshots/`

### Phase 4: Stany i zabezpieczenie

#### Automated

- [x] 4.1 Lint, typy, build przechodzą — e546c79
- [x] 4.2 Testy jednostkowe przechodzą, w tym `design-tokens.test.ts` — e546c79
- [x] 4.3 Kontrola celowego zepsucia: `text-purple-300` w `Topbar.astro` czerwieni test — e546c79
- [ ] 4.4 Testy HTTP i smoke przechodzą na preview
- [ ] 4.5 e2e seed przechodzi

#### Manual

- [ ] 4.6 Tab przez `/dashboard`: widoczny ring na marce, linkach, „Wyloguj”, CTA i wierszach
- [ ] 4.7 Pusty stan czytelny z działającym CTA; stan `?deleted=1` poprawny
- [ ] 4.8 Zrzuty stanów (desktop i Pixel 7) w `screenshots/`, macierz stanów uzupełniona
