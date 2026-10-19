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
