import { loadConfig } from "~/config/env";

type ZohoJsonApiSingle<T> = {
  data: T;
};

type ZohoJsonApiList<T> = {
  data: T[];
};

type ZohoAttributes = {
  name?: string;
  type?: string;
  is_folder?: boolean;
  parent_id?: string;
  download_url?: string;
  permalink?: string;
  modified_time_in_millisecond?: number;
  created_time_in_millisecond?: number;
  display_html_name?: string;
};

type ZohoItem = {
  id: string;
  type: string;
  attributes: ZohoAttributes;
};

export type ZohoFile = {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  downloadUrl: string | null;
  permalink: string | null;
  modifiedTimeMillis: number | null;
  createdTimeMillis: number | null;
};

let cachedToken:
  | {
      accessToken: string;
      expiresAt: number;
    }
  | undefined;
let refreshInFlight: Promise<string> | undefined;

const ZOHO_ACCESS_TOKEN_CACHE_KEY = "zoho:workdrive:access_token";
const TOKEN_REFRESH_SKEW_MS = 60_000;

type CachedZohoToken = {
  accessToken: string;
  expiresAt: number;
};

const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

export function resetZohoAccessTokenCacheForTests() {
  cachedToken = undefined;
  refreshInFlight = undefined;
}

export class ZohoWorkDriveClient {
  constructor(
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = defaultFetch,
  ) {}

  async getFile(fileId: string) {
    const config = loadConfig(this.env);
    const response = await this.requestJson<ZohoJsonApiSingle<ZohoItem>>(
      `${config.zoho.apiBaseUrl}/files/${fileId}`,
    );
    return normalizeZohoItem(response.data);
  }

  async listFiles(folderId: string) {
    const config = loadConfig(this.env);
    const response = await this.requestJson<ZohoJsonApiList<ZohoItem>>(
      `${config.zoho.apiBaseUrl}/files/${folderId}/files`,
    );
    return response.data.map(normalizeZohoItem);
  }

  async listFolders(folderId: string) {
    const config = loadConfig(this.env);
    const response = await this.requestJson<ZohoJsonApiList<ZohoItem>>(
      `${config.zoho.apiBaseUrl}/files/${folderId}/folders`,
    );
    return response.data.map(normalizeZohoItem);
  }

  async findChildFolder(parentFolderId: string, folderName: string) {
    const folders = await this.listFolders(parentFolderId);
    return (
      folders.find(
        (folder) => folder.isFolder && folder.name.toLowerCase() === folderName.toLowerCase(),
      ) ?? null
    );
  }

  async resolveFolderPath(rootFolderId: string, segments: string[]) {
    let current = await this.getFile(rootFolderId);
    for (const segment of segments) {
      const next = await this.findChildFolder(current.id, segment);
      if (!next) {
        throw new Error(
          `Zoho WorkDrive folder "${segment}" not found under folder ${current.id}. Pre-create the documented memory structure in WorkDrive before writing through MCP.`,
        );
      }
      current = next;
    }
    return current;
  }

  async ensureFolderPath(rootFolderId: string, segments: string[]) {
    let current = await this.getFile(rootFolderId);
    const created: ZohoFile[] = [];
    for (const segment of segments) {
      const existing = await this.findChildFolder(current.id, segment);
      if (existing) {
        current = existing;
        continue;
      }
      const next = await this.createFolder(current.id, segment);
      created.push(next);
      current = next;
    }
    return { folder: current, created };
  }

