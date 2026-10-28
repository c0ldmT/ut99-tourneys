import 'reflect-metadata';
import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AgentsController } from './agents/agents.controller.js';
import { AgentsService } from './agents/agents.service.js';
import { AgentConnections } from './agents/connections.js';
import { AgentGateway } from './agents/gateway.js';
import { AuthController } from './auth/auth.controller.js';
import { discordApi, DISCORD, type DiscordApi } from './auth/discord.js';
import { AuthGuard } from './auth/guard.js';
import { SessionsService } from './auth/sessions.service.js';
import { UsersService } from './auth/users.service.js';
import { ApiExceptionFilter } from './common/errors.js';
import { consoleLogger, LOGGER, type ApiLogger } from './common/logger.js';
import { CLOCK, CONFIG, ShiftClock, systemClock, type ApiClock, type ApiConfig } from './config.js';
import { DB, openDatabase, type Db } from './db/database.js';
import { EventLogService } from './tournaments/event-log.service.js';
import { LiveHub } from './tournaments/hub.js';
import { LiveRecorder } from './tournaments/live-recorder.js';
import { TournamentsController } from './tournaments/tournaments.controller.js';
import { TournamentsService } from './tournaments/tournaments.service.js';
import { TeamsService } from './tournaments/teams.service.js';
import { DISCORD_OUT, discordOut, type DiscordOut } from './notify/discord-out.js';
import { NotificationsService } from './notify/notifications.service.js';
import { StatsController } from './stats/stats.controller.js';
import { StatsService } from './stats/stats.service.js';
import { BetsController } from './bets/bets.controller.js';
import { BetsService } from './bets/bets.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { SeasonsController } from './seasons/seasons.controller.js';
import { SeasonsService } from './seasons/seasons.service.js';
import { BotsController } from './bots/bots.controller.js';
import { LooksController } from './bots/looks.controller.js';
import { LookPreviewService } from './bots/look-preview.service.js';
import { BotsService } from './bots/bots.service.js';
import { SeriesController, SeriesOverviewController } from './series/series.controller.js';
import { ShopController } from './shop/shop.controller.js';
import { LedgerService } from './ledger/ledger.service.js';
import { NeuroHub } from './ledger/neuro-hub.js';
import { ServerActivity } from './common/activity.js';
import { NeuroController } from './ledger/neuro.controller.js';
import { UdtController } from './udt/udt.controller.js';
import { UdtTestController } from './udt/udt-test.controller.js';
import { UdtTestService } from './udt/udt-test.service.js';
import { UdtRewardsService } from './udt/udt-rewards.service.js';
import { UdtPacksService } from './udt/udt-packs.service.js';
import { UdtTradesService } from './udt/udt-trades.service.js';
import { UdtAcademyService } from './udt/udt-academy.service.js';
import { UdtCareerService } from './udt/udt-career.service.js';
import { UdtKeepersService } from './udt/udt-keepers.service.js';
import { UdtLeagueService } from './udt/udt-league.service.js';
import { UdtAiService } from './udt/udt-ai.service.js';
import { UdtEventsService } from './udt/udt-events.service.js';
import { UdtMarketService } from './udt/udt-market.service.js';
import { UdtService } from './udt/udt.service.js';
import { ShopService } from './shop/shop.service.js';
import { SeriesService } from './series/series.service.js';
import { AutoStartService } from './tournaments/auto-start.service.js';
import { ServerCalendar } from './tournaments/server-calendar.js';

export interface AppOverrides {
  clock?: ApiClock;
  logger?: ApiLogger;
  discord?: DiscordApi | null;
  db?: Db;
  /** Outgoing Discord notifications (tests record them). */
  discordOut?: DiscordOut;
}

