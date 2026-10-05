import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { MAX_VARIANTS, MIN_VARIANTS } from "@/lib/study-limits";

const VARIANT_COUNT_MESSAGE = `Nie można rozpocząć badania: musi mieć od ${String(MIN_VARIANTS)} do ${String(MAX_VARIANTS)} wariantów.`;
const GENERIC_MESSAGE = "Nie udało się rozpocząć badania. Spróbuj ponownie.";

export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}?error=${encodeURIComponent(message)}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { error } = await supabase.rpc("start_study", { p_study_id: id });

  if (error) {
    // Already started (e.g. a double submit): the study page shows the existing links.
    if (error.code === "55000") return context.redirect(studyUrl);
    // Not the caller's study, or an id that is not a uuid (PostgREST answers 22P02).
    if (error.code === "P0002" || error.code === "22P02") return new Response(null, { status: 404 });
    if (error.code === "22023") return fail(VARIANT_COUNT_MESSAGE);
    return fail(GENERIC_MESSAGE);
  }

  return context.redirect(studyUrl);
};
