import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ListsStore } from './lists-store';
import { ListView } from './list-view';

/** `/` redirects to the first list. */
const firstList: CanActivateFn = async () => {
  const router = inject(Router);
  const lists = await inject(ListsStore).ensureLoaded();
  return lists.length ? router.createUrlTree(['/lists', lists[0].id]) : true;
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [firstList], children: [] },
  { path: 'lists/:listId', component: ListView },
  { path: 'lists/:listId/tasks/:taskId', component: ListView },
  { path: '**', redirectTo: '' },
];
