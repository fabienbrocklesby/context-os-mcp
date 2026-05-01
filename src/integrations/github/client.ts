import type { AppConfig } from "~/config/env";
import type { MemoryPrincipal } from "~/domain/memory";

const DEFAULT_MAX_FILE_BYTES = 200_000;

type GithubContentFile = {
  type: string;
  encoding?: string;
  size: number;
  name: string;
  path: string;
  sha: string;
  content?: string;
  html_url?: string;
  download_url?: string;
};

type GithubContentDirectoryItem = GithubContentFile & {
  type: "file" | "dir" | "symlink" | "submodule";
};

type GithubRepo = {
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  description?: string | null;
  archived: boolean;
  fork: boolean;
  owner: {
    login: string;
  };
};

type GithubSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{
    name: string;
    path: string;
    sha: string;
    html_url: string;
    repository: {
      full_name: string;
      private: boolean;
      html_url: string;
    };
  }>;
};

export type GithubRepoFile = {
  repo: string;
  path: string;
  ref: string | null;
  sha: string;
  size: number;
  htmlUrl: string | null;
  downloadUrl: string | null;
  content: string;
};

export class GithubOAuthClient {
  constructor(
    private readonly env: Env,
    private readonly config: AppConfig["github"],
    private readonly principal: MemoryPrincipal,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async listRepos(input: {
    query?: string;
    owner?: string;
    limit?: number;
  } = {}) {
    const token = await this.getAccessToken();
    const repos: GithubRepo[] = [];
    let page = 1;
    const maxResults = Math.min(input.limit ?? 50, 100);

    while (repos.length < maxResults && page <= 5) {
      const url = new URL("/user/repos", this.config.apiBaseUrl);
      url.searchParams.set("visibility", "all");
      url.searchParams.set("affiliation", "owner,collaborator,organization_member");
      url.searchParams.set("sort", "updated");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const response = await this.githubFetch(url, token);
      if (!response.ok) {
        throw new Error(`GitHub repo list failed: ${response.status} ${await response.text()}`);
      }
      const batch = (await response.json()) as GithubRepo[];
      if (!batch.length) {
        break;
      }
      repos.push(...batch);
      page += 1;
    }

    const query = input.query?.toLowerCase();
    const owner = input.owner?.toLowerCase();
    return {
      results: repos
        .filter((repo) => this.isRepoAllowed(repo.full_name))
        .filter((repo) => !owner || repo.owner.login.toLowerCase() === owner)
        .filter((repo) => {
          if (!query) {
            return true;
          }
          return (
            repo.full_name.toLowerCase().includes(query) ||
            (repo.description ?? "").toLowerCase().includes(query)
          );
        })
        .slice(0, maxResults)
        .map((repo) => ({
          repo: repo.full_name,
          private: repo.private,
          url: repo.html_url,
          default_branch: repo.default_branch,
          description: repo.description,
          archived: repo.archived,
          fork: repo.fork,
        })),
    };
  }

  async getFile(input: {
    repo: string;
    path: string;
    ref?: string;
    maxBytes?: number;
  }): Promise<GithubRepoFile> {
    const token = await this.getAccessToken();
    this.assertRepoAllowed(input.repo);
    const [owner, repoName] = parseRepo(input.repo);
    const url = new URL(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${encodePath(input.path)}`,
      this.config.apiBaseUrl,
    );
    if (input.ref) {
      url.searchParams.set("ref", input.ref);
    }

    const response = await this.githubFetch(url, token);
    if (!response.ok) {
      throw new Error(`GitHub file lookup failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as GithubContentFile | GithubContentFile[];
    if (Array.isArray(payload) || payload.type !== "file") {
      throw new Error(`GitHub path ${input.repo}:${input.path} is not a file.`);
    }
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (payload.size > maxBytes) {
      throw new Error(
        `GitHub file ${input.repo}:${input.path} is ${payload.size} bytes, over the ${maxBytes} byte limit.`,
      );
    }
    if (payload.encoding !== "base64" || !payload.content) {
      throw new Error(`GitHub file ${input.repo}:${input.path} did not include base64 content.`);
    }

    return {
      repo: input.repo.toLowerCase(),
      path: payload.path,
      ref: input.ref ?? null,
      sha: payload.sha,
      size: payload.size,
      htmlUrl: payload.html_url ?? null,
      downloadUrl: payload.download_url ?? null,
      content: decodeBase64Text(payload.content.replace(/\s+/g, "")),
    };
  }

  async listDirectory(input: {
    repo: string;
    path?: string;
    ref?: string;
  }) {
    const token = await this.getAccessToken();
    this.assertRepoAllowed(input.repo);
    const [owner, repoName] = parseRepo(input.repo);
    const url = new URL(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${encodePath(input.path ?? "")}`,
      this.config.apiBaseUrl,
    );
    if (input.ref) {
      url.searchParams.set("ref", input.ref);
    }

    const response = await this.githubFetch(url, token);
    if (!response.ok) {
      throw new Error(`GitHub directory lookup failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as GithubContentDirectoryItem[] | GithubContentFile;
    if (!Array.isArray(payload)) {
      throw new Error(`GitHub path ${input.repo}:${input.path ?? "/"} is not a directory.`);
    }
    return {
      repo: input.repo.toLowerCase(),
      path: input.path ?? "",
      ref: input.ref ?? null,
      entries: payload.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        url: item.html_url ?? null,
      })),
    };
  }

