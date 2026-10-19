import type { Routes } from '@angular/router';
import { adminOnly, loggedIn } from './core/auth';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.LoginPage) },
  {
    path: '',
    canActivate: [loggedIn],
    children: [
      {
        path: '',
        title: 'nav.tournaments',
        loadComponent: () => import('./pages/tournament-list').then((m) => m.TournamentListPage),
      },
      {
        path: 'stats',
        title: 'nav.stats',
        loadComponent: () => import('./pages/stats').then((m) => m.StatsPage),
      },
      {
        path: 'stats/p/:key',
        loadComponent: () => import('./pages/stats-player').then((m) => m.StatsPlayerPage),
      },
      {
        path: 'shop',
        title: 'shop.title',
        loadComponent: () => import('./pages/shop').then((m) => m.ShopPage),
      },
      {
        path: 'udt',
        title: 'udt.title',
        loadComponent: () => import('./pages/udt-team').then((m) => m.UdtTeamPage),
      },
      {
        path: 'udt/market',
        title: 'udt.nav.market',
        loadComponent: () => import('./pages/udt-market').then((m) => m.UdtMarketPage),
      },
      {
        path: 'udt/packs',
        title: 'udt.nav.packs',
        loadComponent: () => import('./pages/udt-packs').then((m) => m.UdtPacksPage),
      },
      {
        path: 'udt/trades',
        title: 'udt.nav.trades',
        loadComponent: () => import('./pages/udt-trades').then((m) => m.UdtTradesPage),
      },
      {
        path: 'udt/events',
        title: 'udt.nav.events',
        loadComponent: () => import('./pages/udt-events').then((m) => m.UdtEventsPage),
      },
      {
        path: 'udt/table',
        title: 'udt.nav.table',
        loadComponent: () => import('./pages/udt-events').then((m) => m.UdtTablePage),
      },
      {
        path: 'bots/:id',
        loadComponent: () => import('./pages/bot-profile').then((m) => m.BotProfilePage),
      },
      {
        path: 'profile',
        title: 'profile.title',
        loadComponent: () => import('./pages/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'new',
        title: 'nav.new',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/tournament-form').then((m) => m.TournamentFormPage),
      },
      {
        path: 't/:id',
        loadComponent: () => import('./pages/tournament-page').then((m) => m.TournamentPage),
      },
      {
        path: 't/:id/m/:matchId',
        loadComponent: () => import('./pages/match-page').then((m) => m.MatchPage),
      },
      {
        path: 't/:id/edit',
        title: 'form.editTitle',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/tournament-form').then((m) => m.TournamentFormPage),
      },
      {
        path: 'admin/agents',
        title: 'nav.agents',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/agents').then((m) => m.AgentsPage),
      },
      {
        path: 'admin/bots',
        title: 'nav.bots',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/bots').then((m) => m.BotsPage),
      },
      {
        path: 'admin/settings',
        title: 'nav.settings',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage),
      },
      {
        path: 'series/:sid/edit',
        title: 'series.edit',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/tournament-form').then((m) => m.TournamentFormPage),
      },
      {
        path: 'admin/series',
        title: 'series.title',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/series').then((m) => m.SeriesPage),
      },
      {
        path: 'admin/users',
        title: 'nav.users',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/users').then((m) => m.UsersPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
