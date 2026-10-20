# Landing ThisOrThat w układzie bento — plan implementacji

## Overview

Zastępujemy startowy komponent `Welcome` („10x Astro Starter”, po angielsku) polską stroną główną ThisOrThat w układzie bento-grid. Strona opowiada o 7 grupach możliwości aplikacji dowiezionych w M-1. Przyciski CTA zależą od zalogowania. Przy okazji polonizujemy współdzieloną ramę: `lang`, domyślny tytuł i anonimowy `Topbar`. Zmiana jest poza roadmapą (M-1 zamknięty).

## Current State Analysis

- `src/pages/index.astro:1-8` renderuje `<Layout><Welcome /></Layout>` bez `title`.
- `src/components/Welcome.astro` to szablon startowy. Ma tło `bg-cosmic` (`:5`), orby, gwiezdne tło, gradientowy h1 „10x Astro Starter” (`:22`), angielskie CTA (`:33`, `:39`) i siatkę 3 kart (`:45`). Importuje go wyłącznie `index.astro`.
- `src/layouts/Layout.astro:10` ma domyślny tytuł „10x Astro Starter”, `:14` ustawia `<html lang="en">`. Brakuje meta description.
- `src/components/Topbar.astro:22-29`: anonim widzi „Not signed in”, „Sign in”, „Sign up”, a zalogowany widzi polskie „Twoje badania” i „Wyloguj”.
- `src/components/ui/LibBadge.astro` to pozostałość szablonu, nikt jej nie importuje. Komponent `Card` nie istnieje, z shadcn jest tylko `button.tsx`.
- Po zalogowaniu następuje przekierowanie na `/` (`src/pages/api/auth/signin.ts:19`), więc zalogowany autor ląduje na landingu.

## Desired End State

Każdy (anonim i zalogowany) pod `/` widzi polską stronę ThisOrThat:

- hero z nazwą, jednozdaniową obietnicą („tani filtr wariantów treści przed testem A/B”) i CTA;
- bento-grid 7 kafelków z ikonami lucide;
- duży kafelek „Wyniki na żywo” ze statyczną makietą rankingu i licznika „odpowiedziało X z N”.

CTA: anonim widzi „Załóż konto” (`/auth/signup`, główne) i „Zaloguj się” (`/auth/signin`). Zalogowany widzi „Twoje badania” (`/dashboard`, główne) i „Nowe badanie” (`/studies/new`).

Wszystkie strony mają `lang="pl"`. Strona bez `title` dostaje „ThisOrThat”. Anonimowy `Topbar` jest po polsku. `Welcome.astro` i `LibBadge.astro` nie istnieją.

Weryfikacja: build, lint, testy unit i http, smoke (`/` → 200) oraz ręczny przegląd w szerokości telefonu i desktopu, jako anonim i jako zalogowany.

### Key Discoveries:

- Język wizualny do powielenia (`src/pages/dashboard.astro:21+`, `Welcome.astro`):
  - tło `bg-cosmic min-h-screen p-4 sm:p-8`;
  - szklane panele `rounded-2xl border border-white/10 bg-white/5|10 backdrop-blur-xl`;
  - gradient nagłówka `bg-gradient-to-r from-blue-200 via-purple-200 to-pink-200 bg-clip-text text-transparent`;
  - CTA `rounded-lg bg-purple-600 … hover:bg-purple-500`, drugorzędne `border border-white/20 hover:bg-white/10`;
  - tekst pomocniczy `text-blue-100/50…/70`.
- Ikony lucide działają w plikach `.astro` jako komponenty SSR bez hydratacji (`src/pages/studies/[id].astro:3` importuje `Pencil` z `lucide-react`).
- `/` jest w `ROUTE_AUDIENCE` jako `public` (`src/lib/route-access.ts:11`). Smoke oczekuje `GET /` → 200 (`scripts/smoke.mjs:39`). Testy HTTP oczekują signin → `/` (`tests/http/client.ts:174-175`). Nie zmieniamy tras ani przekierowań.
- Testy e2e używają „Sign in” tylko jako przycisku i nagłówka na `/auth/signin` (`tests/e2e/auth.setup.ts:21`, `tests/e2e/seed.spec.ts:24`), a nie jako linku `Topbar`. Polonizacja `Topbar` ich nie dotyka.
- Fakty do treści: `context/foundation/prd.md` (FR-001…FR-019, NFR `:108-110`), limity 2–6 wariantów i N 1–100 (`context/foundation/roadmap.md:110`). Non-Goals (`prd.md:131-135`) — nie obiecywać.

## What We're NOT Doing

