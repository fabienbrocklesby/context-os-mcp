import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("public documentation data safety", () => {
  it("keeps the public Assistant Context OS guide generic", () => {
    const text = readFileSync(join(repoRoot, "docs", "ASSISTANT_CONTEXT_OS.md"), "utf8");

    expect(text).toContain("example-project");
    expect(text).toContain("owner/example-repo");
    expect(text).not.toMatch(/\b(?:ub4ir|ujn4s|sf8jz|turk4)[a-z0-9]{8,}\b/i);
    expect(text).not.toMatch(/\b(?:access|refresh|bearer|api)[_-]?token\s*[:=]\s*[A-Za-z0-9_-]{16,}/i);
    expect(text).not.toMatch(/\b(?:client|session)[_-]?secret\s*[:=]\s*[A-Za-z0-9_-]{16,}/i);
    expect(text).not.toMatch(/\bFabien\b/);
    expect(text).not.toMatch(/\bLight Lane\b/);
  });
});
