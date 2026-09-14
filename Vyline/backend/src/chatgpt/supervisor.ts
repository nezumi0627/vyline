import { access } from "node:fs/promises";

/** Container entrypoint: if either process exits, terminate its sibling so Docker can restart both. */
export async function supervise(commands: string[][]): Promise<number> {
  const children: Bun.Subprocess[] = [];
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer) return;
    for (const child of children) child.kill("SIGTERM");
    timer = setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, 10000);
  };
  const onSignal = () => {
    requested = true;
    stop();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    for (const cmd of commands)
      children.push(Bun.spawn(cmd, { stdin: "ignore", stdout: "inherit", stderr: "inherit" }));
    if (!children.length) throw new Error("At least one command is required");
    const exit = await Promise.race(children.map((child) => child.exited));
    stop();
    await Promise.all(children.map((child) => child.exited));
    return requested ? 0 : exit || 1;
  } finally {
    stop();
    await Promise.all(children.map((child) => child.exited));
    clearTimeout(timer);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}
if (import.meta.main) {
  const profile = process.env.VYLINE_CHATGPT_TUNNEL_PROFILE;
  if (!profile) throw new Error("VYLINE_CHATGPT_TUNNEL_PROFILE is required");
  await access(profile);
  const backend = process.argv.slice(2);
  if (!backend.length) throw new Error("Backend command is required");
  process.exit(await supervise([backend, ["tunnel-client", "run", "--profile-file", profile]]));
}
