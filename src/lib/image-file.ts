// Server-side image check: the type comes from the file's magic bytes, never from the declared MIME type
// or the file name. Only the two stored types pass (docs/reference/contract-surfaces.md#storage-variant-images).

export type StoredImageType = "webp" | "jpg";

/** The Content-Type each stored type is uploaded with. */
export const IMAGE_CONTENT_TYPES: Readonly<Record<StoredImageType, string>> = {
  webp: "image/webp",
  jpg: "image/jpeg",
};

/** Bytes `sniffImageType` needs to look at. */
export const IMAGE_SNIFF_BYTES = 12;

/** `webp` for `RIFF????WEBP`, `jpg` for `FF D8 FF`, null for anything else (PNG, text, a truncated file). */
export function sniffImageType(bytes: Uint8Array): StoredImageType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= IMAGE_SNIFF_BYTES && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** Sniffs a form file from its first bytes only. */
export async function sniffImageFile(file: Blob): Promise<StoredImageType | null> {
  return sniffImageType(new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer()));
}
