import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  IMAGE_MESSAGE,
  keptImagePaths,
  newImageFiles,
  readStudyForm,
  studyRpcArgs,
  studyRpcErrorMessage,
  validateStudyForm,
} from "@/lib/study-form";
import { removeVariantImages, uploadVariantImages } from "@/lib/variant-images";

const GENERIC_MESSAGE = "Nie udało się zapisać zmian. Spróbuj ponownie.";
const NOT_DRAFT_MESSAGE = "Badanie już wystartowało — szkicu nie można edytować.";
const UPLOAD_MESSAGE = "Nie udało się przesłać grafiki. Spróbuj ponownie.";

// Draft edit: the wizard's form, validated like create, saved through update_study_draft, which
// replaces the whole draft and refuses anything that is not the caller's draft
// (docs/reference/contract-surfaces.md#publicupdate_study_draft). Images: read the draft's current paths
// (RLS: only the caller's), upload the new files, call the RPC; on failure remove the new uploads, on
// success remove the current paths the form no longer keeps.
export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}/edit?error=${encodeURIComponent(message)}`);

  // A non-form or truncated body throws; answer it like any other failed save, not with a 500.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return fail(GENERIC_MESSAGE);
  }

  const fields = readStudyForm(form);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  // Someone else's study reads as no rows, so its paths can never be kept or removed from here.
  const { data: current, error: currentError } = await supabase
    .from("variants")
    .select("image_path")
    .eq("study_id", id)
    .not("image_path", "is", null);
  if (currentError) {
    // An id that is not a uuid (PostgREST answers 22P02): the study page renders the 404.
    if (currentError.code === "22P02") return context.redirect(studyUrl);
    return fail(GENERIC_MESSAGE);
  }
  const currentPaths = new Set(current.flatMap((v) => (v.image_path ? [v.image_path] : [])));

  const validationError = await validateStudyForm(fields, { currentImagePaths: currentPaths });
  if (validationError) return fail(validationError);

  const upload = await uploadVariantImages(supabase, newImageFiles(fields));
  if (upload.error) return fail(upload.error === "invalid_image" ? IMAGE_MESSAGE : UPLOAD_MESSAGE);

  const { error } = await supabase.rpc("update_study_draft", {
    p_study_id: id,
    ...studyRpcArgs(fields, upload.paths),
  });

  if (error) {
    await removeVariantImages(supabase, upload.paths);
    // Started or closed in the meantime: the study page shows it, with the reason.
    if (error.code === "55000") return context.redirect(`${studyUrl}?error=${encodeURIComponent(NOT_DRAFT_MESSAGE)}`);
    // Not the caller's study, or an id that is not a uuid (PostgREST answers 22P02): the study page
    // renders the 404 with a way back, like every other form endpoint.
    if (error.code === "P0002" || error.code === "22P02") return context.redirect(studyUrl);
    return fail(studyRpcErrorMessage(error.code, fields) ?? GENERIC_MESSAGE);
  }

  const kept = new Set(keptImagePaths(fields));
  await removeVariantImages(
    supabase,
    [...currentPaths].filter((path) => !kept.has(path)),
  );

  return context.redirect(studyUrl);
};
