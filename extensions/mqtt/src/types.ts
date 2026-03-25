export type MqttPluginConfig = {
  enabled?: boolean;
  brokerUrl?: string;
  username?: string;
  password?: string;
  clientId?: string;
  subscribeTopics?: string[];
  qos?: number;
  maxBufferedMessages?: number;
};

export type MqttMessage = {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  receivedAt: string;
};

export type MqttTopicSnapshot = {
  topic: string;
  messageCount: number;
  lastMessageAt: string;
  lastPayload: string;
};

export type MqttPublishParams = {
  topic: string;
  payload: string;
  qos?: number;
  retain?: boolean;
};

export type MqttRuntime = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  publish: (params: MqttPublishParams) => Promise<{
    topic: string;
    qos: number;
    retain: boolean;
    bytes: number;
  }>;
  getMessages: (params: { topic?: string; limit?: number }) => Promise<MqttMessage[]>;
  listTopics: (params?: { limit?: number }) => Promise<MqttTopicSnapshot[]>;
};
