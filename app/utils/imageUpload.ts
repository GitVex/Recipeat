import { toRaw } from "vue";
import { MAX_IMAGE_BYTES, MAX_THUMB_BYTES } from "#shared/utils/images";

// A picture made into what the server keeps (#45): two JPEGs, about 1600 px
// and 400 px on the long edge, drawn from the file in this browser so the
// server never decodes anything. Drawing to a canvas drops EXIF, location
// included; the orientation is applied first, so nothing ends up sideways.

// A file this browser cannot draw. HEIC is the usual one: Safari reads it,
// Chrome and Firefox on a desktop do not.
export class UnreadableImage extends Error {}

function encode(bitmap: ImageBitmap, longEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new UnreadableImage())), "image/jpeg", quality),
  );
}

// The best quality that fits under the server's ceiling. At these sizes the
// first nearly always does.
async function fitted(bitmap: ImageBitmap, longEdge: number, max: number): Promise<Blob> {
  let blob: Blob | null = null;
  for (const quality of [0.85, 0.7, 0.5]) {
    blob = await encode(bitmap, longEdge, quality);
    if (blob.size <= max) return blob;
  }
  throw new UnreadableImage();
}

/** The multipart body the image routes take. */
export async function imageForm(file: Blob): Promise<FormData> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UnreadableImage();
  }
  try {
    const form = new FormData();
    form.append("image", await fitted(bitmap, 1600, MAX_IMAGE_BYTES), "image.jpg");
    form.append("thumb", await fitted(bitmap, 400, MAX_THUMB_BYTES), "thumb.jpg");
    return form;
  } finally {
    bitmap.close();
  }
}

export function uploadMessage(error: unknown): string {
  if (error instanceof UnreadableImage)
    return "This browser can’t read that picture. Save it as a JPEG and try again.";
  switch ((error as { statusCode?: number }).statusCode) {
    case undefined:
      return "We couldn’t reach Recipeat. Check your connection and try again.";
    case 401:
      return "You’ve been signed out. Sign in again to add photos.";
    case 409:
      return "These photos changed in the meantime. Reload the page and try again.";
    default:
      return "Something went wrong with that photo.";
  }
}

// A photo import's picture, held until the recipe it was read from is saved
// and can keep it. By the recipe object, raw, since the dialogs hand it round
// behind reactive proxies.
const kept = new WeakMap<object, File>();
export const keepSourcePhoto = (recipe: object, file: File) => kept.set(toRaw(recipe), file);
export const keptSourcePhoto = (recipe: object) => kept.get(toRaw(recipe)) ?? null;
