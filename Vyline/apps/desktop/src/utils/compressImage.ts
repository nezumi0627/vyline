/**
 * utils/compressImage.ts — 送信画像のクライアント側圧縮
 *
 * LINE 本体同様、長辺 2048px に縮小し JPEG(0.85) で送る。
 * 非画像・GIF（アニメ）・デコード失敗時は元ファイルのまま返す。
 */

export const IMAGE_MAX_DIMENSION = 2048;
export const IMAGE_QUALITY = 0.85;

export async function compressImageFile(
  file: File,
): Promise<{ blob: Blob; mime: string; compressed: boolean }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return { blob: file, mime: file.type || "application/octet-stream", compressed: false };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size <= 2_000_000) {
      // 小さい画像は再エンコードせずそのまま（画質維持）
      bitmap.close();
      return { blob: file, mime: file.type, compressed: false };
    }
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { blob: file, mime: file.type, compressed: false };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY),
    );
    if (!blob || blob.size <= 0) return { blob: file, mime: file.type, compressed: false };
    return { blob, mime: "image/jpeg", compressed: true };
  } catch {
    return { blob: file, mime: file.type, compressed: false };
  }
}
