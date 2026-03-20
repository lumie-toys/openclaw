import { Type } from "@sinclair/typebox";
import {
  buildSearchCacheKey,
  DEFAULT_SEARCH_COUNT,
  MAX_SEARCH_COUNT,
  readCachedSearchPayload,
  readNumberParam,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  setProviderWebSearchPluginConfigValue,
  type SearchConfigRecord,
  type WebSearchProviderPlugin,
  type WebSearchProviderToolDefinition,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8888";

type SearxngConfig = {
  baseUrl?: string;
  engines?: string;
  categories?: string;
  language?: string;
  time_range?: string;
};

type SearxngSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  publishedDate?: string;
};

type SearxngSearchResponse = {
  results?: SearxngSearchResult[];
  answers?: string[];
  infoboxes?: Array<{
    infobox?: string;
    content?: string;
    id?: string;
    urls?: Array<{ title?: string; url?: string }>;
    url?: string;
  }>;
};

function resolveSearxngConfig(searchConfig?: SearchConfigRecord): SearxngConfig {
  const scoped = searchConfig?.searxng;
  return scoped && typeof scoped === "object" && !Array.isArray(scoped)
    ? (scoped as SearxngConfig)
    : {};
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeBaseUrl(value: unknown): string {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return DEFAULT_SEARXNG_BASE_URL;
  }
  return trimmed.replace(/\/+$/u, "") || DEFAULT_SEARXNG_BASE_URL;
}

function resolveSearxngBaseUrl(config?: SearxngConfig): string {
  return normalizeBaseUrl(config?.baseUrl ?? readProviderEnvValue(["SEARXNG_BASE_URL"]));
}

function resolveDefaultEngines(config?: SearxngConfig): string | undefined {
  return (
    normalizeOptionalString(config?.engines) ??
    normalizeOptionalString(readProviderEnvValue(["SEARXNG_ENGINES"]))
  );
}

function resolveDefaultCategories(config?: SearxngConfig): string | undefined {
  return (
    normalizeOptionalString(config?.categories) ??
    normalizeOptionalString(readProviderEnvValue(["SEARXNG_CATEGORIES"]))
  );
}

function resolveDefaultLanguage(config?: SearxngConfig): string | undefined {
  return (
    normalizeOptionalString(config?.language) ??
    normalizeOptionalString(readProviderEnvValue(["SEARXNG_LANGUAGE"]))
  );
}

function resolveDefaultTimeRange(config?: SearxngConfig): string | undefined {
  return (
    normalizeOptionalString(config?.time_range) ??
    normalizeOptionalString(readProviderEnvValue(["SEARXNG_TIME_RANGE"]))
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
    engines: Type.Optional(
      Type.String({
        description: "Comma-separated engines (e.g. 'google,bing,duckduckgo').",
      }),
    ),
    categories: Type.Optional(
      Type.String({
        description: "Comma-separated categories (e.g. 'general,news').",
      }),
    ),
    language: Type.Optional(
      Type.String({
        description: "Search language (e.g. 'en', 'zh-CN').",
      }),
    ),
    time_range: Type.Optional(
      Type.String({
        description: "Time range filter: day, month, or year.",
      }),
    ),
  });
}

