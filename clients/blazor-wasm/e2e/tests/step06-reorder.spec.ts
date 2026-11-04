import { test, expect, gotoList, rowIdsInOrder, expectRowOrder, selectFlexible, Api } from '../fixtures';
import type { Page, TestInfo } from '@playwright/test';

async function apiOrder(api: Api, listId: number): Promise<number[]> {
  return (await api.tasks(listId)).filter((t) => !t.completed).map((t) => t.id);
}

/**
 * Drags the handle of `fromId` onto the row of `toId`: first with locator.dragTo, and if the
 * API order has not changed, with a pointer sequence. Returns which path worked.
 */
async function drag(page: Page, api: Api, listId: number, fromId: number, toId: number, before: number[], testInfo: TestInfo): Promise<'dragTo' | 'pointer'> {
  const handle = page.getByTestId(`drag-handle-${fromId}`);
  const target = page.getByTestId(`task-row-${toId}`);
  await expect(handle).toBeVisible();
  const changed = async () => JSON.stringify(await apiOrder(api, listId)) !== JSON.stringify(before);

  await handle.dragTo(target, { targetPosition: { x: 60, y: 8 } });
  try {
    await expect.poll(changed, { timeout: 3000 }).toBe(true);
    testInfo.annotations.push({ type: 'drag-path', description: 'dragTo' });
    return 'dragTo';
  } catch {
    // Fallback: a slow pointer sequence (for pointer-event and library implementations).
    const hb = (await handle.boundingBox())!;
    const tb = (await target.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    const steps = 12;
    const x0 = hb.x + hb.width / 2;
    const y0 = hb.y + hb.height / 2;
    const x1 = tb.x + 60;
    const y1 = tb.y + 8;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    }
    await page.mouse.up();
    await expect.poll(changed, { message: 'order changed after dragTo and the pointer fallback' }).toBe(true);
    testInfo.annotations.push({ type: 'drag-path', description: 'pointer' });
    return 'pointer';
  }
}

test.describe('Step 06: Drag-and-drop reorder', { tag: '@step06' }, () => {
  test('dragging the last row onto the first moves it to the top and survives a reload', async ({ page, api }, testInfo) => {
    const { list, tasks } = await api.makeList('Reorder', [
      { title: 'One: book the venue' },
      { title: 'Two: invite Maria Garcia' },
      { title: 'Three: order the cake' },
      { title: 'Four: print the menus' },
    ]);
    const [a, b, c, d] = tasks.map((t) => t.id);
    await gotoList(page, list.id);
    await expectRowOrder(page, [a, b, c, d]);
    const path = await drag(page, api, list.id, d, a, [a, b, c, d], testInfo);
    console.log(`step06 drag path: ${path}`);
    // The drop lands on the upper part of the first row: "before it" gives [d, a, b, c]. The spec
    // does not fix drop semantics, so "after it" ([a, d, b, c]) is accepted too.
    await expect
      .poll(async () => {
        const o = JSON.stringify(await apiOrder(api, list.id));
        return o === JSON.stringify([d, a, b, c]) || o === JSON.stringify([a, d, b, c]);
      })
      .toBe(true);
    const apiNow = await apiOrder(api, list.id);
    await expectRowOrder(page, apiNow);
    await page.reload();
    await expectRowOrder(page, apiNow);
  });

  test('dragging the first row onto the last moves it down', async ({ page, api }, testInfo) => {
    const { list, tasks } = await api.makeList('Reorder down', [
      { title: 'Pack the bags' },
      { title: 'Call David Chen' },
      { title: 'Lock the door' },
    ]);
    const [a, b, c] = tasks.map((t) => t.id);
    await gotoList(page, list.id);
    await expectRowOrder(page, [a, b, c]);
    await drag(page, api, list.id, a, c, [a, b, c], testInfo);
    // Either side of the target row is acceptable when moving down.
    await expect
      .poll(async () => {
        const o = JSON.stringify(await apiOrder(api, list.id));
        return o === JSON.stringify([b, a, c]) || o === JSON.stringify([b, c, a]);
      })
      .toBe(true);
    const apiNow = await apiOrder(api, list.id);
    await expectRowOrder(page, apiNow);
  });

  test('the handle is hidden in other sorts', async ({ page, api }) => {
    const { list, tasks } = await api.makeList('Sorted', [{ title: 'Beta task' }, { title: 'Alpha task' }]);
    await gotoList(page, list.id);
    await expect(page.getByTestId(`drag-handle-${tasks[0].id}`)).toBeVisible();
    await selectFlexible(page.getByTestId('sort-select'), 'title');
    await expect(page.getByTestId(`drag-handle-${tasks[0].id}`)).toBeHidden();
    await expect(page.getByTestId(`drag-handle-${tasks[1].id}`)).toBeHidden();
    expect(await rowIdsInOrder(page)).toEqual([tasks[1].id, tasks[0].id]);
  });
});
