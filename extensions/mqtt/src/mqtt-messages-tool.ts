import { Type } from "@sinclair/typebox";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { MqttRuntime } from "./types.js";

const MqttMessagesToolSchema = Type.Object(
  {
    topic: Type.Optional(
      Type.String({
        description: "Optional topic filter. When omitted, returns all recent messages.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of messages to return.",
        minimum: 1,
        maximum: 200,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMqttMessagesTool(runtime: MqttRuntime) {
  return {
    name: "mqtt_get_messages",
    label: "MQTT Get Messages",
    description: "Read recently received MQTT messages from the local buffer.",
    parameters: MqttMessagesToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const topic = readStringParam(rawParams, "topic") || undefined;
      const limit = readNumberParam(rawParams, "limit", { integer: true });
      return jsonResult(
        await runtime.getMessages({
          topic,
          limit,
        }),
      );
    },
  };
}
