import type { Logger } from "@lib/kernel";

export interface PollingLoopOptions {
  name: string;
  /** Does one batch of work and says how much it did; 0 means idle. */
  run: () => Promise<number>;
  logger: Logger;
  /** Wait after an idle run. */
  idleMs?: number;
  /** Longest wait after consecutive failures (the wait doubles from idleMs). */
  maxBackoffMs?: number;
}

/**
 * Runs a batch job again and again: at once while there is work, after `idleMs` when idle, with a
 * growing wait while it fails (database down…). `stop()` waits for the batch in progress.
 */
export class PollingLoop {
  private running = false;
  private current: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: PollingLoopOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.current = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.current;
  }

  private async loop(): Promise<void> {
    const {
      name,
      run,
      logger,
      idleMs = 1000,
      maxBackoffMs = 30_000,
    } = this.options;
    let failures = 0;
    while (this.running) {
      let wait = 0;
      try {
        const done = await run();
        failures = 0;
        if (done === 0) wait = idleMs;
      } catch (error) {
        failures++;
        wait = Math.min(idleMs * 2 ** failures, maxBackoffMs);
        logger.error(
          `${name} failed (${failures} in a row, next try in ${wait} ms): ${(error as Error).message}`,
        );
      }
      if (wait > 0 && this.running) await this.sleep(wait);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }
}
