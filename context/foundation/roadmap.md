---
project: "ThisOrThat"
version: 1
status: draft
created: 2026-09-22
updated: 2026-10-19
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: mvp-study-lifecycle
milestone_seq: 1
milestone_status: open
---

# Roadmap: ThisOrThat

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: MVP — pełny cykl życia badania** (`mvp-study-lifecycle`) — Status: open

- **Intent:** Autor może przeprowadzić badanie wariantów od stworzenia szkicu, przez rozesłanie jednorazowych linków i anonimowe głosowanie, po ranking z komentarzami i zamknięcie badania. Kamień milowy dowozi całą ścieżkę konieczną z PRD.
- **Source materials:** `context/foundation/prd.md` (v1); wejścia pomocnicze: `context/foundation/tech-stack.md`, `context/foundation/infrastructure.md`, `context/deployment/deploy-plan.md`.
- **Done when:** każdy `F-NN` i `S-NN` poniżej ma status `done`.
- **Scope anchors:** FR-001 – FR-019 (wszystkie oznaczone jako „konieczne"), US-01, trzy wymagania pozafunkcjonalne oraz sekcja Access Control z PRD.

## Vision recap

Osoba z zespołu produktowego ma kilka wariantów treści (wording, CTA, grafika) i chce je sprawdzić na zamkniętej grupie, zanim pójdzie z nimi dalej. Dziś robi to ręcznie — mailem albo na czacie — i sama zlicza odpowiedzi, przez co badanie bywa pomijane.

ThisOrThat sprowadza to do minimum: autor tworzy badanie, dostaje N jednorazowych linków, rozsyła je sam, a aplikacja przyjmuje z każdego linku dokładnie jeden głos i układa ranking. Deklarowane preferencje zamkniętej grupy są tanim filtrem przed testem A/B — pozwalają odsiać słabe warianty, zanim trafią do kosztownego testu na produkcji.

To, co odróżnia produkt od zwykłego formularza, to dwie rzeczy naraz: kontrola nad grupą (jeden link = jeden głos, widoczny postęp „X z N") przy jednoczesnej anonimowości — autor widzi wyniki, ale w żadnym widoku nie może powiązać głosu ani komentarza z konkretną osobą czy konkretnym linkiem.

## North star

**S-03: Autor widzi na żywo ranking wariantów, anonimowe komentarze i postęp „X z N"** — to moment, w którym pętla badania domyka się po raz pierwszy i Kryterium sukcesu (primary) z PRD jest spełnione w całości.

> „Gwiazda przewodnia" znaczy tu: najmniejszy fragment działający od końca do końca, którego dowiezienie udowadnia, że produkt w ogóle spełnia swoją obietnicę — dlatego stawiamy go tak wcześnie, jak pozwalają na to wymagania wstępne, bo reszta zakresu ma sens tylko wtedy, gdy ten fragment działa. Kolejność `S-01 → S-02 → S-03` jest najkrótszą drogą do tego punktu; `S-01` i `S-02` nie są odrębnymi celami, tylko dwoma etapami dojścia do niego.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                                                    | Prerequisites | PRD refs                                        | Status      |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------- | ----------- |
| F-01 | `study-data-model`          | (foundation) najmniejszy model danych jednej pętli badania + polityki dostępu z wbudowaną anonimowością | —             | NFR §anonimowość, NFR §izolacja, Access Control | done        |
| S-01 | `create-and-start-study`    | Autor tworzy badanie tekstowe, ustala N, startuje je i kopiuje N jednorazowych linków                   | F-01          | US-01, FR-003, FR-004, FR-005, FR-006           | done        |
| S-02 | `one-time-link-voting`      | Uczestnik bez konta otwiera link, wybiera wariant, opcjonalnie komentuje i widzi podziękowanie          | S-01          | US-01, FR-007, FR-008, FR-009, FR-010           | done        |
| S-03 | `live-results-and-comments` | Autor widzi na żywo ranking (z remisami), anonimowe komentarze przy wariantach i postęp „X z N"         | S-02          | US-01, FR-011, FR-012, FR-013                   | done        |
| S-04 | `study-closing-rules`       | Autor zamyka badanie — automatycznie po N głosach, ręcznie albo po ustawionym terminie                  | S-02          | US-01, FR-014, FR-015, FR-016, FR-010           | done        |
| S-05 | `author-study-dashboard`    | Autor widzi listę swoich badań ze statusem i postępem „X z N"                                           | S-02          | FR-002, FR-001                                  | done        |
| S-06 | `edit-and-delete-study`     | Autor edytuje szkic badania przed startem i usuwa badanie                                               | S-05          | FR-017, FR-018, FR-010                          | done        |
| S-07 | `generate-extra-links`      | Autor dogenerowuje dodatkowe linki w trwającym badaniu                                                  | S-01, S-04    | FR-019                                          | done        |
| S-08 | `image-variants`            | Autor dodaje warianty graficzne, a uczestnik ogląda je na telefonie                                     | S-01, S-02    | FR-003, NFR §mobile, NFR §izolacja              | in-progress |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                             | Note                                                                                          |
| ------ | ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------- |
| A      | Rdzeń pętli badania            | `F-01` → `S-01` → `S-02` → `S-03` | Najkrótsza droga do gwiazdy przewodniej; przy celu `speed` nic nie wchodzi przed tym ciągiem. |
| B      | Domykanie badania              | `S-04` → `S-07`                   | Dołącza do strumienia A przy `S-02`. `S-04` domyka kryteria akceptacji US-01.                 |
| C      | Zarządzanie własnymi badaniami | `S-05` → `S-06`                   | Dołącza do strumienia A przy `S-02`. Edycja i usuwanie sięgane są z listy badań.              |
| D      | Warianty graficzne             | `S-08`                            | Dołącza do strumienia A przy `S-02`; jedyny plasterek dokładający magazyn plików.             |

## Baseline

What's already in place in the codebase as of `2026-09-22` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 + TypeScript + Tailwind 4, komponenty w stylu shadcn (`src/components/ui/button.tsx`), wspólny układ w `src/layouts/Layout.astro`.
- **Backend / API:** present — Astro SSR na adapterze Cloudflare; istnieją wyłącznie trasy uwierzytelniania (`src/pages/api/auth/{signup,signin,signout}.ts`), brak tras domenowych.
- **Data:** **absent** — katalog `supabase/` zawiera tylko `config.toml`; brak `supabase/migrations/`, brak schematu domenowego (badanie, wariant, link, głos, komentarz), brak polityk dostępu po stronie bazy, brak magazynu na grafiki.
- **Auth:** present — e-mail + hasło przez `@supabase/ssr`; `src/middleware.ts:4` chroni `/dashboard`, ciasteczka sesji `secure` poza trybem deweloperskim. **Pokrywa FR-001 w całości** (odzyskiwanie hasła jest poza zakresem — PRD §Non-Goals).
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`, nazwa `thisorthat`), GitHub Actions `ci.yml` + `deploy.yml`, wdrożenie produkcyjne wykonane (commit `bb34316`).
- **Observability:** partial — włączona telemetria platformy Cloudflare (`wrangler.jsonc:18`), czyli wyłącznie logi platformy. Brak śledzenia błędów i logowania na poziomie aplikacji; przy celu `speed` i braku wymagania pozafunkcjonalnego w tym obszarze nie otwieramy na to osobnego elementu.

`src/pages/dashboard.astro` jest obecnie zaślepką (pokazuje e-mail i przycisk wylogowania) — podmienia ją `S-05`.

## Foundations

### F-01: Model danych jednej pętli badania i polityki dostępu

- **Outcome:** (foundation) w bazie istnieje najmniejszy zestaw encji potrzebny do przeprowadzenia jednej pętli badania — badanie, wariant, jednorazowy link, głos, komentarz — wraz z politykami dostępu wymuszającymi izolację między autorami oraz takim kształtem zapisu głosu, przy którym autor z założenia nie jest w stanie powiązać głosu ani komentarza z konkretnym linkiem. Uruchomiony jest też obieg migracji (`supabase/migrations/`), którego w repo dotąd nie było.
- **Change ID:** `study-data-model`
- **PRD refs:** NFR §anonimowość, NFR §izolacja danych, sekcja Access Control, Business Logic (etapy szkic → trwa → zamknięte)
- **Unlocks:** `S-01`, `S-02`, `S-03` (żaden nie ma gdzie zapisać danych bez tego); redukuje niewiadomą „jak pogodzić jednorazowość linku z anonimowością głosu"; udostępnia ścieżkę weryfikacji wymaganą przez `S-02` i `S-03` — dowód, że zapytanie autora o wyniki nie jest w stanie zwrócić powiązania głos↔link.
- **Prerequisites:** — (uwierzytelnianie autora jest już obecne w baseline i stanowi punkt zaczepienia polityk dostępu)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Jak zapisać zużycie jednorazowego linku i sam głos tak, żeby jedno nie pozwalało odtworzyć drugiego (link musi być oznaczalny jako zużyty, a głos musi pozostać nieprzypisywalny)? — Owner: user. Block: no.
- **Risk:** Stoi na początku, bo anonimowość i izolacja to ograniczenia modelu, nie warstwa prezentacji — dołożone po fakcie wymagałyby przepisania zapisu głosów i wszystkich zapytań o wyniki. Ryzyko przeciwne: przerost zakresu. Element ma objąć wyłącznie encje pętli `S-01`–`S-03`; termin zamknięcia (`S-04`), dogenerowane linki (`S-07`) i magazyn grafik (`S-08`) rozszerzają schemat dopiero w swoich plasterkach.
- **Status:** done

## Slices

### S-01: Autor tworzy badanie tekstowe i rozpoczyna je

- **Outcome:** Autor może stworzyć w kreatorze badanie z kilkoma wariantami tekstowymi, ustalić liczbę uczestników N, kliknąć „Rozpocznij" i skopiować wygenerowane N jednorazowych linków.
- **Change ID:** `create-and-start-study`
- **PRD refs:** US-01, FR-003 (część tekstowa), FR-004, FR-005, FR-006
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Jaka jest górna granica liczby wariantów w badaniu i górna granica N?~~ — Resolved 2026-10-05: **warianty 2–6** (min. 2, bo z jednym nie ma czego porównywać; maks. 6, bo ekran głosowania z komentarzem przy każdym wariancie musi być czytelny na telefonie); **N 1–100** (min. 1 zgodnie z FR-004; maks. 100, bo autor rozsyła każdy link ręcznie, a grupa jest zamknięta). Limit N dotyczy łącznej liczby linków w badaniu, więc obowiązuje też dogenerowanie w `S-07`. Limity trzymane jako nazwane stałe, łatwe do podniesienia.
- **Risk:** Sedno ryzyka to przejście szkic → trwa: „Rozpocznij" jest nieodwracalne i musi wygenerować dokładnie N niezgadywalnych kluczy w jednej operacji. Częściowe wygenerowanie linków zostawiłoby badanie w stanie niespójnym z FR-014.
- **Status:** done

### S-02: Uczestnik oddaje głos przez jednorazowy link

- **Outcome:** Uczestnik bez konta może otworzyć otrzymany link, zobaczyć warianty, wybrać jeden, opcjonalnie dopisać komentarz przy każdym wariancie i po wysłaniu zobaczyć podziękowanie; po ponownym otwarciu zużytego linku widzi „Twój głos został już oddany".
- **Change ID:** `one-time-link-voting`
- **PRD refs:** US-01, FR-007, FR-008, FR-009, FR-010 (podziękowanie i komunikat o zużytym linku; komunikaty dla badania zamkniętego i usuniętego dochodzą w `S-04` i `S-06`)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy pola komentarzy przy każdym wariancie mieszczą się czytelnie na ekranie telefonu, czy potrzebują zwijania? — Owner: user. Block: no.
- **Risk:** Tu żyje gwarancja produktu („jeden link = jeden głos"). Dwa równoległe wysłania tego samego linku nie mogą dać dwóch głosów, a ekran musi być w pełni używalny na smartfonie — to jedyne wymaganie pozafunkcjonalne dotyczące wyglądu w całym PRD.
- **Status:** done

### S-03: Autor widzi wyniki badania na żywo

- **Outcome:** Autor może oglądać ranking wariantów według liczby głosów (warianty z równą liczbą głosów dzielą miejsce), anonimowe komentarze pogrupowane przy wariantach oraz postęp „odpowiedziało X z N", aktualizowane w trakcie trwania badania.
- **Change ID:** `live-results-and-comments`
- **PRD refs:** US-01, FR-011, FR-012, FR-013
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To jest gwiazda przewodnia i zarazem ostatnie miejsce, w którym anonimowość może się zepsuć: kolejność komentarzy albo znacznik czasu potrafią odtworzyć powiązanie z konkretnym linkiem nawet wtedy, gdy schemat z `F-01` jest poprawny. Weryfikacja z `F-01` musi objąć również widok wyników, nie tylko zapis.
- **Status:** done

### S-04: Autor zamyka badanie

- **Outcome:** Badanie zamyka się automatycznie po wykorzystaniu wszystkich N linków; autor może je zamknąć ręcznie w dowolnym momencie albo ustawić termin (dzień + godzina w swojej strefie czasowej), po którym badanie się zamyka. Zamknięte badanie nie przyjmuje głosów, a uczestnik widzi „Badanie jest zakończone"; wyniki pozostają widoczne dla autora.
- **Change ID:** `study-closing-rules`
- **PRD refs:** US-01, FR-014, FR-015, FR-016, FR-010 (komunikat dla badania zamkniętego)
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-05, S-06, S-08
- **Blockers:** —
- **Unknowns:**
  - Termin jest oceniany leniwie — przy otwarciu linku lub strony wyników (`tech-stack.md`: brak zadań w tle). Czy badanie po terminie, którego nikt nie otworzył, może figurować jako „trwa" do pierwszego otwarcia? — Owner: user. Block: no.
- **Risk:** Trzy niezależne drogi do tego samego stanu końcowego (wyczerpanie linków, ręczne zamknięcie, termin) muszą zbiegać się do jednej reguły, inaczej badanie da się zamknąć dwa razy lub przyjąć głos w trakcie zamykania. Ręczne zamknięcie jest nieodwracalne — PRD świadomie to akceptuje (runda Socrates przy FR-015).
- **Status:** done

### S-05: Autor widzi listę swoich badań

- **Outcome:** Autor po zalogowaniu widzi prostą listę wyłącznie swoich badań ze statusem (szkic / trwa / zamknięte) i postępem „X z N", z której wchodzi w konkretne badanie.
- **Change ID:** `author-study-dashboard`
- **PRD refs:** FR-002, FR-001 (konto jest już zrealizowane w baseline — ten plasterek podmienia zaślepkę `src/pages/dashboard.astro` na docelową listę)
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwsze miejsce, w którym izolacja między autorami jest widoczna dla użytkownika — zapytanie o listę musi opierać się na politykach z `F-01`, a nie na filtrowaniu po stronie aplikacji. Poza tym plasterek jest celowo płytki: PRD świadomie ograniczył dashboard do listy (runda Socrates przy FR-002).
- **Status:** done

### S-06: Autor edytuje szkic i usuwa badanie

- **Outcome:** Autor może edytować badanie, dopóki jest w stanie szkicu, oraz usunąć badanie na dowolnym etapie; uczestnik z linkiem do usuniętego badania widzi „Badanie jest zakończone".
- **Change ID:** `edit-and-delete-study`
- **PRD refs:** FR-017, FR-018, FR-010 (komunikat dla badania usuniętego)
- **Prerequisites:** S-05
- **Parallel with:** S-03, S-04, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Usunięcie trwającego badania psuje linki, które uczestnicy już dostali — PRD akceptuje to świadomie i domyka komunikatem z FR-010. Edycja musi być twardo zablokowana poza stanem szkicu, inaczej autor zmieniłby warianty pod oddanymi już głosami.
- **Status:** done

### S-07: Autor dogenerowuje dodatkowe linki

- **Outcome:** Autor może dogenerować dodatkowe jednorazowe linki w trwającym badaniu (co podnosi N i przesuwa moment automatycznego zamknięcia); badania zamkniętego nie da się rozszerzyć.
- **Change ID:** `generate-extra-links`
- **PRD refs:** FR-019
- **Prerequisites:** S-01, S-04
- **Parallel with:** S-03, S-05, S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zależy od `S-04`, bo cała treść wymagania to rozróżnienie „trwa" od „zamknięte" — bez istniejącej reguły zamykania nie ma czego egzekwować. Dogenerowanie zmienia N w trakcie, więc postęp „X z N" z `S-03` i automatyczne zamknięcie z `S-04` muszą przeliczać się na bieżąco, a nie na wartości zapamiętanej przy starcie.
- **Status:** done

### S-08: Autor używa wariantów graficznych

- **Outcome:** Autor może dodać do badania warianty graficzne zamiast lub obok tekstowych, a uczestnik ogląda je na ekranie telefonu; grafiki są dostępne wyłącznie dla autora badania i osób z ważnym linkiem.
- **Change ID:** `image-variants`
- **PRD refs:** FR-003 (część graficzna), NFR §mobile, NFR §izolacja danych
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Jaki jest limit liczby i rozmiaru wgrywanych grafik na badanie? — Owner: user. Block: no. (Wiąże się z pytaniem 2 w `## Open Roadmap Questions`.)
- **Risk:** Jedyny plasterek dokładający magazyn plików — celowo wchodzi tu, a nie do `F-01`, bo wcześniej nic go nie potrzebuje. Trudna część to dostęp: niepublikowane grafiki muszą być chronione tą samą regułą co reszta badania, więc publiczny odczyt z magazynu jest wykluczony. Przy celu `speed` to najsłabszy kandydat ze ścieżki koniecznej — jeśli termin zacznie uwierać, to pierwszy element do rozmowy z autorem PRD.
- **Status:** in-progress

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                | Issue |
| ---------- | --------------------------- | ------------------------------------------------------------ | --------------------- | ------------------------------------ | ----- |
| F-01       | `study-data-model`          | Model danych pętli badania + polityki dostępu i anonimowość  | yes                   | Uruchom `/10x-plan study-data-model` | #5    |
| S-01       | `create-and-start-study`    | Kreator badania tekstowego, ustalenie N i generowanie linków | no                    | Czeka na `F-01`                      | #6    |
| S-02       | `one-time-link-voting`      | Głosowanie uczestnika przez jednorazowy link z komentarzami  | no                    | Czeka na `S-01`                      | #7    |
| S-03       | `live-results-and-comments` | Ranking na żywo, komentarze przy wariantach i postęp „X z N" | no                    | Czeka na `S-02`; gwiazda przewodnia  | #8    |
| S-04       | `study-closing-rules`       | Zamykanie badania: automatyczne, ręczne i po terminie        | no                    | Czeka na `S-02`                      | #9    |
| S-05       | `author-study-dashboard`    | Lista badań autora ze statusem i postępem                    | no                    | Czeka na `S-02`                      | #10   |
| S-06       | `edit-and-delete-study`     | Edycja szkicu badania i usuwanie badania                     | no                    | Czeka na `S-05`                      | #11   |
| S-07       | `generate-extra-links`      | Dogenerowanie linków w trwającym badaniu                     | no                    | Czeka na `S-01`, `S-04`              | #12   |
| S-08       | `image-variants`            | Warianty graficzne i chroniony magazyn plików                | no                    | Czeka na `S-01`, `S-02`              | #13   |

**Tracker:** GitHub Issues — `dorianopacki/thisorthat`, milestone `M-1: MVP — pełny cykl życia badania`, tablica postępu #14.
Otwarte pytania z sekcji poniżej żyją jako #2, #3, #4. Ten plik pozostaje źródłem prawdy; issues są widokiem operacyjnym.

This table is the clean handoff to Jira/Linear or any MCP-backed backlog. Include one row for every `F-NN` and `S-NN`. It should be compact enough to copy into issues, but it must not duplicate the detailed roadmap body.

## Open Roadmap Questions

1. **Jak zmieniłaby się reguła przy skali 100× (np. tysiące linków w jednym badaniu)?** — Owner: user. Block: `roadmap-wide` (nie blokuje; skala MVP to kilkadziesiąt–sto osób). Przeniesione z PRD §Open Questions 1.
2. **Jaki jest orientacyjny ruch (`target_scale.qps`) i wolumen danych (`target_scale.data_volume`), w tym liczba i rozmiar wgrywanych grafik?** — Owner: user. Block: `S-08` (nie blokuje planowania; bez odpowiedzi `/10x-plan` przyjmie ostrożny limit). Przeniesione z PRD §Open Questions 2.
3. **`tech-stack.md` deklaruje `deployment_target: cloudflare-pages`, a repozytorium wdraża się na Cloudflare Workers (`wrangler.jsonc`, `.github/workflows/deploy.yml`).** Który zapis jest wiążący? — Owner: user. Block: `roadmap-wide` (nie blokuje; żaden plasterek nie dotyka wdrożenia). Wykryte przy badaniu baseline — warto poprawić `tech-stack.md`, zanim `/10x-plan` zacznie z niego czytać.

## Parked

- **Odzyskiwanie hasła** — Why parked: PRD §Non-Goals; decyzja z rundy Socrates dla FR-001, oszczędza obsługę resetu i wysyłki maili.
- **Wysyłka linków z aplikacji** — Why parked: PRD §Non-Goals; autor sam kopiuje i rozsyła linki.
- **Zespoły i współdzielenie badań** — Why parked: PRD §Non-Goals; MVP obsługuje pojedynczego autora i wyłącznie jego badania.
- **Dane o uczestnikach i analityka (demografia, segmentacja, wykresy, eksport)** — Why parked: PRD §Non-Goals; zostaje ranking, komentarze i postęp.
- **Integracje z narzędziami do testów A/B** — Why parked: PRD §Non-Goals; narzędzie działa samodzielnie, przed testem A/B.
- **Śledzenie błędów i logowanie na poziomie aplikacji** — Why parked: żadne wymaganie pozafunkcjonalne tego nie wymusza, a telemetria platformy Cloudflare jest już włączona; przy celu `speed` nie wchodzi do tego kamienia milowego.

## Milestone History

(Append-only. Empty on the first milestone.)

## Done

- **F-01: (foundation) w bazie istnieje najmniejszy zestaw encji potrzebny do przeprowadzenia jednej pętli badania — badanie, wariant, jednorazowy link, głos, komentarz — wraz z politykami dostępu wymuszającymi izolację między autorami oraz takim kształtem zapisu głosu, przy którym autor z założenia nie jest w stanie powiązać głosu ani komentarza z konkretnym linkiem. Uruchomiony jest też obieg migracji (`supabase/migrations/`), którego w repo dotąd nie było.** — Archived 2026-10-02 → `context/archive/2026-10-02-study-data-model/`. Lesson: —.
- **S-01: Autor może stworzyć w kreatorze badanie z kilkoma wariantami tekstowymi, ustalić liczbę uczestników N, kliknąć „Rozpocznij" i skopiować wygenerowane N jednorazowych linków.** — Archived 2026-10-05 → `context/archive/2026-10-05-create-and-start-study/`. Lesson: —.
- **S-02: Uczestnik bez konta może otworzyć otrzymany link, zobaczyć warianty, wybrać jeden, opcjonalnie dopisać komentarz przy każdym wariancie i po wysłaniu zobaczyć podziękowanie; po ponownym otwarciu zużytego linku widzi „Twój głos został już oddany".** — Archived 2026-10-06 → `context/archive/2026-10-05-one-time-link-voting/`. Lesson: —.
- **S-03: Autor może oglądać ranking wariantów według liczby głosów (warianty z równą liczbą głosów dzielą miejsce), anonimowe komentarze pogrupowane przy wariantach oraz postęp „odpowiedziało X z N", aktualizowane w trakcie trwania badania.** — Archived 2026-10-06 → `context/archive/2026-10-06-live-results-and-comments/`. Lesson: —.
- **S-04: Badanie zamyka się automatycznie po wykorzystaniu wszystkich N linków; autor może je zamknąć ręcznie w dowolnym momencie albo ustawić termin (dzień + godzina w swojej strefie czasowej), po którym badanie się zamyka. Zamknięte badanie nie przyjmuje głosów, a uczestnik widzi „Badanie jest zakończone"; wyniki pozostają widoczne dla autora.** — Archived 2026-10-15 → `context/archive/2026-10-15-study-closing-rules/`. Lesson: —.
- **S-05: Autor po zalogowaniu widzi prostą listę wyłącznie swoich badań ze statusem (szkic / trwa / zamknięte) i postępem „X z N", z której wchodzi w konkretne badanie.** — Archived 2026-10-15 → `context/archive/2026-10-15-author-study-dashboard/`. Lesson: —.
- **S-07: Autor może dogenerować dodatkowe jednorazowe linki w trwającym badaniu (co podnosi N i przesuwa moment automatycznego zamknięcia); badania zamkniętego nie da się rozszerzyć.** — Archived 2026-10-19 → `context/archive/2026-10-16-generate-extra-links/`. Lesson: —.

(Empty on first generation. `/10x-archive` appends entries here.)
