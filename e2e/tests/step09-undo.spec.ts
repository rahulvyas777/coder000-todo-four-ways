import { test, expect, gotoList, rowIdsInOrder, confirmIfAsked } from '../fixtures';

test.describe('Step 09: Undo', { tag: '@step09' }, () => {
  test('delete task shows the toast; Undo restores the task', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Undo task', [{ title: 'Renew the insurance' }, { title: 'Call Yuki Tanaka' }]);
    await gotoList(page, list.id);
    await page.getByTestId(`task-delete-${tasks[0].id}`).click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect.poll(async () => api.task(tasks[0].id)).toBeNull();
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.task(tasks[0].id))?.id).toBe(tasks[0].id);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([tasks[0].id, tasks[1].id]);
  });

  test('the toast disappears after about five seconds', async ({ page, api }) => {
    // No clock mocking: the toast must be visible right after the action and gone within 7 s,
    // and it must have stayed at least 4 s (the spec says five).
    const { list, tasks } = await api.makeList('Undo timer', [{ title: 'Clean the windows' }]);
    await gotoList(page, list.id);
    await page.getByTestId(`task-delete-${tasks[0].id}`).click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast-undo')).toBeVisible();
    const shownAt = Date.now();
    await expect(page.getByTestId('toast')).toBeHidden({ timeout: 7000 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(4000);
    expect(await api.task(tasks[0].id)).toBeNull();
  });

  test('delete list shows the toast; Undo restores the list and its tasks', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Holiday of Maria Garcia', [{ title: 'Book the flights' }, { title: 'Find a pet sitter' }]);
    await gotoList(page, list.id);
    await page.getByTestId(`list-delete-${list.id}`).click();
    await confirmIfAsked(page, async () => !(await api.list(list.id)));
    await expect(page.getByTestId('toast')).toBeVisible();
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.list(list.id))?.name).toBe('Holiday of Maria Garcia');
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
    await expect(page.getByTestId(`list-item-${list.id}`)).toBeVisible();
  });

  test('bulk delete and bulk complete can be undone', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Undo bulk', [{ title: 'Sweep the yard' }, { title: 'Fix the gate' }, { title: 'Feed the cat' }]);
    const [a, b, c] = tasks.map((t) => t.id);
    await gotoList(page, list.id);

    await page.getByTestId(`select-check-${a}`).check();
    await page.getByTestId(`select-check-${b}`).check();
    await page.getByTestId('bulk-delete').click();
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([c]);
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([a, b, c]);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([a, b, c]);

    await page.getByTestId(`select-check-${b}`).check();
    await page.getByTestId(`select-check-${c}`).check();
    await page.getByTestId('bulk-complete').click();
    await expect.poll(async () => (await api.tasks(list.id)).filter((t) => t.completed).length).toBe(2);
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.tasks(list.id)).filter((t) => t.completed).length).toBe(0);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([a, b, c]);
  });

  test('a new action replaces the toast; Undo undoes only the latest', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Undo twice', [{ title: 'Read the contract' }, { title: 'Sign the contract' }, { title: 'Post the contract' }]);
    const [a, b, c] = tasks.map((t) => t.id);
    await gotoList(page, list.id);
    await page.getByTestId(`task-delete-${a}`).click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await page.getByTestId(`task-delete-${b}`).click();
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([c]);
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await page.getByTestId('toast-undo').click();
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([b, c]);
    expect(await api.task(a)).toBeNull();
  });
});
