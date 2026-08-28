#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w):/, "$1:");
const source = readFileSync(`${root}/README.src.md`, "utf8").replace(/\r\n/g, "\n");
const check = process.argv.includes("--check");
const languages = source.match(/^<!--@languages=(.+)-->$/m)?.[1].split(",") ?? [];
const defaultLanguage = source.match(/^<!--@default=(.+)-->$/m)?.[1] ?? languages[0];

if (languages.length === 0 || !languages.includes(defaultLanguage)) {
  throw new Error("README.src.md must declare @languages and a valid @default");
}

const body = source.split("\n").filter((line) => !/^<!--@(languages|default)=/.test(line));

for (const language of languages) {
  const output = body
    .flatMap((line) => {
      const match = line.match(/^(.*)<!--([a-z-]+)-->$/);
      return !match || match[2] === language ? [match ? match[1] : line] : [];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "")
    .concat("\n");

  const outputPath = language === defaultLanguage ? `${root}/README.md` : `${root}/README.${language}.md`;
  const generated = `<!-- GENERATED FILE. Edit README.src.md, then run bun run docs:readme. -->\n<!-- Language: ${language} -->\n\n${output}`;

  if (check) {
    const current = normalizeGenerated(readFileSync(outputPath, "utf8"));
    const expected = normalizeGenerated(generated);
    if (current !== expected) {
      const message = `${outputPath} is out of date`;
      if (language === defaultLanguage) {
        console.error(message);
        process.exitCode = 1;
      } else {
        console.warn(`${message}; run bun run docs:readme to refresh translated README output.`);
      }
    }
  } else {
    writeFileSync(outputPath, generated);
  }
}

function normalizeGenerated(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n*$/g, "\n");
}
