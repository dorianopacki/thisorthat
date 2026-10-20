---
date: 2026-10-20T13:05:00+02:00
researcher: Claude (Opus 5.5) dla dorian.opacki
git_commit: 791e4bd
branch: feat/brand-palette-dashboard
repository: thisorthat (C:\10xdevs)
topic: "Audyt /10x-ui: paleta marki jako tokeny semantyczne, nowy Topbar, /dashboard na tokenach"
tags: [research, ui-audit, design-tokens, tailwind-v4, shadcn, dashboard, topbar, contrast]
status: complete
last_updated: 2026-10-20
last_updated_by: Claude (Opus 5.5)
---

# Research: paleta marki, Topbar i /dashboard na tokenach

**Date**: 2026-10-20T13:05:00+02:00
**Researcher**: Claude (Opus 5.5) dla dorian.opacki
**Git Commit**: 791e4bd
**Branch**: feat/brand-palette-dashboard
**Repository**: thisorthat

## Research Question

Audyt `/10x-ui` dla jednego widoku (`/dashboard`) i współdzielonego `Topbar`. Pytania: skąd biorą się wartości kolorów, kto z nich korzysta, które literały w widoku powinny być tokenami, czego brakuje we wspólnych komponentach, jakie stany ma widok i jak paleta #A853CA / #CA53B0 / #CA5375 wypada pod względem kontrastu.

## Summary

- **Wariant kontraktu: starter z martwym plikiem tokenów.** Tokeny shadcn są w `src/styles/global.css:6-111` (`:root`, `.dark`, `@theme inline`), ale czyta je w `src/` tylko `src/components/ui/button.tsx:8-19`. Wszystkie inne pliki używają klas z palety Tailwinda (163 trafienia skanu w 28 plikach, pre-audyt).
- **Tokeny opisują jasny motyw, a aplikacja jest wyłącznie ciemna.** `:root` ma jasne wartości (`--background: oklch(1 0 0)`, `--foreground: oklch(0.145 0 0)`, `global.css:8-9`). Klasa `.dark` nie jest ustawiana nigdzie w `src/` (grep `class="dark"`/`classList` — 0 trafień), a każda z 9 stron rysuje ciemne tło `bg-cosmic` z hexami wpisanymi w `@utility` (`global.css:113-115`). Zmiana samych tokenów nie przemaluje dziś niemal niczego.
- **Dashboard i Topbar to wyłącznie literały:** 8 trafień skanu w `dashboard.astro` i 7 w `Topbar.astro`. „Primary” występuje w czterech odcieniach (`purple-600/500/300/100`), a tekst pomocniczy w czterech przezroczystościach `blue-100` (/50, /60, /70, /90).
- **Przycisk główny istnieje w 3 wersjach.** Shadcn `Button` (z `asChild`, `button.tsx:2,39`) jest nadpisywany w `SubmitButton.tsx:29` przez `bg-purple-600`. Dashboard ma własny `<a>` (`dashboard.astro:30`), a landing ma `linkBase` w `Hero.astro:4-7`.
- **Focus-visible:** ani `dashboard.astro`, ani `Topbar.astro` nie mają klas `focus:`/`focus-visible:`. Działa tylko globalne `outline-ring/50` (`global.css:119`) z szarym `--ring` jasnego motywu.
- **Paleta:** odcienie 283°/313°/343°, wszystkie `S 53% L 56%`. Biały tekst ma na nich 4,42 / 3,91 / 4,20 : 1, czyli poniżej AA 4,5 dla zwykłego tekstu. Minimalne korekty pod AA są niżej.

## Charges

Każdy zarzut ma plik, linię i skutek dla użytkownika. Plan przypisuje każdy zarzut do fazy albo oznacza go jako odłożony.

### C1. Martwe tokeny w złym motywie (missing tokens / accidental architecture)

- **Evidence:** `src/styles/global.css:6-39` — `:root` ma jasny motyw; `:41-73` — blok `.dark` nigdy nie jest aktywny (brak `class="dark"` w `src/layouts/Layout.astro` i w całym `src/`); `:113-115` — `bg-cosmic` z hexami `#0a0e1a/#0f1529` poza tokenami; `:122` — `body { bg-background text-foreground }` daje białe tło i prawie czarny tekst pod ciemnymi wrapperami.
- **Skutek dla użytkownika:** paleta marki nie ma gdzie trafić — zmiana `--primary` dziś nic nie zmienia na ekranie, a każdy komponent shadcn dodany w przyszłości (np. `Card`, wariant `outline` przycisku) wyrenderuje się jako jasna wyspa na ciemnym tle. Każdy tekst bez własnej klasy `text-*` jest prawie czarny na granatowym tle, czyli praktycznie niewidoczny.
- **Typowa naprawa:** ustawić ciemny motyw jako jedyny (ciemne wartości w `:root` albo `class="dark"` na `<html>`), przenieść kolory tła `bg-cosmic` do tokenów i dodać tokeny marki publikowane przez `@theme inline`.

