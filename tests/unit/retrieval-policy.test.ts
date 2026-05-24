import { describe, expect, it } from "vitest";

import type { MemorySearchHit } from "~/domain/memory";
import {
  applyDocumentDiversity,
  buildRequiredContextPack,
  inferTaskProfile,
} from "~/domain/retrieval-policy";

function makeHit(documentId: string, chunkIndex: number, score: number): MemorySearchHit {
  return {
    documentId,
    snapshotId: `${documentId}-snapshot`,
    vectorId: `${documentId}-${chunkIndex}`,
    title: documentId,
    path: `/memory/projects/light-lane/context/current/${documentId}.md`,
    project: "light-lane",
    namespace: "light-lane",
    workdriveFileId: `${documentId}-wd`,
    memoryType: "current_context",
    status: "active",
    active: true,
    superseded: false,
    revision: 1,
    headingPath: "",
    chunkIndex,
    chunkText: "body",
    score,
    updatedAtUnix: 1_776_000_000,
  };
}

describe("retrieval policy", () => {
  it("infers sales proposal work and requires the Light Lane sales context pack", () => {
    const taskProfile = inferTaskProfile("write a HamiltonJet proposal for Light Lane");
    const pack = buildRequiredContextPack({
      project: "light-lane",
      taskProfile,
      userIntent: "write a HamiltonJet proposal",
    });

    expect(taskProfile).toBe("sales_proposal");
    expect(pack.required_documents).toEqual(
      expect.arrayContaining([
        "light-lane-entrypoint",
        "full-system-positioning",
        "core-sales-thesis",
        "claim-boundaries",
        "source-trust",
      ]),
    );
    expect(pack.required_live_checks).toEqual(
      expect.arrayContaining(["crm_current_deal_state", "email_recent_customer_replies"]),
    );
  });

  it("caps duplicate chunks from the same document in top retrieval results", () => {
    const ranked = [
      makeHit("ruida-current-context", 0, 0.99),
      makeHit("ruida-current-context", 1, 0.98),
      makeHit("ruida-current-context", 2, 0.97),
      makeHit("full-system-positioning", 0, 0.8),
      makeHit("claim-boundaries", 0, 0.79),
    ];

    const diverse = applyDocumentDiversity(ranked, { maxChunksPerDocument: 2, limit: 5 });

    expect(diverse.map((hit) => hit.documentId)).toEqual([
      "ruida-current-context",
      "ruida-current-context",
      "full-system-positioning",
      "claim-boundaries",
    ]);
  });
});
