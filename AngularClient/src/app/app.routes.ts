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
  // One parent route, so opening and closing the panel keeps the list view (and its tasks).
  {
    path: 'lists/:listId',
    component: ListView,
    children: [
      { path: '', children: [] },
      { path: 'tasks/:taskId', children: [] },
    ],
  },
  { path: '**', redirectTo: '' },
];
