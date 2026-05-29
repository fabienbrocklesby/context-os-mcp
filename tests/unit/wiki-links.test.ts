import { describe, expect, it } from "vitest";
import { generateRelatedSection, stripRelatedSection } from "~/service/DocumentService";

describe("generateRelatedSection", () => {
  const entities = [
    { name: "FiveStar Print", slug: "fivestar-print", type: "company" },
    { name: "Fully Promoted", slug: "fully-promoted", type: "company" },
    { name: "Light Lane", slug: "light-lane", type: "project" },
    { name: "Jo", slug: "jo", type: "person" }, // too short — 2 chars
  ];

  it("returns null when no entities match the body", () => {
    const result = generateRelatedSection("Nothing relevant here.", entities);
    expect(result).toBeNull();
  });

  it("matches by entity name (case-insensitive)", () => {
    const result = generateRelatedSection(
      "We spoke with fivestar print about the order.",
      entities,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("[[FiveStar Print]]");
  });

  it("matches by slug words when different from name", () => {
    const result = generateRelatedSection(
      "The fully promoted campaign went well.",
      entities,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("[[Fully Promoted]]");
  });

  it("matches multiple entities and includes all links", () => {
    const result = generateRelatedSection(
      "light lane worked with fivestar print on a project.",
      entities,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("[[Light Lane]]");
    expect(result).toContain("[[FiveStar Print]]");
  });

  it("skips entities with name shorter than 3 characters", () => {
    const result = generateRelatedSection("spoke with jo today", entities);
    expect(result).toBeNull();
  });

  it("returns properly formatted ## Related section", () => {
    const result = generateRelatedSection("light lane rocks", entities);
    expect(result).toMatch(/^## Related\n\n\[\[/);
  });

  it("deduplicates: same entity matched by both name and slug only appears once", () => {
    const result = generateRelatedSection(
      "light lane and light-lane are the same",
      entities,
    );
    const count = (result ?? "").split("[[Light Lane]]").length - 1;
    expect(count).toBe(1);
  });
});

describe("stripRelatedSection", () => {
  it("removes ## Related section at end of document", () => {
    const body = "Some content.\n\n## Related\n\n[[FiveStar Print]]";
    expect(stripRelatedSection(body)).toBe("Some content.");
  });

  it("removes ## Related section with single newline separator", () => {
    const body = "Some content.\n## Related\n\n[[Light Lane]]";
    expect(stripRelatedSection(body)).toBe("Some content.");
  });

  it("does not touch ## Related sections in the middle of the document", () => {
    const body =
      "## Related\n\n[[FiveStar Print]]\n\n## More content\n\nStill here.";
    const result = stripRelatedSection(body);
    expect(result).toContain("## More content");
    expect(result).toContain("Still here.");
  });

  it("is a no-op when there is no ## Related section", () => {
    const body = "Just a normal document with no related section.";
    expect(stripRelatedSection(body)).toBe(body);
  });

  it("handles empty string", () => {
    expect(stripRelatedSection("")).toBe("");
  });

  it("round-trips: strip then regenerate produces original stripped body", () => {
    const original = "Content about light lane.\n\n## Related\n\n[[Light Lane]]";
    const stripped = stripRelatedSection(original);
    expect(stripped).toBe("Content about light lane.");
  });
});
