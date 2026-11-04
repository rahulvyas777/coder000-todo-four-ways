import { test, expect, gotoList, revealRow, selectFlexible, isoDate } from '../fixtures';

test.describe('Step 13: Recurring tasks', { tag: '@step13' }, () => {
  test('panel-repeat sets the repeat and the row shows task-repeat', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Routines', [{ title: 'Take out the recycling', dueDate: isoDate(0) }]);
    const t = tasks[0];
    await page.goto(`/lists/${list.id}/tasks/${t.id}`);
    await expect(page.getByTestId(`task-repeat-${t.id}`)).toHaveCount(0);
    for (const r of ['daily', 'monthly', 'weekly'] as const) {
      await selectFlexible(page.getByTestId('panel-repeat'), r);
      await expect.poll(async () => (await api.task(t.id))?.repeat).toBe(r);
    }
    await expect(page.getByTestId(`task-repeat-${t.id}`)).toBeVisible();
    await selectFlexible(page.getByTestId('panel-repeat'), 'none');
    await expect.poll(async () => (await api.task(t.id))?.repeat).toBe('none');
    await expect(page.getByTestId(`task-repeat-${t.id}`)).toHaveCount(0);
  });

  test('completing a repeating task shows the next occurrence without a reload', async ({ page, api }) => {
    const due = isoDate(0);
    const { list, tasks } = await api.makeList('Weekly', [{ title: 'Water the plants for Aisha Khan', dueDate: due, repeat: 'weekly' }, { title: 'Plain task' }]);
    const t = tasks[0];
    await gotoList(page, list.id);
    await expect(page.getByTestId(`task-repeat-${t.id}`)).toBeVisible();
    await page.getByTestId(`task-check-${t.id}`).click();
    let nextId = 0;
    await expect
      .poll(async () => {
        const n = (await api.tasks(list.id)).find((x) => x.id !== t.id && x.title === t.title && !x.completed);
        nextId = n?.id ?? 0;
        return nextId > 0;
      })
      .toBe(true);
    const next = (await api.task(nextId))!;
    expect(next.dueDate).toBe(isoDate(7));
    const row = await revealRow(page, nextId);
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`task-title-${nextId}`)).toHaveText(t.title);
    await expect(page.getByTestId(`task-repeat-${nextId}`)).toBeVisible();
  });

  test('Undo after completing a repeating task reopens it and deletes the next one', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Daily', [{ title: 'Feed the fish', dueDate: isoDate(-1), repeat: 'daily' }]);
    const t = tasks[0];
    await gotoList(page, list.id);
    await page.getByTestId(`task-check-${t.id}`).click();
    let nextId = 0;
    await expect
      .poll(async () => {
        const n = (await api.tasks(list.id)).find((x) => x.id !== t.id);
        nextId = n?.id ?? 0;
        return nextId > 0;
      })
      .toBe(true);
    await expect(page.getByTestId(`task-row-${nextId}`)).toBeVisible();
    await expect(page.getByTestId('toast')).toBeVisible();
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.task(t.id))?.completed).toBe(false);
    await expect.poll(async () => api.task(nextId)).toBeNull();
    await expect(page.getByTestId(`task-row-${nextId}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-check-${t.id}`)).not.toBeChecked();
  });
});
