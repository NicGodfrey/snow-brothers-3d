import type { MessageSenderPort, OutboundMessage } from "../application/ports.js";
import type { DeliveryOutcome } from "../domain/send-job.js";

/**
 * Engagement funnel probabilities per channel. Opens only exist for email;
 * SMS "clicks" model tapping a link in the message.
 */
interface ChannelRates {
  readonly deliver: number;
  readonly open: number; // of delivered
  readonly click: number; // of opened (email) / of delivered (sms)
  readonly unsubscribe: number; // of delivered
}

const DEFAULT_RATES: Record<"email" | "sms", ChannelRates> = {
  email: { deliver: 0.96, open: 0.42, click: 0.3, unsubscribe: 0.015 },
  sms: { deliver: 0.985, open: 0, click: 0.11, unsubscribe: 0.008 },
};

/** FNV-1a 32-bit — cheap, stable string hash for seeding. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — deterministic sequence from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic delivery simulation: the outcome for a (job, recipient) pair
 * is a pure function of the seed, so tests and demos are reproducible while
 * still exhibiting realistic funnel behavior (bounces, opens, clicks,
 * unsubscribes) at aggregate level.
 */
export class SimulatedMessageSender implements MessageSenderPort {
  constructor(
    private readonly seedSalt = "marketing-erp",
    private readonly rates: Record<"email" | "sms", ChannelRates> = DEFAULT_RATES,
  ) {}

  send(message: OutboundMessage): DeliveryOutcome {
    const rand = mulberry32(fnv1a(`${this.seedSalt}:${message.jobId}:${message.to}`));
    const rates = this.rates[message.channel];

    if (rand() >= rates.deliver) {
      return {
        delivered: false,
        opened: false,
        clicked: false,
        unsubscribed: false,
        failureReason: rand() < 0.5 ? "hard bounce: unknown recipient" : "soft bounce: mailbox full",
      };
    }

    if (message.channel === "email") {
      const opened = rand() < rates.open;
      const clicked = opened && rand() < rates.click;
      const unsubscribed = rand() < rates.unsubscribe;
      return { delivered: true, opened, clicked, unsubscribed };
    }
    // SMS: no open tracking; click means the shortened link was tapped.
    const clicked = rand() < rates.click;
    const unsubscribed = rand() < rates.unsubscribe;
    return { delivered: true, opened: false, clicked, unsubscribed };
  }
}

/** Always-delivers sender with scriptable engagement, for focused tests. */
export class ScriptedMessageSender implements MessageSenderPort {
  private readonly outcomes = new Map<string, DeliveryOutcome>();

  script(to: string, outcome: DeliveryOutcome): void {
    this.outcomes.set(to, outcome);
  }

  send(message: OutboundMessage): DeliveryOutcome {
    return (
      this.outcomes.get(message.to) ?? {
        delivered: true,
        opened: false,
        clicked: false,
        unsubscribed: false,
      }
    );
  }
}
