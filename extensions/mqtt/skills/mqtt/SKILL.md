---
name: mqtt
description: MQTT messaging tools for realtime IoT device communication.
metadata:
  { "openclaw": { "emoji": "📡", "requires": { "config": ["plugins.entries.mqtt.enabled"] } } }
---

# MQTT Tools

Use these tools to communicate with IoT devices through an MQTT broker (for example EMQX).

| Need | Tool | When |
| --- | --- | --- |
| Send a command/event to a device | `mqtt_publish` | Publish control messages, prompts, or command payloads to a device topic |
| Check recent device messages | `mqtt_get_messages` | Read buffered inbound messages, optionally filtered by topic |
| Inspect active topic traffic | `mqtt_list_topics` | See topic-level snapshots and latest payloads |

## mqtt_publish

Use when you need to deliver a message to a target topic.

| Parameter | Description |
| --- | --- |
| `topic` | MQTT topic to publish to |
| `payload` | Text payload |
| `qos` | Optional QoS (`0`, `1`, `2`) |
| `retain` | Optional retain flag |

## mqtt_get_messages

Use this to read what devices have already sent.

| Parameter | Description |
| --- | --- |
| `topic` | Optional exact topic filter |
| `limit` | Number of messages to return (default small batch) |

## mqtt_list_topics

Use this to quickly inspect the most active topics and latest payload snapshots.

| Parameter | Description |
| --- | --- |
| `limit` | Maximum number of topics to return |

## Recommended workflow

1. Use `mqtt_list_topics` to discover live topics.
2. Use `mqtt_get_messages` on the chosen topic to inspect recent device state.
3. Use `mqtt_publish` to send a command or response payload.
4. Use `mqtt_get_messages` again to verify device acknowledgment/state changes.
