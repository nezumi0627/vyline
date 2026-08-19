/**
 * 通話 wire コンテキスト — Desktop / ログイン端末 identity を Planet・SIP に反映
 *
 * Desktop LINE 実測:
 *   Planet SETUP の UA.appReleaseInfo ≒ x-line-application (TAB 区切り)
 *   acquireCallRoute.fromEnvInfo.devname ≒ 端末表示名 (Windows / iPad / Android)
 */

import type * as LINETypes from "@vyline/line-types";
import type { Client } from "@vyline/protocol/stack";
import { defaultCallFromEnvInfo } from "@vyline/protocol/stack/call";
import type { DesktopProfile } from "../desktop/types.js";
import { getDesktopPcIdentity } from "../login/pcIdentity.js";
import { resolveDeviceMode, type VylineDeviceMode } from "../login/deviceMode.js";

/** Planet SETUP の UA — stack/planet/schema と同型 */
export interface PlanetUserAgent {
  osName: string;
  osVersion: string;
  deviceName: string;
  appVersion: string;
  engineVersion?: string;
  appReleaseInfo?: string;
  manufacturer?: string;
}

type DeviceDetails = Parameters<typeof defaultCallFromEnvInfo>[0];

export interface CallWireContext {
  localMid: string;
  deviceMode: VylineDeviceMode;
  deviceDetails: DeviceDetails;
  fromEnvInfo: Record<string, string>;
  planetUserAgent: PlanetUserAgent;
  sipUserAgent: string;
  transportKind: "planet" | "andromeda";
}

function deviceReleaseInfo(details: DeviceDetails): string {
  return `${details.device}\t${details.appVersion}\t${details.systemName}\t${details.systemVersion}`;
}

/** Desktop VylineProfile から Planet UA を合成（LINE.exe 追従） */
export function buildDesktopPlanetUserAgent(profile: DesktopProfile): PlanetUserAgent {
  const id = profile.identity;
  const pc = getDesktopPcIdentity();
  return {
    osName: "Windows",
    osVersion: id.systemVersion,
    deviceName: pc.modelName,
    appVersion: id.appVersion,
    engineVersion: id.appVersion,
    appReleaseInfo: id.xLineApplication,
    manufacturer: "Microsoft",
  };
}

/** ログイン端末 + Desktop profile から Planet UA（appVersion / appReleaseInfo の不一致を解消） */
export function buildPlanetUserAgent(
  details: DeviceDetails,
  desktopProfile?: DesktopProfile | null,
): PlanetUserAgent {
  if (desktopProfile && process.env.VYLINE_CALL_DESKTOP_WIRE === "1") {
    return buildDesktopPlanetUserAgent(desktopProfile);
  }

  if ((details.device === "DESKTOPWIN" || details.device === "DESKTOPMAC") && desktopProfile) {
    if (details.device === "DESKTOPMAC") {
      const id = desktopProfile.identity;
      return {
        osName: "Mac OS X",
        osVersion: details.systemVersion,
        deviceName: "Mac",
        appVersion: id.appVersion,
        engineVersion: id.appVersion,
        appReleaseInfo: deviceReleaseInfo(details),
        manufacturer: "Apple",
      };
    }
    return buildDesktopPlanetUserAgent(desktopProfile);
  }

  switch (details.device) {
    case "IOS":
    case "IOSIPAD":
      return {
        osName: "iOS",
        osVersion: details.systemVersion,
        deviceName: details.device === "IOSIPAD" ? "iPad" : "iPhone",
        appVersion: details.appVersion,
        engineVersion: details.appVersion,
        appReleaseInfo: deviceReleaseInfo(details),
        manufacturer: "Apple",
      };
    case "DESKTOPWIN":
      return {
        osName: "Windows",
        osVersion: details.systemVersion,
        deviceName: "Windows PC",
        appVersion: details.appVersion,
        engineVersion: details.appVersion,
        appReleaseInfo: deviceReleaseInfo(details),
        manufacturer: "Microsoft",
      };
    case "DESKTOPMAC":
      return {
        osName: "Mac OS X",
        osVersion: details.systemVersion,
        deviceName: "Mac",
        appVersion: details.appVersion,
        engineVersion: details.appVersion,
        appReleaseInfo: deviceReleaseInfo(details),
        manufacturer: "Apple",
      };
    default:
      return {
        osName: "Android",
        osVersion: details.systemVersion,
        deviceName: "Android",
        appVersion: details.appVersion,
        engineVersion: details.appVersion,
        appReleaseInfo: deviceReleaseInfo(details),
        manufacturer: "google",
      };
  }
}

export function buildSipUserAgent(
  details: DeviceDetails,
  desktopProfile?: DesktopProfile | null,
): string {
  if (desktopProfile && (details.device === "DESKTOPWIN" || details.device === "DESKTOPMAC")) {
    return desktopProfile.identity.userAgent;
  }
  return `Line/${details.appVersion}`;
}

export function describeRouteTransport(route: LINETypes.CallRoute): "planet" | "andromeda" {
  try {
    const comm = JSON.parse(route.commParam || "{}") as { mpkey?: string };
    return comm.mpkey ? "planet" : "andromeda";
  } catch {
    return "andromeda";
  }
}

export function buildCallWireContext(
  client: Client,
  route: LINETypes.CallRoute,
  opts?: { desktopProfile?: DesktopProfile | null; deviceMode?: VylineDeviceMode | string },
): CallWireContext {
  const deviceMode = resolveDeviceMode(opts?.deviceMode);
  const details = client.base.deviceDetails;
  const localMid = client.base.profile?.mid ?? "";
  const profile = opts?.desktopProfile ?? null;

  const planetUserAgent = buildPlanetUserAgent(details, profile);
  const sipUserAgent = buildSipUserAgent(details, profile);

  return {
    localMid,
    deviceMode,
    deviceDetails: details,
    fromEnvInfo: defaultCallFromEnvInfo(details),
    planetUserAgent,
    sipUserAgent,
    transportKind: describeRouteTransport(route),
  };
}
