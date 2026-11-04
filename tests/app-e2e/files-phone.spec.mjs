import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-51 FILES-통합 3단계 '이 폰'(명진 결정 H-1 모든 파일 접근, H-7 [최근]에 폰 파일도 같이·줄마다 작은 출처 점).
// 폰 앱(412, 앱 다리 흉내 + __phone/…/files/ 가로채기 흉내): [이 폰] 아이콘 → 허락 전이면 설정 안내·pfiles:ask → 앱이 '켜짐'을 알리면
// [최근]에 폰 파일이 클라우드 파일과 바뀐 날 순으로 섞이고(출처 점), [폴더] 나무 맨 위 줄에 '이 폰', 폴더 안 목록·미리보기(폰 안에서 읽음),
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
const RECENT = [PHONE.Download[0], PHONE.Download[1]];
const TEXT = '폰 안 가짜 글';

async function phoneApp(page, { granted = false } = {}) {
  const st = { reads: [], granted };
  await page.addInitScript(({ key, granted }) => {
    const listeners = [];
    window.__pfilesSent = [];
    let all = granted;
    const tell = () => setTimeout(() => listeners.forEach(fn => fn({ data: `pfiles:state:${JSON.stringify(all ? { v: 1, can: true, all: true, key } : { v: 1, can: true, all: false })}` })), 0);
    // 설정에서 '모든 파일 접근'을 켜고 돌아온 것처럼(앱 onResume): 시험이 부르면 켜짐을 알린다.
    window.__pfilesGrant = () => { all = true; tell(); };
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(m) {
        window.__pfilesSent.push(String(m));
        if (m === 'pfiles:hello') tell();
        prev?.postMessage?.(m);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, { key: KEY, granted });
  await page.route('**/__phone/**', r => {
    const u = new URL(r.request().url());
    st.reads.push(u.pathname.replace(/^.*__phone\/[^/]+\//, '') + u.search);
    if (!u.pathname.includes(`/__phone/${KEY}/files/`)) return r.fulfill({ status: 403, json: { error: 'key' } });
    if (u.pathname.endsWith('/files/list')) {
      const dir = u.searchParams.get('dir') || '';
      if (!(dir in PHONE)) return r.fulfill({ status: 404, json: { error: 'not_found' } });
      return r.fulfill({ json: { dir, items: PHONE[dir], more: false } });
    }
    if (u.pathname.endsWith('/files/recent')) return r.fulfill({ json: { items: RECENT } });
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

  test('[이 폰] 허락 → [최근]에 섞임(출처 점) → 나무 맨 위 줄 · 폴더 목록 · 미리보기 → 원드라이브에 복사(올리기 길) · 끄기', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, 412);
    const st = await phoneApp(page);
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    // 허락 전: 아이콘은 보이지만 꺼짐, [최근]에는 클라우드 줄만.
    await expect(chip(page, 'ph')).toBeVisible();
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await expect(list(page).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(list(page).locator('[data-fx-row^="ph:"]')).toHaveCount(0);
    expect(st.reads).toEqual([]);
    // 누르면 설정 안내 한 줄 + 앱에 pfiles:ask → 앱이 켜짐을 알리면 아이콘 켜짐, [최근]에 폰 줄.
    await chip(page, 'ph').click();
    await expect(root(page).locator('[data-fx-note]')).toHaveText("설정에서 '모든 파일 접근 허용'을 켜고 돌아오세요");
    await expect.poll(() => page.evaluate(() => window.__pfilesSent)).toContain('pfiles:ask');
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => window.__pfilesGrant());
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    const phoneRow = list(page).locator('[data-fx-row="ph:Download/가짜 회의자료.hwp"]');
    await expect(phoneRow).toBeVisible();
    await expect(root(page).locator('[data-fx-note]')).toBeHidden();
    // H-7: 바뀐 날 순으로 섞인다(폰 회의자료 10/6 09:30 서울이 맨 위, 원드라이브 예산표 10/6 09:12가 다음). 줄마다 출처 점.
    const keys = await list(page).locator('[data-fx-row]').evaluateAll(els => els.map(e => e.dataset.fxRow));
    expect(keys.slice(0, 2)).toEqual(['ph:Download/가짜 회의자료.hwp', 'od:OD!12']);
    await expect(phoneRow.locator('.fx-dot')).toHaveAttribute('data-src', 'ph');
    await expect(list(page).locator('[data-fx-row="od:OD!12"] .fx-dot')).toHaveAttribute('data-src', 'od');
    await expect(phoneRow).toContainText('이 폰 › Download');
    await shot(page, 'files-phone-recent-412');
    // 폰 목록은 서버로 보내지 않는다: Edge·RPC 몸통 어디에도 폰 경로가 없다.
    expect(JSON.stringify(server.calls)).not.toContain('가짜 회의자료');

    // [폴더]: 나무 맨 위 줄 셋(원드라이브·구글 드라이브·이 폰), '이 폰'을 펼치면 폰 폴더.
    await root(page).locator('[data-fx-tab="folders"]').click();
    const roots = tree(page).locator('.fx-root');
    await expect(roots).toHaveCount(3);
    await expect(roots.nth(2)).toContainText('이 폰');
    await tree(page).locator('[data-fx-twist="ph:"]').click();
    await expect(tree(page).locator('[data-fx-go="ph"][data-fx-id="Download"]')).toBeVisible();
    await tree(page).locator('[data-fx-go="ph"][data-fx-id="Download"]').click();
    await expect(list(page).locator('[data-fx-row="ph:Download/가짜 메모장.txt"]')).toBeVisible();
    await expect(root(page).locator('.fx-crumb-now')).toHaveText('Download');
    await expect(root(page).locator('[data-fx-crumb]')).toContainText('이 폰');
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
    await expect(prev.locator('[data-fx-trash-one]')).toHaveCount(0);
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

    // [이 폰] 끄기(이번 접속): 나무·[최근]에서 빠진다.
    await prev.locator('[data-fx-close]').click();
    await expect(prev).toBeHidden();
    await chip(page, 'ph').click();
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'false');
    await expect(tree(page).locator('.fx-root')).toHaveCount(2);
    await root(page).locator('[data-fx-tab="recent"]').click();
    await expect(list(page).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(list(page).locator('[data-fx-row^="ph:"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('이미 허락된 앱: 열자마자 [최근]에 폰 파일, 폰을 못 읽어도 클라우드 줄은 보이고 한 줄 안내', async ({ page }) => {
    const { errors } = await start(page, 412);
    await phoneApp(page, { granted: true });
    await page.route('**/__phone/**/files/recent*', r => r.fulfill({ status: 403, json: { error: 'permission' } }));
    await installViewPrefsServer(page);
    await page.reload();
    await openFiles(page, 412);
    await expect(chip(page, 'ph')).toHaveAttribute('aria-pressed', 'true');
    await expect(list(page).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(list(page).locator('[data-fx-row^="ph:"]')).toHaveCount(0);
    await expect(root(page).locator('[data-fx-note]')).toHaveText('폰 저장 공간 허락이 꺼져 있어요(설정 › 모든 파일 접근)');
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
  await expect(tree(page).locator('.fx-root')).toHaveCount(2);
  expect(reads).toEqual([]);
  expect(errors).toEqual([]);
});
