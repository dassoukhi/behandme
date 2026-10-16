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

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, ip } = req;
    const userAgent = req.get("user-agent") || "";

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();

          this.logger.log(
            `${method} ${url} ${response.statusCode} ${Date.now() - now}ms - ${ip} - ${userAgent}`,
          );
        },
        // The status the client gets (a business refusal is a 4xx, not a 500); its stack, for an
        // unexpected error, is logged once, by GlobalExceptionFilter.
        error: (err) => {
          const status = httpStatusOf(err);
          const line = `${method} ${url} ${status} ${Date.now() - now}ms - ${ip} - ${userAgent}`;
          if (status >= 500) this.logger.error(line);
          else this.logger.warn(line);
        },
      }),
    );
  }
}
