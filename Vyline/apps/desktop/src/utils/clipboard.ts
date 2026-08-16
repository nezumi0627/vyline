/**
 * クリップボードへテキストをコピー。
 * Permissions-Policy で Clipboard API がブロックされる環境では execCommand にフォールバック。
 */
/** 同オリジン URL をダウンロード（/api/cdn/line や /api/line/media は same-origin） */
export function downloadUrl(url: string, filename: string): void {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // execCommand は user gesture 内で同期的に呼ぶと成功率が高い
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