- Nie zmieniamy przekierowania po zalogowaniu ani middleware. Zalogowany zostaje na `/`.
- Nie polonizujemy stron auth (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) ani formularzy React. Mają angielskie etykiety, na których opierają się testy e2e.
- Nie dodajemy komponentów shadcn (Card itp.) ani nowych zależności. Nie ruszamy tokenów w `global.css` ani trybu `.dark`.
- Nie dodajemy tagów OG, obrazów, zrzutów ekranu ani animacji poza istniejącym `transition-colors`.
- Nie usuwamy `public/template.png`, bo używa go `README.md:3`.
- Nie dodajemy nowego testu e2e ani visual diff. `context/foundation/test-plan.md:171` wyklucza testy wyglądu, a landing nie zmienia ryzyka #1.
- Makieta wyników nie korzysta z prawdziwych danych. To statyczny HTML.

## Implementation Approach

Czyste Astro (SSR, zero JS po stronie klienta), Tailwind utility zgodnie z istniejącymi stronami. Kafelki bento to mały lokalny komponent, żeby nie kopiować klas 7 razy. Treść kafelków trzymamy w tablicy w `index.astro` (albo w komponencie gridu), żeby copy było w jednym miejscu. Grid: jedna kolumna na telefonie, na `md+` 3 kolumny, duży kafelek zajmuje 2 kolumny × 2 rzędy (`md:col-span-2 md:row-span-2`), reszta po 1 polu. Szerokość `max-w-5xl`, tak żeby 1 duży + 6 małych domknęło siatkę bez dziur.

## Faza 1: Polonizacja współdzielonej ramy

### Overview

Ustawiamy polski język i markę w `Layout` oraz polskie teksty anonimowego `Topbar`, żeby landing w Fazie 2 stał na spójnej ramie.

### Changes Required:

#### 1. Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Strony mają deklarować język polski, a strona bez tytułu ma nosić nazwę produktu zamiast nazwy szablonu. Dodajemy opcjonalny opis do meta, żeby landing mógł podać swój.

**Contract**: `<html lang="pl">`. Props: `title?: string` (domyślnie `"ThisOrThat"`) i nowy `description?: string`. Gdy `description` jest podany, renderuje się `<meta name="description" content={description}>`, a gdy nie, tag jest pomijany. Pozostałe strony przekazujące `title` działają bez zmian.

#### 2. Topbar (gałąź anonimowa)

**File**: `src/components/Topbar.astro`

**Intent**: Zastąpić angielskie teksty anonima polskimi, spójnymi z gałęzią zalogowaną.

**Contract**: „Not signed in” → „Nie zalogowano”, „Sign in” → „Zaloguj się”, „Sign up” → „Załóż konto”. Adresy (`/auth/signin`, `/auth/signup`), klasy i gałąź zalogowana bez zmian.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Testy jednostkowe przechodzą: `npm run test:unit`
- W `src/` nie ma już stringów „10x Astro Starter”, „Not signed in” ani `lang="en"` (grep zwraca 0 trafień poza `Welcome.astro`, które usuwa Faza 2)

#### Manual Verification:

- Na dowolnej stronie anonimowej (np. `/auth/signin`) pasek pokazuje „Nie zalogowano · Zaloguj się · Załóż konto” i linki prowadzą na właściwe strony
- Zakładka przeglądarki na `/` pokazuje tytuł „ThisOrThat”

**Implementation Note**: Po automatycznej weryfikacji poczekaj na potwierdzenie ręcznych kroków przed Fazą 2.

---

## Faza 2: Landing bento-grid

### Overview

Budujemy nową stronę główną: hero z CTA zależnym od zalogowania, grid 7 kafelków z dużym kafelkiem „Wyniki na żywo” i makietą. Usuwamy szablon startowy.

### Changes Required:

#### 1. Kafelek bento

**File**: `src/components/landing/FeatureTile.astro` (nowy)

**Intent**: Jeden szklany kafelek: ikona, tytuł, opis 1–2 zdania i opcjonalny slot na treść dodatkową (makietę). Sterowanie rozmiarem z zewnątrz.

**Contract**: Props `title: string`, `description: string`, `icon` (komponent lucide), `class?: string` (dla `col-span`/`row-span`). Domyślny `<slot />` renderuje się pod opisem. Tytuł to `<h3>`, a ikona jest `aria-hidden`. Styl: `rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl`, tekst w odcieniach `text-white` / `text-blue-100/70`.

#### 2. Makieta wyników

**File**: `src/components/landing/ResultsMockup.astro` (nowy)

**Intent**: Statyczna ilustracja ekranu wyników do dużego kafelka. Ranking 3 wariantów z paskami głosów i liczbami, w tym remis dzielący miejsce, licznik „Odpowiedziało 7 z 10” i jeden anonimowy komentarz.

