import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

/**
 * Error bodies carry the English text (`message`), its template (`key`, the English text with
 * `{name}` placeholders) and the values (`params`): the website translates the template.
 */
export type ErrorParams = Record<string, string | number>;

export function fillTemplate(key: string, params?: ErrorParams): string {
  return key.replace(/\{(\w+)\}/g, (m, k: string) =>
    params && params[k] !== undefined ? String(params[k]) : m,
  );
}

function errorBody(status: number, error: string, key: string, params?: ErrorParams) {
  return {
    statusCode: status,
    error,
    message: fillTemplate(key, params),
    key,
    ...(params ? { params } : {}),
  };
}

/** Invalid input: the first problem (its own message if the schema has one) and its field. */
export function invalidInput(error: z.ZodError): BadRequestException {
  const issue = error.issues[0];
  const field = issue?.path.map(String).join('.') ?? '';
  return new BadRequestException({
    ...errorBody(400, 'Bad Request', 'invalid input', field ? { field } : undefined),
    message: z.prettifyError(error),
    ...(issue?.code === 'custom' || issue?.code === 'invalid_format'
      ? { key: issue.message, params: field ? { field } : {} }
      : {}),
  });
}

/** Validates a request body/query with a zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw invalidInput(parsed.error);
    return parsed.data;
  }
}

/**
 * For partial updates: like ZodPipe, but keeps only the fields the request sent. Zod fills in
 * the defaults of a `.partial()` schema, which would reset the fields that were left out.
 */
export class PatchPipe<T extends object> implements PipeTransform<unknown, Partial<T>> {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(value: unknown): Partial<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw invalidInput(parsed.error);
    const sent = value && typeof value === 'object' ? Object.keys(value) : [];
    return Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => sent.includes(k)),
    ) as Partial<T>;
  }
}

/** `what` is a fixed text, e.g. `notFound('bot {id}', { id })` ("bot {id} not found"). */
export const notFound = (what: string, params?: ErrorParams) =>
  new NotFoundException(errorBody(404, 'Not Found', `${what} not found`, params));
export const conflict = (key: string, params?: ErrorParams) =>
  new ConflictException(errorBody(409, 'Conflict', key, params));
export const badRequest = (key: string, params?: ErrorParams) =>
  new BadRequestException(errorBody(400, 'Bad Request', key, params));
export const unauthorized = () =>
  new UnauthorizedException(errorBody(401, 'Unauthorized', 'login required'));
export const forbidden = (key = 'forbidden', params?: ErrorParams) =>
  new ForbiddenException(errorBody(403, 'Forbidden', key, params));

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function cookie(
  name: string,
  value: string,
  opts: { maxAgeSec?: number; secure: boolean; httpOnly?: boolean; path?: string },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    'SameSite=Lax',
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${opts.maxAgeSec}`);
  return parts.join('; ');
}
