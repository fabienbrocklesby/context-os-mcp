import YAML from "yaml";

import {
  createSystemFrontmatter,
  extractProjectFromPath,
  frontmatterSchema,
  inferMemoryTypeFromPath,
  inferStatusFromPath,
  type ParsedMarkdownDocument,
} from "~/domain/memory";

const FRONTMATTER_BOUNDARY = "---";

export function parseMarkdownDocument(
  path: string,
  markdown: string,
  authorClient = "system",
): ParsedMarkdownDocument {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    const title = inferTitleFromPath(path, markdown);
    return {
      frontmatter: createSystemFrontmatter({
        path,
        title,
        project: extractProjectFromPath(path),
        memoryType: inferMemoryTypeFromPath(path),
        status: inferStatusFromPath(path),
        authorClient,
      }),
      body: markdown.trim(),
    };
  }

  const [, rawFrontmatter, rawBody = ""] = trimmed.split(
    new RegExp(`^${FRONTMATTER_BOUNDARY}\\s*$`, "m"),
    3,
  );
  const parsed = YAML.parse(rawFrontmatter ?? "") ?? {};
  const title = parsed.title ?? inferTitleFromPath(path, rawBody);

  return {
    frontmatter: frontmatterSchema.parse({
      id: parsed.id ?? crypto.randomUUID(),
      title,
      project: parsed.project ?? extractProjectFromPath(path),
      memory_type: parsed.memory_type ?? inferMemoryTypeFromPath(path),
      status: parsed.status ?? inferStatusFromPath(path),
      revision: parsed.revision ?? 1,
      tags: parsed.tags ?? [],
      created_at: parsed.created_at ?? new Date().toISOString(),
      updated_at: parsed.updated_at ?? new Date().toISOString(),
      author_client: parsed.author_client ?? authorClient,
      source: parsed.source,
      source_urls: parsed.source_urls ?? [],
      confidence: parsed.confidence,
      usefulness: parsed.usefulness,
      repo: parsed.repo,
      path: parsed.path,
      supersedes: parsed.supersedes ?? [],
      superseded_by: parsed.superseded_by ?? [],
      canonical: parsed.canonical ?? inferMemoryTypeFromPath(path) === "current_context",
    }),
    body: rawBody.trim(),
  };
}

function inferTitleFromPath(path: string, markdown: string) {
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }

  const fileName = path.split("/").pop() ?? "untitled";
  return fileName.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
}
