import { Injectable } from "@nestjs/common";
import type { Kysely } from "kysely";
import { systemClock } from "@lib/kernel";
import { type Executor, TransactionalOutbox } from "@lib/messaging";
import type {
  JobRunRepository,
  SchedulerStore,
  SchedulerStores,
} from "../application/ports.js";

interface OpsDatabase {
  job_runs: { job: string; period_start: Date; dispatched_at?: Date };
}

class KyselyJobRuns implements JobRunRepository {
  constructor(private readonly db: Kysely<OpsDatabase>) {}

  async claim(job: string, periodStart: Date): Promise<boolean> {
    const row = await this.db
      .insertInto("job_runs")
      .values({ job, period_start: periodStart })
      .onConflict((oc) => oc.columns(["job", "period_start"]).doNothing())
      .returning("job")
      .executeTakeFirst();
    return row !== undefined;
  }

  async purge(before: Date): Promise<number> {
    const result = await this.db
      .deleteFrom("job_runs")
      .where("period_start", "<", before)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

/** ops.job_runs and ops.outbox in the transaction of the event being handled. */
@Injectable()
export class KyselySchedulerStores implements SchedulerStores {
  bind(
    tx: Executor,
    cause: { id: string; correlationId: string },
  ): SchedulerStore {
    const outbox = new TransactionalOutbox(tx, {
      schema: "ops",
      context: { correlationId: cause.correlationId, causationId: cause.id },
      clock: systemClock,
    });
    return {
      runs: new KyselyJobRuns(
        (tx as unknown as Kysely<OpsDatabase>).withSchema("ops"),
      ),
      publish: async (event) => {
        await outbox.publish(event);
      },
    };
  }
}
