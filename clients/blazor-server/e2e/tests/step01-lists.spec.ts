import { test, expect, gotoList, lastInt, confirmIfAsked, retypeFocused } from '../fixtures';

test.describe('Step 01: Lists', { tag: '@step01' }, () => {
  test('list-add reveals the name input and Enter saves a new list', async ({ page, api }) => {
    await gotoList(page, 1);
    await page.getByTestId('list-add').click();
    const input = page.getByTestId('list-name-input');
    await expect(input).toBeVisible();
    await input.fill('Errands for Fatima Al-Sayed');
    await input.press('Enter');
    let created: { id: number } | undefined;
    await expect
      .poll(async () => {
        created = (await api.lists()).find((l) => l.name === 'Errands for Fatima Al-Sayed');
        return Boolean(created);
      })
      .toBe(true);
    await expect(page.getByTestId(`list-item-${created!.id}`)).toContainText('Errands for Fatima Al-Sayed');
    await expect(page.getByTestId(`list-count-${created!.id}`)).toHaveText(/\b0\b/);
  });

  test('rename inline with list-rename and Enter', async ({ page, api }) => {
    const { list } = await api.makeList('Garden for Tomasz', []);
    await gotoList(page, 1);
    await page.getByTestId(`list-rename-${list.id}`).click();
    // The inline editor takes focus; its id is not part of the contract.
    await retypeFocused(page, 'Garden for Tomasz Nowak', 'Enter');
    await expect.poll(async () => (await api.list(list.id))?.name).toBe('Garden for Tomasz Nowak');
    await expect(page.getByTestId(`list-item-${list.id}`)).toContainText('Garden for Tomasz Nowak');
  });

  test('rename inline by double-clicking the list name', async ({ page, api }) => {
    const { list } = await api.makeList('Books for Yuki', []);
    await gotoList(page, 1);
    await page.getByTestId(`list-item-${list.id}`).getByText('Books for Yuki').dblclick();
    await retypeFocused(page, 'Books for Yuki Tanaka', 'Enter');
    await expect.poll(async () => (await api.list(list.id))?.name).toBe('Books for Yuki Tanaka');
    await expect(page.getByTestId(`list-item-${list.id}`)).toContainText('Books for Yuki Tanaka');
  });

  test('delete a list after the confirm', async ({ page, api }) => {
    const { list } = await api.makeList('Old plans of David Chen', [{ title: 'Throw away the old map' }]);
    await gotoList(page, list.id);
    await page.getByTestId(`list-delete-${list.id}`).click();
    await confirmIfAsked(page, async () => !(await api.list(list.id)));
    await expect(page.getByTestId(`list-item-${list.id}`)).toHaveCount(0);
  });

  test('the selected list survives a reload and counts follow changes', async ({ page, api }) => {
    const home = (await api.list(2))!;
    await gotoList(page, 2);
    await page.reload();
    await expect(page).toHaveURL(/\/lists\/2(\?|$)/);
    const before = lastInt((await page.getByTestId('list-count-2').textContent()) ?? '');
    expect([home.openCount, home.taskCount]).toContain(before);
    // A task added elsewhere changes both counts by one; a reload shows the new count.
    await api.createTask(2, { title: 'Call Aisha Khan about the invoice' });
    await page.reload();
    await expect.poll(async () => lastInt((await page.getByTestId('list-count-2').textContent()) ?? '')).toBe(before! + 1);
  });
});
