import { useEffect, useRef, useState } from "react";
import { CircleAlert, Trash } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageResizeError, resizeImage } from "@/lib/image-resize";
import { ACCEPTED_IMAGE_INPUT_TYPES, MAX_IMAGE_INPUT_BYTES } from "@/lib/study-limits";

export type VariantKind = "text" | "image";
/** The new file in the image input: none picked, being resized, or resized and ready to post. */
export type VariantImageStatus = "none" | "pending" | "ready";

interface VariantFieldProps {
  id: string;
  index: number;
  kind: VariantKind;
  onKindChange: (kind: VariantKind) => void;
  text: string;
  onTextChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  /** The draft's current image (edit), posted back as `variant.<i>.image_path` unless a new file replaces it. */
  keptImagePath?: string;
  keptPreviewUrl?: string;
  imageStatus: VariantImageStatus;
  onImageStatusChange: (status: VariantImageStatus, error?: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  error?: string;
}

const inputClass = (error?: string) =>
  cn(
    "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
    error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
  );

const ACCEPT = ACCEPTED_IMAGE_INPUT_TYPES.join(",");

function resizeErrorMessage(e: unknown): string {
  return e instanceof ImageResizeError && e.reason === "too_large"
    ? "Nie udało się zmniejszyć grafiki do 1 MB. Wybierz inny plik."
    : "Nie udało się odczytać grafiki. Wybierz inny plik.";
}

export function VariantField({
  id,
  index,
  kind,
  onKindChange,
  text,
  onTextChange,
  description,
  onDescriptionChange,
  keptImagePath,
  keptPreviewUrl,
  imageStatus,
  onImageStatusChange,
  onRemove,
  canRemove,
  error,
}: VariantFieldProps) {
  const prefix = `variant.${String(index)}`;
  const number = index + 1;
  // Object URL of the resized file; revoked when replaced or when the field goes away.
  const [newPreviewUrl, setNewPreviewUrl] = useState<string>();
  useEffect(
    () => () => {
      if (newPreviewUrl) URL.revokeObjectURL(newPreviewUrl);
    },
    [newPreviewUrl],
  );
  // Only the latest pick may write back to the input (a slow resize must not overwrite a newer one).
  const pick = useRef(0);
  // A resize finishes after later renders (the variant may have moved); report through the latest callback.
  const reportStatus = useRef(onImageStatusChange);
  useEffect(() => {
    reportStatus.current = onImageStatusChange;
  });

  // Runs on pick, not on submit: the submit is a native POST that an async resize would race.
  async function handleFile(input: HTMLInputElement) {
    const run = ++pick.current;
    const file = input.files?.[0];
    setNewPreviewUrl(undefined);
    if (!file) {
      reportStatus.current("none");
      return;
    }
    const reject = (message: string) => {
      // Never post the original: clear the input so only a resized file can reach the server.
      input.value = "";
      reportStatus.current("none", message);
    };
    if (!(ACCEPTED_IMAGE_INPUT_TYPES as readonly string[]).includes(file.type)) {
      reject("Wybierz plik JPEG, PNG lub WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      reject("Plik może mieć najwyżej 10 MB.");
      return;
    }

    reportStatus.current("pending");
    try {
      const resized = await resizeImage(file);
      if (run !== pick.current) return;
      const transfer = new DataTransfer();
      transfer.items.add(resized);
      input.files = transfer.files;
      setNewPreviewUrl(URL.createObjectURL(resized));
      reportStatus.current("ready");
    } catch (e) {
      if (run !== pick.current) return;
      reject(resizeErrorMessage(e));
    }
  }

  const previewUrl = imageStatus === "ready" ? newPreviewUrl : keptPreviewUrl;
  const errorId = `${id}-error`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={kind === "text" ? id : `${id}-description`} className="block text-sm text-blue-100/80">
          Wariant {number}
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="flex items-center gap-1 text-xs text-purple-300 transition-colors hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-purple-300"
          aria-label={`Usuń wariant ${String(number)}`}
        >
          <Trash className="size-3" />
          Usuń
        </button>
      </div>

      <fieldset className="mb-2 flex gap-4 text-sm text-blue-100/80">
        <legend className="sr-only">Rodzaj wariantu {number}</legend>
        {(["text", "image"] as const).map((value) => (
          <label key={value} className="flex items-center gap-1">
            <input
              type="radio"
              name={`${prefix}.kind`}
              value={value}
              checked={kind === value}
              onChange={() => {
                onKindChange(value);
              }}
              className="accent-purple-400"
            />
            {value === "text" ? "Tekst" : "Grafika"}
          </label>
        ))}
      </fieldset>

      {/* Both parts stay mounted so switching kind keeps what was typed or picked; the inactive part is
          disabled and therefore not posted. */}
      <div className={kind === "text" ? "" : "hidden"}>
        <textarea
          id={id}
          name={`${prefix}.content`}
          rows={3}
          value={text}
          disabled={kind !== "text"}
          onChange={(e) => {
            onTextChange(e.target.value);
          }}
          placeholder="Treść wariantu"
          aria-describedby={error ? errorId : undefined}
          className={inputClass(error)}
        />
      </div>

      <div className={kind === "image" ? "space-y-2" : "hidden"}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt={description || `Podgląd grafiki wariantu ${String(number)}`}
            className="h-auto w-full rounded-lg"
          />
        )}
        {imageStatus === "pending" && <p className="text-xs text-blue-100/60">Przygotowywanie grafiki...</p>}
        <div>
          <label htmlFor={`${id}-image`} className="mb-1 block text-xs text-blue-100/60">
            {keptImagePath || imageStatus === "ready"
              ? `Zmień grafikę wariantu ${String(number)} (JPEG, PNG lub WebP)`
              : `Grafika wariantu ${String(number)} (JPEG, PNG lub WebP)`}
          </label>
          <input
            id={`${id}-image`}
            type="file"
            name={`${prefix}.image`}
            accept={ACCEPT}
            disabled={kind !== "image"}
            onChange={(e) => {
              void handleFile(e.currentTarget);
            }}
            className="block w-full text-sm text-blue-100/80 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white"
          />
        </div>
        {keptImagePath && imageStatus !== "ready" && kind === "image" && (
          <input type="hidden" name={`${prefix}.image_path`} value={keptImagePath} />
        )}
        <div>
          <label htmlFor={`${id}-description`} className="mb-1 block text-xs text-blue-100/60">
            Opis grafiki (widoczny dla uczestników)
          </label>
          <input
            id={`${id}-description`}
            type="text"
            name={`${prefix}.content`}
            value={description}
            disabled={kind !== "image"}
            onChange={(e) => {
              onDescriptionChange(e.target.value);
            }}
            placeholder="Krótki opis grafiki"
            aria-describedby={error ? errorId : undefined}
            className={inputClass(error)}
          />
        </div>
      </div>

      {error && (
        <p id={errorId} className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
