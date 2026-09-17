---
project: "ThisOrThat"
version: 1
status: draft
created: 2026-09-16
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: "# TODO: target_scale.qps — see Open Questions"
  data_volume: "# TODO: target_scale.data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-10-31
  after_hours_only: true
---

# ThisOrThat — PRD

## Vision & Problem Statement

Osoba z zespołu produktowego ma kilka wariantów treści (wording, przycisk CTA, grafika) i chce sprawdzić je na zamkniętej grupie, zanim pójdzie z nimi dalej. Dziś robi to ręcznie — mailem lub innym kanałem, zależnie od firmy. Koszt: odpowiedzi trzeba ręcznie zbierać, zliczać i porównywać; nie ma kontroli nad grupą (kto odpowiedział, ile brakuje, czy ktoś głosował dwa razy); przez pracochłonność badanie często jest pomijane.

Wgląd: ogólne narzędzia (formularze, komunikatory) działają, ale badanie wariantów można uprościć do minimum w dedykowanej aplikacji. Deklarowane preferencje zamkniętej grupy są tanim filtrem przed testem A/B — test A/B mierzy zachowanie użytkowników, to narzędzie pozwala odsiać słabe warianty, zanim trafią do kosztownego testu na produkcji.

## User & Persona

### Primary persona
Osoba z zespołu produktowego (np. UX writer, product owner, designer) w firmie, która testuje warianty treści testami A/B. Pracuje na własnym koncie i własnych badaniach (bez zespołów/przestrzeni firmowych w MVP). Sięga po produkt, gdy ma gotowe warianty i chce je wstępnie sprawdzić przed testem A/B lub przed pokazaniem ich dalej.

### Secondary persona
Uczestnicy badania: osoby wskazane przez autora badania (np. współpracownicy, zaufane osoby), którym sam rozsyła linki.

## Success Criteria

### Primary
- Autor tworzy badanie z wariantami tekstowymi/graficznymi i dostaje N linków; uczestnicy głosują przez linki (z opcjonalnymi komentarzami przy wariantach); autor widzi ranking wariantów, komentarze i postęp X z N.

### Secondary
- Szybkie badanie: stworzenie badania i skopiowanie linków zajmuje autorowi kilka minut.

### Guardrails
- Jeden link = jeden głos: nie da się zagłosować dwa razy tym samym linkiem ani po zamknięciu badania.

## User Stories

### US-01: Autor przeprowadza badanie wariantów

- **Given** zalogowany autor z przygotowanymi wariantami (tekst/obrazek)
- **When** tworzy badanie, ustala N, klika „Rozpocznij” i rozsyła linki, a uczestnicy głosują przez nie (z opcjonalnymi komentarzami)
- **Then** widzi ranking wariantów, komentarze przy wariantach i postęp X z N

#### Acceptance Criteria
- Każdy link pozwala oddać dokładnie jeden głos
- Po wysłaniu uczestnik widzi „Dziękujemy za udział w badaniu”
- Po wykorzystaniu wszystkich N linków badanie się zamyka

## Functional Requirements

### Konto
- FR-001: Autor może założyć konto i zalogować się e-mailem i hasłem. Priority: must-have
  > Socrates: Counter-argument considered: „reset hasła to dodatkowa praca (odzyskiwanie hasła, wysyłka maili)”. Resolution: kept; odzyskiwanie hasła poza MVP.
- FR-002: Autor widzi dashboard jako prostą listę swoich badań ze statusem (szkic / trwa / zamknięte) i postępem X z N. Priority: must-have
  > Socrates: Counter-argument considered: „autor prowadzi naraz 1–2 badania, rozbudowany dashboard jest zbędny”. Resolution: revised; dashboard uproszczony do listy badań ze statusem.

### Tworzenie i zarządzanie badaniem
- FR-003: Autor może stworzyć badanie w kreatorze, dodając kilka wariantów tekstowych lub graficznych. Priority: must-have
  > Socrates: Counter-arguments offered: „obrazki podwajają pracę”, „mieszanie tekstu i obrazka w jednym badaniu”. Resolution: kept as written.
