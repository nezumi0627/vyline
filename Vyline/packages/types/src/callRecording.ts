export type RecordingKind = "audio" | "video";
export type RecordingPathSuggestions = { items: string[]; truncated: boolean };
export type CallRecording = {
  id: string;
  sessionId: string;
  chatMid: string;
  title: string;
  kind: RecordingKind;
  mimeType: string;
  state: "recording" | "ready" | "interrupted";
  bytes: number;
  maxBytes: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  targetId: string | null;
  transfer: "pending" | "complete" | "error" | null;
  error?: string;
};
export type RecordingPreferences = {
  automatic: boolean;
  kind: RecordingKind;
  retentionDays: number;
  targetId: string | null;
  consentAccepted: boolean;
};
export type RecordingTarget = {
  id: string;
  name: string;
  kind: "local" | "webdav";
  path: string;
  username?: string;
  hasPassword?: boolean;
  allowPrivateNetwork?: boolean;
  allowInsecureHttp?: boolean;
};
