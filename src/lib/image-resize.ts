// Browser-only: scales an author's image to MAX_IMAGE_EDGE on the long edge and encodes it as WebP
// (JPEG where the browser cannot encode WebP) at no more than MAX_IMAGE_BYTES. The Worker cannot
// transform images (context/foundation/infrastructure.md), so this is the only resize step; the server
// still sniffs and size-checks what arrives.
import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE } from "@/lib/study-limits";

/** Quality steps tried in order until the encoded file fits MAX_IMAGE_BYTES. */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

export class ImageResizeError extends Error {
  constructor(readonly reason: "unreadable" | "too_large") {
    super(reason);
    this.name = "ImageResizeError";
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/** The resized file, named `image.webp` or `image.jpg`. Throws ImageResizeError. */
export async function resizeImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // Phone photos carry their rotation in EXIF; apply it so the stored pixels are upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageResizeError("unreadable");
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ImageResizeError("unreadable");
  }
  // JPEG has no alpha: flatten onto white rather than black (transparency is not preserved).
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // A browser without a WebP encoder returns PNG for "image/webp"; from then on use JPEG.
  let type = "image/webp";
  for (const quality of QUALITY_STEPS) {
    let blob = await toBlob(canvas, type, quality);
    if (blob && type === "image/webp" && blob.type !== "image/webp") {
      type = "image/jpeg";
      blob = await toBlob(canvas, type, quality);
    }
    if (blob?.type === type && blob.size <= MAX_IMAGE_BYTES) {
      return new File([blob], type === "image/webp" ? "image.webp" : "image.jpg", { type });
    }
  }
  throw new ImageResizeError("too_large");
}
