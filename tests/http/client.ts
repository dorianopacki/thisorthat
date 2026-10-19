// HTTP client for the http project, ported from scripts/smoke.mjs: manual redirects, an Origin header on
// every request (Astro's checkOrigin rejects form posts without it) and one cookie jar per client, so a
// test can hold several identities at once.
//
// Requests go through node:http, not fetch: fetch parses the path as a WHATWG URL and rewrites dot
// segments (including %2e%2e) before sending, so an encoded-path probe would test the client, not the app.
import http from "node:http";
import https from "node:https";

// BASE_URL arrives as TEST_BASE_URL (see vitest.config.ts); tests/http/setup.ts fails when it is unset.
const BASE = new URL(process.env.TEST_BASE_URL ?? "http://localhost:4321");
export const BASE_URL = BASE.origin;

/** Every test account's password, for a test that signs in to Supabase directly as a fixture author. */
export const TEST_PASSWORD = "Http-Test-Passw0rd!";
const PASSWORD = TEST_PASSWORD;

/** Form fields; a form with any File value is posted as multipart/form-data, otherwise urlencoded. */
export type Form = Readonly<Record<string, string | readonly string[] | File>>;

/** A variant as the wizard posts it: text, a new image with its description, or a kept image path. */
export type VariantInput = string | { description: string; image: File } | { description: string; image_path: string };

export interface RequestOptions {
  method?: string;
  form?: Form;
}

export interface HttpResponse {
  status: number;
  /** Raw Location header, "" when absent. Compare with `redirectTarget`. */
  location: string;
  body: string;
  setCookies: string[];
}

export interface Client {
  request(path: string, options?: RequestOptions): Promise<HttpResponse>;
}

export interface Author extends Client {
  email: string;
}

export interface StartedStudy {
  id: string;
  title: string;
  /** Participant link tokens, read from the owner's /studies/<id> page. */
  tokens: string[];
}

