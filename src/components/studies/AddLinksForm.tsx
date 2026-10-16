import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  studyId: string;
  /** Links the study can still get: MAX_PARTICIPANTS − current total (at least 1 when rendered). */
  max: number;
}

/** „Dogeneruj linki” (S-07): adds links to an active study. The server parses `count` again. */
export default function AddLinksForm({ studyId, max }: Props) {
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

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (submitting) {
      e.preventDefault();
      return;
    }
    setSubmitting(true);
  }

  return (
    <form
      method="POST"
      action={`/api/studies/${encodeURIComponent(studyId)}/links`}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-white/20 bg-white/5 p-4"
    >
      <div>
        <label htmlFor="add-links-count" className="mb-1 block text-sm text-blue-100/80">
          Liczba nowych linków
        </label>
        <input
          id="add-links-count"
          name="count"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          defaultValue={1}
          required
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-blue-100/50">Możesz dodać od 1 do {max}.</p>
      </div>
      <SubmitButton pending={submitting} pendingText="Dodawanie..." icon={<Plus className="size-4" />}>
        Dogeneruj linki
      </SubmitButton>
    </form>
  );
}
