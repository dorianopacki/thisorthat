// Direct Storage access for the http project: a supabase-js client signed in as a fixture author (their
// own session, so Storage RLS applies exactly as in the app) and the signed image URLs an author page
// renders.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_PASSWORD, type Author } from "./client";

export const BUCKET = "variant-images";

// A 1×1 lossless WebP.
export const WEBP_1PX = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

export function webpFile(name = "image.webp"): File {
  return new File([WEBP_1PX], name, { type: "image/webp" });
}

/** The variant-images paths signed into a page, with their signed URLs, in page order. */
export function signedImages(html: string): { path: string; url: string }[] {
  return [
    ...html.matchAll(
      /(https?:\/\/[^"\s]+\/storage\/v1\/object\/sign\/variant-images\/([0-9a-f-]{36}\.(?:webp|jpg))\?token=[^"\s&]+)/g,
    ),
  ].map((m) => ({ url: m[1], path: m[2] }));
}

// The Supabase the preview Worker under test runs against: .dev.vars, as in playwright.config.ts. Never
// .env, which may point at production locally.
function supabaseEnv(): { url: string; key: string } {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    try {
      process.loadEnvFile(".dev.vars");
    } catch {
      // Reported below.
    }
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_KEY must be set (or present in .dev.vars)");
  return { url, key };
}

/** A supabase-js client signed in as `author`, to look at their objects directly. */
export async function storageAs(author: Author): Promise<SupabaseClient> {
  const { url, key } = supabaseEnv();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: author.email, password: TEST_PASSWORD });
  if (error) throw new Error(`sign in ${author.email}: ${error.message}`);
  return client;
}

export async function exists(storage: SupabaseClient, path: string): Promise<boolean> {
  const { data, error } = await storage.storage.from(BUCKET).exists(path);
  // exists() reports a missing object as an error with status 400/404 and data false.
  if (error && !data) {
    const status = (error as { status?: number }).status;
    if (status !== 400 && status !== 404) throw error;
  }
  return data;
}
