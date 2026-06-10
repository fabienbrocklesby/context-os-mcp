import { describe, it, expect } from "vitest";
import { classifyRequest, requiresExternalStateChecks } from "~/domain/request-classification";

describe("requiresExternalStateChecks", () => {
  it("is true for a sales/deal query", () => {
    expect(requiresExternalStateChecks(classifyRequest("what deal is underway"))).toBe(true);
  });
  it("is true for a planning query", () => {
    expect(requiresExternalStateChecks(classifyRequest("plan my day and schedule"))).toBe(true);
  });
  it("is false for a pure memory-recall query", () => {
    expect(requiresExternalStateChecks(classifyRequest("remember the decision we made about pricing"))).toBe(false);
  });
});
