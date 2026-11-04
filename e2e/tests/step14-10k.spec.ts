import { test, expect, gotoList, parseTaskCount, lastInt, rowIdsInOrder, selectFlexible, blurAll, today, TaskItem } from '../fixtures';
import type { Page } from '@playwright/test';

// Budget for the first rows of "Archive 10k" after the click (dev build, 10,000 tasks from the API).
const FIRST_ROWS_BUDGET_MS = 15000;

const rowsInDom = (page: Page) => page.getByTestId('rows-container').getByTestId(/^task-row-\d+$/).count();

async function archive(api: { tasks(id: number): Promise<TaskItem[]> }) {
  const all = await api.tasks(4);
  expect(all.length).toBe(10000);
  return all;
}

test.describe('Step 14: The 10,000-item list', { tag: '@step14' }, () => {
  test('selecting Archive 10k renders only the visible rows while task-count says 10,000', async ({ page, api }) => {
    const all = await archive(api);
    const firstOpen = all.find((t) => !t.completed)!;
    await gotoList(page, 1);
    const t0 = Date.now();
    await page.getByTestId('list-item-4').getByText('Archive 10k').click();
    await expect(page).toHaveURL(/\/lists\/4(\?|$)/);
    await expect(page.getByTestId(`task-row-${firstOpen.id}`)).toBeVisible({ timeout: FIRST_ROWS_BUDGET_MS });
    console.log(`step14 click to first row: ${Date.now() - t0} ms`);
    await expect.poll(async () => parseTaskCount((await page.getByTestId('task-count').textContent()) ?? '')?.total).toBe(10000);
    await expect.poll(() => rowsInDom(page)).toBeLessThan(200);
    expect(await rowsInDom(page)).toBeGreaterThan(0);
    await expect(page.getByTestId(`task-title-${firstOpen.id}`)).toContainText(firstOpen.title.slice(0, 12));
  });

  test('scrolling rows-container to the end shows Ticket 10000', async ({ page, api }) => {
    const all = await archive(api);
    const last = all.find((t) => t.title.startsWith('Ticket 10000'))!;
    const first = all.find((t) => t.title.startsWith('Ticket 00001'))!;
    expect(last && first).toBeTruthy();
    // Completed tasks are hidden in the default view, so pick the view that contains the task.
    await gotoList(page, 4, last.completed ? '?view=completed' : '');
    const container = page.getByTestId('rows-container');
    await expect.poll(() => rowsInDom(page)).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        await container.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return page.getByTestId(`task-title-${last.id}`).isVisible();
      })
      .toBe(true);
    await expect(page.getByTestId(`task-title-${last.id}`)).toContainText('Ticket 10000');
    expect(await rowsInDom(page)).toBeLessThan(200);

    await gotoList(page, 4, first.completed ? '?view=completed' : '');
    await expect(page.getByTestId(`task-title-${first.id}`)).toContainText('Ticket 00001');
  });

  test('search, filters and sort work on the 10,000 tasks', async ({ page, api }) => {
    const all = await archive(api);
    const open = all.filter((t) => !t.completed);
    await gotoList(page, 4);
    await expect.poll(() => rowsInDom(page)).toBeGreaterThan(0);

    // Search: "ticket 0999" matches Ticket 09990 to 09999; the default view shows the open ones.
    const matches = open.filter((t) => t.title.toLowerCase().includes('ticket 0999')).map((t) => t.id);
    expect(all.filter((t) => t.title.toLowerCase().includes('ticket 0999')).length).toBe(10);
    await page.getByTestId('search-input').fill('ticket 0999');
    await expect.poll(async () => (await rowIdsInOrder(page)).sort((a, b) => a - b)).toEqual(matches.sort((a, b) => a - b));
    await page.getByTestId('search-input').fill('');

    // Filters: counts match the API and the real date.
    const t = today();
    const overdue = open.filter((x) => x.dueDate !== null && x.dueDate < t).length;
    await expect.poll(async () => lastInt((await page.getByTestId('filter-overdue').textContent()) ?? '')).toBe(overdue);
    await expect.poll(async () => lastInt((await page.getByTestId('filter-completed').textContent()) ?? '')).toBe(all.length - open.length);
    await page.getByTestId('filter-completed').click();
    await expect(page).toHaveURL(/[?&]view=completed/);
    const firstDone = all.find((x) => x.completed)!;
    await expect(page.getByTestId(`task-row-${firstDone.id}`)).toBeVisible();
    expect(await rowsInDom(page)).toBeLessThan(200);
    await page.getByTestId('filter-all').click();

    // Sort by title: the first row is the open task with the smallest title.
    const byTitle = open.slice().sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    await selectFlexible(page.getByTestId('sort-select'), 'title');
    await expect.poll(async () => (await rowIdsInOrder(page))[0]).toBe(byTitle[0].id);
    // Sort by due: the first row is an open task with the earliest due date.
    await selectFlexible(page.getByTestId('sort-select'), 'due');
    const minDue = open.filter((x) => x.dueDate).map((x) => x.dueDate!).sort()[0];
    await expect
      .poll(async () => {
        const firstId = (await rowIdsInOrder(page))[0];
        return all.find((x) => x.id === firstId)?.dueDate;
      })
      .toBe(minDue);
    expect(await rowsInDom(page)).toBeLessThan(200);
  });

  test('toggle, the panel and select-all work on the 10,000 tasks', async ({ page, api }) => {
    const all = await archive(api);
    const open = all.filter((t) => !t.completed);
    const target = open[0];
    await gotoList(page, 4);
    await expect(page.getByTestId(`task-row-${target.id}`)).toBeVisible({ timeout: FIRST_ROWS_BUDGET_MS });

    await page.getByTestId(`task-check-${target.id}`).click();
    await expect.poll(async () => (await api.task(target.id))?.completed).toBe(true);

    const other = open[1];
    await page.getByTestId(`task-title-${other.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/lists/4/tasks/${other.id}`));
    await expect(page.getByTestId('task-panel')).toBeVisible();
    await page.getByTestId('panel-close').click();
    await expect(page.getByTestId('task-panel')).toBeHidden();

    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
    expect(lastInt((await page.getByTestId('bulk-count').textContent()) ?? '')).toBeGreaterThan(0);
    await blurAll(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
    expect(await rowsInDom(page)).toBeLessThan(200);
  });
});
