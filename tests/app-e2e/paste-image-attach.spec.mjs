import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// UPD-그림붙여넣기: Ctrl+V of a picture and dropping a file take the same road as the clip in every input with attachments.
// A paste/drop only fills the file list (preview rows with ×); nothing is saved until [추가].
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch: true});
const pasteInto = (locator, {files = [], text = ''} = {}) => locator.evaluate((el, {files, text}) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10])], f.name, {type: f.type}));
  if (text) dt.setData('text/plain', text);
  el.focus();
  const event = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
  el.dispatchEvent(event);
  return event.defaultPrevented;
}, {files, text});
const dropOn = (locator, names) => locator.evaluate((el, names) => {
  const dt = new DataTransfer();
  for (const n of names) dt.items.add(new File(['x'], n, {type: 'application/pdf'}));
  for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true}));
}, names);
const shot = {name: 'image.png', type: 'image/png'};
const NAME = /^붙여넣은 그림 \d\d-\d\d \d\d:\d\d(?: \(\d+\))?\.png$/;

for (const width of [412, 1440]) test(`paste and drop fill the attach list in every attach input ${width}`, async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width, height: 900});
  await openHome(page, {beforeLoad: () => page.route('**/rest/v1/app_task_attachments**', r => r.fulfill({json: []}))});
  await page.route(SB + '/rest/v1/app_notes**', r => r.request().method() === 'GET' ? r.fulfill({json: []}) : r.fallback());

  const home = page.locator('#homeView [data-home-quick]');
  const input = home.locator('[data-quick-input]');
  const rows = home.locator('[data-basket-file]');
  // 1. a picture alone: goes in the list, no letters, named by the minute.
  await input.click();
  expect(await pasteInto(input, {files: [shot]})).toBe(true);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('b')).toHaveText(NAME);
  await expect(input).toHaveValue('');
  // 2. several in a row: all kept, names never repeat.
  await pasteInto(input, {files: [shot, shot]});
  await expect(rows).toHaveCount(3);
  const names = await rows.locator('b').allTextContents();
  expect(new Set(names).size).toBe(3);
  // 3. letters together with a picture: the paste is not stopped (letters go in by default), the picture is added.
  expect(await pasteInto(input, {files: [shot], text: '글'})).toBe(false);
  await expect(rows).toHaveCount(4);
  // 4. letters alone are left alone.
  expect(await pasteInto(input, {text: '그냥 글'})).toBe(false);
  await expect(rows).toHaveCount(4);
  // 5. × takes one out.
  await rows.nth(0).locator('[data-basket-remove]').click();
  await expect(rows).toHaveCount(3);
  // 6. drop of a file lands in the same list.
  await dropOn(home, ['공문.pdf']);
  await expect(rows).toHaveCount(4);
  await expect(rows.last().locator('b')).toHaveText('공문.pdf');
  // 7. over the 20 limit: refused with the existing line, nothing added.
  for (let i = 0; i < 4; i++) await pasteInto(input, {files: Array.from({length: 4}, () => shot)});
  await expect(rows).toHaveCount(20);
  await pasteInto(input, {files: [shot]});
  await expect(rows).toHaveCount(20);
  await expect(home.locator('[data-quick-status]')).toContainText('20개');

  while (await rows.count()) await rows.first().locator('[data-basket-remove]').click();
  // 8. the 할 일 mode of the same box (task-file table answered empty) takes it too.
  await home.locator('[data-quick-mode="task"]').click();
  await expect(home.locator('[data-quick-file-picker]')).toBeVisible();
  await pasteInto(input, {files: [shot]});
  await expect(home.locator('[data-basket-file]')).toHaveCount(1);

  // 9. the 노트 입력 on the basket note list.
  await page.evaluate(() => window.KPTURouter.go('basket'));
  const basket = page.locator('#basketView [data-home-quick]:visible').first();
  await pasteInto(basket.locator('[data-quick-input]'), {files: [shot]});
  await expect(basket.locator('[data-basket-file]')).toHaveCount(1);
  await expect(basket.locator('[data-basket-file] b')).toHaveText(NAME);

  await basket.locator('[data-basket-remove]').click();
  // 10. the [할 일] screen's own input.
  await page.evaluate(() => window.KPTURouter.go('tasks'));
  const tasks = page.locator('#tasksView .home-quick[data-home-quick]');
  await expect(tasks.locator('[data-quick-file-picker] .basket-clip')).toBeVisible({timeout: 20000});
  await pasteInto(tasks.locator('[data-quick-input]'), {files: [shot]});
  await expect(tasks.locator('[data-basket-file]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

// The window parts (자료실 등록·회의 = bindDropTarget, 할 일 추가 창 = mountNewTaskFilePick, 할 일 수정 창 = mountTaskAttach): a paste with the cursor in the window.
for (const width of [412, 1440]) test(`window parts take a pasted picture ${width}`, async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width, height: 900});
  await openHome(page);
  const result = await page.evaluate(async () => {
    const out = {};
    const fire = (el, files, text = '') => {
      const dt = new DataTransfer();
      for (const n of files) dt.items.add(new File(['x'], n, {type: 'image/png'}));
      if (text) dt.setData('text/plain', text);
      const e = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
      el.dispatchEvent(e); return e.defaultPrevented;
    };
    const mk = () => { const w = document.createElement('div'); w.className = 'modal-card'; const t = document.createElement('textarea'); w.append(t); document.body.append(w); return {w, t}; };
    // bindDropTarget (library upload, meeting windows)
    { const {w, t} = mk(), got = []; let can = true;
      (await import('/app/meeting-compact.js')).bindDropTarget(w, files => got.push(...files.map(f => f.name)), () => can);
      fire(t, ['image.png']); can = false; fire(t, ['image.png']);
      out.drop = got; }
    // mountNewTaskFilePick (task add window)
    { const {w, t} = mk(), host = document.createElement('div'); w.append(host);
      const m = await import('/app/task-files.js'), errs = [];
      const pick = m.mountNewTaskFilePick(host, {onError: x => errs.push(x)}); pick.show(true);
      fire(t, ['image.png']); fire(t, ['image.png']);
      out.pick = pick.files().map(f => f.name); out.pickErr = errs.filter(Boolean);
      pick.show(false); fire(t, ['image.png']); out.pickHidden = pick.files().length; }
    // mountTaskAttach (task edit window): adds, never replaces a row
    { const {w, t} = mk(), host = document.createElement('div'); w.append(host);
      const m = await import('/app/task-files.js');
      const att = m.mountTaskAttach(host);
      att.set([{drive_file_id: 'd1', file_name: '기존.pdf', inTable: true}], {editable: true, shown: true, taskId: 't1'});
      fire(t, ['image.png']);
      const plan = att.plan(); out.attach = {add: plan.add.map(f => f.name), swap: plan.swap.length, remove: plan.remove.length}; }
    return out;
  });
  expect(result.drop).toHaveLength(1);
  expect(result.drop[0]).toMatch(NAME);
  expect(result.pick).toHaveLength(2);
  for (const n of result.pick) expect(n).toMatch(NAME);
  expect(new Set(result.pick).size).toBe(2);
  expect(result.pickHidden).toBe(0);
  expect(result.attach.add).toHaveLength(1);
  expect(result.attach.add[0]).toMatch(NAME);
  expect(result.attach.swap + result.attach.remove).toBe(0);
  expect(errors).toEqual([]);
});
