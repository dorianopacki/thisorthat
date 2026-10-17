// The study form shared by create (POST /api/studies -> create_study) and draft edit
// (POST /api/studies/<id>/update -> update_study_draft): same fields, same normalization, same server
// validation and the same messages for the database's 22023/23514
// (docs/reference/contract-surfaces.md#publiccreate_study and #publicupdate_study_draft).
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
// The database raises 22023 for a deadline in the past or an unknown zone; the zone comes from the
// browser (or, on edit, the stored zone the database validated), so in practice only the past is reachable.
const DEADLINE_MESSAGE = "Termin musi być w przyszłości.";
const DEADLINE_ZONE_MESSAGE = "Nie udało się ustalić strefy czasowej terminu. Odśwież stronę i spróbuj ponownie.";

export interface StudyForm {
  title: string;
  participantTarget: string;
  variants: string[];
  /** The author's local date-time from the datetime-local input, "" when no deadline. */
  closesLocal: string;
  /** The IANA zone closesLocal is in, "" when absent. */
  closesTz: string;
}

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** Reads the wizard's fields (`title`, `participant_target`, `variant[]`, `closes_local`, `closes_tz`). */
export function readStudyForm(form: FormData): StudyForm {
  // A native form POST sends textarea line breaks as CRLF; the wizard validated LF, so normalize
  // before measuring and storing.
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").trim();
  return {
    title: normalize(asString(form.get("title"))),
    participantTarget: asString(form.get("participant_target")).trim(),
    variants: form.getAll("variant").map((v) => normalize(asString(v))),
    // Optional deadline: the author's local date-time plus an IANA zone. Postgres converts it to an
    // instant (docs/reference/contract-surfaces.md#closing-rule).
    closesLocal: asString(form.get("closes_local")).trim(),
    closesTz: asString(form.get("closes_tz")).trim(),
  };
}

/** The first problem with the form, as a message for the author, or null when it can go to the database. */
export function validateStudyForm({ title, participantTarget, variants, closesLocal, closesTz }: StudyForm) {
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

  if (closesLocal && !closesTz) return DEADLINE_ZONE_MESSAGE;

  return null;
}

/**
 * The form as create_study / update_study_draft arguments (the jsonb `p_variant_items` signatures);
 * the deadline pair only when a deadline is set.
 */
export function studyRpcArgs({ title, participantTarget, variants, closesLocal, closesTz }: StudyForm) {
  return {
    p_title: title,
    p_participant_target: Number(participantTarget),
    p_variant_items: variants.map((content) => ({ kind: "text" as const, content, image_path: null })),
    ...(closesLocal ? { p_closes_local: closesLocal, p_closes_tz: closesTz } : {}),
  };
}

/** The author's message for a 22023/23514 from create_study or update_study_draft, null for any other code. */
export function studyRpcErrorMessage(code: string, { closesLocal }: StudyForm): string | null {
  // Variants were validated before the call, so a 22023 on a request with a deadline is the deadline.
  if (code === "22023") return closesLocal ? DEADLINE_MESSAGE : VARIANT_COUNT_MESSAGE;
  if (code === "23514") return LIMITS_MESSAGE;
  return null;
}
