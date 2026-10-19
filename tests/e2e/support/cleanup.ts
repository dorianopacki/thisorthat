import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Cleanup deletes by title, which the app's delete route (by id) does not offer, so it deletes the study
// as its author through Supabase: RLS lets an author delete their own study, and links, votes and
// comments cascade with it. Image objects do not cascade with the rows; they are removed through the
// Storage API (Storage RLS: the author's own objects), the same way the app's delete route does.
const VARIANT_IMAGES_BUCKET = "variant-images";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .dev.vars (see context/foundation/test-stack.md, ## E2E)`);
  return value;
}

/** Deletes the E2E author's studies with this exact title, and their images, and asserts none is left. */
export async function deleteStudiesTitled(title: string): Promise<void> {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: requireEnv("E2E_USERNAME"),
    password: requireEnv("E2E_PASSWORD"),
  });
  expect(signInError).toBeNull();

  // Read the image paths before the variants are gone.
  const { data: images, error: imagesError } = await supabase
    .from("variants")
    .select("image_path, studies!inner(title)")
    .eq("studies.title", title)
    .not("image_path", "is", null);
  expect(imagesError).toBeNull();
  // The client is untyped here (no Database generic), so name the one column read.
  const rows = (images ?? []) as { image_path: string | null }[];
  const paths = rows.flatMap((v) => (v.image_path ? [v.image_path] : []));

  const { error: deleteError } = await supabase.from("studies").delete().eq("title", title);
  expect(deleteError).toBeNull();
  const { data: left, error: selectError } = await supabase.from("studies").select("id").eq("title", title);
  expect(selectError).toBeNull();
  expect(left).toEqual([]);

  if (paths.length) {
    const bucket = supabase.storage.from(VARIANT_IMAGES_BUCKET);
    const { error: removeError } = await bucket.remove(paths);
    expect(removeError).toBeNull();
    for (const path of paths) {
      const { data: stillThere } = await bucket.exists(path);
      expect(stillThere, `image ${path} left in ${VARIANT_IMAGES_BUCKET}`).toBe(false);
    }
  }

  await supabase.auth.signOut({ scope: "local" });
}
