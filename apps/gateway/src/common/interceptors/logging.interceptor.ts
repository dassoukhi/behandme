import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { httpStatusOf } from "@lib/platform";

/**
 * One line per request: the route, the status and how long it took. Never the client's address or its
 * user agent: the privacy policy says the server records neither (the rate limit reads the address in
 * memory only).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const { method, url } = context.switchToHttp().getRequest();

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();

          this.logger.log(
            `${method} ${url} ${response.statusCode} ${Date.now() - now}ms`,
          );
        },
        // The status the client gets (a business refusal is a 4xx, not a 500); its stack, for an
        // unexpected error, is logged once, by GlobalExceptionFilter.
        error: (err) => {
          const status = httpStatusOf(err);
          const line = `${method} ${url} ${status} ${Date.now() - now}ms`;
          if (status >= 500) this.logger.error(line);
          else this.logger.warn(line);
        },
      }),
    );
  }
}
