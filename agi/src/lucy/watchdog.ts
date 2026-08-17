/**
 * Claude Code-style stream idle watchdog.
 *
 * Matches CLAUDE_STREAM_IDLE_TIMEOUT_MS (default 90s). Heartbeats keep the
 * HTTP connection alive but do not count as model data. Only token/thinking
 * /result events reset the timer. The timer starts after the stream opens,
 * never while the client is still uploading a large request body.
 */
export class StreamWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    readonly idleTimeoutMs: number,
    private readonly onStall: () => void,
  ) {}

  start(): void {
    this.touch();
  }

  touch(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      this.stopped = true;
      this.timer = undefined;
      this.onStall();
    }, this.idleTimeoutMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get active(): boolean {
    return !this.stopped;
  }
}
