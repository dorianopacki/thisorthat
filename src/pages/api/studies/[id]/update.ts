import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { readStudyForm, studyRpcArgs, studyRpcErrorMessage, validateStudyForm } from "@/lib/study-form";

const GENERIC_MESSAGE = "Nie udało się zapisać zmian. Spróbuj ponownie.";
const NOT_DRAFT_MESSAGE = "Badanie już wystartowało — szkicu nie można edytować.";

// Draft edit: the wizard's form, validated like create, saved through update_study_draft, which
// replaces the whole draft and refuses anything that is not the caller's draft
// (docs/reference/contract-surfaces.md#publicupdate_study_draft).
export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}/edit?error=${encodeURIComponent(message)}`);

  const fields = readStudyForm(await context.request.formData());
  const validationError = validateStudyForm(fields);
  if (validationError) return fail(validationError);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { error } = await supabase.rpc("update_study_draft", { p_study_id: id, ...studyRpcArgs(fields) });

  if (error) {
    // Started or closed in the meantime: the study page shows it, with the reason.
    if (error.code === "55000") return context.redirect(`${studyUrl}?error=${encodeURIComponent(NOT_DRAFT_MESSAGE)}`);
    // Not the caller's study, or an id that is not a uuid (PostgREST answers 22P02): the study page
    // renders the 404 with a way back, like every other form endpoint.
    if (error.code === "P0002" || error.code === "22P02") return context.redirect(studyUrl);
    return fail(studyRpcErrorMessage(error.code, fields) ?? GENERIC_MESSAGE);
  }

  return context.redirect(studyUrl);
};
