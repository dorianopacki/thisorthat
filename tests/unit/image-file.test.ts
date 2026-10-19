import { describe, expect, it } from "vitest";
import { sniffImageFile, sniffImageType } from "@/lib/image-file";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

// The stored type comes from the magic bytes only; the declared MIME type and file name are ignored.
describe("sniffImageType", () => {
  it("recognizes WebP by RIFF....WEBP", () => {
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("webp");
  });

  it("recognizes JPEG by FF D8 FF", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("jpg");
  });

  it("refuses PNG, which the bucket does not store", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBeNull();
  });

  it("refuses text", () => {
    expect(sniffImageType(ascii("hello, this is not an image"))).toBeNull();
  });

  it("refuses a RIFF container that is not WebP", () => {
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBeNull();
  });

  it("refuses a truncated WebP header", () => {
    expect(sniffImageType(ascii("RIFF\u0000\u0000"))).toBeNull();
  });
});

describe("sniffImageFile", () => {
  it("ignores the declared type of a text file named .webp", async () => {
    const file = new File(["not an image at all"], "fake.webp", { type: "image/webp" });
    expect(await sniffImageFile(file)).toBeNull();
  });

  it("reads the type of a real JPEG regardless of its declared type", async () => {
    const file = new File([bytes(0xff, 0xd8, 0xff, 0xdb, 1, 2, 3)], "photo.txt", { type: "text/plain" });
    expect(await sniffImageFile(file)).toBe("jpg");
  });
});
