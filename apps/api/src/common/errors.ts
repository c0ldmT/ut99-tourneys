import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { conflict } from './http.js';
import { AgentOfflineError, CommandFailedError } from '../agents/connections.js';

/** Agent problems become HTTP 409 with the reason, everything else is handled by Nest. */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof AgentOfflineError || exception instanceof CommandFailedError) {
      return super.catch(
        exception.key ? conflict(exception.key, exception.params) : conflict(exception.message),
        host,
      );
    }
    return super.catch(exception, host);
  }
}