- FR-004: Autor może ustalić liczbę uczestników N. Priority: must-have
  > Socrates: Counter-arguments offered: „N zbędne przy dogenerowaniu linków”, „zbyt małe N daje przypadkowy wynik”. Resolution: kept as written.
- FR-005: Autor może rozpocząć badanie, co generuje N jednorazowych linków. Priority: must-have
  > Socrates: Counter-argument offered: „rozsyłanie N różnych linków jest uciążliwe”. Resolution: kept as written.
- FR-006: Autor może łatwo skopiować wygenerowane linki. Priority: must-have
  > Socrates: Counter-argument offered: „wklejenie całej listy do wspólnego czatu pozwala użyć cudzego linku”. Resolution: kept as written; autor odpowiada za rozesłanie.
- FR-017: Autor może edytować badanie przed jego rozpoczęciem. Priority: must-have
  > Socrates: Counter-argument offered: „szkic to osobny stan; można usunąć i stworzyć od nowa”. Resolution: kept as written.
- FR-018: Autor może usunąć badanie. Priority: must-have
  > Socrates: Counter-argument offered: „usunięcie trwającego badania psuje linki uczestnikom”. Resolution: kept as written (komunikat dla uczestnika pokrywa FR-010).
- FR-019: Autor może dogenerować dodatkowe linki w trwającym badaniu; zamkniętego badania nie da się rozszerzyć. Priority: must-have
  > Socrates: Counter-argument considered: „koliduje z automatycznym zamknięciem po wykorzystaniu N linków”. Resolution: revised; dogenerowanie tylko w trwającym badaniu.

### Głosowanie
- FR-007: Uczestnik może otworzyć link bez konta i zobaczyć warianty. Priority: must-have
  > Socrates: Counter-argument offered: „link można przekazać dalej, grupa przestaje być zamknięta”. Resolution: kept as written.
- FR-008: Uczestnik może wybrać jeden wariant. Priority: must-have
  > Socrates: Counter-argument offered: „jeden głos gubi informację przy bliskich wariantach”. Resolution: kept as written.
- FR-009: Uczestnik może zostawić opcjonalny komentarz przy każdym wariancie. Priority: must-have
  > Socrates: Counter-argument offered: „pola przy każdym wariancie przytłaczają na telefonie”. Resolution: kept as written.
- FR-010: Uczestnik po wysłaniu widzi podziękowanie; po ponownym otwarciu zużytego linku widzi „Twój głos został już oddany”, a przy zamkniętym lub usuniętym badaniu „Badanie jest zakończone”. Priority: must-have
  > Socrates: Counter-argument considered: „ponowne otwarcie linku jest niejasne”. Resolution: revised; dodane komunikaty dla zużytego linku i zamkniętego/usuniętego badania.

### Wyniki i zamykanie
- FR-011: Autor widzi ranking wariantów wg liczby głosów; warianty z równą liczbą głosów dzielą miejsce. Priority: must-have
  > Socrates: Counter-argument considered: „remis nie jest obsłużony, częsty przy małych grupach”. Resolution: revised; remis = wspólne miejsce, brak jednego zwycięzcy.
- FR-012: Autor widzi anonimowe komentarze pogrupowane przy wariantach. Priority: must-have
  > Socrates: Counter-argument offered: „komentarz bez kontekstu, na co głosował autor komentarza”. Resolution: kept as written.
- FR-013: Autor widzi postęp „odpowiedziało X z N” i wyniki na żywo w trakcie badania. Priority: must-have
  > Socrates: Counter-argument offered: „wczesne wyniki mylą i skłaniają do przedwczesnego zamknięcia”. Resolution: kept as written.
- FR-014: Badanie zamyka się automatycznie po wykorzystaniu wszystkich N linków. Priority: must-have
  > Socrates: Counter-argument considered: „badanie nigdy się nie zamknie, gdy ktoś nie zagłosuje”. Resolution: kept; ten przypadek pokrywają FR-015 i FR-016.
