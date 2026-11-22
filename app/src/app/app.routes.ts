import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'novo-menu',
    loadComponent: () => import('./novo-menu/novo-menu.page').then((m) => m.NovoMenuPage),
  },
  { path: '', redirectTo: 'novo-menu', pathMatch: 'full' },
];
