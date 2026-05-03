import { describe, expect, it } from "vitest";

import { planEnvironmentToolUse } from "~/domain/environment-capabilities";
import { isToolAvailable } from "~/domain/tool-availability";

describe("environment capability planning", () => {
  it("normalizes ContextOS memory availability aliases", () => {
    for (const tool of [
      "Context OS Memory",
      "memory",
      "ContextOS",
      "prepare_assistant_session",
      "mcp__codex_apps__memory.prepare_assistant_session",
    ]) {
      expect(isToolAvailable("prepare_assistant_session", "memory", [tool])).toBe(true);
    }
  });

  it("plans Codex tool use with client-executed Cloudflare and terminal checks", () => {
    const guidance = planEnvironmentToolUse({
      environment: "codex",
      userIntent: "Deploy the ContextOS Worker after D1 migration and run tests",
      projectOrTopic: "memory-system-mcp",
      availableTools: ["Context OS Memory", "terminal", "wrangler"],
      activeSources: ["cloudflare"],
      includeInstructions: true,
    });

    expect(guidance.environment.slug).toBe("codex");
    expect(guidance.available_capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "contextos_memory" }),
        expect.objectContaining({ capability: "terminal_local" }),
        expect.objectContaining({ capability: "cloudflare_live" }),
      ]),
    );
    expect(guidance.client_must_execute).toContain("cloudflare_live");
    expect(guidance.confirmation_required).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "Cloudflare Live Platform" }),
      ]),
    );
    expect(guidance.client_instructions.join("\n")).toContain("ContextOS first");
  });

  it("warns when required live tools are unavailable", () => {
    const guidance = planEnvironmentToolUse({
      environment: "chatgpt",
      userIntent: "Check the latest GitHub code before answering",
      availableTools: ["prepare_assistant_session"],
    });

    expect(guidance.unavailable_required_capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "github_live" }),
      ]),
    );
    expect(guidance.fallback_plan.join("\n")).toContain("github");
  });
});
