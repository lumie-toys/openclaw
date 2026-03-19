import { Type } from "@sinclair/typebox";
import {
  buildSearchCacheKey,
  DEFAULT_SEARCH_COUNT,
  MAX_SEARCH_COUNT,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readNumberParam,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  setProviderWebSearchPluginConfigValue,
  throwWebSearchApiError,
  type SearchConfigRecord,
  type WebSearchProviderPlugin,
  type WebSearchProviderToolDefinition,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8888";

type SearxngConfig = {
  baseUrl?: string;
};

type SearxngSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
};

type SearxngSearchResponse = {
  results?: SearxngSearchResult[];
};

function resolveSearxngConfig(searchConfig?: SearchConfigRecord): SearxngConfig {
  const scoped = searchConfig?.searxng;
  return scoped && typeof scoped === "object" && !Array.isArray(scoped)
    ? (scoped as SearxngConfig)
    : {};
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return DEFAULT_SEARXNG_BASE_URL;
  }
  return trimmed.replace(/\/+$/u, "") || DEFAULT_SEARXNG_BASE_URL;
}

function resolveSearxngBaseUrl(config?: SearxngConfig): string {
  return normalizeBaseUrl(
    readConfiguredSecretString(config?.baseUrl, "tools.web.search.searxng.baseUrl") ??
      readProviderEnvValue(["SEARXNG_BASE_URL"]),
  );
}

function createSearxngSchema() {
  return Type.Object({
    query: Type.String({ description: "Search query string." }),
    count: Type.Optional(
      Type.Number({
        description: "Number of results to return (1-10).",
        minimum: 1,
        maximum: MAX_SEARCH_COUNT,
      }),
    ),
  });
}

async function runSearxngSearch(params: {
  baseUrl: string;
  query: string;
  timeoutSeconds: number;
  count: number;
}): Promise<Array<Record<string, unknown>>> {
  const endpoint = new URL(`${params.baseUrl}/search`);
  endpoint.searchParams.set("q", params.query);
  endpoint.searchParams.set("format", "json");

  return withTrustedWebSearchEndpoint(
    {
      url: endpoint.toString(),
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    },
    async (res) => {
      if (!res.ok) {
        return throwWebSearchApiError(res, "SearXNG");
      }

      const data = (await res.json()) as SearxngSearchResponse;
      const results = Array.isArray(data.results) ? data.results : [];
      return results.slice(0, params.count).map((entry) => {
        const title = typeof entry.title === "string" ? entry.title : "";
        const url = typeof entry.url === "string" ? entry.url : "";
        const description = typeof entry.content === "string" ? entry.content : "";
        const published =
          typeof entry.publishedDate === "string" ? entry.publishedDate : undefined;
        return {
          title: title ? wrapWebContent(title, "web_search") : "",
          url,
          description: description ? wrapWebContent(description, "web_search") : "",
          published,
          siteName: resolveSiteName(url) || undefined,
        };
      });
    },
  );
}

function createSearxngToolDefinition(
  searchConfig?: SearchConfigRecord,
): WebSearchProviderToolDefinition {
  return {
    description:
      "Search the web using SearXNG. Returns result titles, URLs, and snippets from your self-hosted SearXNG instance.",
    parameters: createSearxngSchema(),
    execute: async (args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const requestedCount = readNumberParam(params, "count", { integer: true });
      const count = resolveSearchCount(
        requestedCount ?? searchConfig?.maxResults ?? DEFAULT_SEARCH_COUNT,
        DEFAULT_SEARCH_COUNT,
      );

      const searxngConfig = resolveSearxngConfig(searchConfig);
      const baseUrl = resolveSearxngBaseUrl(searxngConfig);
      const cacheKey = buildSearchCacheKey(["searxng", baseUrl, query, count]);
      const cached = readCachedSearchPayload(cacheKey);
      if (cached) {
        return cached;
      }

      const start = Date.now();
      const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
      const cacheTtlMs = resolveSearchCacheTtlMs(searchConfig);
      const results = await runSearxngSearch({
        baseUrl,
        query,
        timeoutSeconds,
        count,
      });
      const payload = {
        query,
        provider: "searxng",
        count: results.length,
        tookMs: Date.now() - start,
        externalContent: {
          untrusted: true,
          source: "web_search",
          provider: "searxng",
          wrapped: true,
        },
        results,
      };
      writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
      return payload;
    },
  };
}

function getScopedCredentialValue(searchConfig?: Record<string, unknown>): unknown {
  const scoped = searchConfig?.searxng;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return undefined;
  }
  return (scoped as Record<string, unknown>).baseUrl;
}

function setScopedCredentialValue(
  searchConfigTarget: Record<string, unknown>,
  value: unknown,
): void {
  const scoped = searchConfigTarget.searxng;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    searchConfigTarget.searxng = { baseUrl: value };
    return;
  }
  (scoped as Record<string, unknown>).baseUrl = value;
}

export function createSearxngWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "searxng",
    label: "SearXNG",
    hint: "Self-hosted meta search engine · no API key required",
    envVars: ["SEARXNG_BASE_URL"],
    placeholder: "http://localhost:8888",
    signupUrl: "https://docs.searxng.org/",
    docsUrl: "https://docs.openclaw.ai/tools/web",
    autoDetectOrder: 5,
    credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
    getCredentialValue: getScopedCredentialValue,
    setCredentialValue: setScopedCredentialValue,
    getConfiguredCredentialValue: (config) =>
      resolveProviderWebSearchPluginConfig(config, "searxng")?.baseUrl,
    setConfiguredCredentialValue: (configTarget, value) => {
      setProviderWebSearchPluginConfigValue(configTarget, "searxng", "baseUrl", value);
    },
    createTool: (ctx) =>
      createSearxngToolDefinition(
        (() => {
          const searchConfig = ctx.searchConfig as SearchConfigRecord | undefined;
          const pluginConfig = resolveProviderWebSearchPluginConfig(ctx.config, "searxng");
          if (!pluginConfig) {
            return searchConfig;
          }
          return {
            ...(searchConfig ?? {}),
            searxng: {
              ...resolveSearxngConfig(searchConfig),
              ...pluginConfig,
            },
          } as SearchConfigRecord;
        })(),
      ),
  };
}
