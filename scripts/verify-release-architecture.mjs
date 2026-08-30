import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const compose = read("docker-compose.yml");
expect(compose.includes("ghcr.io/tqmane/vyline:latest"), "docker-compose.yml must use tqmane GHCR image");
expect(!/^\s*build:/m.test(compose), "docker-compose.yml must not build locally");
expect(/pull_policy:\s*always/.test(compose), "docker-compose.yml must always pull the selected image");

const portainer = read("docker-compose.portainer.yml");
expect(portainer.includes("ghcr.io/tqmane/vyline:latest"), "Portainer stack must use tqmane GHCR image");
expect(/pull_policy:\s*always/.test(portainer), "Portainer stack must allow Pull latest image updates");

const workflow = read(".github/workflows/container.yml");
expect(workflow.includes("linux/amd64,linux/arm64"), "container workflow must publish amd64 and arm64");
expect(workflow.includes("docker/setup-qemu-action@v3"), "container workflow must configure QEMU");
expect(workflow.includes("docker/setup-buildx-action@v3"), "container workflow must configure Buildx");
expect(workflow.includes("push: true"), "container workflow must push to GHCR");

const gitmodules = read(".gitmodules");
for (const repository of ["vyline-search", "vyline-api", "vyline-plugin", "vyline-theme"]) {
  expect(
    gitmodules.includes(`https://github.com/tqmane/${repository}.git`),
    `.gitmodules must keep tqmane/${repository}`,
  );
}
expect(!gitmodules.includes("github.com/nezumi0627/"), ".gitmodules must not point at nezumi0627 forks");

const chatArea = read("Vyline/apps/desktop/src/components/chat-area.tsx");
expect(chatArea.includes('aria-label="トークの一番下へ移動"'), "chat UI must contain the jump-to-bottom control");
expect(chatArea.includes('"∧" : "∨"'), "announcement UI must contain expand/collapse controls");
expect(chatArea.includes("showScrollToBottom"), "jump-to-bottom button must be conditional");

const readme = read("README.md");
expect(readme.includes("## Quickstart"), "README must start with a concise Quickstart");
expect(readme.includes("Pull latest image"), "README must document the Portainer update flow");

if (failures.length) {
  console.error("Release architecture verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release architecture verification passed.");
