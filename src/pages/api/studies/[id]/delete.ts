import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const GENERIC_MESSAGE = "Nie udało się usunąć badania. Spróbuj ponownie.";

export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}?error=${encodeURIComponent(message)}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  // The "authors delete own" RLS policy covers every status; links, votes and comments cascade.
  // RLS hides someone else's study, so `.select("id")` tells a real deletion from zero rows.
  const { data, error } = await supabase.from("studies").delete().eq("id", id).select("id");

  if (error) {
    // An id that is not a uuid (PostgREST answers 22P02): the study page renders the 404.
    if (error.code === "22P02") return context.redirect(studyUrl);
    return fail(GENERIC_MESSAGE);
  }

  // Zero rows: not the caller's study, unknown, or already deleted (a double submit). The study page
  // renders the 404 with a way back and does not say which.
  if (data.length === 0) return context.redirect(studyUrl);

  return context.redirect("/dashboard?deleted=1");
};
