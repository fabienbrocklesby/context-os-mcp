import YAML from "yaml";

import { slugify, type MemoryType } from "~/domain/memory";

export type AiBrainTaskPriority = "load-first" | "high" | "normal" | string;

export type AiBrainVaultFile = {
  path: string;
  markdown: string;
};

export type AiBrainVaultImportOptions = {
  project: string;
  vaultName: string;
  files: AiBrainVaultFile[];
  manifest?: Record<string, unknown>;
  retrievalMap?: Record<string, unknown>;
  preserveWikilinks?: boolean;
  applyLinks?: boolean;
  currentContextPriorities?: string[];
};

export type AiBrainVaultDocumentProposal = {
  stable_id: string;
  source_path: string;
  title: string;
  priority: AiBrainTaskPriority;
  memory_type: MemoryType;
  tags: string[];
  source_urls: string[];
  wiki_links: string[];
  preserve_wikilinks: boolean;
  raw_markdown: string;
  frontmatter: Record<string, unknown>;
};

export type AiBrainVaultLinkProposal = {
  project: string;
  from_stable_id: string;
  from_path: string;
  to_stable_id: string;
  to_path: string;
  target_label: string;
  link_type: "wikilink";
};

export type AiBrainVaultUnresolvedLink = {
  source_stable_id: string;
  source_path: string;
  target_label: string;
};

export type AiBrainVaultAnalysis = {
  migration_slug: "ai-brain-vault-import";
  project: string;
  vault_name: string;
  dry_run: true;
  counts: {
    files_seen: number;
    markdown_files: number;
    load_first: number;
    high_priority: number;
    current_context: number;
    snippets: number;
    wiki_links: number;
    unresolved_links: number;
    link_proposals: number;
  };
  proposed_documents: AiBrainVaultDocumentProposal[];
  proposed_links: AiBrainVaultLinkProposal[];
  unresolved_links: AiBrainVaultUnresolvedLink[];
  documents_by_stable_id: Record<
    string,
    {
      stable_id: string;
      title: string;
      source_path: string;
      priority: AiBrainTaskPriority;
      memory_type: MemoryType;
      tags: string[];
      source_urls: string[];
      wiki_links: string[];
    }
  >;
  manifest: Record<string, unknown> | null;
  retrieval_map: Record<string, unknown> | null;
  safety: {
    deletes_workdrive_files: false;
    deletes_d1_rows: false;
    treats_as_live_pipeline: false;
    raw_private_data_policy: string;
  };
};

const DEFAULT_CURRENT_CONTEXT_PRIORITIES = ["load-first", "high"];

export function analyzeAiBrainVaultPayload(input: AiBrainVaultImportOptions): AiBrainVaultAnalysis {
  const currentContextPriorities = new Set(
    (input.currentContextPriorities?.length
      ? input.currentContextPriorities
      : DEFAULT_CURRENT_CONTEXT_PRIORITIES
    ).map((priority) => priority.trim().toLowerCase()).filter(Boolean),
  );
  const preserveWikilinks = input.preserveWikilinks !== false;

  const proposedDocuments = input.files
    .filter((file) => file.path.toLowerCase().endsWith(".md"))
    .map((file) => {
      const parsed = parseLooseMarkdown(file.markdown);
      const title = markdownTitle(parsed.body) ?? titleFromPath(file.path);
      const priority = frontmatterPriority(parsed.frontmatter, file.path);
      const stableId = frontmatterStableId(parsed.frontmatter) ?? stableIdFromPath(file.path);
      const sourceUrls = frontmatterSourceUrls(parsed.frontmatter);
      const tags = [
        "ai-brain-vault",
        slugify(input.vaultName),
        ...frontmatterTags(parsed.frontmatter),
        ...file.path.split("/").slice(0, -1).map((part) => slugify(part)).filter(Boolean),
      ];
      const memoryType: MemoryType =
        currentContextPriorities.has(priority) || file.path.startsWith("00 ")
          ? "current_context"
          : "snippet";
      return {
        stable_id: stableId,
        source_path: file.path,
        title,
        priority,
        memory_type: memoryType,
        tags: [...new Set(tags.filter(Boolean))],
        source_urls: sourceUrls,
        wiki_links: extractWikiLinks(file.markdown),
        preserve_wikilinks: preserveWikilinks,
        raw_markdown: file.markdown,
        frontmatter: parsed.frontmatter,
      };
    });

  const documentsByLookupKey = new Map<string, AiBrainVaultDocumentProposal>();
  for (const document of proposedDocuments) {
    for (const key of documentLookupKeys(document)) {
      if (!documentsByLookupKey.has(key)) {
        documentsByLookupKey.set(key, document);
      }
    }
  }

  const proposedLinks: AiBrainVaultLinkProposal[] = [];
  const unresolvedLinks: AiBrainVaultUnresolvedLink[] = [];
  for (const document of proposedDocuments) {
    for (const wikiLink of document.wiki_links) {
      const target = documentsByLookupKey.get(normalizeWikiTarget(wikiLink));
      if (!target) {
        unresolvedLinks.push({
          source_stable_id: document.stable_id,
          source_path: document.source_path,
          target_label: wikiLink,
        });
        continue;
      }
      proposedLinks.push({
        project: input.project,
        from_stable_id: document.stable_id,
        from_path: document.source_path,
        to_stable_id: target.stable_id,
        to_path: target.source_path,
        target_label: wikiLink,
        link_type: "wikilink",
      });
    }
  }

  return {
    migration_slug: "ai-brain-vault-import",
    project: input.project,
    vault_name: input.vaultName,
    dry_run: true,
    counts: {
      files_seen: input.files.length,
      markdown_files: proposedDocuments.length,
      load_first: proposedDocuments.filter((document) => document.priority === "load-first").length,
      high_priority: proposedDocuments.filter((document) => document.priority === "high").length,
      current_context: proposedDocuments.filter((document) => document.memory_type === "current_context").length,
      snippets: proposedDocuments.filter((document) => document.memory_type === "snippet").length,
      wiki_links: proposedDocuments.reduce((sum, document) => sum + document.wiki_links.length, 0),
      unresolved_links: unresolvedLinks.length,
      link_proposals: proposedLinks.length,
    },
    proposed_documents: proposedDocuments,
    proposed_links: input.applyLinks === false ? [] : proposedLinks,
    unresolved_links: unresolvedLinks,
    documents_by_stable_id: Object.fromEntries(
      proposedDocuments.map((document) => [
        document.stable_id,
        {
          stable_id: document.stable_id,
          title: document.title,
          source_path: document.source_path,
          priority: document.priority,
          memory_type: document.memory_type,
          tags: document.tags,
          source_urls: document.source_urls,
          wiki_links: document.wiki_links,
        },
      ]),
    ),
    manifest: input.manifest ?? null,
    retrieval_map: input.retrievalMap ?? null,
    safety: {
      deletes_workdrive_files: false,
      deletes_d1_rows: false,
      treats_as_live_pipeline: false,
      raw_private_data_policy: "import only client-supplied vault markdown approved by caller",
    },
  };
}

