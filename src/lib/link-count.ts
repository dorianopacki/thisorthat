// Parsing for „Dogeneruj linki” (S-07): the `count` field of POST /api/studies/<id>/links and the
// `?added=` the endpoint redirects with. The database is the authority on limits
// (docs/reference/contract-surfaces.md#publicadd_study_links); these only reject what cannot be a count.
import { MAX_PARTICIPANTS } from "@/lib/study-limits";

/** The form's `count` as a whole number 1…MAX_PARTICIPANTS, or null (empty, fractional, signed, out of range). */
export function parseLinkCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return count >= 1 && count <= MAX_PARTICIPANTS ? count : null;
}

/** `?added=k` clamped to 1…total; null when absent, not a whole number, below 1, or there are no links. */
export function parseAddedCount(value: string | null, total: number): number | null {
  if (value === null || total < 1 || !/^\d+$/.test(value.trim())) return null;
  const added = Number(value.trim());
  if (added < 1) return null;
  return Math.min(added, total);
}
