import {
  createPluginBackedWebSearchProvider,
} from "../../src/agents/tools/web-search-plugin-factory.js";
import { emptyPluginConfigSchema } from "../../src/plugins/config-schema.js";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";

const searxngPlugin = {
  id: "searxng",
  name: "SearXNG Plugin",
  description: "Bundled SearXNG plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerWebSearchProvider(
      createPluginBackedWebSearchProvider({
        id: "searxng",
        label: "SearXNG",
        hint: "Self-hosted meta search engine · no API key required",
        envVars: ["SEARXNG_BASE_URL"],
        placeholder: "http://localhost:8888",
        signupUrl: "https://docs.searxng.org/",
        docsUrl: "https://docs.openclaw.ai/tools/web",
        autoDetectOrder: 5,
        getCredentialValue: (searchConfig) => {
          const scoped = searchConfig?.searxng;
          if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
            return undefined;
          }
          return (scoped as Record<string, unknown>).baseUrl;
        },
        setCredentialValue: (searchConfigTarget, value) => {
          const scoped = searchConfigTarget.searxng;
          if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
            searchConfigTarget.searxng = { baseUrl: value };
            return;
          }
          (scoped as Record<string, unknown>).baseUrl = value;
        },
      }),
    );
  },
};

export default searxngPlugin;
