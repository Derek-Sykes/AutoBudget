import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (/\.(tsx?|jsx?)$/.test(entry)) return [path];
    return [];
  });
}

describe("native browser dialogs", () => {
  it("does not use window.confirm or window.alert in app source", () => {
    const offenders = sourceFiles(join(process.cwd(), "src"))
      .map((path) => ({ path, contents: readFileSync(path, "utf8") }))
      .filter(({ contents }) => /window\.(confirm|alert)\s*\(/.test(contents))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