@Module({})
class AppModule {
  static forRoot(config: ApiConfig, o: AppOverrides): DynamicModule {
    const discord =
      o.discord !== undefined
        ? o.discord
        : config.discord.enabled
          ? discordApi({
              clientId: config.discord.clientId,
              clientSecret: config.discord.clientSecret,
              redirectUri: `${config.publicUrl}/api/auth/discord/callback`,
              withGuilds: Boolean(config.discord.guildId),
            })
          : null;
    return {
      module: AppModule,
      controllers: [
        AuthController,
        TournamentsController,
        AgentsController,
        StatsController,
        SettingsController,
        SeasonsController,
        BotsController,
        LooksController,
        BetsController,
        SeriesOverviewController,
        SeriesController,
        ShopController,
        UdtController,
        UdtTestController,
        NeuroController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        {
          provide: CLOCK,
          useValue: o.clock ?? (config.testMode ? new ShiftClock() : systemClock),
        },
        { provide: LOGGER, useValue: o.logger ?? consoleLogger(config.logLevel) },
        { provide: DB, useValue: o.db ?? openDatabase(config.dbFile) },
        { provide: DISCORD, useValue: discord },
        {
          provide: DISCORD_OUT,
          useFactory: (log: ApiLogger) =>
            o.discordOut ?? discordOut({ botToken: config.notify.botToken, log }),
          inject: [LOGGER],
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: APP_FILTER,
          useFactory: (host: HttpAdapterHost) => new ApiExceptionFilter(host.httpAdapter),
          inject: [HttpAdapterHost],
        },
        UsersService,
        SessionsService,
        LiveHub,
        LiveRecorder,
        NeuroHub,
        ServerActivity,
        EventLogService,
        AgentConnections,
        AgentsService,
        TeamsService,
        NotificationsService,
        TournamentsService,
        ServerCalendar,
        StatsService,
        SettingsService,
        SeasonsService,
        BotsService,
        LookPreviewService,
        BetsService,
        SeriesService,
        AutoStartService,
        ShopService,
        LedgerService,
        UdtService,
        UdtMarketService,
        UdtEventsService,
        UdtRewardsService,
        UdtPacksService,
        UdtTradesService,
        UdtAcademyService,
        UdtCareerService,
        UdtKeepersService,
        UdtLeagueService,
        UdtAiService,
        UdtTestService,
        AgentGateway,
      ],
    };
  }
}

export interface RunningApi {
  app: INestApplication;
  url: string;
  close(): Promise<void>;
}

export async function createApi(
  config: ApiConfig,
  overrides: AppOverrides = {},
): Promise<RunningApi> {
  const log = overrides.logger ?? consoleLogger(config.logLevel);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config, { ...overrides, logger: log }),
    { logger: ['error', 'warn'], bodyParser: true },
  );
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  trackRequests(app);
  serveWebApp(app, config, log);
  await app.listen(config.port, config.host);
  const server = app.getHttpServer() as Server;
  const gateway = app.get(AgentGateway);
  gateway.attach(server);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const host = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  return {
    app,
    url: `http://${host}:${port}`,
    async close() {
      gateway.close();
      // Open browser tabs keep their event stream (and keep-alive sockets) open forever, and
      // server.close() waits for every connection: cut them, then wait for Nest to finish.
      const closing = app.close();
      server.closeAllConnections();
      await closing;
      app.get<Db>(DB).$client.close();
    },
  };
}

/**
 * Notes every API request (method, path, time) for the log line of a long event loop block
 * (decision 229); event streams stay open for hours and are left out.
 */
function trackRequests(app: NestExpressApplication) {
  const activity = app.get(ServerActivity);
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith('/api/') || req.path.endsWith('/stream')) return next();
    res.once('close', activity.track(`${req.method} ${req.path}`));
    next();
  });
}

/** Serves the built Angular app; unknown non-API paths get index.html (client-side routing). */
function serveWebApp(app: NestExpressApplication, config: ApiConfig, log: ApiLogger) {
  if (!config.webDist) return;
  const dir = path.resolve(config.webDist);
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) {
    log.warn(`WEB_DIST ${dir} has no index.html; serving the API only`);
    return;
  }
  app.use(express.static(dir, { index: false, maxAge: '1h' }));
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/api') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