**Contract**: Brak propsów, czysty HTML/CSS. Dane w makiecie muszą być wewnętrznie spójne: suma głosów = 7, dwa warianty z tą samą liczbą głosów mają to samo miejsce (FR-011). Makieta jest dekoracyjna, więc kontener ma `aria-hidden="true"`, bo treść kafelka niesie tekst opisu.

#### 3. Hero z CTA

**File**: `src/components/landing/Hero.astro` (nowy)

**Intent**: Nagłówek strony z marką, obietnicą i CTA dopasowanym do sesji.

**Contract**:

- h1 „ThisOrThat” z gradientem.
- Podtytuł w stylu: „Sprawdź, który wariant treści wygrywa — zanim wydasz budżet na test A/B.”
- Krótkie zdanie o mechanice: warianty → jednorazowe linki → wyniki na żywo.
- CTA z `Astro.locals.user`:
  - anonim: „Załóż konto” → `/auth/signup` (purple-600), „Zaloguj się” → `/auth/signin` (obramowany);
  - zalogowany: „Twoje badania” → `/dashboard` (purple-600), „Nowe badanie” → `/studies/new` (obramowany).
- Przyciski to zwykłe linki `<a>`.

#### 4. Strona główna

**File**: `src/pages/index.astro`

**Intent**: Złożyć landing z ramy (`bg-cosmic`, `Topbar`), `Hero` i gridu 7 kafelków. Podać `title` i `description` do `Layout`.

**Contract**: `<Layout title="ThisOrThat — porównaj warianty treści" description="…">`. Struktura: `div.bg-cosmic.min-h-screen.p-4.sm:p-8` > `Topbar` > `main.mx-auto.max-w-5xl` > `Hero` + `<section aria-labelledby>` z h2 „Co potrafi ThisOrThat” (może być wizualnie ukryte, `sr-only`) i grid `grid grid-cols-1 gap-4 md:grid-cols-3`.

Kafelki (tytuł — sens opisu — źródło):

1. **Wyniki na żywo** (duży, `md:col-span-2 md:row-span-2`, z `ResultsMockup`) — ranking wg głosów z remisami, anonimowe komentarze przy wariantach, licznik „X z N” — FR-011–FR-013
2. **Badanie w kilka kroków** — 2–6 wariantów tekstowych lub obrazkowych, liczba uczestników N (1–100), edycja do startu — FR-003, FR-004, FR-017
3. **Jeden link = jeden głos** — „Rozpocznij” tworzy N jednorazowych linków do skopiowania, w trakcie można dogenerować kolejne — FR-005, FR-006, FR-019
4. **Bez konta, na telefonie** — uczestnik otwiera link, wybiera wariant, opcjonalnie komentuje — FR-007–FR-010, NFR
5. **Pełna anonimowość** — głosu ani komentarza nie da się powiązać z osobą ani linkiem, warianty widzi tylko autor i posiadacz ważnego linku — NFR
6. **Kończy się samo** — zamknięcie po wykorzystaniu wszystkich linków, ręcznie albo o wybranym terminie — FR-014–FR-016
7. **Wszystkie badania w jednym miejscu** — pulpit ze statusem (szkic / trwa / zamknięte) i postępem X z N — FR-002, FR-018

Ikony lucide dobiera implementer (np. `BarChart3`, `ListPlus`, `Link2`, `Smartphone`, `ShieldCheck`, `TimerOff`, `LayoutDashboard`). Copy nie może obiecywać Non-Goals z `prd.md:131-135` (wysyłka linków z aplikacji, zespoły, analityka/eksport, integracje A/B, reset hasła).

#### 5. Usunięcie szablonu

**Files**: `src/components/Welcome.astro`, `src/components/ui/LibBadge.astro` (usunąć)

**Intent**: Usunąć martwy kod startera.

**Contract**: Po usunięciu nie zostaje żaden import tych plików (build to wykryje). `public/template.png` zostaje.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Testy jednostkowe przechodzą (w tym klasyfikacja tras): `npm run test:unit`
- Testy HTTP i smoke przechodzą na zbudowanym preview: `npm run preview`, potem `BASE_URL=http://localhost:4321 npm run test:http` i `node scripts/smoke.mjs` (`/` → 200, signin → `/`)
- `src/components/Welcome.astro` i `src/components/ui/LibBadge.astro` nie istnieją, a w `src/` nie ma odwołań do `Welcome` ani `LibBadge`

#### Manual Verification:

