import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: HEADERS });

// Polled by the StudyResults island. Returns get_study_results unchanged and adds nothing
// (no server time, no ETag): see docs/reference/contract-surfaces.md#results-view.
export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return json({ error: "server_error" }, 500);

  const { data, error } = await supabase.rpc("get_study_results", { p_study_id: context.params.id ?? "" });

  if (error) {
    // An id that is not a uuid (PostgREST answers 22P02) is a 404 like someone else's study.
    if (error.code === "22P02") return json({ error: "not_found" }, 404);
    return json({ error: "server_error" }, 500);
  }
  // null: the caller does not own the study, or it does not exist.
  if (data === null) return json({ error: "not_found" }, 404);

  return json(data, 200);
};
