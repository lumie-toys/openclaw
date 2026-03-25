import { Type } from "@sinclair/typebox";
import { jsonResult, readNumberParam } from "openclaw/plugin-sdk/agent-runtime";
import type { MqttRuntime } from "./types.js";

const MqttTopicsToolSchema = Type.Object(
  {
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of topic snapshots to return.",
        minimum: 1,
        maximum: 200,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMqttListTopicsTool(runtime: MqttRuntime) {
  return {
    name: "mqtt_list_topics",
    label: "MQTT List Topics",
    description: "List subscribed MQTT topics with latest message snapshots.",
    parameters: MqttTopicsToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const limit = readNumberParam(rawParams, "limit", { integer: true });
      return jsonResult(await runtime.listTopics({ limit }));
    },
  };
}
