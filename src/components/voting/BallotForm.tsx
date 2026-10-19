import React, { useEffect, useState, useSyncExternalStore } from "react";
import { CircleAlert, MessageSquare, Send } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { MAX_COMMENT_LENGTH, charLength } from "@/lib/study-limits";
import { votePath } from "@/lib/study-links";
import { cn } from "@/lib/utils";

interface Variant {
  variant_id: string;
  kind: "text" | "image";
  /** The text, or for an image variant its description (the image's alt text and the radio's name). */
  content: string;
  /** Short-lived signed URL, present for an image variant. */
  image_url?: string;
}

interface Props {
  token: string;
  variants: Variant[];
  serverError?: string | null;
}

const subscribeNoop = () => () => undefined;

const COMMENT_TOO_LONG = `Komentarz może mieć najwyżej ${String(MAX_COMMENT_LENGTH)} znaków.`;

export default function BallotForm({ token, variants, serverError }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  // Until the island hydrates the native form must still be sendable; the server rejects a missing choice.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  // A page restored from the back/forward cache keeps its React state; re-enable the button.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setSubmitting(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  function validate() {
    const next: Record<string, string | undefined> = {};
    for (const { variant_id } of variants) {
      const body = (comments[variant_id] ?? "").trim();
      if (charLength(body) > MAX_COMMENT_LENGTH) next[variant_id] = COMMENT_TOO_LONG;
    }
    setErrors(next);
    const invalid = Object.keys(next);
    // Expand every comment with an error so the participant can see and fix it.
    if (invalid.length > 0) {
      setOpen((prev) => ({ ...prev, ...Object.fromEntries(invalid.map((id) => [id, true])) }));
    }
    return invalid.length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (submitting || !selected || !validate()) {
      e.preventDefault();
      return;
    }
    setSubmitting(true);
  }

  return (
    <form method="POST" action={`/api${votePath(token)}`} className="space-y-4" onSubmit={handleSubmit} noValidate>
      <fieldset className="space-y-4">
        <legend className="sr-only">Warianty</legend>
        {variants.map((variant, index) => {
          const id = variant.variant_id;
          const isSelected = selected === id;
          const isOpen = open[id] ?? false;
          const comment = comments[id] ?? "";
          const error = errors[id];
          const optionId = `variant-${id}`;
          const commentId = `comment-${id}`;
          const isImage = variant.kind === "image";

          return (
            <div key={id}>
              <label
                htmlFor={optionId}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer flex-wrap items-start gap-3 rounded-lg border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple-400",
                  isSelected
                    ? "border-purple-400 bg-purple-500/25 ring-1 ring-purple-400"
                    : "border-white/20 bg-white/5 hover:bg-white/10",
                )}
              >
                <input
                  id={optionId}
                  type="radio"
                  name="variant_id"
                  value={id}
                  checked={isSelected}
                  onChange={() => {
                    setSelected(id);
                  }}
                  // The image's alt and „Wariant N” would otherwise join the name; it is the description.
                  aria-label={isImage ? variant.content : undefined}
                  className="mt-1 size-5 shrink-0 accent-purple-500"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-xs text-blue-100/60", !isImage && "mb-1")}>Wariant {index + 1}</span>
                  {!isImage && <span className="block text-sm break-words whitespace-pre-wrap">{variant.content}</span>}
                </span>
                {isImage && (
                  // Full card width on its own row; the page signs every image or shows the error screen.
                  <img
                    src={variant.image_url}
                    alt={variant.content}
                    loading="eager"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="block h-auto w-full max-w-full basis-full rounded-md"
                  />
                )}
              </label>

              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={commentId}
                onClick={() => {
                  setOpen((prev) => ({ ...prev, [id]: !isOpen }));
                }}
                className="mt-1 flex items-center gap-1 py-2 text-xs text-purple-300 transition-colors hover:text-purple-100"
              >
                <MessageSquare className="size-3" />
                {comment.trim() ? "Edytuj komentarz" : "Dodaj komentarz"}
              </button>

              {/* Collapsing only hides the textarea, so the text is kept and still sent. */}
              <div hidden={!isOpen}>
                <label htmlFor={commentId} className="sr-only">
                  Komentarz do wariantu {index + 1}
                </label>
                <textarea
                  id={commentId}
                  name={`comment:${id}`}
                  rows={3}
                  value={comment}
                  onChange={(e) => {
                    const value = e.target.value;
                    setComments((prev) => ({ ...prev, [id]: value }));
                    if (errors[id]) setErrors((prev) => ({ ...prev, [id]: undefined }));
                  }}
                  placeholder="Twój komentarz (opcjonalnie)"
                  className={cn(
                    "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
                    error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
                  )}
                />
              </div>
              {error && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                  <CircleAlert className="size-3" />
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <ServerError message={serverError} />

      <SubmitButton
        pending={submitting}
        disabled={hydrated && !selected}
        pendingText="Wysyłanie głosu..."
        icon={<Send className="size-4" />}
      >
        Wyślij głos
      </SubmitButton>
    </form>
  );
}
