# Paleta marki — wartości, korekty i kontrast

Źródło tokenów w `src/styles/global.css` (`:root`). Ten plik zapisuje, skąd się wzięły, żeby kolejna sesja ich nie wymyślała. Kontrast liczony wzorem WCAG 2.x (luminancja względna), szczegóły w `research.md` § Paleta marki — kontrast.

## Wejście użytkownika (2026-10-20)

| Kolor     | HSL                | Rola w palecie                  |
| --------- | ------------------ | ------------------------------- |
| `#A853CA` | 283°, S 53%, L 56% | brand-1 (fiolet)                |
| `#CA53B0` | 313°, S 53%, L 56% | brand-2 (magenta)               |
| `#CA5375` | 343°, S 53%, L 56% | brand-3 (róż, blisko czerwieni) |

Trzy odcienie co 30° przy tej samej nasyconości i jasności.

## Kontrast oryginałów

| Kolor     | biały tekst na kolorze | kolor na `#0a0e1a` (dawne tło) |
| --------- | ---------------------- | ------------------------------ |
| `#A853CA` | 4,42                   | 4,36                           |
| `#CA53B0` | 3,91                   | 4,93                           |
| `#CA5375` | 4,20                   | 4,59                           |

Wniosek: żaden oryginał nie przenosi białego tekstu na poziomie AA (4,5:1). Jako tekst na ciemnym tle oryginały dają tylko ok. 3,3–4,6:1 (zależnie od tła), więc **nie służą do tekstu** — linki dostały osobny, jaśniejszy token `--link`. Oryginały zostają jako `--brand-1..3` wyłącznie do gradientów i dekoracji.

## Mapowanie na tokeny

| Token                                    | Wartość                                         | Uzasadnienie / kontrast                                                  |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `--background` / `--background-2`        | `#120B1D` / `#1A1028`                           | ciemny fiolet marki; `bg-cosmic`: background → background-2 → background |
| `--foreground`                           | `#F5F0FA`                                       | 13,3:1 na panelu                                                         |
| `--card` / `--card-foreground`           | `oklch(1 0 0 / 8%)` / `--foreground`            | panel szklany jak dotąd (`white/10`)                                     |
| `--popover` / `--popover-foreground`     | `--background-2` / `--foreground`               | nieprzezroczysta warstwa nad tłem                                        |
| `--secondary` / `--secondary-foreground` | `oklch(1 0 0 / 10%)` / `--foreground`           | neutralna, szklana                                                       |
| `--muted`                                | `oklch(1 0 0 / 5%)`                             | wiersze, tła pomocnicze                                                  |
| `--muted-foreground`                     | `#B8ADC9`                                       | 7,0:1 na panelu, 6,0:1 na wierszu                                        |
| `--primary` / `--primary-foreground`     | `#A74FC9` (`#A853CA` −0,5% L) / `#FFFFFF`       | biały na primary 4,56:1                                                  |
| `--accent` / `--accent-foreground`       | `#C440A8` (`#CA53B0` przyciemniony) / `#FFFFFF` | biały na accent 4,52:1                                                   |
| `--brand-1`, `--brand-2`, `--brand-3`    | `#A853CA`, `#CA53B0`, `#CA5375` (oryginały)     | tylko gradienty i dekoracje, nie pod tekst                               |
| `--link`                                 | `#D3A6E4`                                       | linki na ciemnym tle, 7,3:1 na panelu                                    |
| `--ring`                                 | `#C58CDC`                                       | ≥3:1 na każdym tle (5,0–7,5)                                             |
| `--destructive`                          | `#F87171`                                       | tekst błędu na ciemnym tle, 5,4:1 na panelu; wyraźnie inny niż `brand-3` |
| `--border` / `--input`                   | `oklch(1 0 0 / 15%)` / `oklch(1 0 0 / 20%)`     | jak dotąd `white/10–20`                                                  |

Tokeny `--chart-*` i `--sidebar-*` nie są dziś używane w `src/`; mają wartości dopasowane do ciemnego motywu (chart = dawny zestaw `.dark` shadcn, sidebar = pochodne `background-2`/`primary`/`ring`).

## Uwagi

- Motyw jest jeden i ciemny (`color-scheme: dark` w `:root`); blok `.dark` usunięty.
- `#CA5375` (343°) leży blisko czerwieni — `destructive` celowo jest jaśniejszym, cieplejszym `#F87171`, żeby błąd nie wyglądał jak element marki.
- Biały tekst na `--destructive` ma za mały kontrast; odznaka `destructive` używa ciemnego `text-background`.
