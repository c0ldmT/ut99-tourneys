import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

/** Validates a request body/query with a zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}
  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
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
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    const sent = value && typeof value === 'object' ? Object.keys(value) : [];
    return Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => sent.includes(k)),
    ) as Partial<T>;
  }
}

export const notFound = (what: string) => new NotFoundException(`${what} not found`);
export const conflict = (msg: string) => new ConflictException(msg);
export const badRequest = (msg: string) => new BadRequestException(msg);
export const forbidden = (msg = 'forbidden') => new ForbiddenException(msg);

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
