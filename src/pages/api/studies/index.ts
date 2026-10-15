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
// create_study raises 22023 for a deadline in the past or an unknown zone; the zone comes from the
// browser, so in practice only the past is reachable.
const DEADLINE_MESSAGE = "Termin musi być w przyszłości.";
const DEADLINE_ZONE_MESSAGE = "Nie udało się ustalić strefy czasowej terminu. Odśwież stronę i spróbuj ponownie.";

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
  // A native form POST sends textarea line breaks as CRLF; the wizard validated LF, so normalize
  // before measuring and storing.
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").trim();
  const title = normalize(asString(form.get("title")));
  const participantTarget = asString(form.get("participant_target")).trim();
  const variants = form.getAll("variant").map((v) => normalize(asString(v)));
  // Optional deadline: the author's local date-time (datetime-local) plus the browser's IANA zone.
  // Postgres converts it to an instant (docs/reference/contract-surfaces.md#closing-rule).
  const closesLocal = asString(form.get("closes_local")).trim();
  const closesTz = asString(form.get("closes_tz")).trim();

  const validationError = validate(title, participantTarget, variants);
  if (validationError) return fail(validationError);
  if (closesLocal && !closesTz) return fail(DEADLINE_ZONE_MESSAGE);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  const { data: studyId, error } = await supabase.rpc("create_study", {
    p_title: title,
    p_participant_target: Number(participantTarget),
    p_variants: variants,
    ...(closesLocal ? { p_closes_local: closesLocal, p_closes_tz: closesTz } : {}),
  });

  if (error) {
    // Variants were validated above, so a 22023 on a request with a deadline is the deadline.
    if (error.code === "22023") return fail(closesLocal ? DEADLINE_MESSAGE : VARIANT_COUNT_MESSAGE);
    if (error.code === "23514") return fail(LIMITS_MESSAGE);
    return fail(GENERIC_MESSAGE);
  }

  return context.redirect(`/studies/${studyId}`);
};
