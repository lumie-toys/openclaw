import { randomUUID } from "node:crypto";
import { connect, type MqttClient } from "mqtt";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  MqttMessage,
  MqttPluginConfig,
  MqttPublishParams,
  MqttRuntime,
  MqttTopicSnapshot,
} from "./types.js";

const DEFAULT_QOS = 1;
const DEFAULT_BUFFERED_MESSAGES = 200;
const MAX_BUFFERED_MESSAGES = 2000;
const DEFAULT_TOPIC_LIST_LIMIT = 100;
const DEFAULT_MESSAGE_LIST_LIMIT = 50;

function normalizeQos(input: number | undefined): 0 | 1 | 2 {
  if (input === 0 || input === 1 || input === 2) {
    return input;
  }
  return DEFAULT_QOS;
}

function normalizeLimit(input: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  const value = Math.trunc(input as number);
  if (value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

function normalizeSubscribeTopics(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return [...new Set(input.map((v) => v.trim()).filter(Boolean))];
}

function resolvePluginConfig(api: OpenClawPluginApi): MqttPluginConfig {
  const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  const subscribeTopics = Array.isArray(cfg.subscribeTopics)
    ? cfg.subscribeTopics.filter((v): v is string => typeof v === "string")
    : undefined;
  return {
    enabled: cfg.enabled === true,
    brokerUrl: typeof cfg.brokerUrl === "string" ? cfg.brokerUrl : undefined,
    username: typeof cfg.username === "string" ? cfg.username : undefined,
    password: typeof cfg.password === "string" ? cfg.password : undefined,
    clientId: typeof cfg.clientId === "string" ? cfg.clientId : undefined,
    subscribeTopics,
    qos: typeof cfg.qos === "number" ? cfg.qos : undefined,
    maxBufferedMessages:
      typeof cfg.maxBufferedMessages === "number" ? cfg.maxBufferedMessages : undefined,
  };
}

function formatPayload(payload: Buffer): string {
  const text = payload.toString("utf8");
  if (Buffer.from(text, "utf8").equals(payload)) {
    return text;
  }
  return payload.toString("base64");
}

export function createMqttRuntime(api: OpenClawPluginApi): MqttRuntime {
  const config = resolvePluginConfig(api);
  const brokerUrl = config.brokerUrl?.trim();
  const subscribeTopics = normalizeSubscribeTopics(config.subscribeTopics);
  const defaultQos = normalizeQos(config.qos);
  const maxBufferedMessages = normalizeLimit(
    config.maxBufferedMessages,
    DEFAULT_BUFFERED_MESSAGES,
    MAX_BUFFERED_MESSAGES,
  );

  let client: MqttClient | null = null;
  let startPromise: Promise<void> | null = null;
  let started = false;
  const messages: MqttMessage[] = [];
  const latestByTopic = new Map<string, MqttTopicSnapshot>();
  const messageCountByTopic = new Map<string, number>();

  const rememberMessage = (message: MqttMessage) => {
    messages.push(message);
    if (messages.length > maxBufferedMessages) {
      messages.splice(0, messages.length - maxBufferedMessages);
    }
    const previousCount = messageCountByTopic.get(message.topic) ?? 0;
    messageCountByTopic.set(message.topic, previousCount + 1);
    latestByTopic.set(message.topic, {
      topic: message.topic,
      messageCount: previousCount + 1,
      lastMessageAt: message.receivedAt,
      lastPayload: message.payload,
    });
  };

  const subscribeConfiguredTopics = async () => {
    if (!client || subscribeTopics.length === 0) {
      return;
    }
    await Promise.all(
      subscribeTopics.map(
        (topic) =>
          new Promise<void>((resolve, reject) => {
            client!.subscribe(topic, { qos: defaultQos }, (err) => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            });
          }),
      ),
    );
  };

  const ensureStarted = async () => {
    if (config.enabled === false) {
      throw new Error("MQTT plugin is disabled by configuration.");
    }
    if (started) {
      return;
    }
    if (!brokerUrl) {
      throw new Error(
        "MQTT plugin is not configured. Set plugins.entries.mqtt.config.brokerUrl or MQTT_BROKER_URL.",
      );
    }
    if (startPromise) {
      return startPromise;
    }
    startPromise = new Promise<void>((resolve, reject) => {
      const mqttClientId = config.clientId?.trim() || `openclaw-mqtt-${randomUUID().slice(0, 8)}`;
      const nextClient = connect(brokerUrl, {
        username: config.username,
        password: config.password,
        clientId: mqttClientId,
        reconnectPeriod: 1000,
      });
      client = nextClient;

      const onConnect = () => {
        nextClient
          .removeListener("error", onInitialError)
          .removeListener("close", onInitialClose)
          .on("message", (topic, payload, packet) => {
            const incoming: MqttMessage = {
              topic,
              payload: formatPayload(payload),
              qos: packet.qos,
              retain: packet.retain,
              receivedAt: new Date().toISOString(),
            };
            rememberMessage(incoming);
          });
        void subscribeConfiguredTopics()
          .then(() => {
            started = true;
            api.logger.info(
              `mqtt: connected to broker ${brokerUrl} with ${subscribeTopics.length} subscribed topic(s)`,
            );
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      };

      const onInitialError = (err: Error) => {
        nextClient.removeListener("connect", onConnect).removeListener("close", onInitialClose);
        reject(err);
      };

      const onInitialClose = () => {
        nextClient.removeListener("connect", onConnect).removeListener("error", onInitialError);
        reject(new Error("MQTT connection closed before ready"));
      };

      nextClient.once("connect", onConnect);
      nextClient.once("error", onInitialError);
      nextClient.once("close", onInitialClose);
      nextClient.on("reconnect", () => {
        api.logger.info("mqtt: reconnecting to broker");
      });
      nextClient.on("error", (err) => {
        api.logger.warn(`mqtt: client error: ${String(err.message || err)}`);
      });
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  return {
    start: async () => {
      if (config.enabled === false) {
        api.logger.info("mqtt: plugin disabled via plugins.entries.mqtt.config.enabled=false");
        return;
      }
      if (!brokerUrl) {
        api.logger.info("mqtt: brokerUrl is not configured; runtime service will stay idle");
        return;
      }
      await ensureStarted();
    },
    stop: async () => {
      const current = client;
      client = null;
      started = false;
      if (!current) {
        return;
      }
      await new Promise<void>((resolve) => {
        current.end(false, {}, () => resolve());
      });
      api.logger.info("mqtt: disconnected from broker");
    },
    publish: async (params: MqttPublishParams) => {
      await ensureStarted();
      if (!client) {
        throw new Error("MQTT client is not connected");
      }
      const topic = params.topic.trim();
      if (!topic) {
        throw new Error("topic is required");
      }
      const qos = normalizeQos(params.qos ?? defaultQos);
      const payload = params.payload ?? "";
      const retain = params.retain === true;
      await new Promise<void>((resolve, reject) => {
        client!.publish(topic, payload, { qos, retain }, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      return {
        topic,
        qos,
        retain,
        bytes: Buffer.byteLength(payload, "utf8"),
      };
    },
    getMessages: async (params: { topic?: string; limit?: number }) => {
      await ensureStarted();
      const limit = normalizeLimit(params.limit, DEFAULT_MESSAGE_LIST_LIMIT, maxBufferedMessages);
      const topic = params.topic?.trim();
      if (!topic) {
        return messages.slice(-limit).reverse();
      }
      return messages.filter((item) => item.topic === topic).slice(-limit).reverse();
    },
    listTopics: async (params?: { limit?: number }) => {
      await ensureStarted();
      const limit = normalizeLimit(params?.limit, DEFAULT_TOPIC_LIST_LIMIT, MAX_BUFFERED_MESSAGES);
      return [...latestByTopic.values()]
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
        .slice(0, limit);
    },
  };
}
