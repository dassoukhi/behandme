import { Inject, Injectable } from "@nestjs/common";
import type { Clock } from "@lib/kernel";
import { periodStart } from "../domain/schedule.js";
import { JOBS, type ScheduledJob } from "./jobs.js";
import { CLOCK, type SchedulerStore } from "./ports.js";

@Injectable()
export class SchedulerService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * On each tick, publishes the event of every job whose current period has no run yet. Ticks may
   * repeat or be missed, and several workers may run: the run record makes each job fire once per
   * period, and a job missed while the worker was down fires at the next tick.
   */
  async onTick(
    store: SchedulerStore,
    jobs: ScheduledJob[] = JOBS,
  ): Promise<string[]> {
    const now = this.clock.now();
    const fired: string[] = [];
    for (const job of jobs) {
      if (await store.runs.claim(job.name, periodStart(now, job.everyMs))) {
        await store.publish(job.event());
        fired.push(job.name);
      }
    }
    return fired;
  }

  /** Forgets runs older than 30 days. */
  purge(store: SchedulerStore): Promise<number> {
    return store.runs.purge(
      new Date(this.clock.now().getTime() - 30 * 86_400_000),
    );
  }
}
