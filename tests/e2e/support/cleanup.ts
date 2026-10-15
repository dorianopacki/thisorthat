import { expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The app has no delete route yet (S-06), so cleanup deletes the study as its author through Supabase:
// RLS lets an author delete their own study, and links, votes and comments cascade with it.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .dev.vars (see context/foundation/test-stack.md, ## E2E)`);
  return value;
}

/** Deletes the E2E author's studies with this exact title and asserts none is left. */
export async function deleteStudiesTitled(title: string): Promise<void> {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), {
    auth: { persistSession: false },
  });
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: requireEnv("E2E_USERNAME"),
    password: requireEnv("E2E_PASSWORD"),
  });
  expect(signInError).toBeNull();

  const { error: deleteError } = await supabase.from("studies").delete().eq("title", title);
  expect(deleteError).toBeNull();
  const { data: left, error: selectError } = await supabase.from("studies").select("id").eq("title", title);
  expect(selectError).toBeNull();
  expect(left).toEqual([]);

  await supabase.auth.signOut({ scope: "local" });
}