  async createFolder(parentFolderId: string, folderName: string) {
    const config = loadConfig(this.env);
    const response = await this.requestJson<ZohoJsonApiSingle<ZohoItem>>(
      `${config.zoho.apiBaseUrl}/files`,
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "files",
            attributes: {
              name: folderName,
              parent_id: parentFolderId,
            },
          },
        }),
      },
    );
    const folder = normalizeZohoItem(response.data);
    if (!folder.isFolder) {
      throw new Error(
        `Zoho WorkDrive create folder response for "${folderName}" did not describe a folder. Check WorkDrive API scope and tenant endpoint configuration.`,
      );
    }
    return folder;
  }

  async findFileByName(folderId: string, fileName: string) {
    const files = await this.listFiles(folderId);
    return (
      files.find(
        (file) => !file.isFolder && file.name.toLowerCase() === fileName.toLowerCase(),
      ) ?? null
    );
  }

  async downloadMarkdown(fileId: string) {
    const config = loadConfig(this.env);
    const file = await this.getFile(fileId);
    const accessToken = await this.getAccessToken();
    const candidates = uniqueStrings([
      buildWorkDriveDownloadUrl(config.zoho.apiBaseUrl, fileId),
      file.downloadUrl,
    ]);
    const failures: string[] = [];

    for (const url of candidates) {
      const response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          Accept: "text/markdown,text/plain,*/*",
        },
      });
      if (response.ok) {
        return {
          file,
          markdown: await response.text(),
        };
      }
      failures.push(await describeDownloadFailure("authenticated", url, response));

      if (url === file.downloadUrl && (response.status === 401 || response.status === 403)) {
        const unauthenticatedResponse = await this.fetchImpl(url);
        if (unauthenticatedResponse.ok) {
          return {
            file,
            markdown: await unauthenticatedResponse.text(),
          };
        }
        failures.push(
          await describeDownloadFailure("unauthenticated", url, unauthenticatedResponse),
        );
      }
    }

    throw new Error(
      `Failed to download WorkDrive file ${fileId}. Tried ${candidates.length} WorkDrive download endpoint(s): ${failures.join("; ")}. Check the configured Zoho region endpoint and OAuth WorkDrive file scopes.`,
    );
  }

  async uploadMarkdownFile(input: {
    folderId: string;
    fileName: string;
    markdown: string;
    overrideExisting: boolean;
  }) {
    const config = loadConfig(this.env);
    if (!config.zoho.uploadUrl) {
      throw new Error(
        "ZOHO_WORKDRIVE_UPLOAD_URL is required for WorkDrive write operations. This endpoint must be validated against your tenant before production use.",
      );
    }

    const accessToken = await this.getAccessToken();
    const formData = new FormData();
    formData.set(
      "content",
      new File([input.markdown], input.fileName, { type: "text/markdown; charset=utf-8" }),
    );
    formData.set("filename", encodeURIComponent(input.fileName));
    formData.set("parent_id", input.folderId);
    formData.set("override-name-exist", String(input.overrideExisting));

    const response = await this.fetchImpl(config.zoho.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: "application/vnd.api+json",
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to upload markdown to WorkDrive: ${response.status} ${response.statusText} ${body}`,
      );
    }

    const uploaded = await this.findFileByName(input.folderId, input.fileName);
    if (!uploaded) {
      throw new Error(
        `WorkDrive upload succeeded but the uploaded file ${input.fileName} could not be reloaded from folder ${input.folderId}.`,
      );
    }
    return uploaded;
  }

  private async requestJson<T>(url: string, init: RequestInit = {}) {
    const accessToken = await this.getAccessToken();
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: "application/vnd.api+json",
        ...(init.body ? { "content-type": "application/vnd.api+json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      const hint =
        response.status === 401 || response.status === 403
          ? " Check Zoho OAuth scopes and WorkDrive team access."
          : "";
      throw new Error(`Zoho WorkDrive API request failed: ${response.status} ${body}${hint}`);
    }
    return (await response.json()) as T;
  }

  private async getAccessToken() {
    const config = loadConfig(this.env);
    if (config.zoho.accessToken) {
      return config.zoho.accessToken;
    }

    if (isUsableToken(cachedToken)) {
      return cachedToken!.accessToken;
    }

    if (
      !config.zoho.clientId ||
      !config.zoho.clientSecret ||
      !config.zoho.refreshToken
    ) {
      throw new Error(
        "Missing Zoho OAuth configuration. Provide ZOHO_ACCESS_TOKEN or the full refresh-token flow credentials.",
      );
    }

    const kvToken = await this.readCachedAccessToken();
    if (isUsableToken(kvToken)) {
      cachedToken = kvToken;
      return kvToken!.accessToken;
    }

    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = this.refreshAccessToken().finally(() => {
      refreshInFlight = undefined;
    });
    return refreshInFlight;
  }

  private async readCachedAccessToken() {
    if (!this.env.OAUTH_KV) {
      return undefined;
    }
    try {
      return (
        (await this.env.OAUTH_KV.get<CachedZohoToken>(
          ZOHO_ACCESS_TOKEN_CACHE_KEY,
          "json",
        )) ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  private async writeCachedAccessToken(token: CachedZohoToken) {
    if (!this.env.OAUTH_KV) {
      return;
    }
    const expirationTtl = Math.max(60, Math.floor((token.expiresAt - Date.now()) / 1000));
    await this.env.OAUTH_KV.put(ZOHO_ACCESS_TOKEN_CACHE_KEY, JSON.stringify(token), {
      expirationTtl,
    });
  }

  private async refreshAccessToken() {
    const config = loadConfig(this.env);
    const tokenUrl = new URL("/oauth/v2/token", config.zoho.accountsBaseUrl);
    const body = new URLSearchParams({
      client_id: config.zoho.clientId!,
      client_secret: config.zoho.clientSecret!,
      refresh_token: config.zoho.refreshToken!,
      grant_type: "refresh_token",
    });

    const response = await this.fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      if (cachedToken && cachedToken.expiresAt > Date.now()) {
        return cachedToken.accessToken;
      }
      throw new Error(`Failed to refresh Zoho access token: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresIn = payload.expires_in ?? 3600;
    cachedToken = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    await this.writeCachedAccessToken(cachedToken);
    return cachedToken.accessToken;
  }
}

function isUsableToken(token: CachedZohoToken | undefined) {
  return Boolean(token && token.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS);
}

function normalizeZohoItem(item: ZohoItem): ZohoFile {
  return {
    id: item.id,
    name:
      item.attributes.display_html_name ??
      item.attributes.name ??
      item.attributes.type ??
      item.id,
    isFolder: Boolean(item.attributes.is_folder || item.attributes.type === "folder"),
    parentId: item.attributes.parent_id ?? null,
    downloadUrl: item.attributes.download_url ?? null,
    permalink: item.attributes.permalink ?? null,
    modifiedTimeMillis: item.attributes.modified_time_in_millisecond ?? null,
    createdTimeMillis: item.attributes.created_time_in_millisecond ?? null,
  };
}

function buildWorkDriveDownloadUrl(apiBaseUrl: string, fileId: string) {
  const url = new URL(apiBaseUrl);
  let host = url.hostname.toLowerCase();

  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  if (host.startsWith("zohoapis.")) {
    host = host.replace(/^zohoapis\./, "zoho.");
  }
  if (host.startsWith("workdrive.")) {
    return `${url.protocol}//${host}/api/v1/download/${encodeURIComponent(fileId)}`;
  }
  if (host.startsWith("zoho.")) {
    return `${url.protocol}//workdrive.${host}/api/v1/download/${encodeURIComponent(fileId)}`;
  }
  return `${url.origin.replace(/\/$/, "")}/download/${encodeURIComponent(fileId)}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function describeDownloadFailure(mode: string, url: string, response: Response) {
  const body = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
  return `${mode} ${redactUrlForError(url)} -> ${response.status} ${response.statusText}${body ? ` ${body}` : ""}`;
}

function redactUrlForError(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split("?")[0] ?? value;
  }
}
