import { test, expect, gotoList, blurAll } from '../fixtures';
import type { Page } from '@playwright/test';

/** Presses Enter on the highlighted row and returns the task id from the panel route. */
async function openHighlighted(page: Page, listId: number): Promise<number> {
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/lists/${listId}/tasks/\\d+`));
  await expect(page.getByTestId('task-panel')).toBeVisible();
  const m = /\/tasks\/(\d+)/.exec(page.url());
  await blurAll(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-panel')).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/lists/${listId}(\\?|$)`));
  return Number(m![1]);
}

test.describe('Step 10: Keyboard shortcuts', { tag: '@step10' }, () => {
  test('n focuses the add input and / focuses search', async ({ page, api }) => {
    const { list } = await api.makeList('Keys', [{ title: 'Buy bread' }]);
    await gotoList(page, list.id);
    await blurAll(page);
    await page.keyboard.press('n');
    await expect(page.getByTestId('task-add-input')).toBeFocused();
    await expect(page.getByTestId('task-add-input')).toHaveValue('');
    await blurAll(page);
    await page.keyboard.press('/');
    await expect(page.getByTestId('search-input')).toBeFocused();
    await expect(page.getByTestId('search-input')).toHaveValue('');
  });

  test('shortcuts are ignored while typing in an input', async ({ page, api }) => {
    const { list } = await api.makeList('Typing', [{ title: 'Answer the email from Aisha Khan' }]);
    await gotoList(page, list.id);
    await page.getByTestId('search-input').click();
    await page.keyboard.type('n?');
    await expect(page.getByTestId('search-input')).toBeFocused();
    await expect(page.getByTestId('search-input')).toHaveValue('n?');
    await expect(page.getByTestId('task-add-input')).not.toBeFocused();
    await expect(page.getByTestId('shortcut-help')).toBeHidden();
  });

  test('j and k move the highlight; Enter opens the highlighted task; Escape closes it', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Cursor', [{ title: 'First: sweep' }, { title: 'Second: mop' }, { title: 'Third: dust' }]);
    const order = tasks.map((t) => t.id);
    await gotoList(page, list.id);
    await blurAll(page);
    await page.keyboard.press('j');
    const h1 = await openHighlighted(page, list.id);
    expect(order.slice(0, 2), 'the first j highlights the first or the second row').toContain(h1);
    await page.keyboard.press('j');
    const h2 = await openHighlighted(page, list.id);
    expect(h2).toBe(order[order.indexOf(h1) + 1]);
    await page.keyboard.press('k');
    const h3 = await openHighlighted(page, list.id);
    expect(h3).toBe(h1);
  });

  test('x toggles and Delete deletes the highlighted task', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Single', [{ title: 'Only task: call Tomasz Nowak' }]);
    const id = tasks[0].id;
    await gotoList(page, list.id);
    await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();
    await blurAll(page);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect.poll(async () => (await api.task(id))?.completed).toBe(true);

    const { list: list2, tasks: tasks2 } = await api.makeList('Single two', [{ title: 'Only task: water the garden' }]);
    await gotoList(page, list2.id);
    await expect(page.getByTestId(`task-row-${tasks2[0].id}`)).toBeVisible();
    await blurAll(page);
    await page.keyboard.press('j');
    await page.keyboard.press('Delete');
    await expect.poll(async () => api.task(tasks2[0].id)).toBeNull();
    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast-undo')).toBeVisible();
  });

  test('? toggles the shortcut help dialog', async ({ page, api }) => {
    const { list } = await api.makeList('Help', []);
    await gotoList(page, list.id);
    await blurAll(page);
    await expect(page.getByTestId('shortcut-help')).toBeHidden();
    await page.keyboard.press('?');
    const help = page.getByTestId('shortcut-help');
    await expect(help).toBeVisible();
    await expect(help).toContainText(/Esc/i);
    await expect(help).toContainText(/Del/i);
    await page.keyboard.press('?');
    await expect(help).toBeHidden();
  });

  test('Escape clears the selection', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Esc', [{ title: 'Pay the rent' }, { title: 'Pay the phone bill' }]);
    await gotoList(page, list.id);
    await page.getByTestId(`select-check-${tasks[0].id}`).check();
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
    await blurAll(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bulk-bar')).toBeHidden();
  });
});
