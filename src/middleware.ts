import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { requiresAuthor } from "@/lib/route-access";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  // Decide by the route the router matched, not context.url.pathname: the two disagree on
  // encoded dot segments (e.g. /api/studies/%252e%252e/start).
  if (requiresAuthor(context.routePattern) && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  return next();
});
