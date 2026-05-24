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
          status: "historical",
          active: true,
          lastRemoteModifiedAt: 1_700_000_000_000,
        },
        chunkCount: 3,
        remoteModifiedAt: 1_700_000_000_000,
      }),
    ).toBe(false);
  });
});
