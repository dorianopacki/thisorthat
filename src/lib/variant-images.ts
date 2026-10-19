// Author-side access to the private variant-images bucket, always through the author's own session
// client: Storage RLS lets authors insert, read and delete only their own objects
// (docs/reference/contract-surfaces.md#storage-variant-images). Objects are removed only through the
// Storage API; SQL deletes on storage.objects are blocked.
import type { createClient } from "@/lib/supabase";

import { IMAGE_CONTENT_TYPES, sniffImageType } from "@/lib/image-file";

export const VARIANT_IMAGES_BUCKET = "variant-images";
/** Signed URL lifetime for author views (draft, edit). */
export const AUTHOR_IMAGE_URL_TTL_SECONDS = 3600;

type Client = NonNullable<ReturnType<typeof createClient>>;

export type UploadResult = { paths: string[]; error: null } | { paths: null; error: "invalid_image" | "upload_failed" };

/** Logs a failed cleanup; the request itself has already succeeded or failed on its own terms. */
function logCleanupFailure(paths: readonly string[], message: string) {
  // eslint-disable-next-line no-console -- best-effort cleanup has no caller to report to; the log is the trace.
  console.error(`variant-images: could not remove ${String(paths.length)} object(s): ${message}`);
}

/** Removes objects, best effort: a failure is logged, never thrown. */
export async function removeVariantImages(supabase: Client, paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const { error } = await supabase.storage.from(VARIANT_IMAGES_BUCKET).remove([...paths]);
    if (error) logCleanupFailure(paths, error.message);
  } catch (e) {
    logCleanupFailure(paths, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Uploads each file as `<uuid>.webp|jpg`, named and typed from its sniffed bytes (never the declared
 * type or name). Returns the object names in file order. On any failure the objects this call already
 * stored are removed, so nothing is left behind.
 */
export async function uploadVariantImages(supabase: Client, files: readonly File[]): Promise<UploadResult> {
  const uploads = await Promise.all(
    files.map(async (file): Promise<{ path: string; ok: boolean; invalid?: boolean }> => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = sniffImageType(bytes);
      if (!type) return { path: "", ok: false, invalid: true };
      const path = `${crypto.randomUUID()}.${type}`;
      const { error } = await supabase.storage
        .from(VARIANT_IMAGES_BUCKET)
        .upload(path, bytes, { contentType: IMAGE_CONTENT_TYPES[type], upsert: false });
      return { path, ok: !error };
    }),
  );

  if (uploads.every((u) => u.ok)) return { paths: uploads.map((u) => u.path), error: null };

  await removeVariantImages(
    supabase,
    uploads.filter((u) => u.ok).map((u) => u.path),
  );
  return { paths: null, error: uploads.some((u) => u.invalid) ? "invalid_image" : "upload_failed" };
}

/**
 * Signed URLs for the author's own objects, keyed by path. A path that could not be signed is absent
 * from the map (the view then shows the description without the image).
 */
export async function signVariantImages(supabase: Client, paths: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  const { data, error } = await supabase.storage
    .from(VARIANT_IMAGES_BUCKET)
    .createSignedUrls([...paths], AUTHOR_IMAGE_URL_TTL_SECONDS);
  if (error) return urls;
  for (const item of data) {
    if (!item.error && item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