### C2. Literały kolorów w widoku i Topbarze (missing tokens)

- **Evidence:**
  - `src/pages/dashboard.astro:23` — panel `border-white/10 bg-white/10 text-white`;
  - `:25` — h1 `from-blue-200 to-purple-200`;
  - `:30` — CTA `bg-purple-600 … hover:bg-purple-500`;
  - `:37` — komunikat `border-white/20 bg-white/5 text-blue-100/90`;
  - `:43` — błąd `text-red-300`;
  - `:50` — wiersz `border-white/20 bg-white/5 hover:bg-white/10`;
  - `:53` — status `text-blue-100/60`;
  - `:61` — pusty stan `text-blue-100/50`;
  - `src/components/Topbar.astro:5`, `:8`, `:10`, `:14`, `:22-29` — `border-white/10 bg-white/5 text-white/80`, `text-blue-100/70`, linki `text-purple-300 hover:text-purple-100`.
- **Skutek dla użytkownika:** kolorów marki nie da się wprowadzić w jednym miejscu, a ten sam „tekst pomocniczy” ma 4 różne jasności. Pusty stan (`text-blue-100/50` na panelu `white/10`) ma kontrast **4,03:1**, poniżej AA 4,5. Nowy autor widzi ledwie czytelny komunikat „Nie masz jeszcze żadnych badań”.
- **Typowa naprawa:** role `primary`, `accent`, `muted-foreground`, `card`/`surface`, `border`, `destructive`, `ring` i odwołania przez `bg-primary`, `text-muted-foreground` itd.

### C3. Przycisk główny zbudowany trzy razy (missing shared component)

- **Evidence:** `src/pages/dashboard.astro:28-33` — `<a>` „Nowe badanie” z ręcznymi klasami; `src/components/auth/SubmitButton.tsx:29` — nadpisuje wariant `default` shadcn (`bg-primary`) przez `bg-purple-600 … hover:bg-purple-500`; `src/components/landing/Hero.astro:4-7` — trzecia wersja (`linkBase`), jedyna z `focus-visible`. Shadcn `Button` obsługuje `asChild` (`src/components/ui/button.tsx:2,39-43`), więc link może być stylowany jak przycisk.
- **Skutek dla użytkownika:** główne akcje wyglądają i zachowują się inaczej na różnych ekranach (padding, focus, hover). Przycisk w formularzach ignoruje token `primary`, więc po zmianie palety zostałby w starym fiolecie.
- **Typowa naprawa:** użyć `Button` (wariant `default` na `bg-primary`) i `asChild` dla linków. W `.astro` trzeba wybrać ścieżkę: wyspa React bez hydratacji albo współdzielony wariant klas (`buttonVariants` z `button.tsx`). Usunąć nadpisanie w `SubmitButton`.

### C4. Brak widocznego focusu w widoku i Topbarze (states)

- **Evidence:** w `src/pages/dashboard.astro` i `src/components/Topbar.astro` nie ma `focus:` ani `focus-visible:`. Globalne `* { outline-ring/50 }` (`src/styles/global.css:119`) ustawia tylko kolor obrysu, i to szary `--ring: oklch(0.708 0 0)` z jasnego motywu (`:25`).
- **Skutek dla użytkownika:** osoba nawigująca klawiaturą przez wiersze badań, „Nowe badanie”, „Twoje badania” i „Wyloguj” widzi domyślny, przyciemniony obrys przeglądarki albo nic. Na ciemnym tle trudno ustalić, gdzie jest focus.
- **Typowa naprawa:** token `--ring` w kolorze marki z kontrastem ≥3:1 do tła i jednolite `focus-visible:ring` / `outline` na każdym kontrolce widoku.

### C5. Topbar jako przypadkowa architektura nawigacji (accidental architecture)

