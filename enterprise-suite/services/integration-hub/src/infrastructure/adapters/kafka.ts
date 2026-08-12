/**
 * Kafka-style streaming adapter over an in-memory append-only log.
 *
 * Interesting because it is the one bundled driver with a *cursor*: pulls
 * resume from an offset, which is what the inbox's `cursor` round-trip is
 * for.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, HealthCheckResult } from "../../domain/adapter.js";
import type {
  AdapterDriver,
  AdapterMessage,
  AdapterPullResult,
  AdapterSendResult,
} from "../../application/ports.js";
import { AdapterUnavailableError, healthResult, newSimulation, takeFailure } from "./simulation.js";

export interface LogRecord {
  readonly offset: number;
  readonly topic: string;
  readonly key: string;
  readonly eventType: string;
  readonly value: unknown;
}

export class KafkaAdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation({ latencyMs: 8 });
  readonly log: LogRecord[] = [];

  readonly descriptor: AdapterDescriptor = {
    kind: "kafka",
    displayName: "Kafka topic",
    direction: "bidirectional",
    capabilities: { supportsPush: true, supportsPull: true, supportsBatch: true, maxBatchSize: 10_000 },
    configSchema: [
      { name: "brokers", type: "string", required: true, description: "Comma-separated host:port list" },
      { name: "topic", type: "string", required: true },
      { name: "consumerGroup", type: "string", required: false, default: "integration-hub" },
      { name: "credentialsRef", type: "secret-ref", required: false },
      { name: "maxPollRecords", type: "number", required: false, default: 100, min: 1, max: 10_000 },
      { name: "acksAll", type: "boolean", required: false, default: true },
    ],
  };

  /** Seeds records as if a producer had written them. */
  produce(topic: string, records: readonly { key: string; eventType: string; value: unknown }[]): void {
    for (const record of records) {
      this.log.push({ offset: this.log.length, topic, ...record });
    }
  }

  async test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(
      this.simulation,
      now,
      `topic ${String(config["topic"])} available on ${String(config["brokers"])}`,
    );
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("kafka", failure);

    const topic = String(config["topic"]);
    for (const message of messages) {
      this.log.push({
        offset: this.log.length,
        topic,
        key: message.key,
        eventType: message.eventType,
        value: message.payload,
      });
    }
    return {
      accepted: messages.length,
      rejected: [],
      reference: `${topic}@${this.log.length - 1}`,
      latencyMs: this.simulation.latencyMs,
    };
  }

  async pull(config: Readonly<Record<string, unknown>>, cursor?: string): Promise<AdapterPullResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("kafka", failure);

    const topic = String(config["topic"]);
    const limit = Number(config["maxPollRecords"] ?? 100);
    const from = cursor ? Number(cursor) : 0;
    const records = this.log
      .filter((record) => record.topic === topic && record.offset >= from)
      .slice(0, limit);

    const messages: AdapterMessage[] = records.map((record) => ({
      key: `${topic}-${record.offset}`,
      eventType: record.eventType,
      payload: record.value,
      headers: { "x-kafka-offset": String(record.offset), "x-kafka-topic": topic },
    }));
    const nextOffset = records.length > 0 ? records[records.length - 1]!.offset + 1 : from;
    return { messages, cursor: String(nextOffset), latencyMs: this.simulation.latencyMs };
  }
}
