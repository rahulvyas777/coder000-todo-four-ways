import { test, expect, gotoList, revealRow } from '../fixtures';
import * as fs from 'fs';

test.describe('Step 12: Import and export', { tag: '@step12' }, () => {
  test('export-json downloads <list>.json with the list name and its tasks', async ({ page, api }) => {
    const expected = JSON.parse((await api.exportRaw(1, 'json')).body) as { name: string; tasks: { title: string }[] };
    await gotoList(page, 1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    expect(download.suggestedFilename()).toBe('Work.json');
    const file = await download.path();
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { name: string; tasks: { title: string }[] };
    expect(data.name).toBe('Work');
    expect(data.tasks.length).toBe(expected.tasks.length);
    expect(data.tasks.map((t) => t.title)).toEqual(expected.tasks.map((t) => t.title));
  });

  test('export-csv downloads <list>.csv with the header line', async ({ page, api }) => {
    const expected = (await api.exportRaw(2, 'csv')).body;
    await gotoList(page, 2);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    expect(download.suggestedFilename()).toBe('Home.csv');
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(text.split(/\r?\n/)[0]).toBe('title,notes,dueDate,priority,tags,completed,repeat');
    expect(text.split(/\r?\n/).filter((l) => l.length > 0).length).toBe(expected.split(/\r?\n/).filter((l) => l.length > 0).length);
  });

  test('import-input posts a JSON file and selects the new list', async ({ page, api }, testInfo) => {
    const payload = {
      name: 'Imported by Yuki Tanaka',
      tasks: [
        { title: 'Send the slides to David Chen', notes: 'PDF, not PPTX', priority: 2, tags: ['email'] },
        { title: 'Book the meeting room', dueDate: '2030-01-15', completed: false },
        { title: 'Old item', completed: true },
      ],
    };
    const file = testInfo.outputPath('import.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    const before = (await api.lists()).map((l) => l.id);
    await gotoList(page, 1);
    await page.getByTestId('import-input').setInputFiles(file);
    let newId = 0;
    await expect
      .poll(async () => {
        const l = (await api.lists()).find((x) => !before.includes(x.id) && x.name === 'Imported by Yuki Tanaka');
        newId = l?.id ?? 0;
        return newId > 0;
      })
      .toBe(true);
    await expect(page).toHaveURL(new RegExp(`/lists/${newId}(\\?|$)`));
    await expect(page.getByTestId(`list-item-${newId}`)).toContainText('Imported by Yuki Tanaka');
    const tasks = await api.tasks(newId);
    expect(tasks.map((t) => t.title)).toEqual(['Send the slides to David Chen', 'Book the meeting room', 'Old item']);
    await revealRow(page, tasks[0].id);
    await expect(page.getByTestId(`task-title-${tasks[0].id}`)).toHaveText('Send the slides to David Chen');
  });
});
