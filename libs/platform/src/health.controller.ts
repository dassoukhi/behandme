import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { type Kysely, sql } from "kysely";
import { DATABASE } from "./database.module.js";
import { OpenRoute } from "./internal-auth.guard.js";

/** GET /health for the host's health checks: up when the database answers. */
@OpenRoute()
@ApiExcludeController()
@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Kysely<any>) {}

  @Get()
  async check(): Promise<{ status: "ok" }> {
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException("Database unreachable");
    }
    return { status: "ok" };
  }
}
