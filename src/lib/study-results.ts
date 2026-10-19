import type { Database } from "@/lib/database.types";

type StudyStatus = Database["public"]["Enums"]["study_status"];
type VariantKind = Database["public"]["Enums"]["variant_kind"];

/** One variant of get_study_results (docs/reference/contract-surfaces.md#get_study_results). */
export interface ResultVariant {
  variant_id: string;
  position: number;
  kind: VariantKind;
  /** The text, or for an image variant its description. */
  content: string;
  /** Object name of an image variant (null for text). Not rendered: the page signs it once, in SSR. */
  image_path: string | null;
  vote_count: number;
  /** Sorted by body by the database (anonymity rule) — render in the order received. */
  comments: string[];
}

/** The jsonb returned by get_study_results (docs/reference/contract-surfaces.md#get_study_results). */
export interface StudyResults {
  status: StudyStatus;
  /** Count of used links. */
  responded: number;
  /** Count of links — the live N of „Odpowiedziało X z N”. */
  total: number;
  variants: ResultVariant[];
}

export type RankedVariant = ResultVariant & { place: number };

const STATUSES: readonly StudyStatus[] = ["draft", "active", "closed"];

/** Narrows get_study_results' jsonb to the contract shape; `null` when it does not match. */
export function parseStudyResults(value: unknown): StudyResults | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { status, responded, total, variants } = value as Record<string, unknown>;
  if (
    typeof status !== "string" ||
    !(STATUSES as readonly string[]).includes(status) ||
    typeof responded !== "number" ||
    typeof total !== "number" ||
    !Array.isArray(variants)
  ) {
    return null;
  }
  const parsed: ResultVariant[] = [];
  for (const item of variants as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { variant_id, position, kind, content, image_path, vote_count, comments } = item as Record<string, unknown>;
    if (
      typeof variant_id !== "string" ||
      typeof position !== "number" ||
      typeof content !== "string" ||
      typeof vote_count !== "number" ||
      !Array.isArray(comments) ||
      !(comments as unknown[]).every((comment) => typeof comment === "string")
    ) {
      return null;
    }
    // A text variant carries no path; an image variant always has one.
    const shape =
      kind === "text" && image_path === null
        ? { kind: "text" as const, image_path }
        : kind === "image" && typeof image_path === "string"
          ? { kind: "image" as const, image_path }
          : null;
    if (!shape) return null;
    parsed.push({ variant_id, position, ...shape, content, vote_count, comments: comments as string[] });
  }
  return { status: status as StudyStatus, responded, total, variants: parsed };
}

/**
 * Ranks variants: `vote_count` descending, then `position` ascending. Place = 1 + number of
 * variants with a strictly greater `vote_count` (5, 5, 2, 0 → 1, 1, 3, 4). Returns a new array.
 */
export function rankVariants(variants: readonly ResultVariant[]): RankedVariant[] {
  return [...variants]
    .sort((a, b) => b.vote_count - a.vote_count || a.position - b.position)
    .map((variant) => ({
      ...variant,
      place: 1 + variants.filter((other) => other.vote_count > variant.vote_count).length,
    }));
}

/** Polish vote count: „1 głos”, „2 głosy”, „5 głosów”, „12 głosów”, „22 głosy”, „0 głosów”. */
export function formatVotes(n: number): string {
  if (n === 1) return "1 głos";
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${String(n)} głosy`;
  return `${String(n)} głosów`;
}
