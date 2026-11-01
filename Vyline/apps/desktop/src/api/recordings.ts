import type {
  CallRecording,
  RecordingKind,
  RecordingPreferences,
  RecordingPathSuggestions,
  RecordingTarget,
} from "@vyline/types";
import { captureBackendFetch } from "./client";

export type RecordingSettingsResponse = {
  preferences: RecordingPreferences;
  targets: RecordingTarget[];
  roots: Array<{ path: string; available: boolean; freeBytes: number }>;
  credentialProtection: string;
};
export class RecordingRequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
export function recordingFileUrl(owner: string, id: string, download = false) {
  return `/api/line/${encodeURIComponent(owner)}/recordings/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`;
}
export function recordingClient(owner: string) {
  const fetch = captureBackendFetch();
  const base = `/line/${encodeURIComponent(owner)}/recordings`;
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    offset?: number,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        headers:
          body instanceof Blob
            ? { "Content-Type": "application/octet-stream", "X-Recording-Offset": String(offset) }
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      });
    } catch {
      throw new RecordingRequestError("記録をサーバーに送信できませんでした");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true)
      throw new RecordingRequestError(
        typeof data?.error === "string"
          ? data.error
          : `記録の処理に失敗しました（HTTP ${response.status}）`,
        response.status,
      );
    return data;
  }
  return {
    paths: (prefix: string, signal?: AbortSignal) =>
      request<RecordingPathSuggestions>(
        `/paths?prefix=${encodeURIComponent(prefix)}`,
        "GET",
        undefined,
        signal,
      ),
    settings: () => request<RecordingSettingsResponse>("/settings"),
    saveSettings: (preferences: RecordingPreferences) =>
      request<{ preferences: RecordingPreferences }>("/settings", "PUT", preferences),
    addTarget: (target: Omit<RecordingTarget, "id" | "hasPassword"> & { password?: string }) =>
      request<{ target: RecordingTarget }>("/targets", "POST", target),
    testTarget: (id: string) => request(`/targets/${encodeURIComponent(id)}/test`, "POST"),
    removeTarget: (id: string) => request(`/targets/${encodeURIComponent(id)}`, "DELETE"),
    list: (cursor?: string) =>
      request<{ items: CallRecording[]; nextCursor: string | null }>(
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : "",
      ),
    start: async (input: {
      sessionId: string;
      title: string;
      kind: RecordingKind;
      mimeType: string;
      consentAccepted: boolean;
    }) => (await request<{ recording: CallRecording }>("/start", "POST", input)).recording,
    append: async (id: string, offset: number, body: Blob, signal?: AbortSignal) =>
      (await request<{ recording: CallRecording }>(`/${id}/chunks`, "PUT", body, signal, offset))
        .recording,
    finish: async (id: string, durationMs: number, interrupted: boolean, signal?: AbortSignal) =>
      (
        await request<{ recording: CallRecording }>(
          `/${id}/finish`,
          "POST",
          { durationMs, interrupted },
          signal,
        )
      ).recording,
    retry: (id: string) => request(`/${encodeURIComponent(id)}/retry`, "POST"),
    remove: (id: string) => request(`/${encodeURIComponent(id)}`, "DELETE"),
  };
}
