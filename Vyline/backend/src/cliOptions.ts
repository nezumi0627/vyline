export type CliOptions = Record<string, string | boolean>;

const VALUE_OPTIONS = new Set(["account", "chat", "mid", "limit", "before", "last"]);
const BOOLEAN_OPTIONS = new Set(["refresh"]);

export function parseCliArgs(argv: string[]): { command: string; options: CliOptions } {
  const args = argv.filter((arg) => arg !== "--cli");
  const command = args.shift() ?? "help";
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const separator = arg.indexOf("=");
    const key = arg.slice(2, separator < 0 ? undefined : separator);
    const hasInlineValue = separator >= 0;
    if (!key || (!VALUE_OPTIONS.has(key) && !BOOLEAN_OPTIONS.has(key))) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: --${key}`);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (hasInlineValue) throw new Error(`--${key} does not accept a value`);
      options[key] = true;
      continue;
    }
    const value = hasInlineValue ? arg.slice(separator + 1) : args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Option --${key} requires a value`);
    options[key] = value;
  }
  return { command, options };
}
