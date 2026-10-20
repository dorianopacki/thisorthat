---
date: 2026-10-20T10:47:17+02:00
researcher: Claude (Opus 5.5) dla dorian.opacki
git_commit: 68de903
branch: chore/drop-text-variant-wrappers
repository: thisorthat (C:\10xdevs)
topic: "Przebudowa strony głównej `/` na grid (bento) opowiadający o możliwościach aplikacji"
tags: [research, landing, index, welcome, layout, topbar, tailwind, route-access]
status: complete
last_updated: 2026-10-20
last_updated_by: Claude (Opus 5.5)
---

# Research: strona główna jako grid (bento) z możliwościami aplikacji

**Date**: 2026-10-20T10:47:17+02:00
**Researcher**: Claude (Opus 5.5) dla dorian.opacki
**Git Commit**: 68de903
**Branch**: chore/drop-text-variant-wrappers
**Repository**: thisorthat

## Research Question

Co trzeba wiedzieć, żeby przebudować `src/pages/index.astro` (dziś startowy `Welcome`) na układ grid/bento opowiadający o możliwościach ThisOrThat: z czego zbudować UI, jaką treść pokazać, dokąd linkować i czego nie zepsuć w testach.

## Summary

- `/` to wciąż nietknięty szablon „10x Astro Starter” po angielsku — `src/pages/index.astro:1-8` renderuje tylko `Welcome`, a `Welcome.astro:22-24` ma h1 „10x Astro Starter”. Nazwa „ThisOrThat” nie pada w żadnym przejrzanym stringu UI.
- Język wizualny aplikacji jest już ustalony i należy go powtórzyć: tło `bg-cosmic`, „szklane” kafelki `rounded-2xl border border-white/10 bg-white/5|10 backdrop-blur-xl`, gradientowe nagłówki, CTA `bg-purple-600`. Tokeny shadcn z `global.css` (neutralne, oklch) nie są używane przez strony.
- W `src/components/ui/` jest tylko `button.tsx` i nieużywany `LibBadge.astro` — brak Card. Bento najprościej zbudować czystym Tailwindem w Astro (bez React, bez nowych zależności); `lucide-react` jest dostępny do ikon.
- Treść: wszystkie FR-001…FR-019 z PRD są dowiezione w M-1 (roadmapa: F-01, S-01…S-08 `done`). Kafelki mogą opisywać całą pętlę: badanie → linki jednorazowe → głosowanie bez konta na telefonie → ranking/komentarze/postęp na żywo → zamykanie.
- **Ważne zachowanie:** po zalogowaniu `/api/auth/signin` przekierowuje na `/` (`src/pages/api/auth/signin.ts:19`), więc zalogowany użytkownik ląduje na landingu. Landing powinien być auth-aware (`Astro.locals.user` → CTA „Twoje badania” `/dashboard`). Zmiana celu przekierowania łamie `tests/http/client.ts:174-175` i `scripts/smoke.mjs` (krok „signin accepts correct password”).
- Testy: `/` jest sklasyfikowane jako `public` (`src/lib/route-access.ts:11`), sondowane w `tests/http/route-access.test.ts:27` i w smoke'u (`scripts/smoke.mjs:39`, oczekuje 200). Żaden test nie odwołuje się do `Welcome` ani jego tekstów (grep w `tests/` — brak trafień wg workera).

## Detailed Findings

### Obecna strona główna i layout

- `src/pages/index.astro:1-8` — `<Layout><Welcome /></Layout>`, bez propsa `title`.
- `src/layouts/Layout.astro:10` — domyślny tytuł „10x Astro Starter”; `:14` `<html lang="en">`; brak meta description/OG; czcionki systemowe. Jedyny layout w aplikacji (używany przez wszystkie strony wg workera UI).
- `Layout` nie zawiera nawigacji — każda strona sama wstawia `Topbar.astro`.
- `src/components/Welcome.astro` (114 linii) importowany tylko przez `index.astro`. Struktura: `bg-cosmic` wrapper (`:5`), 3 rozmyte „orby”, gwiezdne tło, `Topbar`, hero z gradientowym h1 (`:22`), przyciski Sign In/Sign Up (`:33`, `:39`), siatka 3 kart `grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3` (`:45`). Ikony to inline SVG, bez obrazków.
- Po przebudowie `Welcome.astro` (i nieużywany `LibBadge.astro`, `public/template.png` używany tylko w README) to kandydaci do usunięcia.

### System stylów

