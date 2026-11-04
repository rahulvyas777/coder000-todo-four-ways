import { test, expect, gotoList, lastInt, rowIdsInOrder, isoDate, today, Api, TaskItem } from '../fixtures';
import type { Page } from '@playwright/test';

// A small list with one open and one completed task in each date bucket. The spec leaves open
// whether Today and Upcoming include completed tasks, so those two views accept either; All
// (open only), Overdue (open only) and Completed are exact.
async function bucketList(api: Api) {
  const { list, tasks } = await api.makeList('Filter test', [
    { title: 'A overdue open: call the plumber', dueDate: isoDate(-2) },
    { title: 'B overdue done: pay the water bill', dueDate: isoDate(-1) },
    { title: 'C today open: email Maria Garcia', dueDate: isoDate(0) },
    { title: 'D today done: water the plants', dueDate: isoDate(0) },
    { title: 'E upcoming open: book the hall', dueDate: isoDate(3) },
    { title: 'F upcoming done: buy the tickets', dueDate: isoDate(5) },
    { title: 'G no date open: read the manual' },
    { title: 'H no date done: sort the photos' },
  ]);
  const [a, b, c, d, e, f, g, h] = tasks;
  for (const t of [b, d, f, h]) await api.complete(t.id);
  return { list, a, b, c, d, e, f, g, h };
}

const ids = (ts: TaskItem[]) => ts.map((t) => t.id).sort((x, y) => x - y);

async function shown(page: Page): Promise<number[]> {
  return (await rowIdsInOrder(page)).sort((x, y) => x - y);
}

async function buttonCount(page: Page, view: string): Promise<number | null> {
  return lastInt((await page.getByTestId(`filter-${view}`).textContent()) ?? '');
}

test.describe('Step 04: Filters', { tag: '@step04' }, () => {
  test('All is the default and shows open tasks only', async ({ page, api }) => {
    const s = await bucketList(api);
    await gotoList(page, s.list.id);
    await expect.poll(() => shown(page)).toEqual(ids([s.a, s.c, s.e, s.g]));
    await expect.poll(() => buttonCount(page, 'all')).toBe(4);
  });

  test('each filter button sets ?view= and shows its set, with a matching count', async ({ page, api }) => {
    const s = await bucketList(api);
    await gotoList(page, s.list.id);

    await page.getByTestId('filter-overdue').click();
    await expect(page).toHaveURL(/[?&]view=overdue/);
    await expect.poll(() => shown(page)).toEqual(ids([s.a]));
    await expect.poll(() => buttonCount(page, 'overdue')).toBe(1);

    await page.getByTestId('filter-completed').click();
    await expect(page).toHaveURL(/[?&]view=completed/);
    await expect.poll(() => shown(page)).toEqual(ids([s.b, s.d, s.f, s.h]));
    await expect.poll(() => buttonCount(page, 'completed')).toBe(4);

    await page.getByTestId('filter-today').click();
    await expect(page).toHaveURL(/[?&]view=today/);
    await expect.poll(async () => {
      const v = await shown(page);
      return JSON.stringify(v) === JSON.stringify(ids([s.c])) || JSON.stringify(v) === JSON.stringify(ids([s.c, s.d]));
    }, { message: 'Today shows C (and optionally the completed D)' }).toBe(true);
    expect(await buttonCount(page, 'today')).toBe((await shown(page)).length);

    await page.getByTestId('filter-upcoming').click();
    await expect(page).toHaveURL(/[?&]view=upcoming/);
    await expect.poll(async () => {
      const v = await shown(page);
      return JSON.stringify(v) === JSON.stringify(ids([s.e])) || JSON.stringify(v) === JSON.stringify(ids([s.e, s.f]));
    }, { message: 'Upcoming shows E (and optionally the completed F)' }).toBe(true);
    expect(await buttonCount(page, 'upcoming')).toBe((await shown(page)).length);

    await page.getByTestId('filter-all').click();
    await expect(page).toHaveURL(/[?&]view=all|\/lists\/\d+$/);
    await expect.poll(() => shown(page)).toEqual(ids([s.a, s.c, s.e, s.g]));
  });

  test('?view= in the URL selects the filter on load', async ({ page, api }) => {
    const s = await bucketList(api);
    await gotoList(page, s.list.id, '?view=completed');
    await expect.poll(() => shown(page)).toEqual(ids([s.b, s.d, s.f, s.h]));
    await page.reload();
    await expect.poll(() => shown(page)).toEqual(ids([s.b, s.d, s.f, s.h]));
  });

  test('the empty state says "Nothing here"', async ({ page, api }) => {
    const { list } = await api.makeList('Nothing due', [{ title: 'Someday: learn the cello' }]);
    await gotoList(page, list.id, '?view=overdue');
    await expect(page.getByText('Nothing here')).toBeVisible();
    await expect.poll(() => shown(page)).toEqual([]);
  });

  test('overdue count on a seed list matches the API and the real date', async ({ page, api }) => {
    const t = today();
    const expected = (await api.tasks(1)).filter((x) => !x.completed && x.dueDate !== null && x.dueDate < t).length;
    expect(expected).toBeGreaterThan(0);
    await gotoList(page, 1);
    await expect.poll(() => buttonCount(page, 'overdue')).toBe(expected);
    const completed = (await api.tasks(1)).filter((x) => x.completed).length;
    await expect.poll(() => buttonCount(page, 'completed')).toBe(completed);
  });
});
