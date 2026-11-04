import { test, expect, gotoList, revealRow } from '../fixtures';

test.describe('Step 07: Subtasks', { tag: '@step07' }, () => {
  test('add, toggle and delete subtasks in the panel; the row shows progress', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Moving house', [{ title: 'Pack the kitchen for Fatima Al-Sayed' }]);
    const t = tasks[0];
    await page.goto(`/lists/${list.id}/tasks/${t.id}`);
    await expect(page.getByTestId('task-panel')).toBeVisible();
    const input = page.getByTestId('subtask-add-input');

    for (const title of ['Wrap the plates', 'Box the pans', 'Label the boxes']) {
      await input.fill(title);
      await input.press('Enter');
      await expect.poll(async () => (await api.task(t.id))?.subtasks.map((s) => s.title).includes(title)).toBe(true);
    }
    const subs = (await api.task(t.id))!.subtasks;
    expect(subs.map((s) => s.title)).toEqual(['Wrap the plates', 'Box the pans', 'Label the boxes']);
    for (const s of subs) await expect(page.getByTestId(`subtask-row-${s.id}`)).toContainText(s.title);
    await expect(page.getByTestId(`subtask-progress-${t.id}`)).toHaveText(/0\s*\/\s*3/);

    await page.getByTestId(`subtask-check-${subs[0].id}`).click();
    await expect.poll(async () => (await api.task(t.id))?.subtasks.find((s) => s.id === subs[0].id)?.done).toBe(true);
    await expect(page.getByTestId(`subtask-progress-${t.id}`)).toHaveText(/1\s*\/\s*3/);

    await page.getByTestId(`subtask-delete-${subs[2].id}`).click();
    await expect.poll(async () => (await api.task(t.id))?.subtasks.length).toBe(2);
    await expect(page.getByTestId(`subtask-row-${subs[2].id}`)).toHaveCount(0);
    await expect(page.getByTestId(`subtask-progress-${t.id}`)).toHaveText(/1\s*\/\s*2/);
  });

  test('completing every subtask does not complete the task', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Repairs', [{ title: 'Fix the shed with Tomasz Nowak' }]);
    const t = tasks[0];
    const s1 = await api.addSubtask(t.id, 'Buy the hinges');
    const s2 = await api.addSubtask(t.id, 'Paint the door');
    await page.goto(`/lists/${list.id}/tasks/${t.id}`);
    await page.getByTestId(`subtask-check-${s1.id}`).click();
    await page.getByTestId(`subtask-check-${s2.id}`).click();
    await expect.poll(async () => (await api.task(t.id))?.subtasks.every((s) => s.done)).toBe(true);
    await expect(page.getByTestId(`subtask-progress-${t.id}`)).toHaveText(/2\s*\/\s*2/);
    expect((await api.task(t.id))?.completed).toBe(false);
    await expect(page.getByTestId(`task-check-${t.id}`)).not.toBeChecked();
  });

  test('seed rows with subtasks show done/total from the API', async ({ page, api }) => {
    let found: { listId: number; id: number; done: number; total: number } | undefined;
    for (const listId of [1, 2, 3]) {
      const t = (await api.tasks(listId)).find((x) => !x.completed && x.subtasks.length > 0);
      if (t) {
        found = { listId, id: t.id, done: t.subtasks.filter((s) => s.done).length, total: t.subtasks.length };
        break;
      }
    }
    expect(found, 'the seed has an open task with subtasks').toBeTruthy();
    await gotoList(page, found!.listId);
    await revealRow(page, found!.id);
    await expect(page.getByTestId(`subtask-progress-${found!.id}`)).toHaveText(new RegExp(`${found!.done}\\s*/\\s*${found!.total}`));
  });
});
