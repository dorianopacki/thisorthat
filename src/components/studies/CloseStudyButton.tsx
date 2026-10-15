import React, { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  studyId: string;
}

/** Manual, irreversible close (FR-015): a second step with a warning, like StartStudyButton. */
export default function CloseStudyButton({ studyId }: Props) {
  const [confirming, setConfirming] = useState(false);
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

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 font-medium text-white transition-colors hover:bg-white/10"
      >
        <Square className="size-4" />
        Zakończ badanie
      </button>
    );
  }

  return (
    <form
      method="POST"
      action={`/api/studies/${encodeURIComponent(studyId)}/close`}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-white/20 bg-white/5 p-4"
    >
      <p className="text-sm text-blue-100/90" role="alert">
        Zakończonego badania nie da się wznowić. Linki przestaną przyjmować głosy.
      </p>
      <SubmitButton pending={submitting} pendingText="Zamykanie..." icon={<Square className="size-4" />}>
        Tak, zakończ
      </SubmitButton>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
        }}
        disabled={submitting}
        className="w-full rounded-lg border border-white/20 px-4 py-2 text-sm text-purple-300 transition-colors hover:bg-white/5 hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Anuluj
      </button>
    </form>
  );
}
