import { describe, expect, it } from "vitest";

import {
  analyzeAiBrainVaultPayload,
  buildAiBrainImportMarkdown,
} from "~/domain/ai-brain-vault";

function makeVaultFiles() {
  const markdownFiles = Array.from({ length: 63 }, (_, index) => {
    const fileNumber = index + 1;
    const priority = fileNumber <= 12 ? "load-first" : fileNumber === 13 ? "high" : "normal";
    const linkCount = fileNumber <= 29 ? 4 : 3;
    const links = Array.from({ length: linkCount }, (_, linkIndex) => {
      const target = ((index + linkIndex + 1) % 63) + 1;
      return `[[Brain Note ${String(target).padStart(2, "0")}]]`;
    }).join(" ");
    const sourceUrls =
      fileNumber === 13 ? "\nsource_urls:\n  - https://example.com/source" : "";
    return {
      path: `folder/Brain Note ${String(fileNumber).padStart(2, "0")}.md`,
      markdown: `---\nstable_id: ll-brain-${fileNumber}\npriority: ${priority}\ntags:\n  - sales\n  - light-lane${sourceUrls}\n---\n# Brain Note ${String(fileNumber).padStart(2, "0")}\n\n${links}\n`,
    };
  });

  return [
    ...markdownFiles,
    {
      path: "folder/Canvas.canvas",
      markdown: "{}",
    },
  ];
}

describe("analyzeAiBrainVaultPayload", () => {
  it("classifies the Light Lane AI Brain vault and preserves graph metadata", () => {
    const analysis = analyzeAiBrainVaultPayload({
      project: "light-lane",
      vaultName: "AI Brain Vault",
      files: makeVaultFiles(),
      currentContextPriorities: ["load-first", "high"],
      preserveWikilinks: true,
      applyLinks: true,
    });

    expect(analysis.counts).toMatchObject({
      files_seen: 64,
      markdown_files: 63,
      load_first: 12,
      high_priority: 1,
      current_context: 13,
      snippets: 50,
      wiki_links: 218,
      unresolved_links: 0,
      link_proposals: 218,
    });
    expect(Object.keys(analysis.documents_by_stable_id)).toHaveLength(63);
    expect(analysis.documents_by_stable_id["ll-brain-13"]).toMatchObject({
      priority: "high",
      memory_type: "current_context",
      source_urls: ["https://example.com/source"],
    });
    expect(analysis.proposed_links[0]).toMatchObject({
      project: "light-lane",
      link_type: "wikilink",
    });
  });

  it("reports unresolved wiki links without blocking dry-run analysis", () => {
    const analysis = analyzeAiBrainVaultPayload({
      project: "light-lane",
      vaultName: "AI Brain Vault",
      files: [
        {
          path: "Entry.md",
          markdown: "---\nstable_id: entry\npriority: load-first\n---\n# Entry\n\n[[Missing Note]]",
        },
      ],
    });

    expect(analysis.counts.unresolved_links).toBe(1);
    expect(analysis.unresolved_links).toEqual([
      {
        source_stable_id: "entry",
        source_path: "Entry.md",
        target_label: "Missing Note",
      },
    ]);
  });
});

describe("buildAiBrainImportMarkdown", () => {
  it("writes stable IDs, source URLs, priority, and wikilinks into imported frontmatter", () => {
    const analysis = analyzeAiBrainVaultPayload({
      project: "light-lane",
      vaultName: "AI Brain Vault",
      files: [
        {
          path: "Entry.md",
          markdown:
            "---\nstable_id: entry\npriority: load-first\nsource_urls:\n  - https://example.com/source\n---\n# Entry\n\n[[Other]]",
        },
        {
          path: "Other.md",
          markdown: "---\nstable_id: other\n---\n# Other\n",
        },
      ],
    });

    const markdown = buildAiBrainImportMarkdown({
      proposal: analysis.proposed_documents[0]!,
      vaultName: analysis.vault_name,
      project: "light-lane",
      authorClient: "vitest",
    });

    expect(markdown).toContain("stable_id: entry");
    expect(markdown).toContain("ai_brain_priority: load-first");
    expect(markdown).toContain("https://example.com/source");
    expect(markdown).toContain("wiki_links:");
    expect(markdown).toContain("- Other");
  });
});
