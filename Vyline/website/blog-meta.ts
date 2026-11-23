export function parseBlogPost(markdown: string, sourcePath: string) {
  const lines = markdown.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 1) throw new Error(`Missing blog frontmatter: ${sourcePath}`);
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([a-z]+):[ \t]*(.*)$/);
    if (!field) throw new Error(`Invalid blog frontmatter line: ${sourcePath}`);
    fields.set(field[1], field[2].trim());
  }
  const value = (key: string) => (fields.get(key) ?? "").replace(/^["']|["']$/g, "");
  const title = value("title");
  const summary = value("summary");
  const date = value("date");
  const published = value("published");
  if (
    !title ||
    !summary ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !value("category") ||
    !["true", "false"].includes(published)
  )
    throw new Error(
      `Blog frontmatter requires title, summary, date, category, and published true/false: ${sourcePath}`,
    );
  const name = sourcePath.split(/[\\/]/).at(-1)!.replace(/\.md$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name === "index")
    throw new Error(`Invalid blog filename: ${sourcePath}`);
  return {
    title,
    summary,
    date,
    name,
    published: published === "true",
    body: lines.slice(end + 1).join("\n"),
  };
}
