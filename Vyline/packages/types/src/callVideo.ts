/** Video-only call WebSocket. PCM keeps its existing binary contract. */
export const CALL_VIDEO_MAX_BYTES = 0x3ffff - 3;

export interface CallVideoFrame {
  /** Raw VP8, matching negotiated normal-video. */
  data: Uint8Array;
  key: boolean;
  timestamp: number;
  rotation?: number;
  /** Server-assigned participant identity; absent for 1:1 and browser uploads. */
  sourceMid?: string;
}

export interface CallVideoState {
  available: boolean;
  localEnabled: boolean;
  remoteEnabled: boolean;
}

export function encodeCallVideoFrame(frame: CallVideoFrame): Uint8Array {
  if (
    !Number.isInteger(frame.timestamp) ||
    frame.timestamp < 0 ||
    frame.timestamp > 0xffffffff ||
    !Number.isInteger(frame.rotation ?? 0) ||
    (frame.rotation ?? 0) < 0 ||
    (frame.rotation ?? 0) > 3 ||
    (frame.sourceMid !== undefined && !/^u[0-9a-f]{32}$/.test(frame.sourceMid)) ||
    frame.data.length < 1 ||
    frame.data.length > CALL_VIDEO_MAX_BYTES
  )
    throw new Error("Invalid video frame");
  const headerBytes = frame.sourceMid ? 41 : 8;
  const packet = new Uint8Array(headerBytes + frame.data.length);
  packet.set([frame.sourceMid ? 2 : 1, Number(frame.key), frame.rotation ?? 0, 0]);
  new DataView(packet.buffer).setUint32(4, frame.timestamp);
  if (frame.sourceMid) packet.set(new TextEncoder().encode(frame.sourceMid), 8);
  packet.set(frame.data, headerBytes);
  return packet;
}

export function decodeCallVideoFrame(packet: Uint8Array): CallVideoFrame {
  const headerBytes = packet[0] === 2 ? 41 : 8;
  const sourceMid = packet[0] === 2 ? new TextDecoder().decode(packet.subarray(8, 41)) : undefined;
  if (
    packet.length <= headerBytes ||
    packet.length > CALL_VIDEO_MAX_BYTES + headerBytes ||
    (packet[0] !== 1 && packet[0] !== 2) ||
    (sourceMid !== undefined && !/^u[0-9a-f]{32}$/.test(sourceMid)) ||
    packet[1]! > 1 ||
    packet[2]! > 3 ||
    packet[3] !== 0
  )
    throw new Error("Invalid video frame");
  return {
    key: packet[1] === 1,
    rotation: packet[2]!,
    timestamp: new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(4),
    data: packet.subarray(headerBytes),
    ...(sourceMid ? { sourceMid } : {}),
  };
}
