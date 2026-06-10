import { describe, expect, it } from "vitest";
import { chunkForBinding } from "../../src/persistence/d1/binding";

describe("chunkForBinding", () => {
  it("returns empty array for empty input", () => {
    expect(chunkForBinding([])).toEqual([]);
  });

  it("returns a single batch when under the batch size", () => {
    const ids = ["a", "b", "c"];
    expect(chunkForBinding(ids)).toEqual([["a", "b", "c"]]);
  });

  it("splits input larger than the batch size into batches of at most 90", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const batches = chunkForBinding(ids);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(90);
    expect(batches[1].length).toBe(90);
    expect(batches[2].length).toBe(70);
    expect(batches.flat()).toEqual(ids);
  });

  it("respects a custom batch size", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(chunkForBinding(ids, 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("never produces a batch above 100 even for huge inputs", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    for (const batch of chunkForBinding(ids)) {
      expect(batch.length).toBeLessThanOrEqual(100);
    }
  });
});
