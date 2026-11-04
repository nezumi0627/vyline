import { WhatsNewView } from "@/components/whats-new-view";

/** Shared release notes view shown after an installed version changes. */
export function HubHome() {
  return <WhatsNewView mode="startup" />;
}
