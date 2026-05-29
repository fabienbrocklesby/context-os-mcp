import { describe, expect, it, vi, type Mock } from "vitest";

const mockZoho = {
  ensureFolderPath: vi.fn().mockResolvedValue({ folder: { id: "folder-123" }, created: [] }),
  uploadMarkdownFile: vi.fn().mockResolvedValue({ id: "file-abc" }),
};

const mockProjectRepo = {
  getProject: vi.fn().mockResolvedValue({
    slug: "light-lane",
    workdriveRootFolderId: "root-folder-id",
  }),
};

const mockConfig = {
  zoho: { sharedRootFolderId: "shared-root-id", uploadUrl: "https://upload.zoho.test" },
};

import { VaultSyncService } from "~/service/VaultSyncService";

describe("VaultSyncService.syncEntity", () => {
  it("calls uploadMarkdownFile with correct folder and filename", async () => {
    const svc = new VaultSyncService(mockZoho as any, mockConfig as any, mockProjectRepo as any);
    await svc.syncEntity("light-lane", {
      id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
      summary: null, source: null, sourceId: null, confidence: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    }, {});
    expect(mockZoho.ensureFolderPath).toHaveBeenCalledWith("root-folder-id", ["knowledge", "entities", "companies"]);
    expect(mockZoho.uploadMarkdownFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "acme.md", overrideExisting: true }),
    );
  });

  it("returns null silently when project has no workdriveRootFolderId", async () => {
    mockProjectRepo.getProject.mockResolvedValueOnce({ slug: "light-lane", workdriveRootFolderId: null });
    const svc = new VaultSyncService(mockZoho as any, mockConfig as any, mockProjectRepo as any);
    const result = await svc.syncEntity("light-lane", {
      id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
      summary: null, source: null, sourceId: null, confidence: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    }, {});
    expect(result).toBeNull();
  });
});

describe("VaultSyncService.syncFact", () => {
  it("uploads to knowledge/facts folder", async () => {
    (mockZoho.ensureFolderPath as Mock).mockClear();
    (mockZoho.uploadMarkdownFile as Mock).mockClear();
    const svc = new VaultSyncService(mockZoho as any, mockConfig as any, mockProjectRepo as any);
    await svc.syncFact("light-lane", {
      id: "f1", project: "light-lane", title: "Test Fact", body: "Fact body.",
      factKey: "test-fact-key", status: "active", source: null, sourceUrl: null,
      confidence: 1, initiativeId: null, entityId: null, documentId: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(mockZoho.ensureFolderPath).toHaveBeenCalledWith("root-folder-id", ["knowledge", "facts"]);
    expect(mockZoho.uploadMarkdownFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "test-fact-key.md", overrideExisting: true }),
    );
  });
});
