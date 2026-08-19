/**
 * transport 選択 — commParam.mpkey → Planet、それ以外 → Andromeda
 * Desktop / ログイン端末 UA を Planet・SIP に渡す
 */

import type * as LINETypes from "@vyline/line-types";
import {
  AndromedaTransport,
  PlanetTransport,
  type CallTransport,
} from "@vyline/protocol/stack/call";
import type { CallWireContext } from "./context.js";
import { buildCallWireContext, describeRouteTransport } from "./context.js";
import type { Client } from "@vyline/protocol/stack";
import type { DesktopProfile } from "../desktop/types.js";

export function describeCallRoute(route: LINETypes.CallRoute): "planet" | "andromeda" {
  return describeRouteTransport(route);
}

export function pickCallTransport(route: LINETypes.CallRoute, ctx: CallWireContext): CallTransport {
  if (ctx.transportKind === "planet") {
    const opts: ConstructorParameters<typeof PlanetTransport>[0] = {
      localMid: ctx.localMid,
      userAgent: ctx.planetUserAgent,
    };
    if (ctx.planetUserAgent.appReleaseInfo) {
      opts.deviceInfo = ctx.planetUserAgent.appReleaseInfo;
    }
    return new PlanetTransport(opts);
  }
  return new AndromedaTransport({
    localMid: ctx.localMid,
    userAgent: ctx.sipUserAgent,
  });
}

/** client + route から wire コンテキスト付き transport */
export function pickCallTransportForClient(
  client: Client,
  route: LINETypes.CallRoute,
  opts?: { desktopProfile?: DesktopProfile | null; deviceMode?: string },
): { transport: CallTransport; ctx: CallWireContext } {
  const ctx = buildCallWireContext(client, route, opts);
  return { transport: pickCallTransport(route, ctx), ctx };
}