- Anonim na `/` widzi hero ThisOrThat, CTA „Załóż konto” / „Zaloguj się” i 7 kafelków. Linki prowadzą na `/auth/signup` i `/auth/signin`
- Po zalogowaniu (przekierowanie na `/`) CTA to „Twoje badania” / „Nowe badanie” i prowadzą na `/dashboard` i `/studies/new`
- Na szerokości telefonu (~375 px) kafelki są w jednej kolumnie, nie ma poziomego scrolla, a makieta mieści się w kafelku
- Na desktopie grid 3 kolumn domyka się bez pustych pól: duży kafelek 2×2 i 6 małych
- Treść kafelków zgadza się z działaniem aplikacji (limity 2–6 wariantów, N 1–100) i nie obiecuje funkcji spoza PRD
- Nawigacja klawiaturą: CTA i linki `Topbar` mają widoczny focus, czytnik ekranu nie czyta makiety

---

## Testing Strategy

### Unit Tests:

- Brak nowych. Landing to statyczna treść bez logiki. Istniejący `tests/unit/route-access.test.ts` pilnuje, że `/` pozostaje sklasyfikowane, a żadna trasa nie dochodzi.

### Integration Tests:

- Istniejące: `tests/http/route-access.test.ts:27` (sonda `GET /` jako public), `tests/http/client.ts:174-175` (signin → `/`), `scripts/smoke.mjs:39` (`/` → 200). Muszą przejść bez zmian.
- E2E bez zmian (`tests/e2e/*`). Nie zależą od `/` ani od tekstów `Topbar`.

### Manual Testing Steps:

1. `npm run build && npm run preview`, otwórz `http://localhost:4321/` w trybie incognito i sprawdź hero, CTA anonima i 7 kafelków.
2. Zawęź okno do ~375 px (DevTools) i sprawdź układ jednokolumnowy oraz brak poziomego scrolla.
3. Zaloguj się. Po przekierowaniu na `/` sprawdź CTA zalogowanego i kliknij oba.
4. Przejdź Tabem przez stronę i sprawdź focus na CTA i linkach.

## Performance Considerations

Brak JS po stronie klienta. Ikony lucide renderują się jako inline SVG w SSR. Usunięcie orbów i gwiezdnego tła z `Welcome` (rozmyte warstwy) nie jest wymagane, ale jeśli implementer je zachowa w landingu, niech zostaną `pointer-events-none` i nie powodują poziomego scrolla.

## Migration Notes

Nie dotyczy — brak zmian danych i tras.

## References

- Research: `context/changes/landing-capabilities-grid/research.md`
- Wzorzec stylu: `src/pages/dashboard.astro:21+`, `src/components/Welcome.astro:5-45`
- Ikony lucide w Astro: `src/pages/studies/[id].astro:3`
- Treść: `context/foundation/prd.md` (FR-001…FR-019, `:108-110`, `:131-135`), `context/foundation/roadmap.md:110`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Polonizacja współdzielonej ramy

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint`
- [x] 1.2 Build przechodzi: `npm run build`
- [x] 1.3 Testy jednostkowe przechodzą: `npm run test:unit`
- [x] 1.4 W `src/` nie ma stringów „10x Astro Starter”, „Not signed in” ani `lang="en"` (poza `Welcome.astro`)

#### Manual

- [x] 1.5 Anonimowy pasek pokazuje „Nie zalogowano · Zaloguj się · Załóż konto” z działającymi linkami
- [x] 1.6 Zakładka na `/` pokazuje tytuł „ThisOrThat”

### Phase 2: Landing bento-grid

#### Automated

- [ ] 2.1 Lint przechodzi: `npm run lint`
- [ ] 2.2 Build przechodzi: `npm run build`
- [ ] 2.3 Testy jednostkowe przechodzą (w tym klasyfikacja tras): `npm run test:unit`
- [ ] 2.4 Testy HTTP i smoke przechodzą na preview (`/` → 200, signin → `/`)
- [ ] 2.5 `Welcome.astro` i `LibBadge.astro` usunięte, brak odwołań w `src/`

#### Manual

- [ ] 2.6 Anonim widzi hero, CTA „Załóż konto” / „Zaloguj się” i 7 kafelków z działającymi linkami
- [ ] 2.7 Zalogowany widzi CTA „Twoje badania” / „Nowe badanie” z działającymi linkami
- [ ] 2.8 Na ~375 px jedna kolumna, brak poziomego scrolla, makieta mieści się w kafelku
- [ ] 2.9 Na desktopie grid 3 kolumn domyka się bez pustych pól (2×2 + 6)
- [ ] 2.10 Treść zgodna z aplikacją i PRD, bez obietnic Non-Goals
- [ ] 2.11 Widoczny focus na CTA i linkach, makieta ukryta przed czytnikiem ekranu