- Tailwind v4.2 przez `@tailwindcss/vite`; konfiguracja w CSS: `src/styles/global.css` (`@theme inline`, tokeny oklch, `@utility bg-cosmic`, `@custom-variant dark`). Brak `tailwind.config`.
- Tryb ciemny klasowy (`.dark`), ale nigdzie niewłączany — strony wymuszają ciemny wygląd przez `bg-cosmic` + białe opacity.
- `components.json`: shadcn style „new-york”, iconLibrary lucide. Dodanie shadcn `Card` dałoby neutralne tokeny, niepasujące do kosmicznego wyglądu.

### Wzorce do powielenia (z istniejących stron)

- `src/pages/dashboard.astro:21+` — `div.bg-cosmic.min-h-screen.p-4.sm:p-8` > `Topbar` > `main` szklany panel `rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`; h1 `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent`; CTA `rounded-lg bg-purple-600 … hover:bg-purple-500`; tekst pomocniczy `text-blue-100/50…/70`.
- `src/components/Topbar.astro` — auth-aware: `:2` `Astro.locals.user`; zalogowany → email + „Twoje badania” (`/dashboard`, `:10`) + „Wyloguj”; anonim → „Not signed in”, „Sign in”, „Sign up” (`:22-29`, po angielsku).

### Możliwości produktu (źródło treści kafelków)

PRD (`context/foundation/prd.md`, po polsku): ThisOrThat to tani filtr wariantów treści (tekst, CTA, obraz) na zamkniętej grupie przed testem A/B (`:22-24`). Autor działa solo (`:29`), uczestnicy dostają linki (`:32`).

Pogrupowane możliwości (wszystkie oznaczone jako dowiezione — roadmap.md `:48-56`, archiwum `context/archive/2026-10-0*`…`2026-10-16-*`):

| Kafelek (propozycja)               | FR                                      | Fakt z PRD                                                                                            |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Badanie w kilka kroków             | FR-003, FR-004, FR-017, FR-018          | kreator, warianty tekstowe lub obrazkowe, liczba N, edycja przed startem, usuwanie                    |
| Jeden link = jeden głos            | FR-005, FR-006, FR-019, guardrail `:43` | „Rozpocznij” generuje N jednorazowych linków, łatwe kopiowanie, dogenerowanie w trakcie               |
| Głosowanie bez konta, na telefonie | FR-007…FR-010, NFR `:108`               | uczestnik bez konta wybiera wariant, opcjonalny komentarz, komunikat podziękowania                    |
| Wyniki na żywo                     | FR-011…FR-013                           | ranking (remisy dzielą miejsce), anonimowe komentarze per wariant, „odpowiedziało X z N”              |
| Badanie kończy się samo            | FR-014…FR-016                           | auto-zamknięcie po N głosach, ręczne zamknięcie, termin                                               |
| Anonimowość                        | NFR `:109-110`                          | głosów i komentarzy nie da się powiązać z osobą/linkiem; warianty widzi tylko autor i posiadacz linku |
| Pulpit autora                      | FR-002                                  | lista badań ze statusem (szkic/trwa/zamknięte) i X z N                                                |

Limity, które można podać w treści: 2–6 wariantów, N od 1 do 100 (roadmap.md `:110`). Nie obiecywać rzeczy z Non-Goals (`prd.md:131-135`): odzyskiwania hasła, wysyłki linków z aplikacji, zespołów, analityki/eksportu, integracji A/B.

### Trasy i CTA

