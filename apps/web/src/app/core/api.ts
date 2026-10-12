import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AgentView,
  Me,
  PublicUser,
  SiteConfig,
  TournamentDetail,
  TournamentEventView,
  TournamentSummary,
} from './types';

/** Error with the server's message (Nest puts it into `message`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    try {
      return await firstValueFrom(
        this.http.request<T>(method, `/api${url}`, {
          body,
          headers: method === 'GET' ? {} : { 'x-tourney': '1' },
          withCredentials: true,
        }),
      );
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const msg = e.error?.message;
        throw new ApiError(
          Array.isArray(msg) ? msg.join(', ') : (msg ?? e.statusText ?? 'request failed'),
          e.status,
        );
      }
      throw e;
    }
  }

  config = () => this.call<SiteConfig>('GET', '/config');
  me = () => this.call<Me>('GET', '/me');
  devLogin = (name: string, admin: boolean) =>
    this.call<Me>('POST', '/auth/dev-login', { name, admin });
  logout = () => this.call<void>('POST', '/auth/logout');
  updateMe = (displayName: string) => this.call<Me>('PATCH', '/me', { displayName });
  rotateToken = () => this.call<Me>('POST', '/me/token');

  users = () => this.call<PublicUser[]>('GET', '/users');
  setAdmin = (id: string, isAdmin: boolean) =>
    this.call<PublicUser>('PATCH', `/users/${id}`, { isAdmin });

  tournaments = () => this.call<TournamentSummary[]>('GET', '/tournaments');
  tournament = (id: string) => this.call<TournamentDetail>('GET', `/tournaments/${id}`);
  createTournament = (body: unknown) => this.call<TournamentDetail>('POST', '/tournaments', body);
  updateTournament = (id: string, body: unknown) =>
    this.call<TournamentDetail>('PATCH', `/tournaments/${id}`, body);
  deleteTournament = (id: string) => this.call<void>('DELETE', `/tournaments/${id}`);
  events = (id: string) => this.call<TournamentEventView[]>('GET', `/tournaments/${id}/events`);
  register = (id: string) => this.call<void>('POST', `/tournaments/${id}/registration`);
  unregister = (id: string) => this.call<void>('DELETE', `/tournaments/${id}/registration`);
  kick = (id: string, userId: string) =>
    this.call<void>('DELETE', `/tournaments/${id}/registrations/${userId}`);
  watch = (id: string) => this.call<void>('POST', `/tournaments/${id}/watch`);
  unwatch = (id: string) => this.call<void>('DELETE', `/tournaments/${id}/watch`);
  seed = (id: string, body: unknown) =>
    this.call<TournamentDetail>('POST', `/tournaments/${id}/seed`, body);
  reset = (id: string) => this.call<TournamentDetail>('POST', `/tournaments/${id}/reset`);
  run = (id: string) => this.call<void>('POST', `/tournaments/${id}/run`);
  command = (id: string, body: unknown) =>
    this.call<void>('POST', `/tournaments/${id}/command`, body);

  agents = () => this.call<AgentView[]>('GET', '/agents');
  createAgent = (id: string, name: string) =>
    this.call<{ agent: AgentView; token: string }>('POST', '/agents', { id, name });
  rotateAgentToken = (id: string) => this.call<{ token: string }>('POST', `/agents/${id}/token`);
  deleteAgent = (id: string) => this.call<void>('DELETE', `/agents/${id}`);
  rescan = (id: string, profileId: string) =>
    this.call<void>('POST', `/agents/${id}/profiles/${profileId}/rescan`);
}
