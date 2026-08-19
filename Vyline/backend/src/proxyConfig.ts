/**
 * proxyConfig.ts — LINE 向け HTTP(S)/SOCKS プロキシ設定
 *
 * Bun は HTTP_PROXY / HTTPS_PROXY / ALL_PROXY を参照する。
 */

import { childLogger } from "./logger.js";

const log = childLogger("proxy");

export type ProxyConfig = {
  enabled: boolean;
  url: string;
};

let current: ProxyConfig = {
  enabled: Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY),
  url: process.env.ALL_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "",
};

export function getProxyConfig(): ProxyConfig {
  return { ...current };
}

export function setProxyConfig(next: ProxyConfig): ProxyConfig {
  current = {
    enabled: Boolean(next.enabled && next.url.trim()),
    url: next.url.trim(),
  };
  if (current.enabled) {
    process.env.HTTP_PROXY = current.url;
    process.env.HTTPS_PROXY = current.url;
    process.env.ALL_PROXY = current.url;
    log.info({ url: current.url.replace(/:[^:@/]+@/, ":***@") }, "proxy enabled");
  } else {
    process.env.HTTP_PROXY = undefined;
    process.env.HTTPS_PROXY = undefined;
    process.env.ALL_PROXY = undefined;
    log.info("proxy disabled");
  }
  return getProxyConfig();
}
