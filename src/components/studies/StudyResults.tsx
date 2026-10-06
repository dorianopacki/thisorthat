import { useEffect, useState } from "react";
import { formatVotes, parseStudyResults, rankVariants, type StudyResults as Results } from "@/lib/study-results";

/** Live refresh interval while the study is active (docs/reference/contract-surfaces.md#results-view). */
const RESULTS_POLL_MS = 10_000;

const NOTICES = {
  transient: "Nie udało się odświeżyć wyników. Spróbujemy ponownie.",
  expired: "Sesja wygasła — odśwież stronę, aby zobaczyć aktualne wyniki.",
  notFound: "Nie znaleziono badania — odśwież stronę.",
  final: "Badanie jest zakończone — wyniki są ostateczne.",
} as const;

type Notice = keyof typeof NOTICES;

interface Props {
  studyId: string;
  initial: Results;
}

// No change cues (docs/reference/contract-surfaces.md#anonymity-rule): each refresh replaces the
// whole state, comments render in the order get_study_results returns them, nothing marks what changed.
export default function StudyResults({ studyId, initial }: Props) {
  const [results, setResults] = useState(initial);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Polls only while the study is active and the tab is visible; a study loaded as closed makes no requests.
  useEffect(() => {
    if (initial.status !== "active") return;

    const url = `/api/studies/${encodeURIComponent(studyId)}/results`;
    const controller = new AbortController();
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    // A getter, so the checks after `await` re-read the flag that stop() or unmount may have set.
    const isStopped = () => stopped;

    function clearTimer() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }

    function startTimer() {
      clearTimer();
      timer = setInterval(() => {
        void refresh();
      }, RESULTS_POLL_MS);
    }

    function stop(final: Notice) {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      setNotice(final);
    }

    async function refresh() {
      // Never two requests at once; nothing after a permanent stop.
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (isStopped()) return;
        // The middleware redirects an expired session to the sign-in page (HTML with 200).
        if (res.redirected) {
          stop("expired");
          return;
        }
        if (res.status === 404) {
          stop("notFound");
          return;
        }
        if (!res.ok) {
          setNotice("transient");
          return;
        }
        const next = parseStudyResults(await res.json());
        if (isStopped()) return;
        if (!next) {
          setNotice("transient");
          return;
        }
        setResults(next);
        if (next.status !== "active") {
          stop("final");
          return;
        }
        setNotice(null);
      } catch {
        // Network error, non-JSON body, or the abort on unmount: keep the last data.
        if (!isStopped()) setNotice("transient");
      } finally {
        inFlight = false;
      }
    }

    function onVisibilityChange() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        void refresh();
        startTimer();
      } else {
        clearTimer();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    // The server-rendered data is fresh, so the first request waits one interval.
    if (document.visibilityState === "visible") startTimer();

    return () => {
      stopped = true;
      clearTimer();
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [studyId, initial.status]);

  const ranked = rankVariants(results.variants);
  const percent = results.total > 0 ? Math.min(100, Math.round((results.responded / results.total) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="text-sm text-blue-100/80 empty:hidden">
        {notice && <p className="rounded-md border border-white/20 bg-white/5 px-3 py-2">{NOTICES[notice]}</p>}
      </div>
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
