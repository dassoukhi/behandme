import type { Executor, NewEvent } from "@lib/messaging";

export interface JobRunRepository {
  /** Records that `job` ran for the period; false if it already had. */
  claim(job: string, periodStart: Date): Promise<boolean>;
  /** Forgets runs of periods that started before `before`; returns how many. */
  purge(before: Date): Promise<number>;
}

/** What a handler may do inside the transaction of the event it handles. */
export interface SchedulerStore {
  runs: JobRunRepository;
  /** Publishes to ops.outbox, caused by the event being handled. */
  publish(event: NewEvent): Promise<void>;
}

export interface SchedulerStores {
  bind(
    tx: Executor,
    cause: { id: string; correlationId: string },
  ): SchedulerStore;
}
export const SCHEDULER_STORES = Symbol("SchedulerStores");

export const CLOCK = Symbol("Clock");