/** Unique per call, so suites can run repeatedly against the same database. */
export function uniqueSuffix(): string {
  return `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Path and query a redirect points to, resolved against BASE_URL ("" when there is no redirect). */
export function redirectTarget(response: HttpResponse): string {
  if (!response.location) return "";
  const url = new URL(response.location, BASE_URL);
  return url.origin === BASE_URL ? url.pathname + url.search : url.href;
}

/** "status location", for assertion messages. */
export function describeResponse(response: HttpResponse): string {
  return `${String(response.status)} ${response.location}`.trim();
}

/** The wizard's per-position variant fields (`variant.<i>.kind`, `.content`, `.image`, `.image_path`). */
export function variantFields(variants: readonly VariantInput[]): Record<string, string | File> {
  const fields: Record<string, string | File> = {};
  variants.forEach((variant, i) => {
    const prefix = `variant.${String(i)}`;
    if (typeof variant === "string") {
      fields[`${prefix}.kind`] = "text";
      fields[`${prefix}.content`] = variant;
      return;
    }
    fields[`${prefix}.kind`] = "image";
    fields[`${prefix}.content`] = variant.description;
    if ("image" in variant) fields[`${prefix}.image`] = variant.image;
    else fields[`${prefix}.image_path`] = variant.image_path;
  });
  return fields;
}

async function encodeForm(form: Form): Promise<{ body: Buffer; contentType: string }> {
  const entries = Object.entries(form);
  if (entries.some(([, value]) => value instanceof File)) {
    const data = new FormData();
    for (const [name, value] of entries) {
      if (value instanceof File) data.append(name, value);
      else for (const item of typeof value === "string" ? [value] : value) data.append(name, item);
    }
    // Request serializes the multipart body and picks its boundary.
    const encoded = new Request(BASE_URL, { method: "POST", body: data });
    return {
      body: Buffer.from(await encoded.arrayBuffer()),
      contentType: encoded.headers.get("content-type") ?? "",
    };
  }
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (value instanceof File) continue;
    for (const item of typeof value === "string" ? [value] : value) params.append(name, item);
  }
  return { body: Buffer.from(params.toString()), contentType: "application/x-www-form-urlencoded" };
}

function send(path: string, method: string, headers: Record<string, string>, body?: Buffer): Promise<HttpResponse> {
  const transport = BASE.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      { protocol: BASE.protocol, hostname: BASE.hostname, port: BASE.port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
            setCookies: res.headers["set-cookie"] ?? [],
          });
        });
        res.on("error", reject);
      },
    );
    // Fail with the request that hung instead of waiting for the test timeout.
    req.setTimeout(10_000, () => req.destroy(new Error(`timeout: ${method} ${path}`)));
    req.on("error", reject);
    req.end(body);
  });
}

/** A client with its own cookie jar. The path is sent exactly as written (no normalization). */
export function newClient(): Client {
  const jar = new Map<string, string>();

  function storeCookies(setCookies: string[]) {
    for (const raw of setCookies) {
      const [pair = "", ...attrs] = raw.split(";");
      const [name = "", ...rest] = pair.split("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired) jar.delete(name.trim());
      else jar.set(name.trim(), rest.join("="));
    }
  }

  return {
    async request(path, { method = "GET", form } = {}) {
      const headers: Record<string, string> = { Origin: BASE_URL };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const encoded = form ? await encodeForm(form) : undefined;
      if (encoded) headers["Content-Type"] = encoded.contentType;
      const response = await send(path, method, headers, encoded?.body);
      storeCookies(response.setCookies);
      return response;
    },
  };
}

function expectRedirect(step: string, response: HttpResponse, target: string) {
  if (response.status !== 302 || !redirectTarget(response).startsWith(target)) {
    throw new Error(`${step}: expected 302 -> ${target}, got ${String(response.status)} ${response.location}`);
  }
}

/** Signs a fresh account in through the app, using the scripts/smoke.mjs sequence (signup, then signin). */
export async function signUpAndSignIn(client: Client, email: string): Promise<HttpResponse> {
  const signup = await client.request("/api/auth/signup", { method: "POST", form: { email, password: PASSWORD } });
  expectRedirect("signup", signup, "/auth/confirm-email");
  const signin = await client.request("/api/auth/signin", { method: "POST", form: { email, password: PASSWORD } });
  expectRedirect("signin", signin, "/");
  if (redirectTarget(signin) !== "/") throw new Error(`signin: expected 302 -> /, got ${signin.location}`);
  return signin;
}

/** A signed-in author with a unique account per call. */
export async function newAuthor(): Promise<Author> {
  const client = newClient();
  const email = `http-${uniqueSuffix()}@example.com`;
  await signUpAndSignIn(client, email);
  return { ...client, email };
}

/** Creates a study through POST /api/studies and returns its id (from the redirect to /studies/<id>). */
export async function createStudy(author: Client, title: string, variants: readonly VariantInput[] = ["A", "B"]) {
  const response = await author.request("/api/studies", {
    method: "POST",
    form: { title, participant_target: String(variants.length), ...variantFields(variants) },
  });
  const match = /^\/studies\/([^/?]+)$/.exec(redirectTarget(response));
  if (response.status !== 302 || !match?.[1]) {
    throw new Error(`create study: expected 302 -> /studies/<id>, got ${String(response.status)} ${response.location}`);
  }
  return match[1];
}

/** Creates and starts a study as `author`, then reads its participant tokens from the owner's page. */
export async function createStartedStudy(
  author: Client,
  title = `Started ${uniqueSuffix()}`,
  variants: readonly VariantInput[] = ["A", "B"],
): Promise<StartedStudy> {
  const id = await createStudy(author, title, variants);

  const start = await author.request(`/api/studies/${id}/start`, { method: "POST" });
  if (start.status !== 302 || redirectTarget(start) !== `/studies/${id}`) {
    throw new Error(`start study: expected 302 -> /studies/${id}, got ${String(start.status)} ${start.location}`);
  }

  const page = await author.request(`/studies/${id}`);
  if (page.status !== 200) throw new Error(`owner page: expected 200, got ${String(page.status)}`);
  const tokens = [...new Set([...page.body.matchAll(/\/v\/([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  if (!tokens.length) throw new Error(`owner page /studies/${id} shows no /v/<token> link`);

  return { id, title, tokens };
}
