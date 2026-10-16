import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  studyId: string;
  started: boolean;
}

/** Irreversible delete in any state: a second step with a warning naming the consequence, like CloseStudyButton. */
export default function DeleteStudyButton({ studyId, started }: Props) {
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
        <Trash2 className="size-4" />
        Usuń badanie
      </button>
    );
  }

  return (
    <form
      method="POST"
      action={`/api/studies/${encodeURIComponent(studyId)}/delete`}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-white/20 bg-white/5 p-4"
    >
      <p className="text-sm text-blue-100/90" role="alert">
        {started
          ? "Badanie zostanie trwale usunięte razem z wynikami i komentarzami. Linki przestaną działać — uczestnicy zobaczą „Badanie jest zakończone”."
          : "Szkic zostanie trwale usunięty."}
      </p>
      <SubmitButton pending={submitting} pendingText="Usuwanie..." icon={<Trash2 className="size-4" />}>
        Tak, usuń
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