  async searchCode(input: {
    query: string;
    repos?: string[];
    owner?: string;
    limit?: number;
  }) {
    const token = await this.getAccessToken();
    const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
    const repoQualifiers = this.repoQualifiers(input.repos);
    const ownerQualifier = input.owner ? ` user:${input.owner}` : "";
    const url = new URL("/search/code", this.config.apiBaseUrl);
    url.searchParams.set("q", `${input.query}${repoQualifiers}${ownerQualifier}`);
    url.searchParams.set("per_page", String(limit));

    const response = await this.githubFetch(url, token);
    if (!response.ok) {
      throw new Error(`GitHub code search failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as GithubSearchResponse;
    return {
      total_count: payload.total_count,
      incomplete_results: payload.incomplete_results,
      results: payload.items
        .filter((item) => this.isRepoAllowed(item.repository.full_name))
        .map((item) => ({
          repo: item.repository.full_name,
          path: item.path,
          sha: item.sha,
          url: item.html_url,
          private: item.repository.private,
        })),
    };
  }

  private async getAccessToken() {
    if (this.config.accessToken) {
      return this.config.accessToken;
    }

    const principalToken = await this.readTokenForUser(this.principal.userId);
    if (principalToken) {
      return principalToken;
    }

    const defaultUserId = await this.env.OAUTH_KV.get("github:default_user_id");
    const defaultToken = defaultUserId ? await this.readTokenForUser(defaultUserId) : null;
    if (defaultToken) {
      return defaultToken;
    }

    throw new Error(
      "GitHub repo access is not connected. Visit /login/github, approve repo access, then retry.",
    );
  }

  private async readTokenForUser(userId: string) {
    if (!userId || userId === "unknown" || userId === "bearer") {
      return null;
    }
    return this.env.OAUTH_KV.get(githubAccessTokenKey(userId));
  }

  private async githubFetch(url: URL, token: string) {
    return this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "memory-system-mcp",
      },
    });
  }

  private repoQualifiers(repos?: string[]) {
    const explicitRepos = repos?.map(normalizeRepo).filter(Boolean);
    if (explicitRepos?.length) {
      for (const repo of explicitRepos) {
        this.assertRepoAllowed(repo);
      }
      return explicitRepos.map((repo) => ` repo:${repo}`).join("");
    }
    if (!this.config.allowedRepos.length) {
      return "";
    }
    return this.config.allowedRepos.map((repo) => ` repo:${repo}`).join("");
  }

  private assertRepoAllowed(repo: string) {
    if (!this.isRepoAllowed(repo)) {
      throw new Error(`GitHub repo ${normalizeRepo(repo)} is not in GITHUB_ALLOWED_REPOS.`);
    }
  }

  private isRepoAllowed(repo: string) {
    return !this.config.allowedRepos.length || this.config.allowedRepos.includes(normalizeRepo(repo));
  }
}

export function githubAccessTokenKey(userId: string) {
  return `github:user:${userId}:access_token`;
}

function parseRepo(repo: string) {
  const normalized = normalizeRepo(repo);
  const [owner, name] = normalized.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repo "${repo}". Use owner/name.`);
  }
  return [owner, name] as const;
}

function normalizeRepo(repo: string) {
  return repo.trim().toLowerCase();
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodeBase64Text(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
