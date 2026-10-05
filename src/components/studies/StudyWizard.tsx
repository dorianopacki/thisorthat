import React, { useEffect, useRef, useState } from "react";
import { FilePlus, Plus, Type, Users } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { VariantField } from "@/components/studies/VariantField";
import {
  MAX_PARTICIPANTS,
  MAX_TITLE_LENGTH,
  MAX_VARIANT_LENGTH,
  MAX_VARIANTS,
  MIN_PARTICIPANTS,
  MIN_VARIANTS,
  charLength,
} from "@/lib/study-limits";

interface Props {
  serverError?: string | null;
}

interface Variant {
  key: number;
  value: string;
}

interface Errors {
  title?: string;
  participantTarget?: string;
  variants?: (string | undefined)[];
  variantCount?: string;
}

export default function StudyWizard({ serverError }: Props) {
  const nextKey = useRef(MIN_VARIANTS);
  const [title, setTitle] = useState("");
  const [participantTarget, setParticipantTarget] = useState("");
  const [variants, setVariants] = useState<Variant[]>(() =>
    Array.from({ length: MIN_VARIANTS }, (_, key) => ({ key, value: "" })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

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
    const next: Errors = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      next.title = "Podaj tytuł badania.";
    } else if (charLength(trimmedTitle) > MAX_TITLE_LENGTH) {
      next.title = `Tytuł może mieć najwyżej ${String(MAX_TITLE_LENGTH)} znaków.`;
    }

    const n = participantTarget.trim();
    if (!n) {
      next.participantTarget = "Podaj liczbę uczestników.";
    } else if (!/^\d+$/.test(n) || Number(n) < MIN_PARTICIPANTS || Number(n) > MAX_PARTICIPANTS) {
      next.participantTarget = `Liczba uczestników musi być liczbą całkowitą od ${String(MIN_PARTICIPANTS)} do ${String(MAX_PARTICIPANTS)}.`;
    }

    if (variants.length < MIN_VARIANTS || variants.length > MAX_VARIANTS) {
      next.variantCount = `Badanie musi mieć od ${String(MIN_VARIANTS)} do ${String(MAX_VARIANTS)} wariantów.`;
    }

    const variantErrors = variants.map(({ value }) => {
      const trimmed = value.trim();
      if (!trimmed) return "Wariant nie może być pusty.";
      if (charLength(trimmed) > MAX_VARIANT_LENGTH) {
        return `Wariant może mieć najwyżej ${String(MAX_VARIANT_LENGTH)} znaków.`;
      }
      return undefined;
    });
    if (variantErrors.some(Boolean)) next.variants = variantErrors;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function updateVariant(index: number, value: string) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, value } : v)));
    if (errors.variants?.[index]) {
      setErrors((prev) => ({ ...prev, variants: prev.variants?.map((e, i) => (i === index ? undefined : e)) }));
    }
  }

  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return;
    const key = nextKey.current;
    nextKey.current += 1;
    setVariants((prev) => [...prev, { key, value: "" }]);
    setErrors((prev) => ({
      ...prev,
      variantCount: undefined,
      variants: prev.variants && [...prev.variants, undefined],
    }));
  }

  function removeVariant(index: number) {
    if (variants.length <= MIN_VARIANTS) return;
    setVariants((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => ({
      ...prev,
      variantCount: undefined,
      variants: prev.variants?.filter((_, i) => i !== index),
    }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (submitting || !validate()) {
      e.preventDefault();
      return;
    }
    setSubmitting(true);
  }

  return (
    <form method="POST" action="/api/studies" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="title"
        label="Tytuł badania"
        value={title}
        onChange={(v) => {
          setTitle(v);
          if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
        }}
        placeholder="Np. Który nagłówek jest lepszy?"
        error={errors.title}
        icon={<Type className="size-4" />}
      />

      <FormField
        id="participant_target"
        label="Liczba uczestników"
        type="number"
        value={participantTarget}
        onChange={(v) => {
          setParticipantTarget(v);
          if (errors.participantTarget) setErrors((prev) => ({ ...prev, participantTarget: undefined }));
        }}
        placeholder={`Od ${String(MIN_PARTICIPANTS)} do ${String(MAX_PARTICIPANTS)}`}
        error={errors.participantTarget}
        hint={<p className="mt-1 text-xs text-blue-100/50">Tyle linków do głosowania otrzymasz po starcie badania.</p>}
        icon={<Users className="size-4" />}
      />

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm text-blue-100/80">
          Warianty ({variants.length}/{MAX_VARIANTS})
        </legend>
        {variants.map((variant, index) => (
          <VariantField
            key={variant.key}
            id={`variant-${String(variant.key)}`}
            index={index}
            value={variant.value}
            onChange={(v) => {
              updateVariant(index, v);
            }}
            onRemove={() => {
              removeVariant(index);
            }}
            canRemove={variants.length > MIN_VARIANTS}
            error={errors.variants?.[index]}
          />
        ))}
        {errors.variantCount && <p className="text-xs text-red-300">{errors.variantCount}</p>}
        <button
          type="button"
          onClick={addVariant}
          disabled={variants.length >= MAX_VARIANTS}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-4 py-2 text-sm text-purple-300 transition-colors hover:bg-white/5 hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus className="size-4" />
          Dodaj wariant
        </button>
      </fieldset>

      <ServerError message={serverError} />

      <SubmitButton pending={submitting} pendingText="Tworzenie badania..." icon={<FilePlus className="size-4" />}>
        Utwórz szkic
      </SubmitButton>
    </form>
  );
}
