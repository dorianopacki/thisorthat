import type { StudyStatus } from "@/lib/study-status";

export interface StudyProgress {
  status: StudyStatus;
  responded: number;
  total: number;
  participant_target: number;
}

/**
 * Dashboard progress for one study (list_author_studies row). A started study shows
 * „Odpowiedziało X z N” with N = total, the live link count (docs/reference/contract-surfaces.md#results-view).
 * A draft has no links yet, so it shows the planned participant_target instead.
 */
export function progressLabel(study: StudyProgress): string {
  if (study.status === "draft") {
    return `Planowana liczba uczestników: ${String(study.participant_target)}`;
  }
  return `Odpowiedziało ${String(study.responded)} z ${String(study.total)}`;
}
