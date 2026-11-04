export type PreReleaseChannel = "alpha" | "beta" | "rc";
export type VersionOperation =
  | "major"
  | "minor"
  | "patch"
  | "promote"
  | `prerelease:${PreReleaseChannel}`;

export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

export function parseVersion(value: string): VersionParts | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (!match) return null;
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (numbers.some((part) => !Number.isSafeInteger(part))) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))
    return null;
  return {
    major: numbers[0]!,
    minor: numbers[1]!,
    patch: numbers[2]!,
    prerelease,
    build: match[5]?.split(".") ?? [],
  };
}

export function isValidVersion(value: string): boolean {
  return parseVersion(value) !== null;
}

export function compareVersionPrecedence(leftValue: string, rightValue: string): number | null {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return BigInt(a) > BigInt(b) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

export function resolveNextVersion(current: string, operation: VersionOperation | string): string {
  const parsed = parseVersion(current);
  if (!parsed) throw new Error(`現在のバージョンが不正です: ${current}`);
  if (isValidVersion(operation)) {
    if (compareVersionPrecedence(operation, current)! > 0) return operation;
    throw new Error(`新しいバージョンは現在より大きくしてください: ${current} → ${operation}`);
  }
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (operation === "promote") {
    if (!parsed.prerelease.length) throw new Error("正式版への昇格にはプレリリースが必要です");
    return base;
  }
  if (operation === "major") return `${parsed.major + 1}.0.0`;
  if (operation === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (operation === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;

  const channel = operation.startsWith("prerelease:") ? operation.slice(11) : "";
  if (channel !== "alpha" && channel !== "beta" && channel !== "rc") {
    throw new Error(`不明な更新方法です: ${operation}`);
  }
  if (parsed.prerelease[0] === channel) {
    const last = parsed.prerelease.at(-1);
    if (last && /^\d+$/.test(last)) {
      const next = [...parsed.prerelease];
      next[next.length - 1] = String(BigInt(last) + 1n);
      return `${base}-${next.join(".")}`;
    }
    return `${base}-${parsed.prerelease.join(".")}.1`;
  }
  const targetBase = parsed.prerelease.length
    ? base
    : `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  return `${targetBase}-${channel}.1`;
}

export function replaceProductVersions(rootPackage: string, desktopPackage: string, next: string) {
  if (!isValidVersion(next)) throw new Error(`バージョン形式が不正です: ${next}`);
  const root = JSON.parse(rootPackage) as Record<string, unknown>;
  const desktop = JSON.parse(desktopPackage) as Record<string, unknown>;
  root.version = next;
  desktop.version = next;
  return {
    root: `${JSON.stringify(root, null, 2)}\n`,
    desktop: `${JSON.stringify(desktop, null, 2)}\n`,
  };
}