- FR-015: Autor może ręcznie zamknąć badanie. Priority: must-have
  > Socrates: Counter-argument offered: „przypadkowe zamknięcie jest nieodwracalne”. Resolution: kept as written.
- FR-016: Autor może ustawić termin (dzień + godzina w strefie czasowej autora), po którym badanie się zamyka. Priority: must-have
  > Socrates: Counter-argument considered: „termin wymaga ustalenia godziny i strefy czasowej”. Resolution: revised; dzień + godzina w strefie czasowej autora.

## Non-Functional Requirements

- Ekran głosowania uczestnika jest w pełni używalny na smartfonie.
- Autor nie może w żadnym widoku powiązać głosu ani komentarza z konkretną osobą lub konkretnym linkiem.
- Warianty badania (w tym niepublikowane grafiki) są dostępne wyłącznie dla autora badania i osób z ważnym linkiem do tego badania; żaden autor nie ma dostępu do badań ani wyników innego autora.

## Business Logic

Aplikacja przyjmuje z każdego jednorazowego linku dokładnie jeden głos tylko w trwającym badaniu i na tej podstawie układa ranking wariantów wg liczby głosów, który jest niewiążącą wskazówką dla autora.

O wyniku decyduje liczba głosów. Wynik i komentarze uczestników są interpretowane przez autora i nie są wiążące — to tylko badanie. Przy równej liczbie głosów warianty dzielą miejsce.

Badanie przechodzi przez etapy: **szkic → trwa → zamknięte**. W szkicu autor może edytować badanie, głosowanie nie jest możliwe. „Rozpocznij” generuje N linków i otwiera głosowanie; w trwającym badaniu linki przyjmują głosy, a autor może dogenerować dodatkowe linki. Badanie zamyka się po wykorzystaniu wszystkich linków, ręcznie przez autora lub po terminie (dzień + godzina w strefie czasowej autora); zamknięte badanie nie przyjmuje głosów ani edycji, wyniki pozostają widoczne.

Uczestnik, który otworzy zużyty link, widzi „Twój głos został już oddany”; przy zamkniętym lub usuniętym badaniu — „Badanie jest zakończone”.

## Access Control

- **Autor badania**: logowanie e-mail + hasło. Jedna rola (brak admina w MVP). Każdy zalogowany autor widzi i zarządza wyłącznie własnymi badaniami.
- **Uczestnik badania**: bez konta. Wchodzi przez jednorazowy link z kluczem. Autor ustala liczebność grupy N, aplikacja generuje N unikalnych linków; każdy link pozwala oddać jeden głos.
- **Anonimowość**: głosy i komentarze są anonimowe dla autora — widzi wyniki, ale nie wie, kto je oddał.
- Niezalogowany użytkownik nie ma dostępu do tworzenia badań ani wyników.

## Non-Goals

- Brak odzyskiwania hasła — decyzja z rundy Socrates dla FR-001; oszczędza obsługę resetu i wysyłki maili.
- Brak wysyłki linków z aplikacji — autor sam kopiuje i rozsyła linki.
- Brak zespołów i współdzielenia badań — pojedynczy autor, tylko własne badania.
- Brak danych o uczestnikach i analityki — bez demografii, segmentacji, wykresów i eksportu; tylko ranking, komentarze i postęp.
- Brak integracji z narzędziami do testów A/B — narzędzie działa samodzielnie, przed testem A/B.

## Open Questions

1. **Jak zmieniłaby się reguła przy skali 100× (np. tysiące linków w jednym badaniu)?** — Owner: user. Odpowiedź w sesji planistycznej: „nie wiem”. Block: no (skala MVP: kilkadziesiąt–sto osób).
2. **Jaki jest orientacyjny ruch (`target_scale.qps`) i wolumen danych (`target_scale.data_volume`), w tym liczba i rozmiar wgrywanych grafik?** — Owner: user. Nie ustalone w notatkach. Block: no.
