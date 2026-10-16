import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ROUTE_AUDIENCE, type RouteAudience } from "@/lib/route-access";
import {
  createStartedStudy,
  describeResponse,
  newClient,
  redirectTarget,
  signUpAndSignIn,
  uniqueSuffix,
  type Form,
  type HttpResponse,
  type StartedStudy,
} from "./client";

const SIGN_IN = "/auth/signin";

interface Probe {
  method: "GET" | "POST";
  form?: Form;
}

// The real methods of each route, with a realistic body for form endpoints. Every ROUTE_AUDIENCE entry
// needs a row: a route added to the map without one fails "has a probe row" below.
const PROBES: Readonly<Record<string, readonly Probe[]>> = {
  "/": [{ method: "GET" }],
  "/auth/signin": [{ method: "GET" }],
  "/auth/signup": [{ method: "GET" }],
  "/auth/confirm-email": [{ method: "GET" }],
  "/api/auth/signin": [{ method: "POST", form: { email: "nobody@example.com", password: "wrong-password" } }],
  "/api/auth/signup": [{ method: "POST", form: { email: "not-an-email", password: "x" } }],
  "/api/auth/signout": [{ method: "POST" }],

  "/dashboard": [{ method: "GET" }],
  "/studies/new": [{ method: "GET" }],
  "/studies/[id]": [{ method: "GET" }],
  "/studies/[id]/edit": [{ method: "GET" }],
  "/api/studies": [{ method: "POST", form: { title: "Anonymous", participant_target: "2", variant: ["A", "B"] } }],
  "/api/studies/[id]/start": [{ method: "POST" }],
  "/api/studies/[id]/close": [{ method: "POST" }],
  "/api/studies/[id]/results": [{ method: "GET" }],
  "/api/studies/[id]/update": [
    {
      method: "POST",
      form: {
        title: "Anonymous",
        participant_target: "2",
        variant: ["A", "B"],
        closes_local: "2099-06-15T18:00",
        closes_tz: "Europe/Warsaw",
      },
    },
  ],
  "/api/studies/[id]/delete": [{ method: "POST" }],

  "/v/[token]": [{ method: "GET" }],
  "/api/v/[token]": [{ method: "POST", form: { variant_id: randomUUID() } }],
};

// Sample values for dynamic segments: a uuid nobody owns, a token no link has.
function samplePath(pattern: string): string {
  return pattern.replace("[id]", randomUUID()).replace("[token]", randomBytes(16).toString("hex"));
}

function isSignInRedirect(response: HttpResponse): boolean {
  return response.status === 302 && redirectTarget(response) === SIGN_IN;
}

