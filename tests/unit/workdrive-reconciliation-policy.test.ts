import { describe, expect, it } from "vitest";

import { shouldReindexWorkDriveEntry } from "~/domain/service";

describe("WorkDrive reconciliation policy", () => {
  it("treats historical documents indexed as inactive as stale so they become searchable", () => {
    expect(
      shouldReindexWorkDriveEntry({
        existing: {
          status: "historical",
          active: false,
          lastRemoteModifiedAt: 1_700_000_000_000,
        },
        chunkCount: 3,
        remoteModifiedAt: 1_700_000_000_000,
      }),
    ).toBe(true);
  });

  it("does not reindex unchanged historical documents already marked retrievable", () => {
    expect(
      shouldReindexWorkDriveEntry({
        existing: {
          path: "/memory/projects/light-lane/sessions/session.md",
          status: "historical",
          active: true,
          lastRemoteModifiedAt: 1_700_000_000_000,
        },
        chunkCount: 3,
        remoteModifiedAt: 1_700_000_000_000,
        remotePath: "/memory/projects/light-lane/sessions/session.md",
      }),
    ).toBe(false);
  });

  it("treats documents with stale D1 logical paths as stale even when content is unchanged", () => {
    expect(
      shouldReindexWorkDriveEntry({
        existing: {
          path: "overview.md",
          status: "active",
          active: true,
          lastRemoteModifiedAt: 1_700_000_000_000,
        },
        chunkCount: 2,
        remoteModifiedAt: 1_700_000_000_000,
        remotePath: "/memory/projects/dropship-side/context/current/overview.md",
      }),
    ).toBe(true);
  });
});
