// tests/unit/vault-markdown.test.ts
import { describe, expect, it } from "vitest";
import {
  buildEntityVaultMarkdown,
  buildEventVaultMarkdown,
  buildFactVaultMarkdown,
  buildInitiativeVaultMarkdown,
  buildTaskVaultMarkdown,
  vaultSlugForTask,
} from "~/domain/vault-markdown";

describe("buildEntityVaultMarkdown", () => {
  it("includes entity name as H1", () => {
    const md = buildEntityVaultMarkdown(
      { id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
        summary: null, source: null, sourceId: null, confidence: null, metadata: {},
        createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      { deal_stage: { value: "Discovery", updated_at: "2026-05-30T00:00:00Z" } },
    );
    expect(md).toContain("# Acme Corp");
    expect(md).toContain("deal_stage");
    expect(md).toContain("Discovery");
  });

  it("includes memory_layer: knowledge in frontmatter", () => {
    const md = buildEntityVaultMarkdown(
      { id: "e1", project: "light-lane", type: "person", slug: "fabien", name: "Fabien",
        summary: null, source: null, sourceId: null, confidence: null, metadata: {},
        createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      {},
    );
    expect(md).toContain("memory_layer: knowledge");
    expect(md).toContain("entity_type: person");
  });
});

describe("buildFactVaultMarkdown", () => {
  it("renders fact body and source", () => {
    const md = buildFactVaultMarkdown({
      id: "f1", project: "light-lane", title: "Creditflex is a partner",
      body: "Not a prospect.", factKey: "creditflex-partner", status: "active",
      source: "Fabien", sourceUrl: null, confidence: 1, initiativeId: null,
      entityId: null, documentId: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# Creditflex is a partner");
    expect(md).toContain("Not a prospect.");
    expect(md).toContain("memory_layer: knowledge");
    expect(md).toContain("memory_type: decision");
  });
});

describe("buildTaskVaultMarkdown", () => {
  it("includes priority and status", () => {
    const md = buildTaskVaultMarkdown({
      id: "t1", project: "light-lane", title: "Send info to South Pine",
      description: "Send by Monday.", status: "open", priority: "urgent",
      dueAt: "2026-06-01", owner: "Fabien", initiativeId: null, entityId: null,
      source: null, sourceUrl: null, reminderAt: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# Send info to South Pine");
    expect(md).toContain("urgent");
    expect(md).toContain("2026-06-01");
    expect(md).toContain("memory_layer: operational");
  });
});

describe("buildEventVaultMarkdown", () => {
  it("includes event type and summary", () => {
    const md = buildEventVaultMarkdown({
      id: "ev1", project: "light-lane", source: "Fabien direct report",
      sourceId: null, eventType: "sales_meeting", occurredAt: "2026-05-30",
      title: "South Pine meeting", summary: "Went very well.", sensitivity: "internal",
      savePolicy: "durable_summary", initiativeId: null, entityId: null,
      externalUrl: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# South Pine meeting");
    expect(md).toContain("Went very well.");
    expect(md).toContain("memory_layer: operational");
    expect(md).toContain("historical_note");
  });
});

describe("buildInitiativeVaultMarkdown", () => {
  it("links all entity names as wikilinks", () => {
    const md = buildInitiativeVaultMarkdown(
      { id: "i1", slug: "light-lane", title: "Light Lane", summary: "Laser biz",
        status: "active", createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      ["Acme Corp", "HamiltonJet"],
    );
    expect(md).toContain("# Light Lane");
    expect(md).toContain("[[Acme Corp]]");
    expect(md).toContain("[[HamiltonJet]]");
    expect(md).toContain("memory_layer: situation");
  });
});

describe("vaultSlugForTask", () => {
  it("returns slugified title with id suffix", () => {
    expect(vaultSlugForTask("Send info", "abc123")).toBe("send-info-abc123");
  });
});
