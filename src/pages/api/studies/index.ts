import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import {
  MAX_PARTICIPANTS,
  MAX_TITLE_LENGTH,
  MAX_VARIANT_LENGTH,
  MAX_VARIANTS,
  MIN_PARTICIPANTS,
  MIN_VARIANTS,
  charLength,
} from "@/lib/study-limits";

const VARIANT_COUNT_MESSAGE = `Badanie musi mieć od ${String(MIN_VARIANTS)} do ${String(MAX_VARIANTS)} niepustych wariantów.`;
const LIMITS_MESSAGE = `Sprawdź limity: tytuł do ${String(MAX_TITLE_LENGTH)} znaków, od ${String(MIN_PARTICIPANTS)} do ${String(MAX_PARTICIPANTS)} uczestników, wariant do ${String(MAX_VARIANT_LENGTH)} znaków.`;
const GENERIC_MESSAGE = "Nie udało się utworzyć badania. Spróbuj ponownie.";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function validate(title: string, participantTarget: string, variants: string[]): string | null {
  if (!title) return "Podaj tytuł badania.";
  if (charLength(title) > MAX_TITLE_LENGTH) return `Tytuł może mieć najwyżej ${String(MAX_TITLE_LENGTH)} znaków.`;

  if (
    !/^\d+$/.test(participantTarget) ||
    Number(participantTarget) < MIN_PARTICIPANTS ||
    Number(participantTarget) > MAX_PARTICIPANTS
  ) {
    return `Liczba uczestników musi być liczbą całkowitą od ${String(MIN_PARTICIPANTS)} do ${String(MAX_PARTICIPANTS)}.`;
  }

  if (variants.length < MIN_VARIANTS || variants.length > MAX_VARIANTS) {
    return `Badanie musi mieć od ${String(MIN_VARIANTS)} do ${String(MAX_VARIANTS)} wariantów.`;
  }
  if (variants.some((v) => !v)) return "Wariant nie może być pusty.";
  if (variants.some((v) => charLength(v) > MAX_VARIANT_LENGTH)) {
    return `Wariant może mieć najwyżej ${String(MAX_VARIANT_LENGTH)} znaków.`;
  }

  return null;
}

export const POST: APIRoute = async (context) => {
  const fail = (message: string) => context.redirect(`/studies/new?error=${encodeURIComponent(message)}`);

  const form = await context.request.formData();
  const title = asString(form.get("title")).trim();
  const participantTarget = asString(form.get("participant_target")).trim();
  const variants = form.getAll("variant").map((v) => asString(v).trim());

  const validationError = validate(title, participantTarget, variants);
  if (validationError) return fail(validationError);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { data: studyId, error } = await supabase.rpc("create_study", {
    p_title: title,
    p_participant_target: Number(participantTarget),
    p_variants: variants,
  });

  if (error) {
    if (error.code === "22023") return fail(VARIANT_COUNT_MESSAGE);
    if (error.code === "23514") return fail(LIMITS_MESSAGE);
    return fail(GENERIC_MESSAGE);
  }

  return context.redirect(`/studies/${studyId}`);
};
