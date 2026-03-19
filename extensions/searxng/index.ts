import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { createSearxngWebSearchProvider } from "./src/searxng-web-search-provider.js";

export default definePluginEntry({
  id: "searxng",
  name: "SearXNG Plugin",
  description: "Bundled SearXNG plugin",
  register(api) {
    api.registerWebSearchProvider(createSearxngWebSearchProvider());
  },
});
