import { test, expect, gotoList, revealRow, selectFlexible, valueOrText, blurAll, isoDate } from '../fixtures';

test.describe('Step 03: Detail panel', { tag: '@step03' }, () => {
  test('clicking a row opens the panel and its route; panel-close returns', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Panel list', [
      { title: 'Plan the trip with Aisha Khan', notes: 'Trains first, then hotels' },
      { title: 'Order printer paper' },
    ]);
    const t = tasks[0];
    await gotoList(page, list.id);
    await (await revealRow(page, t.id)).getByTestId(`task-title-${t.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}/tasks/${t.id}(\\?|$)`));
    const panel = page.getByTestId('task-panel');
    await expect(panel).toBeVisible();
    await expect.poll(() => valueOrText(page.getByTestId('panel-title'))).toBe(t.title);
    await expect(page.getByTestId('panel-notes')).toHaveValue('Trains first, then hotels');
    await page.getByTestId('panel-close').click();
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}(\\?|$)`));
    await expect(panel).toBeHidden();
  });

  test('the panel route opens directly and Escape closes it', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Direct', [{ title: 'Renew the passport of Tomasz Nowak' }]);
    await page.goto(`/lists/${list.id}/tasks/${tasks[0].id}`);
    await expect(page.getByTestId('task-panel')).toBeVisible();
    await expect.poll(() => valueOrText(page.getByTestId('panel-title'))).toBe('Renew the passport of Tomasz Nowak');
    await blurAll(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-panel')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/lists/${list.id}(\\?|$)`));
  });

  test('notes save on blur; due date, priority and repeat save on change', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Details', [{ title: 'Prepare the talk for David Chen' }]);
    const t = tasks[0];
    const due = isoDate(3);
    await page.goto(`/lists/${list.id}/tasks/${t.id}`);
    const notes = page.getByTestId('panel-notes');
    await notes.fill('Slides, demo, ten minutes of questions');
    await notes.blur();
    await expect.poll(async () => (await api.task(t.id))?.notes).toBe('Slides, demo, ten minutes of questions');

    await page.getByTestId('panel-due').fill(due);
    await expect.poll(async () => (await api.task(t.id))?.dueDate).toBe(due);

    await selectFlexible(page.getByTestId('panel-priority'), '3');
    await expect.poll(async () => (await api.task(t.id))?.priority).toBe(3);

    await selectFlexible(page.getByTestId('panel-repeat'), 'weekly');
    await expect.poll(async () => (await api.task(t.id))?.repeat).toBe('weekly');

    // The row shows the due date and the priority mark.
    await expect(page.getByTestId(`task-due-${t.id}`)).toBeVisible();
    await expect(page.getByTestId(`task-priority-${t.id}`)).toBeVisible();

    // A reload shows the saved values in the panel.
    await page.reload();
    await expect(page.getByTestId('panel-notes')).toHaveValue('Slides, demo, ten minutes of questions');
    await expect(page.getByTestId('panel-due')).toHaveValue(due);
    await expect(page.getByTestId('panel-priority')).toHaveValue(/3|high/i);
    await expect(page.getByTestId('panel-repeat')).toHaveValue(/weekly/i);
  });

  test('tags: Enter adds a chip, Backspace on empty removes the last', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Tags', [{ title: 'Send the invoice to Maria Garcia' }]);
    const t = tasks[0];
    await page.goto(`/lists/${list.id}/tasks/${t.id}`);
    const input = page.getByTestId('panel-tags-input');
    await input.fill('invoice');
    await input.press('Enter');
    await expect(page.getByTestId('panel-tag-invoice')).toBeVisible();
    await input.fill('Urgent');
    await input.press('Enter');
    // Tags are lower-case (the contract).
    await expect(page.getByTestId('panel-tag-urgent')).toBeVisible();
    await expect.poll(async () => (await api.task(t.id))?.tags.slice().sort()).toEqual(['invoice', 'urgent']);
    // The row shows the chips.
    await expect(page.getByTestId(`task-tag-${t.id}-invoice`)).toBeVisible();
    await expect(page.getByTestId(`task-tag-${t.id}-urgent`)).toBeVisible();

    await expect(input).toHaveValue('');
    await input.press('Backspace');
    await expect(page.getByTestId('panel-tag-urgent')).toHaveCount(0);
    await expect.poll(async () => (await api.task(t.id))?.tags).toEqual(['invoice']);
    await expect(page.getByTestId(`task-tag-${t.id}-urgent`)).toHaveCount(0);
  });

  test('rows show due date, priority and tags from the API', async ({ page, api }) => {
    const tasks = await api.tasks(1);
    const withAll = tasks.find((t) => !t.completed && t.dueDate && t.priority > 0 && t.tags.length > 0);
    expect(withAll, 'the seed has an open task with a due date, a priority and tags').toBeTruthy();
    await gotoList(page, 1);
    await revealRow(page, withAll!.id);
    await expect(page.getByTestId(`task-due-${withAll!.id}`)).toBeVisible();
    await expect(page.getByTestId(`task-priority-${withAll!.id}`)).toBeVisible();
    for (const tag of withAll!.tags) {
      await expect(page.getByTestId(`task-tag-${withAll!.id}-${tag}`)).toBeVisible();
    }
  });
});
