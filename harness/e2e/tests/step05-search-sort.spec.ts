import { test, expect, gotoList, rowIdsInOrder, selectFlexible, isoDate, Api } from '../fixtures';

async function sample(api: Api) {
  const { list, tasks } = await api.makeList('Search and sort', [
    { title: 'Call Aisha Khan about the invoice', tags: ['call'], dueDate: isoDate(2), priority: 1 },
    { title: 'Buy stamps', notes: 'for the Tomasz Nowak letter', priority: 3 },
    { title: 'Water plants', tags: ['errand'], dueDate: isoDate(0), priority: 2 },
    { title: 'Draft the budget', dueDate: isoDate(5), priority: 0 },
    { title: 'Archive the old invoices' },
  ]);
  await api.complete(tasks[4].id);
  const [call, buy, water, draft, archive] = tasks.map((t) => t.id);
  return { list, call, buy, water, draft, archive };
}

test.describe('Step 05: Search and sort', { tag: '@step05' }, () => {
  test('search filters on every keystroke by title, notes and tags', async ({ page, api }) => {
    const s = await sample(api);
    await gotoList(page, s.list.id);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.call, s.buy, s.water, s.draft]);
    const search = page.getByTestId('search-input');
    await search.click();
    await page.keyboard.type('w'); // "Water" (title) and "Nowak" (notes)
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy, s.water]);
    await page.keyboard.type('a');
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy, s.water]);
    await page.keyboard.type('t'); // "wat": Water only
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.water]);
    await expect(page).toHaveURL(/[?&]q=wat/);

    await search.fill('TOMASZ'); // notes, case-insensitive
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy]);
    await search.fill('errand'); // tag
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.water]);
    await search.fill('');
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.call, s.buy, s.water, s.draft]);
  });

  test('sort-select orders by due, priority, title, created and back to manual', async ({ page, api }) => {
    const s = await sample(api);
    await gotoList(page, s.list.id);
    const sort = page.getByTestId('sort-select');

    await selectFlexible(sort, 'due'); // nulls last
    await expect(page).toHaveURL(/[?&]sort=due/);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.water, s.call, s.draft, s.buy]);

    await selectFlexible(sort, 'priority'); // high first
    await expect(page).toHaveURL(/[?&]sort=priority/);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy, s.water, s.call, s.draft]);

    await selectFlexible(sort, 'title');
    await expect(page).toHaveURL(/[?&]sort=title/);
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy, s.call, s.draft, s.water]);

    // The spec does not fix the direction of "created"; oldest or newest first are both accepted.
    await selectFlexible(sort, 'created');
    await expect(page).toHaveURL(/[?&]sort=created/);
    await expect
      .poll(async () => {
        const v = JSON.stringify(await rowIdsInOrder(page));
        return v === JSON.stringify([s.call, s.buy, s.water, s.draft]) || v === JSON.stringify([s.draft, s.water, s.buy, s.call]);
      })
      .toBe(true);

    await selectFlexible(sort, 'manual');
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.call, s.buy, s.water, s.draft]);
  });

  test('filter, search and sort compose and load from the URL', async ({ page, api }) => {
    const s = await sample(api);
    await gotoList(page, s.list.id, '?view=all&q=o&sort=title');
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.buy, s.call]);
    await expect(page.getByTestId('search-input')).toHaveValue('o');
    await expect(page.getByTestId('sort-select')).toHaveValue(/title/i);
    await gotoList(page, s.list.id, '?view=completed&q=o');
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.archive]);
    await page.reload();
    await expect.poll(() => rowIdsInOrder(page)).toEqual([s.archive]);
  });
});
