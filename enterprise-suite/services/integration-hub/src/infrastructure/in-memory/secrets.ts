import { generateSecret } from "../../domain/signature.js";
import type { SecretGenerator } from "../../application/ports.js";

export class RandomSecretGenerator implements SecretGenerator {
  constructor(private readonly bytes = 32) {}

  generate(): string {
    return generateSecret(this.bytes);
  }
}

/** Predictable secrets so signature assertions in tests are stable. */
export class SequentialSecretGenerator implements SecretGenerator {
  private counter = 0;

  constructor(private readonly prefix = "whsec_test") {}

  generate(): string {
    this.counter += 1;
    return `${this.prefix}_${String(this.counter).padStart(4, "0")}_0123456789abcdef`;
  }
}
