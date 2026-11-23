import { YAML } from "bun";

export function parseBlogPost(markdown: string, sourcePath: string) {
  const lines = markdown.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 1) throw new Error(`Missing blog frontmatter: ${sourcePath}`);
  let metadata: unknown;
  try {
    metadata = YAML.parse(lines.slice(1, end).join("\n"));
  } catch (cause) {
    throw new Error(`Invalid blog frontmatter: ${sourcePath}`, { cause });
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error(`Blog frontmatter must be one YAML mapping: ${sourcePath}`);
  const fields = metadata as Record<string, unknown>;
  const value = (key: string) =>
    typeof fields[key] === "string" ? (fields[key] as string).trim() : "";
  const title = value("title");
  const summary = value("summary");
  const date = value("date");
  const published =
    typeof fields.published === "boolean" ? String(fields.published) : value("published");
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
