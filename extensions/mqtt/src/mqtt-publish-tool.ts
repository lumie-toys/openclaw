import { Type } from "@sinclair/typebox";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { MqttRuntime } from "./types.js";

const MqttPublishToolSchema = Type.Object(
  {
    topic: Type.String({ description: "MQTT topic to publish to, for example device/toy-1/cmd" }),
    payload: Type.String({ description: "Text payload to publish." }),
    qos: Type.Optional(
      Type.Number({
        description: "MQTT QoS level (0, 1, or 2).",
        minimum: 0,
        maximum: 2,
      }),
    ),
    retain: Type.Optional(
      Type.Boolean({
        description: "Whether broker should retain this message.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMqttPublishTool(runtime: MqttRuntime) {
  return {
    name: "mqtt_publish",
    label: "MQTT Publish",
    description: "Publish a message to a target MQTT topic.",
    parameters: MqttPublishToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const topic = readStringParam(rawParams, "topic", { required: true });
      const payload = readStringParam(rawParams, "payload", { required: true });
      const qos = readNumberParam(rawParams, "qos", { integer: true });
      const retain = rawParams.retain === true;
      return jsonResult(
        await runtime.publish({
          topic,
          payload,
          qos,
          retain,
        }),
      );
    },
  };
}