- **Evidence:**
  - `src/components/Topbar.astro:5` — jeden wiersz `flex justify-between` bez `flex-wrap`, `gap`, `min-w-0` ani `truncate`; e-mail jest w `:8`;
  - pasek jest renderowany tylko na `src/pages/dashboard.astro:21` i `src/pages/index.astro:18`. Strony `studies/*` mają zamiast niego doraźne linki „wróć” (`studies/[id].astro:133,244`, `studies/new.astro:16`, `studies/[id]/edit.astro:92`, wg workera);
  - brak marki ani logo, brak `aria-current` na „Twoje badania”;
  - „Wyloguj” to `<button>` stylowany jak link (`:13-15`).
- **Skutek dla użytkownika:**
  - Nie widać, w jakiej aplikacji się jest: pasek nie ma nazwy ThisOrThat.
  - Na ~375 px długi e-mail i dwie akcje w jednym niezawijanym wierszu prawdopodobnie się ścisną albo wyjdą poza ekran. To wniosek z lektury kodu, bez renderu.
  - Poza dashboardem nawigacja znika.
- **Typowa naprawa:** pasek z marką po lewej, nawigacją lub kontem po prawej, zawijaniem lub skracaniem e-maila i `aria-current`. Obecność na stronach `studies/*` to osobna decyzja zakresu.

## Detailed Findings

### Źródło wartości → widoki

- `global.css:75-111` publikuje role przez `@theme inline` jako `--color-*`, więc klasy `bg-primary`, `text-muted-foreground` itd. istnieją.
- Konsumenci tokenów w `src/`: `src/components/ui/button.tsx:8-19` (wg workera to jedyny plik). `Button` jest importowany wyłącznie przez `src/components/auth/SubmitButton.tsx:3`, który nadpisuje kolor (`:29`). Od tokenów faktycznie zależą tylko ring focusu `ring-ring/50` i obramowanie `aria-invalid` `destructive` (`button.tsx:8`).
- `SubmitButton` renderują: `SignInForm.tsx:82`, `SignUpForm.tsx:129`, `BallotForm.tsx:178`, `StudyWizard.tsx:323`, `AddLinksForm.tsx:59`, `CloseStudyButton.tsx:58`, `DeleteStudyButton.tsx:61` i `StartStudyButton.tsx:69` (wg workera). Zmiana `SubmitButton` na `bg-primary` przemaluje te przyciski na wszystkich stronach. To jest jedyny efekt tej zmiany poza dashboardem.
- `bg-cosmic` występuje na 9 stronach: `index.astro:17`, `dashboard.astro:20`, `studies/new.astro:9`, `studies/[id].astro:127`, `studies/[id]/edit.astro:86`, `auth/signin.astro:9`, `auth/signup.astro:9`, `auth/confirm-email.astro:22`, `v/[token].astro:112`. Przepięcie jego definicji na tokeny w `global.css` zmieni tło wszystkich 9 stron naraz, bez edycji samych stron.
- `Banner.astro:27-41` ma własne hexy (info, warning, error), niezależne od tokenów.
- Tokeny `--chart-*` i `--sidebar-*` nie są używane w `src/`.

### Widok → źródło (dashboard)

Dane: `supabase.rpc("list_author_studies")` (`dashboard.astro:10-13`). Gałęzie:

| Element             | Linia    | Literał dziś                                   | Rola docelowa                                       |
| ------------------- | -------- | ---------------------------------------------- | --------------------------------------------------- |
| tło strony          | `:20`    | `bg-cosmic` (hex w `@utility`)                 | `background`                                        |
| panel               | `:23`    | `border-white/10 bg-white/10 text-white`       | `card` / `card-foreground`, `border`                |
| h1 „Twoje badania”  | `:25`    | gradient `from-blue-200 to-purple-200`         | gradient marki (tokeny brand)                       |
| CTA „Nowe badanie”  | `:28-33` | `bg-purple-600 hover:bg-purple-500 text-white` | `Button` default → `primary` / `primary-foreground` |
| komunikat usunięcia | `:37`    | `border-white/20 bg-white/5 text-blue-100/90`  | `muted` / `foreground`, `border`                    |
| błąd                | `:43`    | `text-red-300`                                 | `destructive` (wariant czytelny na ciemnym tle)     |
| wiersz badania      | `:50`    | `border-white/20 bg-white/5 hover:bg-white/10` | `border`, `muted`, `accent` (hover)                 |
| status · postęp     | `:53`    | `text-blue-100/60`                             | `muted-foreground`                                  |
| pusty stan          | `:61`    | `text-blue-100/50` (4,03:1)                    | `muted-foreground` (≥4,5:1)                         |

Statusy (`src/lib/study-status.ts:10-14`): „Szkic”, „Trwa”, „Zakończone”. Wszystkie trzy są zwykłym tekstem w jednym wyciszonym `span`, bez rozróżnienia kolorem ani odznaką.

