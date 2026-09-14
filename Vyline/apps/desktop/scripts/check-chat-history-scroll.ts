// Run: bun Vyline/apps/desktop/scripts/check-chat-history-scroll.ts
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";

const root = resolve(import.meta.dir, "..");
process.chdir(root); // Tailwind resolves its existing config/content from cwd.
const output = resolve(root, "test-results/chat-history-scroll");
await mkdir(output, { recursive: true });
// A loopback-only Vite instance exists only for this test and is always closed.
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, open: false } });
await server.listen();
const base = server.resolvedUrls!.local[0]!;
const origin = new URL(base);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];
const surface = ".vy-chat-messages";

async function position(page: Page, key?: string) {
  return page.locator(surface).evaluate((element, key) => {
    const viewport = element.getBoundingClientRect();
    const row = key
      ? Array.from(element.querySelectorAll<HTMLElement>("[id^='msg-']")).find(
          (row) => row.id === key,
        )
      : Array.from(element.querySelectorAll<HTMLElement>("[id^='msg-']")).find(
          (row) => row.getBoundingClientRect().bottom > viewport.top,
        );
    return {
      key: row?.id ?? null,
      offset: row ? row.getBoundingClientRect().top - viewport.top : null,
      top: element.scrollTop,
      remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
    };
  }, key);
}

async function settle(page: Page) {
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await position(page));
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return stable;
      },
      { intervals: [60], timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(3);
}

try {
  for (const width of [1000, 390]) {
    for (const scenario of [
      "sync-while-scrolling",
      "prepend-while-scrolling",
      "prepend-stationary",
      "sync-at-bottom",
      "latest-while-scrolling",
      "search-while-scrolling",
      "resize-history",
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        serviceWorkers: "block",
      });
      const errors: string[] = [];
      const unexpected: string[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (
          url.origin === "https://fonts.googleapis.com" &&
          route.request().resourceType() === "stylesheet"
        ) {
          return route.fulfill({
            contentType: "text/css",
            body: "/* Use local fallback fonts. */",
          });
        }
        if (
          route.request().method() !== "GET" ||
          url.origin !== origin.origin ||
          /^\/api(?:\/|$)/.test(url.pathname)
        ) {
          unexpected.push(`${route.request().method()} ${url.pathname}`);
          return route.abort();
        }
        if (url.pathname === "/src/main.tsx")
          return route.fulfill({
            contentType: "text/javascript",
            body: 'import "/scripts/history-scroll-probe.tsx";',
          });
        return route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => {
        const url = new URL(socket.url());
        if (url.protocol === "ws:" && url.host === origin.host && url.pathname === "/")
          socket.connectToServer();
        else {
          unexpected.push(`WebSocket ${url.pathname}`);
          socket.close();
        }
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
      });
      let before: Awaited<ReturnType<typeof position>> | undefined;
      let after: Awaited<ReturnType<typeof position>> | undefined;
      try {
        await page.goto(base);
        await expect(page.locator(surface)).toBeVisible();
        assert(
          await page
            .locator(surface)
            .evaluate(
              (element) =>
                element.scrollHeight > element.clientHeight * 2 && element.clientHeight > 200,
            ),
          "Fixture must have a scrollable viewport",
        );
        await expect.poll(async () => (await position(page)).remaining).toBeLessThanOrEqual(1);
        await settle(page);
        const bounds = await page.locator(surface).boundingBox();
        assert(bounds);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        if (scenario.startsWith("prepend") || scenario === "resize-history") {
          await page.getByText("Finish sync", { exact: true }).click();
          await settle(page);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, -100000);
          await expect(
            page.getByText("過去のメッセージを読み込み中…", { exact: true }),
          ).toBeVisible();
          if (scenario !== "prepend-stationary") await page.mouse.wheel(0, 450);
        } else if (scenario === "latest-while-scrolling") {
          await page.getByText("Finish sync", { exact: true }).click();
          await settle(page);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, -450);
          await settle(page);
          await page.getByRole("button", { name: "トークの一番下へ移動", exact: true }).click();
          await expect.poll(async () => (await position(page)).remaining).toBeLessThanOrEqual(1);
          await settle(page);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, -450);
        } else if (scenario === "search-while-scrolling") {
          await page.getByRole("button", { name: "検索", exact: true }).click();
          await page.getByRole("textbox", { name: "トーク内を検索", exact: true }).fill("履歴 80");
          await expect
            .poll(async () => {
              const target = await position(page, "msg-1080");
              const height = await page
                .locator(surface)
                .evaluate((element) => element.clientHeight);
              return target.offset === null
                ? Number.POSITIVE_INFINITY
                : Math.abs(target.offset - height / 2);
            })
            .toBeLessThanOrEqual(2);
          await settle(page);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, 150);
        } else if (scenario === "sync-while-scrolling") {
          await page.mouse.wheel(0, -450);
        }
        await settle(page);
        before = await position(page);
        assert(before.key);
        if (scenario !== "sync-at-bottom")
          assert(before.remaining > 100, "The reader must have left the bottom");
        await page
          .getByText(
            scenario === "resize-history"
              ? "Resize history"
              : scenario.startsWith("prepend")
                ? "Finish history"
                : "Finish sync",
            { exact: true },
          )
          .click();
        await settle(page);
        after = await position(page, before.key);
        if (scenario === "sync-at-bottom")
          assert(after.remaining <= 1, `Bottom gap ${after.remaining}`);
        else {
          assert(after.key === before.key, `Visible anchor ${before.key} disappeared`);
          assert(
            Math.abs(after.offset! - before.offset!) <= 2,
            `Anchor moved ${after.offset! - before.offset!}px`,
          );
        }
        if (scenario.startsWith("prepend")) {
          // The corrected scroll event must not consume or retrigger the next page.
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, -100000);
          await expect(
            page.getByText("過去のメッセージを読み込み中…", { exact: true }),
          ).toBeVisible();
          if (scenario === "prepend-while-scrolling") await page.mouse.wheel(0, 450);
          await settle(page);
          const secondBefore = await position(page);
          assert(secondBefore.key);
          await page.getByText("Finish history", { exact: true }).click();
          await settle(page);
          const secondAfter = await position(page, secondBefore.key);
          assert(
            secondAfter.offset !== null && Math.abs(secondAfter.offset - secondBefore.offset!) <= 2,
            "Second page lost the visible anchor",
          );
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        await page.screenshot({ path: resolve(output, `${width}-${scenario}-passed.png`) });
        results.push({ width, scenario, status: "passed", before, after });
      } catch (error) {
        results.push({
          width,
          scenario,
          status: "failed",
          error: String(error),
          before,
          after,
          errors,
          unexpected,
        });
        await page.screenshot({ path: resolve(output, `${width}-${scenario}.png`) });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
assert(
  results.every((result) => (result as { status: string }).status === "passed"),
  "Chat history scroll regression",
);
