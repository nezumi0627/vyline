export function parseBlogPost(markdown: string, sourcePath: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`Missing blog frontmatter: ${sourcePath}`);
  const fields = new Map(
    [...match[1].matchAll(/^([a-z]+):[ \t]*(.*)$/gm)].map((field) => [field[1], field[2].trim()]),
  );
  const value = (key: string) => (fields.get(key) ?? "").replace(/^["']|["']$/g, "");
  const title = value("title");
  const summary = value("summary");
  const date = value("date");
  const published = value("published");
  if (!title || !summary || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !value("category") ||
      !["true", "false"].includes(published))
    throw new Error(`Blog frontmatter requires title, summary, date, category, and published true/false: ${sourcePath}`);
  const name = sourcePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name === "index")
    throw new Error(`Invalid blog filename: ${sourcePath}`);
  return { title, summary, date, name, published: published === "true", body: match[2] };
}
