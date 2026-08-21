/**
 * OBS メディア取得（プロトコルスタック downloadMessageData の置換）。
 * metadata.name に依存せず blob だけ返す。
 */

export type ObsDownloadDeps = {
  authToken: string;
  systemType: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  prefix?: string;
};

export function obsMessageDataUrl(
  messageId: string,
  isPreview = false,
  square = false,
  prefix = process.env.VYLINE_OBS_PREFIX ?? "https://obs-jp.line-apps.com/",
): string {
  return `${prefix}r/${square ? "g2" : "talk"}/m/${encodeURIComponent(messageId)}${
    isPreview ? "/preview" : ""
  }`;
}

export async function downloadObsMessageBytes(
  deps: ObsDownloadDeps,
  messageId: string,
  opts: { preview?: boolean; square?: boolean; fallbackMime?: string } = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const preview = opts.preview ?? false;
  const square = opts.square ?? false;
  const url = obsMessageDataUrl(messageId, preview, square, deps.prefix);
  const res = await deps.fetch(url, {
    headers: {
      accept: "*/*",
      "x-line-application": deps.systemType,
      "x-Line-access": deps.authToken,
    },
  });
  if (!res.ok) {
    throw new Error(`OBS download failed: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob || blob.size === 0) {
    throw new Error("OBS download returned empty body");
  }
  const ab = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    contentType: blob.type || opts.fallbackMime || "application/octet-stream",
  };
}
