# Paleta marki, nowy Topbar i dashboard na tokenach — Plan Brief

> Full plan: `context/changes/brand-palette-dashboard/plan.md`
> Research: `context/changes/brand-palette-dashboard/research.md`

## What & Why

Aplikacja ma wyglądać jak marka ThisOrThat: paleta #A853CA / #CA53B0 / #CA5375 i porządny pasek nawigacji zamiast generycznego paska ze startera. Dziś tokeny shadcn są nieużywane i opisują jasny motyw, a widoki mają kolory wpisane na sztywno. Dlatego najpierw naprawiamy kontrakt (tokeny i komponenty), a dopiero potem przemalowujemy jeden widok, `/dashboard`, który posłuży kolejnym widokom jako wzór.

## Starting Point

- `global.css` ma jasny `:root`, nieaktywny `.dark` i granatowe `bg-cosmic` z hexami.
- Tokenów używa tylko `button.tsx`, a jego jedyny konsument (`SubmitButton`) nadpisuje kolor.
- `dashboard.astro` i `Topbar.astro` mają 15 literałów palety, zero `focus-visible`, a tekst pustego stanu ma kontrast 4,03:1.

## Desired End State

- Ciemnofioletowe tło na wszystkich stronach i przyciski formularzy w kolorze marki.
- Nowy `Topbar`: marka, nawigacja z `aria-current`, konto; zawija się na telefonie.
- `/dashboard` zbudowany wyłącznie z tokenów, `buttonVariants` i odznak statusów, z widocznym focusem i czytelnym pustym stanem.
- Test jednostkowy i reguła w `AGENTS.md` pilnują, żeby literały nie wróciły.

## Key Decisions Made

| Decision          | Choice                                                                                                | Why (1 sentence)                                                        | Source                    |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| Strategia motywu  | Ciemne wartości w `:root`, usunięty `.dark`, `color-scheme: dark`                                     | Jedno źródło prawdy zgodne z tym, co widać; jasny motyw nie istnieje    | Plan                      |
| Role palety       | `primary` = 283° `#A74FC9`, `accent` = 313° `#C440A8`, `brand-3` = 343° `#CA5375` tylko do gradientów | Akcje mają kolor marki z AA 4,5:1, a róż-czerwień nie myli się z błędem | Plan (kontrast: Research) |
| Tekst linków      | Osobny token `--link` `#D3A6E4`                                                                       | Kolory marki jako tekst na ciemnym tle mają 3,3–4,6:1                   | Plan                      |
| Tło               | Ciemny fiolet `#120B1D → #1A1028` jako tokeny w `bg-cosmic`                                           | Paleta żyje na całej stronie, jedna zmiana obejmuje 9 stron             | Plan                      |
| Topbar            | Marka + nawigacja + konto, tylko landing i dashboard                                                  | Mieści się w zasadzie „jeden widok”, `studies/*` w kolejnym change'u    | Plan                      |
| Statusy           | Odznaki shadcn `badge` (szkic/trwa/zakończone)                                                        | Status czytelny jednym rzutem oka, etykieta tekstowa zostaje            | Plan                      |
| Przyciski w Astro | `buttonVariants` / `badgeVariants` z `src/components/ui`                                              | Jeden przycisk zamiast trzech, bez wyspy React                          | Research                  |
| Bramka wizualna   | Zrzuty desktop + Pixel 7 w `screenshots/`                                                             | `test-plan.md:171` wyklucza snapshoty wyglądu w CI                      | Plan                      |
| Zabezpieczenie    | `tests/unit/design-tokens.test.ts` + blok UI w `AGENTS.md`                                            | Działa w CI i pre-commicie bez nowych zależności                        | Plan                      |

## Scope

**In scope:**

- `src/styles/global.css` (tokeny, `bg-cosmic`)
- `src/components/ui/badge.tsx` (shadcn)
- `SubmitButton.tsx`
- `Topbar.astro`
- `dashboard.astro`
- `tests/unit/design-tokens.test.ts`
- `AGENTS.md`
- `palette.md` i `screenshots/` w folderze change'a

**Out of scope:**

- literały na innych widokach (landing, auth, studies, głosowanie)
- `Topbar` na `studies/*`
- jasny motyw i przełącznik
- `Banner.astro`
- `toHaveScreenshot` i kitchen-sink
- teksty, trasy, dane

## Architecture / Approach

Wartości żyją w `:root`, a `@theme inline` publikuje je jako klasy (`bg-primary`, `text-link`, `from-brand-1`). Widoki odwołują się tylko do ról. Przyciski i odznaki to warianty cva z `src/components/ui/`: w React jako komponenty, w Astro przez `buttonVariants()` / `badgeVariants()`. Zmiana `:root`, `bg-cosmic` i `SubmitButton` działa globalnie. Pozostałe literały innych widoków zostają do kolejnych change'y.

## Phases at a Glance

| Phase                     | What it delivers                                                                          | Key risk                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Tokeny i baza          | Ciemny `:root` z marką, fioletowe tło, `badge`, `SubmitButton` na `primary`, `palette.md` | 9 stron zmienia tło naraz; tekst bez klasy może zmienić kolor |
| 2. Nowy Topbar            | Marka, nawigacja, konto, zawijanie, tokeny                                                | e2e wymaga widocznego e-maila jako osobnego elementu          |
| 3. Dashboard na tokenach  | Panel, gradient, CTA, wiersze, odznaki                                                    | Testy HTTP wymagają ciągłego tekstu postępu                   |
| 4. Stany i zabezpieczenie | Focus, błąd i pusty stan, zrzuty, test literałów, reguła                                  | Kontrola celowego zepsucia musi czerwienić test               |

**Prerequisites:**

- działający Docker i lokalny Supabase (testy HTTP, smoke, e2e, zalogowany dashboard);
- sieć dla `npx shadcn add badge` (jeśli jej nie ma, kopia ręczna);
- gałąź `feat/brand-palette-dashboard`.

**Estimated effort:** ~1–2 sesje, 4 fazy.

## Open Risks & Assumptions

- Strony poza zakresem dostaną nowe tło przy starych literałach (`blue-100`, `purple-300`). Kontrast tych kolorów na ciemnym fiolecie jest podobny jak na granacie, ale trzeba to sprawdzić w kroku 1.8.
- Docker na tej maszynie bywa niestabilny (WinNAT / WSL). Bez niego bramki HTTP i e2e przejdą tylko w CI.
- Hover `bg-primary/90` przyciemnia przycisk. To świadomie przyjęte zachowanie shadcn.

## Success Criteria (Summary)

- Aplikacja wygląda jak jedna marka: fioletowe tło, przyciski i pasek w kolorach palety, a cały tekst ma AA.
- Dashboard jest czytelny w każdym stanie i w pełni obsługiwalny z klawiatury.
- Kolejny agent, który doda literał koloru do oczyszczonych plików, dostanie czerwony test i regułę wskazującą tokeny.