### Macierz 7 stanów (dashboard, stan dzisiejszy)

| Stan                            | Dziś                                                                      | Kotwica                         |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| default                         | jest, same literały                                                       | `dashboard.astro:45-59`         |
| hover                           | jest, tylko kolor (CTA, wiersz, linki Topbar)                             | `:30`, `:50`, `Topbar.astro:10` |
| focus-visible                   | **brak** własnego stylu                                                   | brak klas, `global.css:119`     |
| disabled                        | N/A — widok nie ma kontrolek wyłączanych (jedyny `<button>` to „Wyloguj”) | `Topbar.astro:13`               |
| error                           | jest, minimalny: czerwony tekst bez `role="alert"`, bez ponowienia        | `:43`                           |
| empty                           | jest, za niski kontrast, bez CTA w treści (CTA tylko w nagłówku)          | `:61`                           |
| loading                         | N/A — SSR czeka na `rpc` przed wysłaniem HTML, brak JS po stronie klienta | `:10-13`                        |
| (dodatkowy) status po usunięciu | `role="status"`                                                           | `:36-40`                        |

### Ścieżki wejścia (sprawdzenie przypadkowej architektury)

- **Wylogowany:** middleware przekierowuje na `/auth/signin` (`src/middleware.ts:19-21`, `src/lib/route-access.ts:19`). Nie ma surowego JSON ani pustej ramki.
- **Brak konfiguracji Supabase:** `user` jest `null`, więc następuje przekierowanie na signin, a `Banner` z `Layout` pokazuje ostrzeżenie. Fallback `{ data: [], error: null }` w `dashboard.astro:11-13` jest praktycznie nieosiągalny. Gdyby jednak zadziałał, pokazałby mylący pusty stan.
- **Błąd zapytania:** jeden komunikat, a błąd nie jest nigdzie logowany (`:43`). Logowanie to temat observability, poza zakresem UI.

### Paleta marki — kontrast

Wartości wejściowe od użytkownika (2026-10-20): `#A853CA`, `#CA53B0`, `#CA5375`. To odcienie 283°, 313° i 343° (co 30°) przy tej samej nasyconości 53% i jasności 56%. Kontrast liczony wzorem WCAG 2.x (skrypt node w sesji):

| Kolor     | biały tekst na kolorze | kolor na `#0a0e1a` | kolor na `#0f1529` |
| --------- | ---------------------- | ------------------ | ------------------ |
| `#A853CA` | 4,42                   | 4,36               | 4,10               |
| `#CA53B0` | 3,91                   | 4,93               | 4,64               |
| `#CA5375` | 4,20                   | 4,59               | 4,32               |

Najmniejsze korekty jasności (ten sam odcień i nasycenie) dające ≥4,5:1:

| Odcień | tło przycisku z białym tekstem | tekst na `#0f1529` ≥4,5    | tekst na `#0f1529` ≥7 |
| ------ | ------------------------------ | -------------------------- | --------------------- |
| 283°   | `#A74FC9` (4,56)               | `#AD5DCD` (4,52)           | `#C58CDC` (7,03)      |
| 313°   | `#C440A8` (4,52)               | `#CA53B0` bez zmian (4,65) | `#DA86C8` (7,09)      |
| 343°   | `#C74A6D` (4,54)               | `#CC597A` (4,56)           | `#DB8AA1` (7,04)      |

Dla porównania obecne wartości: biały na `purple-600` ma 5,38, `purple-300` linków w Topbarze ma 9,07, `red-300` błędu na panelu ma 7,27, a `blue-100/60` statusu na panelu ma 5,11.

`#CA5375` (343°) jest blisko czerwieni. Jeśli posłuży jako akcent, `destructive` musi pozostać wyraźnie inny, żeby błąd nie wyglądał jak element marki.

### Testy, które restyling musi zachować

- `tests/e2e/auth.setup.ts:27`, `tests/e2e/seed.spec.ts:12` — h1 „Twoje badania” (`level: 1`), widoczny.
- `tests/e2e/seed.spec.ts:13` — e-mail użytkownika widoczny jako `getByText(..., { exact: true })`. E-mail musi zostać osobnym elementem. Skracanie (`truncate`) jest dozwolone, ukrywanie nie.
- `tests/http/author-isolation.test.ts:147-169` — HTML zawiera ciągły tekst „Planowana liczba uczestników: 2” i nie zawiera „Odpowiedziało” dla szkicu. Tekstu postępu nie wolno rozbijać na kilka elementów.
- `tests/http/edit-and-delete-study.test.ts:191-196` — „Badanie zostało usunięte.” po `?deleted=1`.
- `tests/http/route-access.test.ts:35` — `/dashboard` jako trasa autora.

