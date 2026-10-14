import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import { currentCorrelationId } from "@lib/kernel";

/**
 * Nest logger of every service: JSON lines in production (one object per line, for the host's log
 * search), readable text in development. Each line carries the service name and, inside a request
 * or an event, its correlation id.
 */
export class ServiceLogger extends ConsoleLogger {
  constructor(private readonly service: string) {
    super({ json: process.env.NODE_ENV === "production" });
  }

  protected getJsonLogObject(
    message: unknown,
    options: Parameters<ConsoleLogger["getJsonLogObject"]>[1],
  ) {
    const correlationId = currentCorrelationId();
    return {
      ...super.getJsonLogObject(message, options),
      service: this.service,
      ...(correlationId && { correlationId }),
    };
  }

  protected formatContext(context: string): string {
    const correlationId = currentCorrelationId();
    return super.formatContext(
      correlationId ? `${context}] [${correlationId.slice(0, 8)}` : context,
    );
  }
}

export type { LogLevel };
