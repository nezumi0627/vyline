import type React from "react";

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`"))
      return (
        <code key={key} className="rounded bg-black/10 px-1">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link)
      return (
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {link[1]}
        </a>
      );
    return part;
  });
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) {
      const row = (value: string) =>
        value
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
      const headers = row(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) body.push(row(lines[i++]!));
      nodes.push(
        <div key={`table-${i}`} className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {headers.map((cell, col) => (
                  <th
                    key={col}
                    className="border-b border-[var(--vy-border)] px-2 py-1.5 font-semibold"
                  >
                    {inline(cell, `th-${i}-${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((cells, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td
                      key={ci}
                      className="border-b border-[var(--vy-border)]/60 px-2 py-1.5 align-top"
                    >
                      {inline(cells[ci] ?? "", `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      nodes.push(
        <h3 key={`h-${i}`} className="pt-2 font-semibold">
          {inline(heading[2]!, `h-${i}`)}
        </h3>,
      );
      i++;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(/^\s*[-*+]\s+/, ""), `li-${i}`)}</li>);
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>,
      );
      continue;
    }
    nodes.push(
      <p key={`p-${i}`} className="leading-relaxed">
        {inline(line.replace(/^>\s?/, ""), `p-${i}`)}
      </p>,
    );
    i++;
  }
  return <div className="space-y-2 text-sm">{nodes}</div>;
}
