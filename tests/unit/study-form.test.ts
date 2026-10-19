import { describe, expect, it } from "vitest";
import {
  IMAGE_MESSAGE,
  keptImagePaths,
  newImageFiles,
  readStudyForm,
  studyRpcArgs,
  validateStudyForm,
  type StudyForm,
} from "@/lib/study-form";
import { MAX_IMAGE_BYTES } from "@/lib/study-limits";

const KEPT = "11111111-1111-4111-8111-111111111111.webp";

function webp(size = 64, name = "image.webp"): File {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBP"));
  return new File([bytes], name, { type: "image/webp" });
}

function formData(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

const base = { title: "Badanie", participant_target: "2" };

describe("readStudyForm", () => {
  it("reads indexed variants of mixed kinds in index order, not field order", () => {
    const image = webp();
    const fields = readStudyForm(
      formData({
        ...base,
        "variant.1.kind": "image",
        "variant.1.content": "Logo B",
        "variant.1.image": image,
        "variant.0.kind": "text",
        "variant.0.content": "Tekst A\r\nlinia 2",
      }),
    );
    expect(fields.variants).toEqual([
      { kind: "text", content: "Tekst A\nlinia 2" },
      { kind: "image", content: "Logo B", image },
    ]);
  });

  it("treats a missing kind as text and an unknown kind as null", () => {
    const fields = readStudyForm(
      formData({ ...base, "variant.0.content": "A", "variant.1.kind": "video", "variant.1.content": "B" }),
    );
    expect(fields.variants.map((v) => v.kind)).toEqual(["text", null]);
  });

  it("ignores the empty file an untouched file input posts and keeps the kept path", () => {
    const fields = readStudyForm(
      formData({
        ...base,
        "variant.0.kind": "image",
        "variant.0.content": "Opis",
        "variant.0.image": new File([], ""),
        "variant.0.image_path": KEPT,
      }),
    );
    expect(fields.variants).toEqual([{ kind: "image", content: "Opis", image_path: KEPT }]);
  });

  it("drops image fields from a text variant", () => {
    const fields = readStudyForm(
      formData({ ...base, "variant.0.content": "A", "variant.0.image": webp(), "variant.0.image_path": KEPT }),
    );
    expect(fields.variants).toEqual([{ kind: "text", content: "A" }]);
  });
});

function study(variants: StudyForm["variants"]): StudyForm {
  return { title: "Badanie", participantTarget: "2", variants, closesLocal: "", closesTz: "" };
}

describe("validateStudyForm with image variants", () => {
  it("accepts a new image next to a text variant", async () => {
    const form = study([
      { kind: "text", content: "A" },
      { kind: "image", content: "Logo", image: webp() },
    ]);
    expect(await validateStudyForm(form)).toBeNull();
  });

  it("refuses an image variant without a file or kept path", async () => {
    const form = study([
      { kind: "text", content: "A" },
      { kind: "image", content: "Logo" },
    ]);
    expect(await validateStudyForm(form)).toBe("Dodaj grafikę do wariantu.");
  });

  it("refuses a 201-character description and accepts 200", async () => {
    const over = study([
      { kind: "text", content: "A" },
      { kind: "image", content: "x".repeat(201), image: webp() },
    ]);
    expect(await validateStudyForm(over)).toBe("Opis grafiki może mieć najwyżej 200 znaków.");

    const limit = study([
      { kind: "text", content: "A" },
      { kind: "image", content: "x".repeat(200), image: webp() },
    ]);
    expect(await validateStudyForm(limit)).toBeNull();
  });

  it("refuses a text file posted as .webp and a file over 1 MiB", async () => {
    const fake = new File(["not an image"], "fake.webp", { type: "image/webp" });
    expect(
      await validateStudyForm(
        study([
          { kind: "text", content: "A" },
          { kind: "image", content: "Logo", image: fake },
        ]),
      ),
    ).toBe(IMAGE_MESSAGE);
    expect(
      await validateStudyForm(
        study([
          { kind: "text", content: "A" },
          { kind: "image", content: "Logo", image: webp(MAX_IMAGE_BYTES + 1) },
        ]),
      ),
    ).toBe(IMAGE_MESSAGE);
  });

  it("accepts a kept path only when it is one of the draft's current images", async () => {
    const form = study([
      { kind: "text", content: "A" },
      { kind: "image", content: "Logo", image_path: KEPT },
    ]);
    expect(await validateStudyForm(form, { currentImagePaths: new Set([KEPT]) })).toBeNull();
    // Create has no current images, so a posted path is always refused there.
    expect(await validateStudyForm(form)).toBe("Nie znaleziono grafiki wariantu. Wybierz plik ponownie.");
  });

  it("refuses an unknown variant kind", async () => {
    const form = study([
      { kind: "text", content: "A" },
      { kind: null, content: "B" },
    ]);
    expect(await validateStudyForm(form)).toBe("Nieznany rodzaj wariantu.");
  });
});

describe("studyRpcArgs with image variants", () => {
  it("puts uploaded paths on new images in order, keeps kept paths, and nulls text paths", () => {
    const first = webp();
    const second = webp();
    const form = study([
      { kind: "image", content: "Nowa 1", image: first },
      { kind: "text", content: "Tekst" },
      { kind: "image", content: "Stara", image_path: KEPT },
      // A new file wins over a kept path.
      { kind: "image", content: "Nowa 2", image: second, image_path: KEPT },
    ]);

    expect(newImageFiles(form)).toEqual([first, second]);
    expect(keptImagePaths(form)).toEqual([KEPT]);
    expect(studyRpcArgs(form, ["new-1.webp", "new-2.jpg"]).p_variant_items).toEqual([
      { kind: "image", content: "Nowa 1", image_path: "new-1.webp" },
      { kind: "text", content: "Tekst", image_path: null },
      { kind: "image", content: "Stara", image_path: KEPT },
      { kind: "image", content: "Nowa 2", image_path: "new-2.jpg" },
    ]);
  });
});
