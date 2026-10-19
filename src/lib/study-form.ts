// The study form shared by create (POST /api/studies -> create_study) and draft edit
// (POST /api/studies/<id>/update -> update_study_draft): same fields, same normalization, same server
// validation and the same messages for the database's 22023/23514
// (docs/reference/contract-surfaces.md#publiccreate_study and #publicupdate_study_draft).
import { sniffImageFile } from "@/lib/image-file";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DESCRIPTION_LENGTH,
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
/** A new file that is not a WebP/JPEG by its bytes, or is over the stored limit. */
export const IMAGE_MESSAGE = "Grafika musi być plikiem WebP lub JPEG o rozmiarze najwyżej 1 MB.";
const MISSING_IMAGE_MESSAGE = "Dodaj grafikę do wariantu.";
// A kept image_path that is not one of this draft's current images (a stale form, or a forged path).
const UNKNOWN_IMAGE_MESSAGE = "Nie znaleziono grafiki wariantu. Wybierz plik ponownie.";

export type StudyFormVariantKind = "text" | "image";

/**
 * One variant as posted. `kind` is null for an unknown value. For an image, `content` is its description
 * and either `image` (a new file) or `image_path` (the draft's current image, kept on edit) is set; a new
 * file wins over a kept path. Text variants carry neither.
 */
export interface StudyFormVariant {
  kind: StudyFormVariantKind | null;
  content: string;
  image?: File;
  image_path?: string;
}

export interface StudyForm {
  title: string;
  participantTarget: string;
  variants: StudyFormVariant[];
  /** The author's local date-time from the datetime-local input, "" when no deadline. */
  closesLocal: string;
  /** The IANA zone closesLocal is in, "" when absent. */
  closesTz: string;
}

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

const VARIANT_FIELD = /^variant\.(\d+)\.(kind|content|image|image_path)$/;

/**
 * Reads the wizard's fields: `title`, `participant_target`, per position i `variant.<i>.kind`,
 * `variant.<i>.content`, `variant.<i>.image` (file) and `variant.<i>.image_path` (kept image), then
 * `closes_local` and `closes_tz`. Variants come back ordered by i; a missing kind means text.
 */
export function readStudyForm(form: FormData): StudyForm {
  // A native form POST sends textarea line breaks as CRLF; the wizard validated LF, so normalize
  // before measuring and storing.
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n").trim();

  const indices = new Set<number>();
  for (const name of form.keys()) {
    const match = VARIANT_FIELD.exec(name);
    if (match?.[1]) indices.add(Number(match[1]));
  }

  const variants = [...indices]
    .sort((a, b) => a - b)
    .map((i): StudyFormVariant => {
      const field = (name: string) => form.get(`variant.${String(i)}.${name}`);
      const rawKind = asString(field("kind")).trim();
      const kind = rawKind === "" || rawKind === "text" ? "text" : rawKind === "image" ? "image" : null;
      const content = normalize(asString(field("content")));
      if (kind !== "image") return { kind, content };

      // An empty file input still posts a nameless, empty File.
      const file = field("image");
      const imagePath = asString(field("image_path")).trim();
      return {
        kind,
        content,
        ...(file instanceof File && file.size > 0 ? { image: file } : {}),
        ...(imagePath ? { image_path: imagePath } : {}),
      };
    });

  return {
    title: normalize(asString(form.get("title"))),
    participantTarget: asString(form.get("participant_target")).trim(),
    variants,
    // Optional deadline: the author's local date-time plus an IANA zone. Postgres converts it to an
    // instant (docs/reference/contract-surfaces.md#closing-rule).
    closesLocal: asString(form.get("closes_local")).trim(),
    closesTz: asString(form.get("closes_tz")).trim(),
  };
}

/** The first problem with one variant, or null. */
async function variantError(
  { kind, content, image, image_path }: StudyFormVariant,
  currentImagePaths: ReadonlySet<string>,
): Promise<string | null> {
  if (kind === null) return "Nieznany rodzaj wariantu.";
  if (kind === "text") {
    if (!content) return "Wariant nie może być pusty.";
    if (charLength(content) > MAX_VARIANT_LENGTH) {
      return `Wariant może mieć najwyżej ${String(MAX_VARIANT_LENGTH)} znaków.`;
    }
    return null;
  }

  if (!content) return "Opis grafiki nie może być pusty.";
  if (charLength(content) > MAX_IMAGE_DESCRIPTION_LENGTH) {
    return `Opis grafiki może mieć najwyżej ${String(MAX_IMAGE_DESCRIPTION_LENGTH)} znaków.`;
  }
  if (image) {
    if (image.size > MAX_IMAGE_BYTES || (await sniffImageFile(image)) === null) return IMAGE_MESSAGE;
    return null;
  }
  if (!image_path) return MISSING_IMAGE_MESSAGE;
  if (!currentImagePaths.has(image_path)) return UNKNOWN_IMAGE_MESSAGE;
  return null;
}

export interface ValidateStudyFormOptions {
  /**
   * The image paths of the draft's current variants, which an edit may keep. Empty on create, so a
   * kept path is always refused there.
   */
  currentImagePaths?: ReadonlySet<string>;
}

/** The first problem with the form, as a message for the author, or null when it can go to the database. */
export async function validateStudyForm(
  { title, participantTarget, variants, closesLocal, closesTz }: StudyForm,
  { currentImagePaths = new Set() }: ValidateStudyFormOptions = {},
): Promise<string | null> {
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
  for (const variant of variants) {
    const message = await variantError(variant, currentImagePaths);
    if (message) return message;
  }

  if (closesLocal && !closesTz) return DEADLINE_ZONE_MESSAGE;

  return null;
}

/** The new files to upload, in variant order (the order `studyRpcArgs` expects their paths in). */
export function newImageFiles({ variants }: StudyForm): File[] {
  return variants.flatMap((v) => (v.kind === "image" && v.image ? [v.image] : []));
}

/** The draft's current image paths the form keeps (image variants without a new file). */
export function keptImagePaths({ variants }: StudyForm): string[] {
  return variants.flatMap((v) => (v.kind === "image" && !v.image && v.image_path ? [v.image_path] : []));
}

/**
 * The form as create_study / update_study_draft arguments (the jsonb `p_variant_items` signatures);
 * the deadline pair only when a deadline is set. `uploadedPaths` are the object names of
 * `newImageFiles(form)`, in the same order.
 */
export function studyRpcArgs(
  { title, participantTarget, variants, closesLocal, closesTz }: StudyForm,
  uploadedPaths: readonly string[] = [],
) {
  let next = 0;
  const items = variants.map((v) => {
    if (v.kind !== "image") return { kind: "text" as const, content: v.content, image_path: null };
    const imagePath = v.image ? uploadedPaths[next++] : v.image_path;
    return { kind: "image" as const, content: v.content, image_path: imagePath ?? null };
  });
  return {
    p_title: title,
    p_participant_target: Number(participantTarget),
    p_variant_items: items,
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
