import React, { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  studyId: string;
  participantTarget: number;
}

/** „Zostanie wygenerowany 1 link.” / „Zostaną wygenerowane 3 linki.” / „Zostanie wygenerowanych 5 linków.” */
function linksSentence(n: number): string {
  if (n === 1) return "Zostanie wygenerowany 1 link.";
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `Zostaną wygenerowane ${String(n)} linki.`;
  }
  return `Zostanie wygenerowanych ${String(n)} linków.`;
}

export default function StartStudyButton({ studyId, participantTarget }: Props) {
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
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        <Play className="size-4" />
        Rozpocznij
      </button>
    );
  }

  return (
    <form
      method="POST"
      action={`/api/studies/${encodeURIComponent(studyId)}/start`}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-white/20 bg-white/5 p-4"
    >
      <p className="text-sm text-blue-100/90" role="alert">
        Po rozpoczęciu badania nie można już zmienić. {linksSentence(participantTarget)}
      </p>
      <SubmitButton pending={submitting} pendingText="Rozpoczynanie..." icon={<Play className="size-4" />}>
        Tak, rozpocznij
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
