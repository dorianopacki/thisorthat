import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const GENERIC_MESSAGE = "Nie udało się zakończyć badania. Spróbuj ponownie.";

export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}?error=${encodeURIComponent(message)}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { error } = await supabase.rpc("close_study", { p_study_id: id });

  if (error) {
    // Already closed (a double submit, the last vote or the deadline got there first): the study
    // page shows it as closed.
    if (error.code === "55000") return context.redirect(studyUrl);
    // Not the caller's study, or an id that is not a uuid (PostgREST answers 22P02): the study page
    // renders the 404 with a way back, so redirect there like every other form endpoint.
    if (error.code === "P0002" || error.code === "22P02") return context.redirect(studyUrl);
    return fail(GENERIC_MESSAGE);
  }

  return context.redirect(studyUrl);
};
