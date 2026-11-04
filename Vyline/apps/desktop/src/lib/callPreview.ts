import type { CallMessageMeta } from "./store-types.js";

/**
 * 通話の記録の一覧用の表示。バックエンドの callPreviewLabel と同じ言い方にそろえる
 * （開いているトークは画面側、開いていないトークはバックエンドがプレビューを作るため）。
 */
export function callPreviewLabel(meta: CallMessageMeta | undefined): string {
  const video = meta?.video === true;
  const kind = meta?.group
    ? video
      ? "グループビデオ通話"
      : "グループ通話"
    : video
      ? "ビデオ通話"
      : "音声通話";
  return meta?.outcome === "missed" ? `不在着信 · ${kind}` : kind;
}
