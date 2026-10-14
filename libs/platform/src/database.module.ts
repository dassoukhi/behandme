import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Kysely } from "kysely";
import { createDatabase } from "@lib/persistence";

/** Injection token of the service's Kysely instance. */
export const DATABASE = Symbol("Database");

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<any>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}

/**
 * The service's connection pool, from DATABASE_URL (with the service's own Postgres role,
 * svc_<service>). Provides DATABASE to the whole app and closes the pool on shutdown (call
 * `app.enableShutdownHooks()`). Needs a global ConfigModule. Connects on first query only.
 */
@Module({})
export class DatabaseModule {
  static forRoot(options: { applicationName: string }): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATABASE,
          useFactory: (config: ConfigService) =>
            createDatabase<any>({
              connectionString: config.getOrThrow<string>("DATABASE_URL"),
              applicationName: options.applicationName,
            }),
          inject: [ConfigService],
        },
        DatabaseShutdown,
      ],
      exports: [DATABASE],
    };
  }
}
