import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { readStudyForm, studyRpcArgs, studyRpcErrorMessage, validateStudyForm } from "@/lib/study-form";

const GENERIC_MESSAGE = "Nie udało się utworzyć badania. Spróbuj ponownie.";

export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/studies/new?error=${encodeURIComponent(message)}`);

  const fields = readStudyForm(await context.request.formData());
  const validationError = validateStudyForm(fields);
  if (validationError) return fail(validationError);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { data: studyId, error } = await supabase.rpc("create_study", studyRpcArgs(fields));

  if (error) return fail(studyRpcErrorMessage(error.code, fields) ?? GENERIC_MESSAGE);

  return context.redirect(`/studies/${studyId}`);
};
