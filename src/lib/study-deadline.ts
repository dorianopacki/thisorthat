// The study deadline (studies.closes_at + closes_tz). The closing rule itself lives in the
// database (study_status_effective, docs/reference/contract-surfaces.md#closing-rule); this only
// formats the stored instant for the author.

/**
 * „15 czerwca 2030 18:00 (Europe/Warsaw)” — the instant in the zone the author set it in.
 * Server-rendered pages run on Workers in UTC, so the zone must be explicit.
 */
export function formatDeadline(closesAt: string, closesTz: string): string {
  const text = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: closesTz }).format(
    new Date(closesAt),
  );
  return `${text} (${closesTz})`;
}