### Reguły dla agenta

`CLAUDE.md` i `AGENTS.md` nie mają sekcji o UI ani tokenach (pre-audyt, grep). Nic nie zachęca do jednorazowych wartości, ale nic też nie kieruje do tokenów. `AGENTS.md:16` wskazuje tylko `src/components/ui/` jako katalog shadcn.

## Code References

- `src/styles/global.css:6-39,41-73,75-111,113-115,117-124` — tokeny, `.dark`, `@theme inline`, `bg-cosmic`, warstwa bazowa
- `src/components/ui/button.tsx:2,8-19,39-43` — jedyny konsument tokenów, `asChild`
- `src/components/auth/SubmitButton.tsx:3,29` — nadpisanie wariantu `default`
- `src/pages/dashboard.astro:10-13,20-61` — dane, gałęzie, literały
- `src/components/Topbar.astro:2,5-31` — struktura i literały paska
- `src/components/landing/Hero.astro:4-7` — trzecia wersja przycisku głównego
- `src/lib/study-status.ts:10-14`, `src/lib/study-progress.ts:15-20` — etykiety statusu i postępu
- `src/components/Banner.astro:27-41` — hexy poza tokenami
- `tests/e2e/seed.spec.ts:12-13`, `tests/e2e/auth.setup.ts:27`, `tests/http/author-isolation.test.ts:147-169`, `tests/http/edit-and-delete-study.test.ts:191-196`

## Architecture Insights

- Aplikacja jest de facto wyłącznie ciemna. Kontrakt tokenów powinien to odzwierciedlać: jeden ciemny zestaw wartości, a nie jasny `:root` plus nieużywany `.dark`. Wybór między „ciemne wartości w `:root`” a „`class="dark"` na `<html>`” to decyzja planu.
- Strony są w Astro, a `Button` jest komponentem React. Linki w `.astro` mogą korzystać ze wspólnego wariantu klas (cva `buttonVariants`) bez wyspy React. Zgodność z `asChild` trzeba sprawdzić w planie.
- Zmiana definicji `bg-cosmic` i `SubmitButton` działa globalnie (9 stron i 8 komponentów). Reszta literałów na innych stronach zostaje do kolejnych change'ów, zgodnie z zasadą jednego widoku.

## Historical Context (from prior changes)

- `context/archive/2026-10-20-landing-capabilities-grid/plan.md` — landing celowo powielił wygląd dashboardu (`bg-cosmic`, szklane panele, `purple-600`) i zostawił tokeny bez zmian („Nie ruszamy tokenów w `global.css` ani trybu `.dark`”). Notatka follow-up w jego `change.md` zapowiada ten change.

## Related Research

- `context/archive/2026-10-20-landing-capabilities-grid/research.md` — opis stylu kosmicznego i komponentów.

## Open Questions

Decyzje dla `/10x-plan` (produktowe i kontraktowe, nie fakty do odkrycia):

1. **Strategia motywu:** ciemne wartości w `:root` (prościej, jeden motyw) czy `class="dark"` na `<html>` z zachowaniem jasnego `:root` na przyszłość?
2. **Mapowanie palety na role:** np. `primary` = 283° (`#A74FC9` pod biały tekst), `accent` = 313°, trzeci kolor = 343° jako `brand-3` do gradientów. Czy dodać nazwane `--brand-1/2/3` obok ról? Jak odróżnić `destructive` od 343°?
3. **Tło `bg-cosmic`:** zostaje granatowe (tylko przeniesione do tokenów) czy dostaje odcień marki? Zmienia to 9 stron naraz.
4. **Topbar:** zawartość (nazwa lub logo ThisOrThat, nawigacja, konto) i czy w tym change'u pojawia się też na stronach `studies/*` (zakres, C5).
5. **Przycisk w `.astro`:** cva `buttonVariants` bezpośrednio czy cienki komponent Astro owijający te same klasy?
6. **Statusy na dashboardzie:** dodać odznaki per status (szkic / trwa / zakończone) z tokenami czy zostawić tekst?
7. **Strażnik (Make it stick):** reguła w `AGENTS.md`/`CLAUDE.md` plus skan literałów jako check w istniejącym hooku `lint-edited-file.mjs` / ESLint, zawężony do oczyszczonych plików.
