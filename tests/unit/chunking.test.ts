import { describe, expect, it } from "vitest";

import { chunkMarkdown } from "~/domain/chunking";

describe("chunkMarkdown", () => {
  it("keeps heading context in chunk metadata", () => {
    const chunks = chunkMarkdown({
      title: "Shared Memory",
      memoryType: "current_context",
      markdown: [
        "# Vision",
        "",
        "We are building a durable memory layer.",
        "",
        "## Constraints",
        "",
        "It must prefer canonical markdown over derived state.",
      ].join("\n"),
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.content).toContain("Title: Shared Memory");
    expect(chunks[0]?.content).toContain("Type: current_context");
    expect(chunks.some((chunk) => chunk.headingPath.includes("Vision"))).toBe(true);
    expect(chunks.some((chunk) => chunk.headingPath.includes("Constraints"))).toBe(true);
  });

  it("splits oversized paragraphs into bounded chunks", () => {
    const longParagraph = Array.from({ length: 700 }, (_, index) => `word-${index}`).join(" ");
    const chunks = chunkMarkdown({
      title: "Large Body",
      memoryType: "session_summary",
      markdown: longParagraph,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 500)).toBe(true);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks.at(-1)?.chunkIndex).toBe(chunks.length - 1);
  });
});
