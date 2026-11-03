import { resolve, relative, isAbsolute, sep, join } from "node:path";
const root = resolve(import.meta.dir, "../../dist-landing");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.SITE_PORT ?? 4187),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL("/Vyline/", url), 302);
    if (!url.pathname.startsWith("/Vyline/")) return new Response("Not found", { status: 404 });
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice("/Vyline/".length)); }
    catch { return new Response("Invalid path", { status: 400 }); }
    const target = resolve(root, path || "index.html");
    const within = relative(root, target);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) return new Response("Not found", { status: 404 });
    const file = Bun.file(url.pathname.endsWith("/") && path ? join(target, "index.html") : target);
    return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`Documentation preview: ${server.url}Vyline/`);
