import { afterAll, expect, test } from "bun:test";

const child = Bun.spawn([process.execPath, `${import.meta.dir}/preview.ts`], {
  env: { ...process.env, SITE_PORT: "4188" },
  stdout: "ignore",
  stderr: "pipe",
});
afterAll(() => child.kill());

test("serves the exact lowercase GitHub Pages base and rejects other paths", async () => {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      response = await fetch("http://127.0.0.1:4188/", { redirect: "manual" });
      break;
    } catch {
      await Bun.sleep(25);
    }
  }
  expect(response?.headers.get("location")).toBe(
    "http://127.0.0.1:4188/vyline/",
  );
  expect((await fetch("http://127.0.0.1:4188/vyline/")).status).toBe(200);
  expect(
    (await fetch("http://127.0.0.1:4188/vyline/assets/site.css")).status,
  ).toBe(200);
  expect((await fetch("http://127.0.0.1:4188/Vyline/")).status).toBe(404);
  expect(
    (await fetch("http://127.0.0.1:4188/vyline/%2e%2e%2fpackage.json")).status,
  ).toBe(404);
});
