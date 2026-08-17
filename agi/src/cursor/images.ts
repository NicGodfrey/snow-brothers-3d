import { AgiError } from "../errors.ts";
import type { PromptImage } from "./types.ts";

const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function normalizeImages(images: unknown): PromptImage[] | undefined {
  if (images == null) return undefined;
  if (!Array.isArray(images)) {
    throw new AgiError("invalid_images", "images must be an array", 400);
  }
  if (images.length === 0) return undefined;
  if (images.length > 5) {
    throw new AgiError("too_many_images", "At most 5 images are allowed", 400);
  }
  return images.map((raw, index) => {
    const img =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const mimeType = typeof img.mimeType === "string" ? img.mimeType : undefined;
    if (mimeType && !MIME.has(mimeType)) {
      throw new AgiError(
        "invalid_image_type",
        `Image ${index} has unsupported mimeType (png, jpeg, gif, webp)`,
        400,
      );
    }
    const data = typeof img.data === "string" ? img.data : undefined;
    const url = typeof img.url === "string" ? img.url : undefined;
    if (!data && !url) {
      throw new AgiError(
        "invalid_image",
        `Image ${index} needs data or url`,
        400,
      );
    }
    return { data, mimeType, url };
  });
}
