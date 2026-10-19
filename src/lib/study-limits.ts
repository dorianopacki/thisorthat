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
// Comment body limit enforced by cast_vote
// (supabase/migrations/20261002124043_cast_vote_comment_uuid_errcode.sql).
export const MAX_COMMENT_LENGTH = 2000;

// Image variants: the variant-images bucket limits and variants_kind_image_check
// (supabase/migrations/20261017120000_image_variants.sql).
/** Largest stored image (bucket file_size_limit, 1 MiB). */
export const MAX_IMAGE_BYTES = 1_048_576;
/** Largest file the wizard accepts before resizing it (client pre-check only). */
export const MAX_IMAGE_INPUT_BYTES = 10_485_760;
/** Long edge, in pixels, the browser scales an image down to. */
export const MAX_IMAGE_EDGE = 1600;
export const MAX_IMAGE_DESCRIPTION_LENGTH = 200;
/** What the author may pick; the browser re-encodes it to a stored type. */
export const ACCEPTED_IMAGE_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** What the bucket stores (allowed_mime_types). */
export const STORED_IMAGE_TYPES = ["image/webp", "image/jpeg"] as const;
/**
 * Largest study form body the server parses: MAX_VARIANTS images at MAX_IMAGE_BYTES plus text and
 * multipart overhead. Checked against Content-Length before formData() buffers the body.
 */
export const MAX_STUDY_FORM_BYTES = 7 * 1_048_576;

/** Character count as Postgres `char_length` sees it (code points, not UTF-16 units). */
export function charLength(value: string): number {
  return Array.from(value).length;
}
