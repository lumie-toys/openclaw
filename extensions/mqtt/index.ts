import {
  definePluginEntry,
  type AnyAgentTool,
  type OpenClawPluginApi,
  type OpenClawPluginService,
} from "openclaw/plugin-sdk/plugin-entry";
import { createMqttRuntime } from "./src/mqtt-client.js";
import { createMqttMessagesTool } from "./src/mqtt-messages-tool.js";
import { createMqttListTopicsTool } from "./src/mqtt-topics-tool.js";
import { createMqttPublishTool } from "./src/mqtt-publish-tool.js";

export default definePluginEntry({
  id: "mqtt",
  name: "MQTT Plugin",
  description: "MQTT messaging for IoT devices via EMQX",
  register(api: OpenClawPluginApi) {
    const runtime = createMqttRuntime(api);

    const service: OpenClawPluginService = {
      id: "mqtt-runtime",
      start: async () => {
        await runtime.start();
      },
      stop: async () => {
        await runtime.stop();
      },
    };

    api.registerService(service);
    api.registerTool(createMqttPublishTool(runtime) as AnyAgentTool);
    api.registerTool(createMqttMessagesTool(runtime) as AnyAgentTool);
    api.registerTool(createMqttListTopicsTool(runtime) as AnyAgentTool);
  },
});