// The audience of the route a concrete path would match, or undefined when it matches none.
function audienceOf(path: string): RouteAudience | undefined {
  const match = Object.entries(ROUTE_AUDIENCE).find(([pattern]) =>
    new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`).test(path),
  );
  return match?.[1];
}

function requiresAuthorOrUnknown(path: string): boolean {
  const audience = audienceOf(path);
  return audience === undefined || audience === "author";
}

const entries = Object.entries(ROUTE_AUDIENCE);
const cases = entries.flatMap(([pattern, audience]) =>
  (PROBES[pattern] ?? []).map((probe) => ({ pattern, audience, ...probe })),
);
const casesFor = (audiences: readonly RouteAudience[]) => cases.filter((c) => audiences.includes(c.audience));

describe("route probe table", () => {
  it.each(entries)("%s (%s) has a probe row", (pattern) => {
    expect(Object.hasOwn(PROBES, pattern), `add ${pattern} to PROBES in tests/http/route-access.test.ts`).toBe(true);
  });

  it.each(Object.keys(PROBES))("%s probe row is in ROUTE_AUDIENCE", (pattern) => {
    expect(Object.hasOwn(ROUTE_AUDIENCE, pattern), `${pattern} has no ROUTE_AUDIENCE entry`).toBe(true);
  });
});

describe("anonymous route matrix", () => {
  it.each(casesFor(["author"]))("$method $pattern ($audience) redirects anonymous to sign-in", async (probe) => {
    const response = await newClient().request(samplePath(probe.pattern), probe);
    expect(isSignInRedirect(response), describeResponse(response)).toBe(true);
  });

  it.each(casesFor(["participant", "public"]))(
    "$method $pattern ($audience) answers anonymous without a sign-in redirect or a 5xx",
    async (probe) => {
      const response = await newClient().request(samplePath(probe.pattern), probe);
      expect(isSignInRedirect(response), describeResponse(response)).toBe(false);
      expect(response.status, describeResponse(response)).toBeLessThan(500);
    },
  );
});

// Encoded and normalization variants of every author route. The only acceptable answers are the sign-in
// redirect or 404 (no route matched); a 2xx, a 5xx or any other redirect means a handler ran anonymously.
// Single-encoded dots (%2e%2e) are not here: the URL standard reads them as "..", see the next block.
function pathVariants(pattern: string): { variant: string; path: string }[] {
  const path = samplePath(pattern);
  const variants = [
    { variant: "trailing slash", path: `${path}/` },
    {
      variant: "percent-encoded letter",
      path: `/%${path.charCodeAt(1).toString(16)}${path.slice(2)}`,
    },
  ];
  if (pattern.includes("[id]")) {
    variants.push({ variant: "%252e%252e as [id]", path: pattern.replace("[id]", "%252e%252e") });
  }
  return variants;
}

// %2e%2e and %2E%2e are a plain ".." under the URL standard, so the server resolves them before routing
// (/studies/%2e%2e -> /). Their answer must equal the answer for the resolved path itself; if that path
// is an author route or no route, the sign-in-or-404 rule above applies as well.
const dotCases = casesFor(["author"])
  .filter((probe) => probe.pattern.includes("[id]"))
  .flatMap((probe) =>
    ["%2e%2e", "%2E%2e"].map((dots) => {
      const path = probe.pattern.replace("[id]", dots);
      return { ...probe, dots, path, resolved: new URL(path, "http://resolve.invalid").pathname };
    }),
  );

const variantCases = casesFor(["author"]).flatMap((probe) =>
  pathVariants(probe.pattern).map((v) => ({ ...probe, ...v })),
);

describe("author route path variants", () => {
  it.each(variantCases)(
    "$method $pattern ($variant: $path) answers anonymous with sign-in redirect or 404",
    async (probe) => {
      const response = await newClient().request(probe.path, probe);
      expect(isSignInRedirect(response) || response.status === 404, describeResponse(response)).toBe(true);
    },
  );

  it.each(dotCases)("$method $pattern ($dots as [id]: resolves to $resolved) answers like $resolved", async (probe) => {
    const viaDots = await newClient().request(probe.path, probe);
    const direct = await newClient().request(probe.resolved, probe);
    expect(
      { status: viaDots.status, target: redirectTarget(viaDots) },
      `${describeResponse(viaDots)} vs ${describeResponse(direct)}`,
    ).toEqual({ status: direct.status, target: redirectTarget(direct) });
    expect(viaDots.status, describeResponse(viaDots)).toBeLessThan(500);
    if (requiresAuthorOrUnknown(probe.resolved)) {
      expect(isSignInRedirect(viaDots) || viaDots.status === 404, describeResponse(viaDots)).toBe(true);
    }
  });

  it.each([
    ["GET", "/api/studiesX"],
    ["POST", "/api/studiesX"],
    ["GET", "/studiesfoo"],
    ["POST", "/studiesfoo"],
  ] as const)("%s %s (prefix collision) answers 404", async (method, path) => {
    const response = await newClient().request(path, { method });
    expect(response.status, describeResponse(response)).toBe(404);
  });
});

describe("participant link and session cookies", () => {
  let signin: HttpResponse;
  let study: StartedStudy;

  beforeAll(async () => {
    const owner = newClient();
    signin = await signUpAndSignIn(owner, `http-${uniqueSuffix()}@example.com`);
    study = await createStartedStudy(owner);
  });

  it("GET /v/<token> from a started study's owner page answers 200 with the ballot, anonymously", async () => {
    const response = await newClient().request(`/v/${study.tokens[0] ?? ""}`);
    expect(response.status, describeResponse(response)).toBe(200);
    expect(response.body).toContain(study.title);
  });

  it("sign-in sets sb- session cookies with Path=/, SameSite=Lax and Secure", () => {
    const sessionCookies = signin.setCookies.filter((cookie) => cookie.startsWith("sb-"));
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      const [pair = "", ...rest] = cookie.split(";");
      const attrs = rest.map((a) => a.trim().toLowerCase());
      const name = pair.split("=")[0] ?? "";
      expect(attrs, `${name} Path`).toContain("path=/");
      expect(attrs, `${name} SameSite`).toContain("samesite=lax");
      expect(attrs, `${name} Secure`).toContain("secure");
    }
  });
});
