/**
 * CallDomain — 1:1 通話 facade
 */

import type { Client } from "./types.js";
import { buildCallWireContext, describeCallRoute, pickCallTransport } from "../call/index.js";
import type * as LINETypes from "@vyline/line-types";
import type { CallType } from "@vyline/protocol/stack/call";

export class CallDomain {
  constructor(private readonly client: Client) {}

  acquireRoute(to: string, callType: CallType = "AUDIO") {
    return this.client.call.acquireRoute({ to, callType });
  }

  pickTransport(route: LINETypes.CallRoute) {
    const ctx = buildCallWireContext(this.client, route);
    return pickCallTransport(route, ctx);
  }

  routeKind(route: LINETypes.CallRoute) {
    return describeCallRoute(route);
  }
}
