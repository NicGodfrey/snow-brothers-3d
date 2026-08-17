export class AgiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AgiError";
    this.code = code;
    this.status = status;
  }
}

export class TransportError extends AgiError {
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status = 502,
    retryable = false,
  ) {
    super(code, message, status);
    this.name = "TransportError";
    this.retryable = retryable;
  }
}
