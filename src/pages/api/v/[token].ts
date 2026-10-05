import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { MAX_COMMENT_LENGTH, charLength } from "@/lib/study-limits";
import { VOTED_COOKIE, votePath } from "@/lib/study-links";

const COMMENT_PREFIX = "comment:";
const GENERIC_MESSAGE = "Nie udało się wysłać głosu. Odśwież stronę i spróbuj ponownie.";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const POST: APIRoute = async (context) => {
  const token = context.params.token ?? "";
  const path = votePath(token);

  // The token is in the URL: keep it out of Referer, caches and indexes on every redirect.
  const redirect = (location: string) => {
    const response = context.redirect(location);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Robots-Tag", "noindex");
    return response;
  };
  const fail = (message: string) => redirect(`${path}?error=${encodeURIComponent(message)}`);

  // A same-browser hint for the page; one vote per link is enforced only by cast_vote.
  const markVoted = () => {
    context.cookies.set(VOTED_COOKIE, "1", {
      path,
      httpOnly: true,
      sameSite: "lax",
      secure: !import.meta.env.DEV,
      maxAge: ONE_YEAR_SECONDS,
    });
  };

  const form = await context.request.formData();

  const variantId = form.get("variant_id");
  if (typeof variantId !== "string" || !variantId.trim()) return fail("Wybierz wariant.");

  const comments: { variant_id: string; body: string }[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith(COMMENT_PREFIX) || typeof value !== "string") continue;
    // A native form POST sends textarea line breaks as CRLF; the island validated LF, so normalize
    // before measuring.
    const body = value.replace(/\r\n?/g, "\n").trim();
    if (!body) continue;
    if (charLength(body) > MAX_COMMENT_LENGTH) {
      return fail(`Komentarz może mieć najwyżej ${String(MAX_COMMENT_LENGTH)} znaków.`);
    }
    // cast_vote validates that the id is a variant of this study (22023 otherwise).
    comments.push({ variant_id: name.slice(COMMENT_PREFIX.length), body });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return fail(GENERIC_MESSAGE);

  const { data: outcome, error } = await supabase.rpc("cast_vote", {
    p_token: token,
    p_variant_id: variantId.trim(),
    p_comments: comments,
  });

  // 22023 (invalid variant/comment), 22P02 (not a uuid) and anything else: the link stays unused.
  if (error) return fail(GENERIC_MESSAGE);

  if (outcome === "accepted") {
    markVoted();
    return redirect(`${path}?status=accepted`);
  }
  if (outcome === "link_used") {
    markVoted();
    return redirect(`${path}?status=used`);
  }
  if (outcome === "study_ended") return redirect(path);

  return fail(GENERIC_MESSAGE);
};
