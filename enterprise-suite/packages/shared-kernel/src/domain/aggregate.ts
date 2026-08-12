import type { EventEnvelope } from "../events/envelope.js";
import { Entity } from "./entity.js";

export abstract class AggregateRoot<TProps extends object> extends Entity<TProps> {
  private readonly pending: EventEnvelope[] = [];

  protected raise(event: EventEnvelope): void {
    this.pending.push(event);
    this.touch();
  }

  pullEvents(): EventEnvelope[] {
    return this.pending.splice(0, this.pending.length);
  }
}
