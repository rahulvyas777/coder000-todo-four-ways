// Shared fixtures and helpers. Every test starts from the seed: the auto fixture below calls
// POST /api/admin/reset before the test body runs. Elements are located only by data-testid
// (the names in SPEC.md) and by visible text.
import { test as base, expect, Locator, Page } from '@playwright/test';
import { Api } from './api';

export { expect } from '@playwright/test';
export * from './api';

type Fixtures = { api: Api; resetSeed: void };

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    const url = process.env.API_URL;
    if (!url) throw new Error('API_URL is not set');
    await use(new Api(request, url));
  },
  // Runs before every test, before the page is opened.
  resetSeed: [
    async ({ api, page }, use) => {
      await api.reset();
      // A native confirm() (list delete) is accepted; in-page confirms are handled by confirmIfAsked.
      page.on('dialog', (d) => {
        void d.accept();
      });
      await use();
    },
    { auto: true },
  ],
});

/** The last integer in a text, commas removed: "Today 3" -> 3, "(12)" -> 12. */
export function lastInt(text: string): number | null {
  const m = text.replace(/,/g, '').match(/\d+/g);
  return m ? Number(m[m.length - 1]) : null;
}

/** Parses "N of M open" (either number may carry thousands separators). */
export function parseTaskCount(text: string): { open: number; total: number } | null {
  const m = text.replace(/,/g, '').match(/(\d+)\s+of\s+(\d+)\s+open/i);
  return m ? { open: Number(m[1]), total: Number(m[2]) } : null;
}

export async function gotoList(page: Page, listId: number, query = ''): Promise<void> {
  await page.goto(`/lists/${listId}${query}`);
  await expect(page.getByTestId('rows-container')).toBeVisible();
}

/** Ids of the task rows currently rendered and visible, in on-screen order (top to bottom). */
export async function rowIdsInOrder(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const out: { id: number; top: number }[] = [];
    document.querySelectorAll('[data-testid^="task-row-"]').forEach((el) => {
      const tid = el.getAttribute('data-testid') || '';
      const m = /^task-row-(\d+)$/.exec(tid);
      if (!m) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el as HTMLElement);
      if (r.height === 0 || style.display === 'none' || style.visibility === 'hidden') return;
      out.push({ id: Number(m[1]), top: r.top });
    });
    out.sort((a, b) => a.top - b.top);
    return out.map((o) => o.id);
  });
}

/** Waits until the visible rows are exactly these ids in this order. */
export async function expectRowOrder(page: Page, ids: number[], message?: string): Promise<void> {
  await expect.poll(() => rowIdsInOrder(page), { message: message ?? 'row order' }).toEqual(ids);
}

/**
 * Brings a row into view in the rows container. Works for windowed lists too: when the row is
 * not in the DOM, the container is scrolled from the top in steps until the row renders.
 */
export async function revealRow(page: Page, id: number): Promise<Locator> {
  const row = page.getByTestId(`task-row-${id}`);
  const container = page.getByTestId('rows-container');
  await expect(container).toBeVisible();
  try {
    await row.waitFor({ state: 'attached', timeout: 3000 });
  } catch {
    await container.evaluate((el) => (el.scrollTop = 0));
    for (let i = 0; i < 200; i++) {
      try {
        await row.waitFor({ state: 'attached', timeout: 250 });
        break;
      } catch {
        const atEnd = await container.evaluate((el) => {
          const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          el.scrollTop += Math.max(40, Math.floor(el.clientHeight * 0.8));
          return end;
        });
        if (atEnd) break;
      }
    }
  }
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  return row;
}

/** Selects an option of a native select by value, or by label (case-insensitive). */
export async function selectFlexible(select: Locator, wanted: string): Promise<void> {
  const options = await select.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, label: o.label.trim() })),
  );
  const w = wanted.toLowerCase();
  const hit =
    options.find((o) => o.value === wanted) ??
    options.find((o) => o.label.toLowerCase() === w) ??
    options.find((o) => o.value.toLowerCase() === w) ??
    options.find((o) => o.label.toLowerCase().startsWith(w));
  if (!hit) throw new Error(`No option "${wanted}" in ${JSON.stringify(options)}`);
  await select.selectOption({ value: hit.value });
}

/** The value of an input/textarea/select, or the text of anything else. */
export async function valueOrText(loc: Locator): Promise<string> {
  return loc.evaluate((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return el.value;
    }
    return (el.textContent || '').trim();
  });
}

/** Moves focus out of any input so single-key shortcuts reach the app. */
export async function blurAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body) a.blur();
  });
}

/**
 * After a destructive click: if the change has not happened within two seconds, a client may be
 * showing an in-page confirm; click its button (Delete, Confirm, Yes or OK inside a dialog).
 * Native confirm() is accepted by the fixture.
 */
export async function confirmIfAsked(page: Page, done: () => Promise<boolean>): Promise<void> {
  try {
    await expect.poll(done, { timeout: 2000 }).toBe(true);
    return;
  } catch {
    const btn = page
      .getByRole('dialog')
      .or(page.getByRole('alertdialog'))
      .getByRole('button', { name: /^(delete|confirm|yes|ok)$/i });
    await btn.first().click();
    await expect.poll(done).toBe(true);
  }
}

/** Replaces the text of the focused field (inline editors) and presses a key. */
export async function retypeFocused(page: Page, text: string, key: 'Enter' | 'Escape'): Promise<void> {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press(key);
}
