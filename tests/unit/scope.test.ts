import { describe, expect, it } from "vitest";

import { isVisibleInProjectScope } from "~/domain/scope";

describe("isVisibleInProjectScope", () => {
  it("allows active project memory and shared memory for a project-scoped search", () => {
    expect(isVisibleInProjectScope({ project: "alpha-project" }, "alpha-project")).toBe(true);
    expect(isVisibleInProjectScope({ project: "shared" }, "alpha-project")).toBe(true);
  });

  it("does not expose one private project to another project-scoped search", () => {
    expect(isVisibleInProjectScope({ project: "beta-project" }, "alpha-project")).toBe(false);
  });

  it("keeps shared-scope searches limited to shared memory", () => {
    expect(isVisibleInProjectScope({ project: "shared" }, "shared")).toBe(true);
    expect(isVisibleInProjectScope({ project: "alpha-project" }, "shared")).toBe(false);
  });
});