- Publiczne: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` (`src/lib/route-access.ts:11-14`).
- Autor: `/dashboard`, `/studies/new`, `/studies/[id]`, `/studies/[id]/edit` — middleware przekierowuje anonima na `/auth/signin` (`src/middleware.ts:19-21`).
- Uczestnik `/v/[token]` — brak publicznego indeksu; z landingu nie da się (i nie należy) linkować.
- Przekierowania: signin → `/` (`src/pages/api/auth/signin.ts:19`), signout → `/`, signup → `/auth/confirm-email` (wg workera; signin zweryfikowany bezpośrednio).
- Sensowne CTA: anonim → „Załóż konto” `/auth/signup` (główne) + „Zaloguj się” `/auth/signin`; zalogowany → „Twoje badania” `/dashboard` i/lub „Nowe badanie” `/studies/new`.

### Testy i bramki

- `src/lib/route-access.ts:1-2` + `tests/unit/route-access.test.ts` — każdy plik w `src/pages/` musi mieć wpis w `ROUTE_AUDIENCE`; landing nie dodaje nowych tras, więc nic do zmiany. Nowa trasa (np. `/o-aplikacji`) wymagałaby wpisu i wiersza sondy w `tests/http/route-access.test.ts`.
- `scripts/smoke.mjs:39` — „home renders”: `GET /` → 200. Landing musi pozostać renderowany bez sesji.
- `tests/http/client.ts:174-175`, `scripts/smoke.mjs:52-55` — oczekują signin → `/`. Zostawienie tego przekierowania nie wymaga zmian w testach.
- e2e (`tests/e2e/*.spec.ts`, `auth.setup.ts`) nie wchodzą na `/` jako cel asercji; `auth.setup.ts:22` czeka na URL ≠ `/auth/signin` (wg workera).
- `context/foundation/test-plan.md:171` — testy wyglądu (snapshoty, visual diff) są świadomie poza zakresem; landing nie wymaga nowego e2e.

## Code References

- `src/pages/index.astro:1-8` — obecna strona główna
- `src/components/Welcome.astro:5,22,33,39,45` — szablon startowy (tło, h1, CTA, siatka 3 kart)
- `src/layouts/Layout.astro:10,14` — domyślny tytuł i `lang="en"`
- `src/components/Topbar.astro:2,10,22-29` — auth-aware pasek, mieszany język
- `src/styles/global.css` — tokeny, `bg-cosmic`, wariant `dark`
- `src/components/ui/button.tsx` — jedyny komponent shadcn
- `src/pages/dashboard.astro:21+` — wzorzec szklanego panelu i CTA
- `src/pages/api/auth/signin.ts:19` — przekierowanie po zalogowaniu na `/`
- `src/lib/route-access.ts:11` — `/` jako `public`
- `src/middleware.ts:19-21` — ochrona tras autora
- `scripts/smoke.mjs:39,52-57` — smoke: `/` 200, signin/signout → `/`
- `tests/http/route-access.test.ts:27`, `tests/http/client.ts:174-175` — sondy `/` i asercja przekierowania

## Architecture Insights

- Strony to Astro SSR (Cloudflare Workers) z wyspami React tylko tam, gdzie potrzebna interakcja. Landing jest statyczną treścią + warunek na `Astro.locals.user` → czyste `.astro`, zero JS po stronie klienta.
- Stylistyka żyje w klasach utility powtarzanych inline (brak wspólnego komponentu karty). Bento z 6–7 kafelkami to dobry moment na mały lokalny komponent (np. `src/components/landing/FeatureTile.astro`) zamiast kopiowania klas.
- Tokeny shadcn i rzeczywisty wygląd stron się rozjechały — to temat dla ewentualnego `/10x-ui`, nie dla tej zmiany.

## Historical Context (from prior changes)

- Żadna zarchiwizowana zmiana nie dotykała `index.astro`/`Welcome.astro` (tytuły w `context/archive/*/change.md` dotyczą modelu danych, badań, głosowania, wyników, testów, CI).
- `context/foundation/roadmap.md:239` — M-1 zamknięty 2026-10-19; ta zmiana jest poza roadmapą.

## Related Research

Nie dotyczy — brak wcześniejszych badań nad stroną główną.

## Open Questions

Decyzje produktowe dla `/10x-plan` (nie fakty do odkrycia):

1. **Język i nazwa** — landing po polsku z marką „ThisOrThat”? Czy przy okazji ujednolicić `lang="pl"` w `Layout.astro:14` i angielskie stringi w `Topbar.astro:22-29` (wpływa na wszystkie strony — może osobna zmiana)?
2. **Zalogowany użytkownik na `/`** — ten sam landing z CTA „Twoje badania” (bez zmian w testach) czy przekierowanie na `/dashboard` (wymaga zmiany `signin.ts:19` lub middleware i aktualizacji smoke/HTTP testów)?
3. **Zakres kafelków** — które z 7 grup powyżej i który jest „dużym” kafelkiem bento (sugestia: pętla „jeden link = jeden głos” / wyniki na żywo).
4. **Elementy wizualne w kafelkach** — tylko ikony lucide + tekst, czy mini-makiety (np. statyczny ranking „X z N”)? Brak obrazów w `public/` poza faviconem.
5. **Sprzątanie** — usunąć `Welcome.astro`, `LibBadge.astro`, `public/template.png` (ten ostatni używany w README)?
6. **SEO** — dodać `description`/OG do `Layout` (prop opcjonalny) czy poza zakresem?
