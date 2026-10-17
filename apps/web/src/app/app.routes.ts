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
        loadComponent: () => import('./pages/tournament-list').then((m) => m.TournamentListPage),
      },
      {
        path: 'stats',
        loadComponent: () => import('./pages/stats').then((m) => m.StatsPage),
      },
      {
        path: 'stats/p/:key',
        loadComponent: () => import('./pages/stats-player').then((m) => m.StatsPlayerPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./pages/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'new',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/tournament-form').then((m) => m.TournamentFormPage),
      },
      {
        path: 't/:id',
        loadComponent: () => import('./pages/tournament-page').then((m) => m.TournamentPage),
      },
      {
        path: 't/:id/edit',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/tournament-form').then((m) => m.TournamentFormPage),
      },
      {
        path: 'admin/agents',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/agents').then((m) => m.AgentsPage),
      },
      {
        path: 'admin/settings',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage),
      },
      {
        path: 'admin/users',
        canActivate: [adminOnly],
        loadComponent: () => import('./pages/users').then((m) => m.UsersPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
