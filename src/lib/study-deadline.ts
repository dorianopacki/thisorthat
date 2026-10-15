// The study deadline (studies.closes_at + closes_tz). The closing rule itself lives in the
// database (study_status_effective, docs/reference/contract-surfaces.md#closing-rule); this only
// formats the stored instant for the author.

/**
 * „15 czerwca 2030 18:00 (Europe/Warsaw)” — the instant in the zone the author set it in.
 * Server-rendered pages run on Workers in UTC, so the zone must be explicit. A zone Intl cannot
 * format (create_study refuses those, but a direct insert can store one) falls back to UTC, so a bad
 * stored value never fails the page.
 */
export function formatDeadline(closesAt: string, closesTz: string): string {
  const instant = new Date(closesAt);
  try {
    const text = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: closesTz }).format(
      instant,
    );
    return `${text} (${closesTz})`;
  } catch {
    const text = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(
      instant,
    );
    return `${text} (UTC)`;
  }
}
