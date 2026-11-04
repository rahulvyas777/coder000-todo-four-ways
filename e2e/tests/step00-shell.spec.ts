import { test, expect, gotoList, lastInt, parseTaskCount, revealRow } from '../fixtures';

test.describe('Step 00: Shell', { tag: '@step00' }, () => {
  test('the title says Tasks and / redirects to the first list', async ({ page, api }) => {
    const lists = await api.lists();
    await page.goto('/');
    await expect(page.getByTestId('app-title')).toHaveText(/Tasks/);
    await expect(page).toHaveURL(new RegExp(`/lists/${lists[0].id}(\\?|$)`));
  });

  test('the sidebar lists every list from the API with its count', async ({ page, api }) => {
    const lists = await api.lists();
    await gotoList(page, 1);
    const nav = page.getByTestId('list-nav');
    await expect(nav).toBeVisible();
    for (const l of lists) {
      const item = nav.getByTestId(`list-item-${l.id}`);
      await expect(item).toContainText(l.name);
      const countText = (await page.getByTestId(`list-count-${l.id}`).textContent()) ?? '';
      // The spec says "with counts"; open count or total count are both accepted.
      expect([l.openCount, l.taskCount], `list-count-${l.id} = "${countText}"`).toContain(lastInt(countText));
    }
  });

  test('a list shows its tasks as rows with title and checkbox state', async ({ page, api }) => {
    const tasks = await api.tasks(2);
    await gotoList(page, 2);
    // The first open tasks in manual order must be there (completed ones may be hidden from step 04 on).
    const firstOpen = tasks.filter((t) => !t.completed).slice(0, 5);
    for (const t of firstOpen) {
      await revealRow(page, t.id);
      await expect(page.getByTestId(`task-title-${t.id}`)).toHaveText(t.title);
      await expect(page.getByTestId(`task-check-${t.id}`)).not.toBeChecked();
    }
    // Every task row on screen shows the checkbox state the API reports.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const rows = page.getByTestId(/^task-row-\d+$/);
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 15); i++) {
      const tid = (await rows.nth(i).getAttribute('data-testid')) ?? '';
      const id = Number(tid.replace('task-row-', ''));
      const t = byId.get(id);
      expect(t, `row ${tid} belongs to list 2`).toBeTruthy();
      if (t!.completed) await expect(page.getByTestId(`task-check-${id}`)).toBeChecked();
      else await expect(page.getByTestId(`task-check-${id}`)).not.toBeChecked();
    }
  });

  test('task-count shows "N of M open" from the API', async ({ page, api }) => {
    for (const id of [1, 3]) {
      const l = (await api.list(id))!;
      await gotoList(page, id);
      await expect
        .poll(async () => parseTaskCount((await page.getByTestId('task-count').textContent()) ?? ''))
        .toEqual({ open: l.openCount, total: l.taskCount });
    }
  });

  test('navigating between lists through the sidebar changes the rows and the URL', async ({ page, api }) => {
    const reading = await api.tasks(3);
    const firstOpen = reading.find((t) => !t.completed)!;
    await gotoList(page, 1);
    await page.getByTestId('list-item-3').getByText('Reading').click();
    await expect(page).toHaveURL(/\/lists\/3(\?|$)/);
    await revealRow(page, firstOpen.id);
    await expect(page.getByTestId(`task-title-${firstOpen.id}`)).toHaveText(firstOpen.title);
  });
});
