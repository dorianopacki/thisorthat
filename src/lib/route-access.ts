// Who may reach each route, keyed by Astro route pattern (`context.routePattern`). Every file under
// src/pages/ needs an entry: tests/unit/route-access.test.ts fails on an unclassified or stale one.
// The middleware protects by the pattern the router matched, never by the URL path string, so
// encoded or dot-segment paths cannot reach an author route under another name.

export type RouteAudience = "author" | "participant" | "public";

export const ROUTE_AUDIENCE: Readonly<Record<string, RouteAudience>> = {
  "/": "public",
  "/auth/signin": "public",
  "/auth/signup": "public",
  "/auth/confirm-email": "public",
  "/api/auth/signin": "public",
  "/api/auth/signup": "public",
  "/api/auth/signout": "public",

  "/dashboard": "author",
  "/studies/new": "author",
  "/studies/[id]": "author",
  "/api/studies": "author",
  "/api/studies/[id]/start": "author",
  "/api/studies/[id]/results": "author",

  "/v/[token]": "participant",
  "/api/v/[token]": "participant",
};

// Unknown patterns (Astro internals such as /_image, unmatched 404s) are not author routes.
export function requiresAuthor(routePattern: string): boolean {
  return ROUTE_AUDIENCE[routePattern] === "author";
}