export function buildAiBrainImportMarkdown(input: {
  proposal: AiBrainVaultDocumentProposal;
  vaultName: string;
  project: string;
  authorClient: string;
}) {
  const now = new Date().toISOString();
  const body = parseLooseMarkdown(input.proposal.raw_markdown).body;
  const frontmatter = {
    id: crypto.randomUUID(),
    title: input.proposal.title,
    project: input.project,
    memory_type: input.proposal.memory_type,
    status: "active",
    revision: 1,
    tags: input.proposal.tags,
    created_at: now,
    updated_at: now,
    author_client: input.authorClient,
    source: "ai-brain-vault",
    source_urls: input.proposal.source_urls,
    confidence: 0.8,
    usefulness: input.proposal.priority === "load-first" ? 1 : 0.85,
    path: input.proposal.source_path,
    supersedes: [],
    superseded_by: [],
    canonical: input.proposal.memory_type === "current_context",
    stable_id: input.proposal.stable_id,
    ai_brain_vault: input.vaultName,
    ai_brain_priority: input.proposal.priority,
    ...(input.proposal.preserve_wikilinks ? { wiki_links: input.proposal.wiki_links } : {}),
  };
  return buildMarkdownWithExtraFrontmatter(frontmatter, body);
}

export function parseLooseMarkdown(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  try {
    return {
      frontmatter: (YAML.parse(match[1] ?? "") ?? {}) as Record<string, unknown>,
      body: markdown.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: markdown.slice(match[0].length) };
  }
}

function buildMarkdownWithExtraFrontmatter(frontmatter: Record<string, unknown>, body: string) {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function frontmatterPriority(frontmatter: Record<string, unknown>, path: string) {
  const raw = frontmatter.priority;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().toLowerCase();
  }
  if (path.startsWith("00 ")) {
    return "load-first";
  }
  return "normal";
}

function frontmatterTags(frontmatter: Record<string, unknown>) {
  const raw = frontmatter.tags;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function frontmatterStableId(frontmatter: Record<string, unknown>) {
  const raw = frontmatter.stable_id ?? frontmatter.stableId ?? frontmatter.id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function frontmatterSourceUrls(frontmatter: Record<string, unknown>) {
  const raw = frontmatter.source_urls ?? frontmatter.sourceUrls ?? frontmatter.source_url;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}

function markdownTitle(markdown: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleFromPath(path: string) {
  const fileName = path.split("/").pop() ?? "Untitled";
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

function stableIdFromPath(path: string) {
  const withoutExtension = path.replace(/\.[^.]+$/, "");
  return slugify(withoutExtension);
}

function extractWikiLinks(markdown: string) {
  return [
    ...new Set(
      [...markdown.matchAll(/\[\[([^\]]+)\]\]/g)]
        .map((match) => match[1])
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function documentLookupKeys(document: AiBrainVaultDocumentProposal) {
  return [
    document.stable_id,
    document.title,
    titleFromPath(document.source_path),
    document.source_path.replace(/\.[^.]+$/, ""),
    document.source_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "",
  ]
    .map(normalizeWikiTarget)
    .filter(Boolean);
}

function normalizeWikiTarget(raw: string) {
  const [withoutAlias] = raw.split("|");
  const [withoutHeading] = (withoutAlias ?? raw).split("#");
  return slugify((withoutHeading ?? raw).trim());
}
