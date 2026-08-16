/**
 * 1:1 CallSession 生成 — Desktop 通話コンテキスト + Planet/Andromeda
 */

import type { DesktopProfile, NezuClient } from "@vyline/nezuline";
import {
  pickCallTransportForClient,
  describeCallRoute,
  type CallWireContext,
} from "@vyline/nezuline";
import { defaultCallFromEnvInfo, opusCodecFactory, type CallType } from "@vyline/nezuline/stack/call";
import type { CallSession } from "@vyline/nezuline/stack/call";
import { childLogger } from "../logger.js";

const log = childLogger("call:factory");

export interface DirectCallOpts {
  to: string;
  kind?: CallType;
  fromEnvInfo?: Record<string, string>;
  desktopProfile?: DesktopProfile;
}

type AcquiredRoute = Awaited<ReturnType<NezuClient["call"]["acquireRoute"]>>;

export interface DirectCallSessionResult {
  session: CallSession;
  route: AcquiredRoute;
  transportKind: "planet" | "andromeda";
  wire: CallWireContext;
}

export async function createDirectCallSession(
  client: NezuClient,
  opts: DirectCallOpts,
): Promise<DirectCallSessionResult> {
  const kind = opts.kind ?? "AUDIO";
  const fromEnvInfo =
    opts.fromEnvInfo ?? defaultCallFromEnvInfo(client.base.deviceDetails);

  const route = await client.call.acquireRoute({
    to: opts.to,
    callType: kind,
    fromEnvInfo,
  });

  const { transport, ctx } = pickCallTransportForClient(client, route, {
    ...(opts.desktopProfile ? { desktopProfile: opts.desktopProfile } : {}),
  });

  log.info(
    {
      to: opts.to,
      kind,
      transport: ctx.transportKind,
      device: ctx.deviceDetails.device,
      devname: fromEnvInfo.devname,
      planetOs: ctx.planetUserAgent.osName,
      planetRelease: ctx.planetUserAgent.appReleaseInfo,
      voip: route.voipAddress,
      port: route.voipUdpPort,
      fakeCall: route.fakeCall,
    },
    "call route acquired",
  );

  const codecs = await opusCodecFactory();
  client.call.setCodecFactory(codecs);

  const session = client.call.startSession({
    to: opts.to,
    kind,
    transport,
    preacquiredRoute: route,
    fromEnvInfo,
  });

  return {
    session,
    route,
    transportKind: describeCallRoute(route),
    wire: ctx,
  };
}
