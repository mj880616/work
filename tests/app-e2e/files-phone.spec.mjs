import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, phoneFolder } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-51 FILES-통합 3단계 '이 폰'(명진 결정 H-1 모든 파일 접근). S50-33: [최근](H-7 섞기)은 화면에서 뺐다.
// 폰 앱(412, 앱 다리 흉내 + __phone/…/files/ 가로채기 흉내): [이 폰] 아이콘 → 허락 전이면 설정 안내·pfiles:ask → 앱이 '켜짐'을 알리면
// 나무 뿌리 줄에 '이 폰', 폴더 안 목록·미리보기(폰 안에서 읽음),
// 폰 파일 → 원드라이브 [복사]는 올리기 길(upload_open)로. 폰 쪽 쓰기(이름·휴지통)는 이 판에 없다. PC 브라우저에는 '이 폰'이 없다. 파일 이름은 모두 가짜.
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.0';
const KEY = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const root = page => page.locator('#filesRoot');
const chip = (page, name) => root(page).locator(`[data-fx-src="${name}"]`);
const tree = page => root(page).locator('[data-fx-tree]');
const list = page => root(page).locator('[data-fx-list]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.FILES_PHONE_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

// 폰 저장 공간 흉내(앱이 답하는 모양: p·n·d·s·m·t). 시계는 2026-10-06 10:00 서울.
const ms = iso => Date.parse(iso);
const PHONE = {
  '': [
    { p: 'Download', n: 'Download', d: true, s: 0, m: ms('2026-10-06T00:30:00Z') },
    { p: 'Documents', n: 'Documents', d: true, s: 0, m: ms('2026-10-01T00:00:00Z') },
  ],
  Download: [
    { p: 'Download/가짜 회의자료.hwp', n: '가짜 회의자료.hwp', d: false, s: 20480, m: ms('2026-10-06T00:30:00Z'), t: 'application/x-hwp' },
    { p: 'Download/가짜 메모장.txt', n: '가짜 메모장.txt', d: false, s: 12, m: ms('2026-10-02T00:00:00Z'), t: 'text/plain' },
  ],
  Documents: [],
};
const TEXT = '폰 안 가짜 글';

// write = 앱 3-③ 판 흉내(새 폴더·이름·휴지통·받기). 폰 쪽 상태는 Node(st.fs)에 두고 __phone 읽기와 같은 것을 본다.
async function phoneApp(page, { granted = false, write = false } = {}) {
  const st = { reads: [], granted, ops: [], fs: JSON.parse(JSON.stringify(PHONE)), saved: {} };
  if (write) {
    let saving = null;
    const numbered = (dir, name) => { const taken = st.fs[dir].map(e => e.n.toLowerCase()); if (!taken.includes(name.toLowerCase())) return name; const m = /^(.*?)(\.[A-Za-z0-9]{1,10})?$/.exec(name); for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!taken.includes(n.toLowerCase())) return n; } };
    await page.exposeFunction('__pfilesWrite', text => {
      st.ops.push(text.length > 300 ? text.slice(0, 40) + '…' : text);
      const done = o => `pfiles:done:${JSON.stringify({ count: 0, ...o })}`, save = o => `pfiles:save:${JSON.stringify({ got: 0, ...o })}`;
      if (text.startsWith('pfiles:op:')) {
        const o = JSON.parse(text.slice(10));
        if (o.confirm !== true) return done({ ok: false, op: o.op, error: 'bad' });
        if (o.op === 'mkdir') { const p = o.dir ? `${o.dir}/${o.name}` : o.name; st.fs[o.dir || ''].push({ p, n: o.name, d: true, s: 0, m: ms('2026-10-06T00:40:00Z') }); st.fs[p] = []; return done({ ok: true, op: 'mkdir', path: p, count: 1 }); }
        if (o.op === 'rename') { const dir = o.path.replace(/\/[^/]*$/, ''); const e = st.fs[dir].find(x => x.p === o.path); e.n = o.name; e.p = `${dir}/${o.name}`; return done({ ok: true, op: 'rename', path: e.p, count: 1 }); }
        if (o.op === 'trash') { for (const p of o.paths) { const dir = p.replace(/\/[^/]*$/, ''); st.fs[dir] = st.fs[dir].filter(x => x.p !== p); } return done({ ok: true, op: 'trash', count: o.paths.length }); }
        return done({ ok: false, op: o.op, error: 'bad' });
      }
      if (text.startsWith('pfiles:save:begin:')) { const o = JSON.parse(text.slice(18)); if (o.confirm !== true) return save({ ok: false, step: 'begin', error: 'bad' }); saving = { ...o, parts: [] }; return save({ ok: true, step: 'begin' }); }
      if (text.startsWith('pfiles:save:part:')) { saving.parts.push(Buffer.from(text.slice(17), 'base64')); return save({ ok: true, step: 'part', got: Buffer.concat(saving.parts).length }); }
      if (text === 'pfiles:save:end') {
        const body = Buffer.concat(saving.parts), name = numbered(saving.dir, saving.name), p = saving.dir ? `${saving.dir}/${name}` : name;
        if (body.length !== saving.size) return save({ ok: false, step: 'end', error: 'size' });
        st.fs[saving.dir].push({ p, n: name, d: false, s: body.length, m: ms('2026-10-06T00:50:00Z'), t: 'text/plain' }); st.saved[p] = body.toString('utf8'); saving = null;
        return save({ ok: true, step: 'end', got: body.length, path: p });
      }
      if (text === 'pfiles:save:cancel') { saving = null; return ''; }
      return '';
    });
  }
  await page.addInitScript(({ key, granted, write }) => {
    const listeners = [];
    window.__pfilesSent = [];
    let all = granted;
    const tell = () => setTimeout(() => listeners.forEach(fn => fn({ data: `pfiles:state:${JSON.stringify(all ? { v: write ? 2 : 1, write, can: true, all: true, key } : { v: 1, can: true, all: false })}` })), 0);
    // 설정에서 '모든 파일 접근'을 켜고 돌아온 것처럼(앱 onResume): 시험이 부르면 켜짐을 알린다.
    window.__pfilesGrant = () => { all = true; tell(); };
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(m) {
        window.__pfilesSent.push(String(m).slice(0, 200));
        if (m === 'pfiles:hello') tell();
        if (write && /^pfiles:(op|save):/.test(m)) window.__pfilesWrite(String(m)).then(reply => { if (reply) listeners.forEach(fn => fn({ data: reply })); });
        prev?.postMessage?.(m);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, { key: KEY, granted, write });
  await page.route('**/__phone/**', r => {
    const u = new URL(r.request().url());
    st.reads.push(u.pathname.replace(/^.*__phone\/[^/]+\//, '') + u.search);
    if (!u.pathname.includes(`/__phone/${KEY}/files/`)) return r.fulfill({ status: 403, json: { error: 'key' } });
    if (u.pathname.endsWith('/files/list')) {
      const dir = u.searchParams.get('dir') || '';
      if (!(dir in st.fs)) return r.fulfill({ status: 404, json: { error: 'not_found' } });
      return r.fulfill({ json: { dir, items: st.fs[dir], more: false } });
    }
    if (u.pathname.endsWith('/files/raw')) {
      const p = u.searchParams.get('path');
      return r.fulfill({ status: 200, contentType: p.endsWith('.txt') ? 'text/plain' : 'application/octet-stream', body: p.endsWith('.txt') ? TEXT : Buffer.alloc(20480, 1) });
    }
    return r.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return st;
}

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('[이 폰] 허락 → 나무 뿌리 줄 · 폴더 목록 · 미리보기 → 원드라이브에 복사(올리기 길) · 끄기', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, 412);
    const st = await phoneApp(page);
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    // 허락 전: 아이콘은 보이지만 꺼짐, 나무에는 클라우드 뿌리 둘만(S50-33: 첫 화면은 나무).
    const roots = tree(page).locator('.fx-root, [data-fx-box-tog]');
    await expect(chip(page, 'ph')).toBeVisible();
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await expect(roots).toHaveCount(2);
    expect(st.reads).toEqual([]);
    // 누르면 설정 안내 한 줄 + 앱에 pfiles:ask → 앱이 켜짐을 알리면 아이콘 켜짐, 나무 뿌리 줄에 '이 폰'.
    await chip(page, 'ph').click();
    await expect(root(page).locator('[data-fx-note]')).toHaveText("설정에서 '모든 파일 접근 허용'을 켜고 돌아오세요");
    await expect.poll(() => page.evaluate(() => window.__pfilesSent)).toContain('pfiles:ask');
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => window.__pfilesGrant());
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    await expect(root(page).locator('[data-fx-note]')).toBeHidden();

    // 나무 뿌리 줄 셋(원드라이브·구글 드라이브·이 폰), '이 폰'을 펼치면 폰 폴더.
    await expect(roots).toHaveCount(3);
    await expect(roots.nth(2)).toContainText('이 폰');
    // FOLDER-나무새기준 ②: 폰 나무는 저장소마다 상자, 폴더 목록(그 폴더만)은 두 손가락 벌리기.
    await expect(tree(page).locator('[data-fx-fold="ph:Download"]')).toBeVisible();
    await phoneFolder(page, 'ph', 'Download');
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]')).toBeVisible();
    await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('Download');
    // S51-24: 폰 '그 폴더만'의 위치 줄은 상자 맨 위.
    await expect(root(page).locator('[data-fx-list] .ft-focus-anc')).toContainText('이 폰');
    // 폰 목록은 서버로 보내지 않는다: Edge·RPC 몸통 어디에도 폰 경로가 없다.
    expect(JSON.stringify(server.calls)).not.toContain('가짜 메모장');
    // 폰 폴더에서는 [새 폴더]·[올리기]가 없다(이 판은 폰 쪽 쓰기 없음).
    await expect(root(page).locator('[data-fx-mkdir]')).toBeHidden();
    await expect(root(page).locator('[data-fx-upload]')).toBeHidden();
    await shot(page, 'files-phone-folder-412');

    // 미리보기: 글은 폰 안에서 읽는다(Edge media를 부르지 않음). 폰 파일은 [받기]·[클라우드에 복사]만(이름·휴지통 없음).
    await list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]').click();
    const prev = root(page).locator('[data-fx-prev]');
    await expect(prev.locator('.fx-pv-text')).toHaveText(TEXT);
    expect(edgeCalls(server, 'media')).toEqual([]);
    expect(st.reads).toContain('files/raw?path=Download%2F%EA%B0%80%EC%A7%9C+%EB%A9%94%EB%AA%A8%EC%9E%A5.txt');
    await expect(prev.locator('[data-fx-rename-one]')).toHaveCount(0);
    // S53-12: [휴지통]은 숨기지 않고 흐리게(폰에 쓸 수 없는 판) — 누르면 이유 한 줄만, 폰 앱에 지우기를 보내지 않는다.
    await expect(prev.locator('[data-fx-trash-one]')).toHaveAttribute('aria-disabled', 'true');
    await expect(prev.locator('[data-fx-trash-one]')).toHaveAttribute('data-fx-off', 'ph');
    await expect(prev.locator('[data-fx-open]')).toHaveCount(0);
    await expect(prev.locator('[data-fx-star-one]')).toHaveCount(0);
    await shot(page, 'files-phone-preview-412');

    // 폰 → 원드라이브 복사: 받을 곳 창에는 클라우드만, 고른 폴더에 upload_open(같은 이름 묻기·전송 목록은 올리기 길 그대로).
    await prev.locator('[data-fx-copy-one]').click();
    const sheet = root(page).locator('[data-fx-dest]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-fx-dest-pick^="ph:"]')).toHaveCount(0);
    await sheet.locator('[data-fx-dest-pick="od:"]').first().click();
    await sheet.locator('[data-fx-dest-go]').click();
    await expect.poll(() => edgeCalls(server, 'upload_open').length).toBe(1);
    expect(edgeCalls(server, 'upload_open')[0].body).toEqual({ action: 'upload_open', confirm: true, to_source: 'od', to: null, name: '가짜 메모장.txt', size: Buffer.byteLength(TEXT), mime: 'text/plain' });
    await expect.poll(() => server.jobs.filter(j => j.status === 'done').length, { timeout: 15000 }).toBe(1);
    // 조각은 클라우드 자리로 바로(토큰 없음).
    expect(server.puts.length).toBeGreaterThan(0);
    expect(server.puts.every(p => !p.auth)).toBe(true);

    // [이 폰] 끄기(이번 접속): 보던 폰 폴더는 닫히고 나무로, 나무에서 빠진다.
    await prev.locator('[data-fx-close]').click();
    await expect(prev).toBeHidden();
    await chip(page, 'ph').click();
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await expect(tree(page)).toBeVisible();
    await expect(tree(page).locator('.fx-root, [data-fx-box-tog]')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('앱 3-③ 판: 폰 새 폴더 · 이름 바꾸기 · 휴지통(확인 한 번) · 원드라이브 → 폰 받기(같은 이름 번호)', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, 412);
    const st = await phoneApp(page, { granted: true, write: true });
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    await phoneFolder(page, 'ph', 'Download');
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]')).toBeVisible();
    const ask = page.locator('.kptu-ask');
    // 새 폴더: 폰 폴더에서도 [새 폴더] → 이름 → 앱에 confirm:true로.
    await root(page).locator('[data-fx-mkdir]').click();
    await ask.locator('.kptu-ask-field').fill('가짜 새 폴더');
    await ask.getByRole('button', { name: '만들기' }).click();
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 새 폴더"]')).toBeVisible();
    expect(st.ops[0]).toBe('pfiles:op:{"op":"mkdir","dir":"Download","name":"가짜 새 폴더","confirm":true}');
    // 이름 바꾸기(미리보기 [이름]).
    await list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]').click();
    const prev = root(page).locator('[data-fx-prev]');
    await prev.locator('[data-fx-rename-one]').click();
    await ask.locator('.kptu-ask-field').fill('가짜 새 메모');
    await ask.getByRole('button', { name: '바꾸기' }).click();
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 새 메모.txt"]')).toBeVisible();
    await expect(prev).toBeHidden();
    expect(st.ops[1]).toBe('pfiles:op:{"op":"rename","path":"Download/가짜 메모장.txt","name":"가짜 새 메모.txt","confirm":true}');
    // 휴지통: 확인 한 번(폰 휴지통 안내) → 앱 휴지통 요청.
    await list(page).locator('[data-fx-row="ph:Download/가짜 회의자료.hwp"]').click();
    await prev.locator('[data-fx-trash-one]').click();
    await expect(ask).toContainText("'가짜 회의자료.hwp'을(를) 휴지통으로 보낼까요?");
    await expect(ask).toContainText('폰 휴지통');
    await ask.getByRole('button', { name: '휴지통으로' }).click();
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 회의자료.hwp"]')).toHaveCount(0);
    expect(st.ops[2]).toBe('pfiles:op:{"op":"trash","paths":["Download/가짜 회의자료.hwp"],"confirm":true}');
    await shot(page, 'files-phone-write-412');

    // 원드라이브 → 폰 받기: 원드라이브 '가짜 메모.txt'를 폰 Download로 두 번(두 번째는 같은 이름 → [그래도 하기] → 번호).
    for (const round of [1, 2]) {
      // 목록에서 ‹ 를 눌러 나무까지(한 단계씩).
      for (let i = 0; i < 4 && !(await tree(page).isVisible()); i++) await root(page).locator('[data-fx-up]').click();
      await expect(tree(page)).toBeVisible();
      await phoneFolder(page, 'od');
      await list(page).locator('[data-fx-row="od:OD!1"]').click();
      await list(page).locator('[data-fx-row="od:OD!13"]').click();
      await prev.locator('[data-fx-copy-one]').click();
      const sheet = root(page).locator('[data-fx-dest]');
      await expect(sheet.locator('[data-fx-dest-pick="ph:"]')).toBeVisible();
      // 받을 곳 창은 켜진 저장소 맨 위를 펼친 채 연다('이 폰'도).
      await sheet.locator('[data-fx-dest-pick="ph:Download"]').click();
      await sheet.locator('[data-fx-dest-go]').click();
      if (round === 2) {
        const box = root(page).locator('[data-fx-askbox] .fx-ask');
        await expect(box).toContainText('가짜 메모.txt — 같은 이름이 있어요. 그래도 받을까요?');
        await box.getByRole('button', { name: '그래도 하기' }).click();
      }
      await expect.poll(() => Object.keys(st.saved).length).toBe(round);
      await prev.locator('[data-fx-close]').click();
    }
    expect(st.saved).toEqual({ 'Download/가짜 메모.txt': '가짜 메모 첫 줄\n둘째 줄', 'Download/가짜 메모 (2).txt': '가짜 메모 첫 줄\n둘째 줄' });
    expect(edgeCalls(server, 'media').length).toBe(4); // 미리보기(글 앞부분) 2번 + 받기 2번
    // 폰 폴더 경로는 서버에 기억하지 않는다('최근 보낸 곳'은 클라우드만), 클라우드 쓰기도 없음.
    expect(JSON.stringify(server.calls)).not.toContain('Download');
    expect(edgeCalls(server, 'job_add')).toEqual([]);
    expect(st.ops.filter(o => o.startsWith('pfiles:save:begin:'))).toEqual([
      'pfiles:save:begin:{"dir":"Download","name":"가짜 메모.txt","size":' + Buffer.byteLength('가짜 메모 첫 줄\n둘째 줄') + ',"confirm":true}',
      'pfiles:save:begin:{"dir":"Download","name":"가짜 메모.txt","size":' + Buffer.byteLength('가짜 메모 첫 줄\n둘째 줄') + ',"confirm":true}']);
    expect(errors).toEqual([]);
  });

  // S52-43 ② FILES-저장소사이: 폰 ↔ 클라우드 옮기기 = 복사한 뒤 원본을 휴지통으로(폰 → 클라우드는 서버가 올린 파일을 맞춘 뒤에만 폰 휴지통).
  test('앱 3-③ 판: 폰 파일 [옮기기] → 원드라이브(올린 뒤 폰 휴지통), 원드라이브 파일 [옮기기] → 이 폰(받은 뒤 원드라이브 휴지통)', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, 412);
    const st = await phoneApp(page, { granted: true, write: true });
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await phoneFolder(page, 'ph', 'Download');
    await list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]').click();
    const prev = root(page).locator('[data-fx-prev]');
    await expect(prev.locator('[data-fx-cut-one]')).toHaveText('옮기기');
    await prev.locator('[data-fx-cut-one]').click();
    const sheet = root(page).locator('[data-fx-dest]');
    // S53-8: 폰에 쓸 수 있으면 받을 곳에 이 폰도(폰 안끼리 옮기기). 여기서는 원드라이브로.
    await expect(sheet.locator('[data-fx-dest-pick="ph:"]')).toBeVisible();
    await sheet.locator('[data-fx-dest-pick="od:"]').first().click();
    await sheet.locator('[data-fx-dest-go]').click();
    await expect.poll(() => server.jobs.filter(j => j.status === 'done').length, { timeout: 15000 }).toBe(1);
    await expect.poll(() => st.ops.filter(o => o.startsWith('pfiles:op:'))).toEqual(['pfiles:op:{"op":"trash","paths":["Download/가짜 메모장.txt"],"confirm":true}']);
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]')).toHaveCount(0);
    // 원드라이브 → 이 폰 옮기기: 폰에 다 쓴 것만 원드라이브 휴지통으로.
    for (let i = 0; i < 4 && !(await tree(page).isVisible()); i++) await root(page).locator('[data-fx-up]').click();
    await phoneFolder(page, 'od');
    await list(page).locator('[data-fx-row="od:OD!1"]').click();
    await list(page).locator('[data-fx-row="od:OD!13"]').click();
    await prev.locator('[data-fx-cut-one]').click();
    await sheet.locator('[data-fx-dest-pick="ph:Download"]').click();
    await sheet.locator('[data-fx-dest-go]').click();
    await expect.poll(() => Object.keys(st.saved)).toEqual(['Download/가짜 메모.txt']);
    await expect.poll(() => edgeCalls(server, 'trash').map(c => c.body)).toEqual([{ action: 'trash', source: 'od', ids: ['OD!13'], confirm: true }]);
    expect(JSON.stringify(server.calls)).not.toContain('Download');
    expect(errors).toEqual([]);
  });

  // S53-8 FILES-폴더째PC폰: 원드라이브 폴더 → 이 폰 폴더째 복사(폰에 같은 폴더 모양을 만들고 안의 파일을 차례로),
  //   이 폰 폴더 → 원드라이브 폴더째 옮기기(받는 쪽 mkdir + 안의 파일을 올리기 길로, 다 맞춰진 뒤에만 폰 원본 휴지통). 폰 경로는 서버로 가지 않는다.
  test('앱 3-③ 판: 원드라이브 폴더 → 이 폰 폴더째 복사, 이 폰 폴더 → 원드라이브 폴더째 옮기기', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, 412);
    const st = await phoneApp(page, { granted: true, write: true });
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    const menu = page.locator('#rowMenu'), sheet = root(page).locator('[data-fx-dest]');
    // ① 원드라이브 '가짜 문서함'(안에 파일 3개 + 하위 폴더 '가짜 2026'에 1개) ⋯ [복사] → 이 폰 Download.
    await tree(page).locator('[data-fx-fold="od:OD!1"] [data-fx-tmenu]').click();
    await expect(menu.getByRole('button', { name: '자료실로 보내기' })).toBeVisible();
    await menu.getByRole('button', { name: '복사', exact: true }).click();
    await sheet.locator('[data-fx-dest-pick="ph:Download"]').click();
    await sheet.locator('[data-fx-dest-go]').click();
    await expect.poll(() => Object.keys(st.saved).sort(), { timeout: 30000 }).toEqual([
      'Download/가짜 문서함/가짜 2026/가짜 계획안.hwpx', 'Download/가짜 문서함/가짜 메모.txt', 'Download/가짜 문서함/가짜 안내문.pdf', 'Download/가짜 문서함/가짜 예산표.xlsx']);
    expect(st.ops.filter(o => o.includes('"op":"mkdir"'))).toEqual([
      'pfiles:op:{"op":"mkdir","dir":"Download","name":"가짜 문서함","confirm":true}',
      'pfiles:op:{"op":"mkdir","dir":"Download/가짜 문서함","name":"가짜 2026","confirm":true}']);
    await expect(page.locator('#kptuNotice')).toContainText('폴더 2개 · 파일 4개 복사함');
    // 복사라 원드라이브 원본은 그대로(휴지통 요청 없음).
    expect(edgeCalls(server, 'trash')).toEqual([]);
    // ② 이 폰 'Documents'에 파일 두 개를 두고 ⋯ [옮기기] → 원드라이브 맨 위.
    st.fs.Documents.push({ p: 'Documents/가짜 하나.txt', n: '가짜 하나.txt', d: false, s: Buffer.byteLength(TEXT), m: ms('2026-10-02T00:00:00Z'), t: 'text/plain' },
      { p: 'Documents/가짜 둘.txt', n: '가짜 둘.txt', d: false, s: Buffer.byteLength(TEXT), m: ms('2026-10-02T00:00:00Z'), t: 'text/plain' });
    await tree(page).locator('[data-fx-fold="ph:Documents"] [data-fx-tmenu]').click();
    await menu.getByRole('button', { name: '옮기기', exact: true }).click();
    await sheet.locator('[data-fx-dest-pick="od:"]').first().click();
    await sheet.locator('[data-fx-dest-go]').click();
    await expect.poll(() => edgeCalls(server, 'mkdir').map(c => c.body), { timeout: 30000 }).toEqual([{ action: 'mkdir', source: 'od', parent: null, name: 'Documents', confirm: true }]);
    await expect.poll(() => edgeCalls(server, 'upload_open').map(c => [c.body.to, c.body.name]).sort(), { timeout: 30000 }).toEqual([['OD!90', '가짜 둘.txt'], ['OD!90', '가짜 하나.txt']]);
    await expect.poll(() => server.jobs.filter(j => j.origin === 'device' && j.status === 'done').length, { timeout: 30000 }).toBe(2);
    // 둘 다 맞춰진 뒤에만 폰 원본을 휴지통으로(한 번에).
    await expect.poll(() => st.ops.filter(o => o.includes('"op":"trash"')).map(o => JSON.parse(o.slice(10)).paths.sort())).toEqual([['Documents/가짜 둘.txt', 'Documents/가짜 하나.txt']]);
    expect(st.fs.Documents).toEqual([]);
    expect(JSON.stringify(server.calls)).not.toContain('Documents/');
    expect(errors).toEqual([]);
  });

  test('이미 허락된 앱: 열자마자 나무 뿌리에 이 폰, 폰을 못 읽으면 목록에 한 줄 안내', async ({ page }) => {
    const { errors } = await start(page, 412);
    await phoneApp(page, { granted: true });
    await page.route('**/__phone/**/files/list*', r => r.fulfill({ status: 403, json: { error: 'permission' } }));
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    await expect(tree(page).locator('.fx-root, [data-fx-box-tog]')).toHaveCount(3);
    await phoneFolder(page, 'ph');
    await expect(list(page)).toContainText('폰 저장 공간 허락이 꺼져 있어요(설정 › 모든 파일 접근)');
    expect(errors).toEqual([]);
  });
});

test('PC 1440 브라우저: [이 폰] 아이콘이 없고 폰 다리를 부르지 않는다', async ({ page }) => {
  const { errors } = await start(page, 1440);
  const reads = [];
  await page.route('**/__phone/**', r => { reads.push(r.request().url()); return r.fulfill({ status: 404, body: '' }); });
  await installViewPrefsServer(page);
  await page.reload();
  await openFiles(page, 1440);
  await expect(chip(page, 'od')).toBeVisible();
  await expect(chip(page, 'ph')).toBeHidden();
  await expect(tree(page).locator('.fx-root, [data-fx-box-tog]')).toHaveCount(2);
  expect(reads).toEqual([]);
  expect(errors).toEqual([]);
});
