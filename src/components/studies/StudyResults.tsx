import { formatVotes, rankVariants, type StudyResults as Results } from "@/lib/study-results";

interface Props {
  /** Used by the live refresh (Phase 2). */
  studyId: string;
  initial: Results;
}

// No change cues (docs/reference/contract-surfaces.md#anonymity-rule): the whole state is rendered
// as received, comments in the order get_study_results returns them, nothing marks what changed.
export default function StudyResults({ initial }: Props) {
  const results = initial;
  const ranked = rankVariants(results.variants);
  const percent = results.total > 0 ? Math.min(100, Math.round((results.responded / results.total) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm text-blue-100/80">
          Odpowiedziało <span className="font-semibold text-white">{results.responded}</span> z{" "}
          <span className="font-semibold text-white">{results.total}</span>
        </p>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Postęp badania"
          aria-valuemin={0}
          aria-valuemax={results.total}
          aria-valuenow={results.responded}
          aria-valuetext={`Odpowiedziało ${String(results.responded)} z ${String(results.total)}`}
        >
          <div className="h-full rounded-full bg-purple-500" style={{ width: `${String(percent)}%` }} />
        </div>
        {results.responded === 0 && <p className="mt-2 text-sm text-blue-100/60">Nikt jeszcze nie zagłosował</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm text-blue-100/80">Wyniki</h2>
        <ol className="space-y-2">
          {ranked.map((variant) => (
            <li
              key={variant.variant_id}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
            >
              <div className="flex items-start gap-2">
                <span className="w-6 shrink-0 font-semibold text-blue-100">{variant.place}.</span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{variant.content}</span>
                <span className="shrink-0 text-xs whitespace-nowrap text-blue-100/80">
                  {formatVotes(variant.vote_count)}
                </span>
              </div>
              <div className="mt-2 pl-8">
                {variant.comments.length > 0 ? (
                  <>
                    <p className="mb-1 text-xs text-blue-100/60">Komentarze ({variant.comments.length})</p>
                    <ul className="space-y-1">
                      {variant.comments.map((comment, index) => (
                        <li
                          // Bodies can repeat; the list is replaced wholesale, so the index is a stable key.
                          key={index}
                          className="rounded-md bg-white/5 px-2 py-1 text-xs break-words whitespace-pre-wrap text-blue-100"
                        >
                          {comment}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-blue-100/60">Brak komentarzy</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
