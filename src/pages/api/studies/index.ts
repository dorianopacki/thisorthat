import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  IMAGE_MESSAGE,
  newImageFiles,
  readStudyForm,
  studyRpcArgs,
  studyRpcErrorMessage,
  validateStudyForm,
} from "@/lib/study-form";
import { removeVariantImages, uploadVariantImages } from "@/lib/variant-images";

const GENERIC_MESSAGE = "Nie udało się utworzyć badania. Spróbuj ponownie.";
const UPLOAD_MESSAGE = "Nie udało się przesłać grafiki. Spróbuj ponownie.";

// Image variants: new files are uploaded first (create_study checks that each image_path exists and is
// the caller's), and removed again when create_study refuses the study, so a failed request leaves no
// objects behind.
export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/studies/new?error=${encodeURIComponent(message)}`);

  // A non-form or truncated body throws; answer it like any other failed save, not with a 500.
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return fail(GENERIC_MESSAGE);
  }

  const fields = readStudyForm(form);
  const validationError = await validateStudyForm(fields);
  if (validationError) return fail(validationError);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const upload = await uploadVariantImages(supabase, newImageFiles(fields));
  if (upload.error) return fail(upload.error === "invalid_image" ? IMAGE_MESSAGE : UPLOAD_MESSAGE);

  const { data: studyId, error } = await supabase.rpc("create_study", studyRpcArgs(fields, upload.paths));

  if (error) {
    await removeVariantImages(supabase, upload.paths);
    return fail(studyRpcErrorMessage(error.code, fields) ?? GENERIC_MESSAGE);
  }

  return context.redirect(`/studies/${studyId}`);
};
