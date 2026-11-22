import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'novo-menu',
    loadComponent: () => import('./novo-menu/novo-menu.page').then((m) => m.NovoMenuPage),
  },
  {
    path: 'menus/:id/marcar',
    loadComponent: () => import('./marcar-pratos/marcar-pratos.page').then((m) => m.MarcarPratosPage),
  },
  {
    path: 'menus/:id',
    loadComponent: () => import('./lista-pratos/lista-pratos.page').then((m) => m.ListaPratosPage),
  },
  { path: '', redirectTo: 'novo-menu', pathMatch: 'full' },
];
