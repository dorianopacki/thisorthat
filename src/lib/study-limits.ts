// Mirrors the limits the database enforces; keep in sync with
// supabase/migrations/20261005075735_create_and_start_study.sql (N check, variant count in create_study/start_study)
// and supabase/migrations/20261002095727_study_data_model.sql (title and variant length checks).
// See docs/reference/contract-surfaces.md#limits.

export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 6;
export const MIN_PARTICIPANTS = 1;
export const MAX_PARTICIPANTS = 100;
export const MAX_TITLE_LENGTH = 200;
export const MAX_VARIANT_LENGTH = 2000;

/** Character count as Postgres `char_length` sees it (code points, not UTF-16 units). */
export function charLength(value: string): number {
  return Array.from(value).length;
}
