import { test, expect, gotoList, lastInt, revealRow, retypeFocused } from '../fixtures';

test.describe('Step 02: Tasks', { tag: '@step02' }, () => {
  test('task-add-input adds a task on Enter, through the API', async ({ page, api }) => {
    const { list } = await api.makeList('Week of Maria Garcia', [{ title: 'Book the dentist' }]);
    await gotoList(page, list.id);
    const input = page.getByTestId('task-add-input');
    await input.fill('Call Aisha Khan about the invoice');
    await input.press('Enter');
    let id = 0;
    await expect
      .poll(async () => {
        const t = (await api.tasks(list.id)).find((x) => x.title === 'Call Aisha Khan about the invoice');
        id = t?.id ?? 0;
        return id > 0;
      })
      .toBe(true);
    await revealRow(page, id);
    await expect(page.getByTestId(`task-title-${id}`)).toHaveText('Call Aisha Khan about the invoice');
    await expect(input).toHaveValue('');
    // The sidebar count follows without a reload (open count and total both go from 1 to 2).
    await expect.poll(async () => lastInt((await page.getByTestId(`list-count-${list.id}`).textContent()) ?? '')).toBe(2);
  });

  test('an empty title is not sent', async ({ page, api }) => {
    const { list } = await api.makeList('Quiet list', []);
    await gotoList(page, list.id);
    const input = page.getByTestId('task-add-input');
    await input.fill('   ');
    await input.press('Enter');
    await input.fill('Water the plants for Yuki Tanaka');
    await input.press('Enter');
    await expect.poll(async () => (await api.tasks(list.id)).map((t) => t.title)).toEqual(['Water the plants for Yuki Tanaka']);
  });

  test('the checkbox completes and reopens a task', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Chores of David Chen', [{ title: 'Fix the bike light' }, { title: 'Buy stamps' }]);
    const t = tasks[0];
    await gotoList(page, list.id);
    await revealRow(page, t.id);
    await page.getByTestId(`task-check-${t.id}`).click();
    await expect.poll(async () => (await api.task(t.id))?.completed).toBe(true);
    // From step 04 on the default view hides completed tasks, so the row may leave.
    await expect
      .poll(async () => {
        const row = page.getByTestId(`task-row-${t.id}`);
        if ((await row.count()) === 0) return true;
        return page.getByTestId(`task-check-${t.id}`).isChecked();
      })
      .toBe(true);
    // ?view=completed is ignored before step 04 and shows completed tasks after it.
    await gotoList(page, list.id, '?view=completed');
    await revealRow(page, t.id);
    await expect(page.getByTestId(`task-check-${t.id}`)).toBeChecked();
    await page.getByTestId(`task-check-${t.id}`).click();
    await expect.poll(async () => (await api.task(t.id))?.completed).toBe(false);
  });

  test('double-click edits the title: Enter saves, Escape cancels', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Errands', [{ title: 'Pick up the parcel' }]);
    const t = tasks[0];
    await gotoList(page, list.id);
    await revealRow(page, t.id);
    await page.getByTestId(`task-title-${t.id}`).dblclick();
    await retypeFocused(page, 'Pick up the parcel for Tomasz Nowak', 'Enter');
    await expect.poll(async () => (await api.task(t.id))?.title).toBe('Pick up the parcel for Tomasz Nowak');
    await gotoList(page, list.id);
    await expect(page.getByTestId(`task-title-${t.id}`)).toHaveText('Pick up the parcel for Tomasz Nowak');

    await page.getByTestId(`task-title-${t.id}`).dblclick();
    await retypeFocused(page, 'This edit is cancelled', 'Escape');
    await expect(page.getByTestId(`task-title-${t.id}`)).toHaveText('Pick up the parcel for Tomasz Nowak');
    expect((await api.task(t.id))?.title).toBe('Pick up the parcel for Tomasz Nowak');
  });

  test('task-delete removes the task', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Short list', [{ title: 'Return the library book' }, { title: 'Send the photos to Fatima' }]);
    await gotoList(page, list.id);
    await revealRow(page, tasks[0].id);
    await page.getByTestId(`task-delete-${tasks[0].id}`).click();
    await expect.poll(async () => api.task(tasks[0].id)).toBeNull();
    await expect(page.getByTestId(`task-row-${tasks[0].id}`)).toHaveCount(0);
    await expect(page.getByTestId(`task-row-${tasks[1].id}`)).toBeVisible();
  });
});
