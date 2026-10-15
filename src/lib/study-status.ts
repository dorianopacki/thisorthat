import type { Database } from "@/lib/database.types";

export type StudyStatus = Database["public"]["Enums"]["study_status"];

/**
 * Author-facing labels. Label the effective status (get_study_results.status or the
 * effective_status computed field), never studies.status alone: a study past its deadline keeps
 * status 'active' in the table (docs/reference/contract-surfaces.md#closing-rule).
 */
export const STATUS_LABELS: Readonly<Record<StudyStatus, string>> = {
  draft: "Szkic",
  active: "Trwa",
  closed: "Zakończone",
};
