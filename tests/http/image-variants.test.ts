import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createStudy,
  describeResponse,
  newAuthor,
  redirectTarget,
  uniqueSuffix,
  variantFields,
  type Author,
  type VariantInput,
} from "./client";
import { BUCKET, WEBP_1PX, exists, signedImages, storageAs, webpFile } from "./storage";

// image-variants (S-08), author side: create with an image, the server's byte sniff and size limit, the
// replace and delete cleanup, and the draft/edit previews through signed URLs. Object existence is
// checked with a supabase-js client signed in as the fixture author (Storage RLS: own objects only).
// The storage policies and the RPCs' ownership checks are proven in pgTAP
// (supabase/tests/image_variants.test.sql); B against A is in author-isolation.test.ts.

const IMAGE_MESSAGE = "Grafika musi być plikiem WebP lub JPEG o rozmiarze najwyżej 1 MB.";
const MAX_IMAGE_BYTES = 1_048_576;
function createRequest(author: Author, title: string, variants: readonly VariantInput[]) {
  return author.request("/api/studies", {
    method: "POST",
    form: { title, participant_target: String(variants.length), ...variantFields(variants) },
  });
}

describe("image variants (author)", () => {
  let owner: Author;
  let storage: SupabaseClient;
  const run = uniqueSuffix();
  const leftovers: string[] = [];

  beforeAll(async () => {
    owner = await newAuthor();
    storage = await storageAs(owner);
  });

  afterAll(async () => {
    if (leftovers.length) await storage.storage.from(BUCKET).remove(leftovers);
  });

  it("create with a WebP shows it on the draft page through a signed URL that answers 200", async () => {
    const description = `Logo ${run}`;
    const id = await createStudy(owner, `Image create ${run}`, ["Tekst A", { description, image: webpFile() }]);

    const page = await owner.request(`/studies/${id}`);
    expect(page.status, describeResponse(page)).toBe(200);
    expect(page.body).toContain(`alt="${description}"`);
    const images = signedImages(page.body);
    expect(images).toHaveLength(1);
    const [image] = images;
    leftovers.push(image.path);

    const file = await fetch(image.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await file.arrayBuffer()).equals(WEBP_1PX)).toBe(true);
  });

  it("a text file named .webp is refused and nothing is stored", async () => {
    const before = await storage.storage.from(BUCKET).list();
    const fake = new File(["definitely not an image"], "fake.webp", { type: "image/webp" });
    const response = await createRequest(owner, `Image fake ${run}`, ["A", { description: "Fake", image: fake }]);
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/new?error=${encodeURIComponent(IMAGE_MESSAGE)}`);
    const after = await storage.storage.from(BUCKET).list();
    expect(after.data?.length).toBe(before.data?.length);
  });

  it("a file of 1 MiB + 1 byte is refused", async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1);
    bytes.set(WEBP_1PX);
    const big = new File([bytes], "big.webp", { type: "image/webp" });
    const response = await createRequest(owner, `Image big ${run}`, ["A", { description: "Big", image: big }]);
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/new?error=${encodeURIComponent(IMAGE_MESSAGE)}`);
  });

  it("the edit page prefills an image variant with its kept path and a signed preview", async () => {
    const description = `Kept ${run}`;
    const id = await createStudy(owner, `Image prefill ${run}`, ["A", { description, image: webpFile() }]);
    const [stored] = signedImages((await owner.request(`/studies/${id}`)).body);
    expect(stored).toBeDefined();
    leftovers.push(stored.path);

    const edit = await owner.request(`/studies/${id}/edit`);
    expect(edit.status, describeResponse(edit)).toBe(200);
    expect(edit.body).toContain(stored.path);
    // The island's preview URL appears twice (SSR'd <img> and serialized props); compare distinct paths.
    expect([...new Set(signedImages(edit.body).map((i) => i.path))]).toEqual([stored.path]);
  });

  it("an edit that replaces an image removes the old object; one that keeps it leaves it", async () => {
    const id = await createStudy(owner, `Image replace ${run}`, [
      { description: "Keep", image: webpFile() },
      { description: "Replace", image: webpFile() },
    ]);
    const before = signedImages((await owner.request(`/studies/${id}`)).body);
    expect(before).toHaveLength(2);
    const [kept, replaced] = before;
    leftovers.push(kept.path, replaced.path);

    const response = await owner.request(`/api/studies/${id}/update`, {
      method: "POST",
      form: {
        title: `Image replaced ${run}`,
        participant_target: "2",
        closes_local: "",
        closes_tz: "",
        ...variantFields([
          { description: "Keep", image_path: kept.path },
          { description: "Replaced", image: webpFile() },
        ]),
      },
    });
    expect(response.status, describeResponse(response)).toBe(302);
    expect(redirectTarget(response)).toBe(`/studies/${id}`);

    const now = signedImages((await owner.request(`/studies/${id}`)).body).map((i) => i.path);
    expect(now).toHaveLength(2);
    expect(now[0]).toBe(kept.path);
    expect(now[1]).not.toBe(replaced.path);
    leftovers.push(...now);

    expect(await exists(storage, kept.path)).toBe(true);
    expect(await exists(storage, replaced.path)).toBe(false);
    expect(await exists(storage, now[1])).toBe(true);
  });

  it("switching an image variant to text removes its object", async () => {
    const id = await createStudy(owner, `Image switch ${run}`, ["A", { description: "Gone", image: webpFile() }]);
    const [image] = signedImages((await owner.request(`/studies/${id}`)).body);
    expect(image).toBeDefined();
    leftovers.push(image.path);

    const response = await owner.request(`/api/studies/${id}/update`, {
      method: "POST",
      form: {
        title: `Image switched ${run}`,
        participant_target: "2",
        closes_local: "",
        closes_tz: "",
        ...variantFields(["A", "Now text"]),
      },
    });
    expect(redirectTarget(response)).toBe(`/studies/${id}`);
    expect(await exists(storage, image.path)).toBe(false);
  });

  it("deleting the study removes its objects", async () => {
    const id = await createStudy(owner, `Image delete ${run}`, [
      { description: "One", image: webpFile() },
      { description: "Two", image: webpFile() },
    ]);
    const images = signedImages((await owner.request(`/studies/${id}`)).body);
    expect(images).toHaveLength(2);
    leftovers.push(...images.map((i) => i.path));

    const response = await owner.request(`/api/studies/${id}/delete`, { method: "POST" });
    expect(redirectTarget(response)).toBe("/dashboard?deleted=1");
    for (const { path } of images) expect(await exists(storage, path)).toBe(false);
  });
});
