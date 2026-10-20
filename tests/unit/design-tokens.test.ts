import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Views already moved to the design tokens in src/styles/global.css (:root + @theme inline).
// A colour literal or an arbitrary value coming back into one of them fails here and in pre-commit.
// When you clean up another view, add its path below (one line).
const CLEANED_FILES = [
  "src/pages/dashboard.astro",
  "src/components/Topbar.astro",
  "src/components/auth/SubmitButton.tsx",
];

// Same scan as /10x-ui: hex, rgb()/hsl()/oklch(), arbitrary px/rem values, Tailwind palette colour classes.
const LITERAL =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/g;

const HINT =
  "użyj tokenu (bg-primary, bg-card, bg-muted, text-foreground, text-muted-foreground, text-link, text-destructive, border-border, ring-ring …), patrz src/styles/global.css";

function findLiterals(file: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");
  return source
    .split(/\r?\n/)
    .flatMap((line, index) => [...line.matchAll(LITERAL)].map((m) => `${file}:${index + 1}: "${m[0]}" — ${HINT}`));
}

describe("design tokens in cleaned views", () => {
  it.each(CLEANED_FILES)("%s has no colour literals or arbitrary values", (file) => {
    expect(findLiterals(file)).toEqual([]);
  });
});
