// The app's only use of SUPABASE_SECRET_KEY, which bypasses RLS. It exposes a single narrow capability,
// signing participant ballot image paths, and never a client. Callers must act only after get_ballot
// accepted the token (docs/reference/contract-surfaces.md#storage-variant-images); the only allowed
// importer, src/pages/v/[token].astro, is pinned by tests/unit/supabase-admin-usage.test.ts.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "astro:env/server";

import { VARIANT_IMAGES_BUCKET } from "@/lib/variant-images";

/** Signed URL lifetime for the participant ballot. */
const PARTICIPANT_IMAGE_URL_TTL_SECONDS = 600;

/**
 * Signed URLs for ballot image paths, keyed by path. Throws when the key is missing, when the batch call
 * fails, or when any single path cannot be signed (for example a missing object): a ballot that silently
 * drops one image would skew the vote.
 */
export async function signParticipantImagePaths(paths: string[]): Promise<Map<string, string>> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured.");
  }
  const urls = new Map<string, string>();
  if (!paths.length) return urls;

  // A fresh, session-less client per call: nothing is stored or refreshed, and no instance outlives it.
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.storage
    .from(VARIANT_IMAGES_BUCKET)
    .createSignedUrls(paths, PARTICIPANT_IMAGE_URL_TTL_SECONDS);
  if (error) throw new Error(`Could not sign ballot images: ${error.message}`);

  for (const item of data) {
    if (item.error || !item.path || !item.signedUrl) {
      throw new Error(`Could not sign a ballot image: ${item.error ?? "no signed URL"}`);
    }
    urls.set(item.path, item.signedUrl);
  }
  if (paths.some((path) => !urls.has(path))) {
    throw new Error("Could not sign every ballot image.");
  }
  return urls;
}
