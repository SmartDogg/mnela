import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: unknown;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, req.originalUrl);
    if (problem.status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${problem.status} ${problem.title}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const base: ProblemDetails = {
        type: 'about:blank',
        title: this.statusTitle(status),
        status,
        instance,
      };
      if (typeof body === 'string') {
        return { ...base, detail: body };
      }
      if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        const message = obj['message'];
        const detail = Array.isArray(message)
          ? message.join('; ')
          : typeof message === 'string'
            ? message
            : undefined;
        const errors = obj['errors'];
        return {
          ...base,
          ...(typeof obj['title'] === 'string' ? { title: obj['title'] as string } : {}),
          ...(detail ? { detail } : {}),
          ...(errors ? { errors } : {}),
        };
      }
      return base;
    }

    if (exception instanceof ZodError) {
      return {
        type: 'about:blank',
        title: 'Validation Failed',
        status: HttpStatus.BAD_REQUEST,
        detail: 'Request body did not match the expected schema.',
        instance,
        errors: exception.issues,
      };
    }

    return {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
    };
  }

  private statusTitle(status: number): string {
    const map: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      415: 'Unsupported Media Type',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      503: 'Service Unavailable',
    };
    return map[status] ?? 'Error';
  }
}
