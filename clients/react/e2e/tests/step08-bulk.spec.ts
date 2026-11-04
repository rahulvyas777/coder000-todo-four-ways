import { test, expect, gotoList, rowIdsInOrder, selectFlexible, blurAll, Api } from '../fixtures';

async function four(api: Api, name: string) {
  return api.makeList(name, [
    { title: 'Send the report to Aisha Khan' },
    { title: 'Check the delivery for David Chen' },
    { title: 'Order the chairs' },
    { title: 'Return the projector' },
  ]);
}

test.describe('Step 08: Bulk actions', { tag: '@step08' }, () => {
  test('selecting rows shows the bulk bar with a count; bulk-complete completes them', async ({ page, api }) => {
    const { list, tasks } = await four(api, 'Bulk complete');
    await gotoList(page, list.id);
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
    await page.getByTestId(`select-check-${tasks[0].id}`).check();
    await page.getByTestId(`select-check-${tasks[2].id}`).check();
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
    await expect(page.getByTestId('bulk-count')).toHaveText(/\b2\b/);
    await page.getByTestId('bulk-complete').click();
    await expect
      .poll(async () => (await api.tasks(list.id)).filter((t) => t.completed).map((t) => t.id).sort((a, b) => a - b))
      .toEqual([tasks[0].id, tasks[2].id].sort((a, b) => a - b));
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
    // The default view hides completed tasks.
    await expect.poll(() => rowIdsInOrder(page)).toEqual([tasks[1].id, tasks[3].id]);
  });

  test('bulk-delete deletes the selected tasks and clears the selection', async ({ page, api }) => {
    const { list, tasks } = await four(api, 'Bulk delete');
    await gotoList(page, list.id);
    await page.getByTestId(`select-check-${tasks[1].id}`).check();
    await page.getByTestId(`select-check-${tasks[3].id}`).check();
    await expect(page.getByTestId('bulk-count')).toHaveText(/\b2\b/);
    await page.getByTestId('bulk-delete').click();
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([tasks[0].id, tasks[2].id]);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([tasks[0].id, tasks[2].id]);
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
  });

  test('bulk-move moves the selected tasks to the list chosen in bulk-move-target', async ({ page, api }) => {
    const { list, tasks } = await four(api, 'Bulk move');
    const homeBefore = (await api.tasks(2)).length;
    await gotoList(page, list.id);
    await page.getByTestId(`select-check-${tasks[0].id}`).check();
    await page.getByTestId(`select-check-${tasks[1].id}`).check();
    const target = page.getByTestId('bulk-move-target');
    await expect(target).toBeVisible();
    // The target select offers the other lists, not the current one.
    const labels = await target.evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.label));
    expect(labels.join('|')).toContain('Home');
    expect(labels).not.toContain('Bulk move');
    await selectFlexible(target, 'Home');
    await page.getByTestId('bulk-move').click();
    await expect.poll(async () => (await api.tasks(2)).length).toBe(homeBefore + 2);
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.id)).toEqual([tasks[2].id, tasks[3].id]);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([tasks[2].id, tasks[3].id]);
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
  });

  test('select-all selects every visible row; Escape clears the selection', async ({ page, api }) => {
    const { list, tasks } = await four(api, 'Select all');
    await gotoList(page, list.id);
    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('bulk-count')).toHaveText(/\b4\b/);
    for (const t of tasks) await expect(page.getByTestId(`select-check-${t.id}`)).toBeChecked();
    await blurAll(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
    for (const t of tasks) await expect(page.getByTestId(`select-check-${t.id}`)).not.toBeChecked();
    // select-all toggles: a second click clears (a checkbox or a button).
    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('bulk-count')).toHaveText(/\b4\b/);
    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
  });
});
