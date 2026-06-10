import { describe, expect, it } from "vitest";

import { parseMarkdownDocument } from "~/domain/frontmatter";

describe("parseMarkdownDocument", () => {
  it("infers frontmatter when the markdown has no frontmatter block", () => {
    const parsed = parseMarkdownDocument(
      "/memory/projects/alpha/context/current/product-vision.md",
      "# Product Vision\n\nThe current direction.",
      "codex",
    );

    expect(parsed.frontmatter.project).toBe("alpha");
    expect(parsed.frontmatter.memory_type).toBe("current_context");
    expect(parsed.frontmatter.status).toBe("active");
    expect(parsed.frontmatter.canonical).toBe(true);
    expect(parsed.frontmatter.author_client).toBe("codex");
    expect(parsed.frontmatter.title).toBe("Product Vision");
    expect(parsed.body).toBe("# Product Vision\n\nThe current direction.");
  });

  it("preserves explicit frontmatter values and falls back for omitted fields", () => {
    const parsed = parseMarkdownDocument(
      "/memory/shared/decisions/adr-0001.md",
      `---
title: Adopt Vector Search
project: shared
memory_type: decision
status: active
revision: 4
tags:
  - architecture
author_client: claude
canonical: false
source: github
source_urls:
  - https://github.com/example/repo/blob/main/README.md
confidence: 0.9
usefulness: 0.8
repo: example/repo
path: README.md
---

# Ignore this heading

Decision body.`,
      "system",
    );

    expect(parsed.frontmatter.title).toBe("Adopt Vector Search");
    expect(parsed.frontmatter.memory_type).toBe("decision");
    expect(parsed.frontmatter.revision).toBe(4);
    expect(parsed.frontmatter.tags).toEqual(["architecture"]);
    expect(parsed.frontmatter.source).toBe("github");
    expect(parsed.frontmatter.source_urls).toEqual([
      "https://github.com/example/repo/blob/main/README.md",
    ]);
    expect(parsed.frontmatter.confidence).toBe(0.9);
    expect(parsed.frontmatter.usefulness).toBe(0.8);
    expect(parsed.frontmatter.repo).toBe("example/repo");
    expect(parsed.frontmatter.path).toBe("README.md");
    expect(parsed.frontmatter.author_client).toBe("claude");
    expect(parsed.frontmatter.canonical).toBe(false);
    expect(parsed.body).toBe("# Ignore this heading\n\nDecision body.");
  });

  it("preserves an explicit memory_layer so the situation layer survives indexing", () => {
    const parsed = parseMarkdownDocument(
      "/memory/projects/light-lane/context/current/situation.md",
      `---
title: Current Situation
project: light-lane
memory_type: current_context
status: active
revision: 1
canonical: true
memory_layer: situation
---

# Light Lane — Current Situation

Positioning body.`,
      "system",
    );

    expect(parsed.frontmatter.memory_layer).toBe("situation");
  });

  it("leaves memory_layer undefined when the frontmatter omits it", () => {
    const parsed = parseMarkdownDocument(
      "/memory/projects/alpha/knowledge/facts/some-fact.md",
      "# Fact\n\nbody",
    );
    expect(parsed.frontmatter.memory_layer).toBeUndefined();
  });

  it("infers snippets and repo indexes from their folder paths", () => {
    expect(
      parseMarkdownDocument(
        "/memory/projects/alpha/snippets/github-note.md",
        "# Snippet",
      ).frontmatter.memory_type,
    ).toBe("snippet");
    expect(
      parseMarkdownDocument(
        "/memory/projects/alpha/repo-index/example-repo.md",
        "# Repo",
      ).frontmatter.memory_type,
    ).toBe("repo_index");
  });
});
