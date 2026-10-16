import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseLinkCount } from "@/lib/link-count";
import { MAX_PARTICIPANTS } from "@/lib/study-limits";

const CLOSED_MESSAGE = "Badanie jest zakończone — nie można dodać linków.";
const LIMIT_MESSAGE = `Badanie może mieć najwyżej ${String(MAX_PARTICIPANTS)} linków.`;
const GENERIC_COUNT_MESSAGE = "Podaj poprawną liczbę linków.";
const GENERIC_MESSAGE = "Nie udało się dodać linków. Spróbuj ponownie.";

export const POST: APIRoute = async (context) => {
  const id = context.params.id ?? "";
  const studyUrl = `/studies/${encodeURIComponent(id)}`;
  const fail = (message: string) => context.redirect(`${studyUrl}?error=${encodeURIComponent(message)}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail("Supabase nie jest skonfigurowany.");

  // „od 1 do <max>” needs the live link count; a study the caller cannot see (or a failed read) has none,
  // so the message falls back to the generic one.
  const countMessage = async () => {
    const { count, error } = await supabase
      .from("study_links")
      .select("id", { count: "exact", head: true })
      .eq("study_id", id);
    if (error || !count) return GENERIC_COUNT_MESSAGE;
    const max = MAX_PARTICIPANTS - count;
    return max < 1 ? LIMIT_MESSAGE : `Podaj liczbę linków od 1 do ${String(max)}.`;
  };

  // Parsed here; the form's min/max are only a hint. An unusable count still goes to the RPC as 0, so the
  // database's check order decides the answer: not the caller's study (P0002), then not active (55000),
  // and only then the count (22023).
  const form = await context.request.formData().catch(() => null);
  const count = parseLinkCount(form?.get("count"));

  const { error } = await supabase.rpc("add_study_links", { p_study_id: id, p_count: count ?? 0 });

  if (error) {
    // Not the caller's study, or an id that is not a uuid (PostgREST answers 22P02): the study page
    // renders the 404 with a way back, so redirect there like every other form endpoint.
    if (error.code === "P0002" || error.code === "22P02") return context.redirect(studyUrl);
    // Draft, closed, or past its deadline (docs/reference/contract-surfaces.md#closing-rule).
    if (error.code === "55000") return fail(CLOSED_MESSAGE);
    // Over the cap or not a usable count: tell the author how many they can still add.
    if (error.code === "23514" || error.code === "22023") return fail(await countMessage());
    return fail(GENERIC_MESSAGE);
  }

  return context.redirect(`${studyUrl}?added=${String(count ?? 0)}`);
};