function buildTimeoutSignal(timeoutSeconds: number): AbortSignal | undefined {
  const timeoutMs = Math.max(1, Math.floor(timeoutSeconds * 1000));
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function runSearxngSearch(params: {
  baseUrl: string;
  query: string;
  timeoutSeconds: number;
  count: number;
  engines?: string;
  categories?: string;
  language?: string;
  timeRange?: string;
}): Promise<{
  requestUrl: string;
  results: Array<Record<string, unknown>>;
  citations: string[];
  answerSnippets: string[];
}> {
  const endpoint = new URL(`${params.baseUrl}/search`);
  endpoint.searchParams.set("q", params.query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("pageno", "1");
  if (params.engines) {
    endpoint.searchParams.set("engines", params.engines);
  }
  if (params.categories) {
    endpoint.searchParams.set("categories", params.categories);
  }
  if (params.language) {
    endpoint.searchParams.set("language", params.language);
  }
  if (params.timeRange) {
    endpoint.searchParams.set("time_range", params.timeRange);
  }

  const requestUrl = endpoint.toString();
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: buildTimeoutSignal(params.timeoutSeconds),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SearXNG API error (${response.status}): ${detail || response.statusText}`);
  }

  const data = (await response.json()) as SearxngSearchResponse;
  const results = Array.isArray(data.results) ? data.results : [];
  const mappedResults = results.slice(0, params.count).map((entry) => {
    const title = typeof entry.title === "string" ? entry.title : "";
    const url = typeof entry.url === "string" ? entry.url : "";
    const description = typeof entry.content === "string" ? entry.content : "";
    const published = typeof entry.publishedDate === "string" ? entry.publishedDate : undefined;
    return {
      title: title ? wrapWebContent(title, "web_search") : "",
      url,
      description: description ? wrapWebContent(description, "web_search") : "",
      published,
      siteName: resolveSiteName(url) || undefined,
    };
  });

  const answerSnippets = (Array.isArray(data.answers) ? data.answers : [])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, 3);

  const infoboxResults = (Array.isArray(data.infoboxes) ? data.infoboxes : [])
    .slice(0, 3)
    .map((box) => {
      const infoTitle =
        typeof box.infobox === "string" && box.infobox.trim().length > 0
          ? box.infobox
          : "SearXNG infobox";
      const infoText = typeof box.content === "string" && box.content.trim().length > 0 ? box.content : "";
      const firstUrl =
        (Array.isArray(box.urls)
          ? box.urls.find((entry) => typeof entry?.url === "string" && entry.url.length > 0)
          : undefined) ?? undefined;
      const url =
        typeof firstUrl?.url === "string"
          ? firstUrl.url
          : typeof box.url === "string"
            ? box.url
            : "";
      return {
        title: wrapWebContent(infoTitle, "web_search"),
        url,
        description: infoText ? wrapWebContent(infoText, "web_search") : "",
        published: undefined,
        siteName: resolveSiteName(url) || undefined,
      };
    });

  const combined = [...mappedResults];
  if (combined.length === 0 && infoboxResults.length > 0) {
    combined.push(...infoboxResults);
  }

  const citations = Array.from(
    new Set(
      combined
        .map((entry) => (typeof entry.url === "string" ? entry.url : ""))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

  return {
    requestUrl,
    results: combined.slice(0, params.count),
    citations,
    answerSnippets,
  };
}

function createSearxngToolDefinition(
  searchConfig?: SearchConfigRecord,
): WebSearchProviderToolDefinition {
  return {
    description:
      "Search the web using SearXNG. Supports custom engines/categories and returns titles, URLs, snippets, and citations.",
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
      const engines = readStringParam(params, "engines") ?? resolveDefaultEngines(searxngConfig);
      const categories = readStringParam(params, "categories") ?? resolveDefaultCategories(searxngConfig);
      const language = readStringParam(params, "language") ?? resolveDefaultLanguage(searxngConfig);
      const timeRange =
        readStringParam(params, "time_range") ?? resolveDefaultTimeRange(searxngConfig);

      const cacheKey = buildSearchCacheKey([
        "searxng",
        baseUrl,
        query,
        count,
        engines,
        categories,
        language,
        timeRange,
      ]);
      const cached = readCachedSearchPayload(cacheKey);
      if (cached) {
        return cached;
      }

      const start = Date.now();
      const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
      const cacheTtlMs = resolveSearchCacheTtlMs(searchConfig);
      let attemptedUrl = `${baseUrl}/search`;

      try {
        const { requestUrl, results, citations, answerSnippets } = await runSearxngSearch({
          baseUrl,
          query,
          timeoutSeconds,
          count,
          engines,
          categories,
          language,
          timeRange,
        });
        attemptedUrl = requestUrl;

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
          citations,
          message:
            results.length === 0 && answerSnippets.length === 0
              ? `No results returned from SearXNG for query: "${query}". Check instance health, engine filters, and whether JSON format is enabled.`
              : `SearXNG returned ${results.length} result(s).`,
          answers:
            answerSnippets.length > 0
              ? answerSnippets.map((entry) => wrapWebContent(entry, "web_search"))
              : undefined,
          diagnostics: {
            baseUrl,
            requestUrl,
            engines: engines || undefined,
            categories: categories || undefined,
            language: language || undefined,
            timeRange: timeRange || undefined,
          },
        };
        if (results.length > 0 || answerSnippets.length > 0) {
          writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
        }
        return payload;
      } catch (error) {
        return {
          status: "error",
          provider: "searxng",
          query,
          count: 0,
          tookMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
          message:
            "SearXNG request failed. Verify endpoint reachability and enable `json` under SearXNG search formats.",
          results: [],
          citations: [],
          diagnostics: {
            baseUrl,
            requestUrl: attemptedUrl,
            engines: engines || undefined,
            categories: categories || undefined,
            language: language || undefined,
            timeRange: timeRange || undefined,
          },
        };
      }
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
