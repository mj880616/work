// HELP-그림(S71-33, 명진 11/26 "쓰는법 내용 전체적으로 현황에 맞게 업데이트 / 캡처 등 그림 많이 활용"):
// '쓰는 법' 줄마다 넣는 화면 그림을 찍는다. 공개 저장소이므로 실제 화면이 아니라 흉내 낸 서버·지어낸 자료로 띄운 화면만 찍는다.
// 메뉴 화면을 여는 방법은 메뉴 찾기 시험 표(helpers/menu-find)와 같은 도구를 그대로 쓴다(지어낸 이름만 들어 있음).
// 담당조직 묶음·보고 캘린더 이름도 지어낸 값으로 먼저 깔아 둔다(openHome 기본값 대신 — 같은 쪽 두 번째 설치는 처음 값을 지킨다).
// 찍은 뒤 화면 글자에 시험 자료의 실제 단체 이름이 하나라도 보이면 그림을 쓰지 않고 실패한다.
// 그림: 폰 폭 390 × 720(배율 1.5) → webp(품질 0.7). 크기 상한은 tests/help-shots.test.mjs가 본다.
import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {openHome} from '../helpers/home-entry.mjs';
import {installViewPrefsServer} from '../helpers/view-prefs-server.mjs';
import {OPERATOR_ORG_ORDER, OPERATOR_REPORT_CALENDAR} from '../../org-order-fixture.mjs';
import {TOPIC_IDS, topic} from '../../../app/help-content.mjs';
import {faceOf} from '../../../app/brand/faces.mjs';
import {faceHtml} from '../../../scripts/brand-face.mjs';
import {FORBIDDEN} from '../../../scripts/girok-words-allow.mjs';
import {DEFAULT_STAGES} from '../../../app/org-dispute-stage-model.mjs';
import {bootLibrary, libDoc} from '../helpers/library-folder-server.mjs';
import basket from '../helpers/menu-find/basket.mjs';
import calendar from '../helpers/menu-find/calendar.mjs';
import notes from '../helpers/menu-find/notes.mjs';
import meetings from '../helpers/menu-find/meetings.mjs';
import files from '../helpers/menu-find/files.mjs';
import outside from '../helpers/menu-find/outside.mjs';
import calls from '../helpers/menu-find/calls.mjs';
import telegram from '../helpers/menu-find/telegram.mjs';

const OUT = new URL('../../../app/help-shots/', import.meta.url);
const FAKE_PREFS = {
  org_order: {groups: [{name: '예시 묶음', orgs: ['예시 거래처 A', '예시 거래처 B']}], hidden: []},
  report_calendar: '예시 캘린더',
};
const REAL = [...OPERATOR_ORG_ORDER.groups.flatMap(g => [g.name, ...g.orgs]), ...OPERATOR_ORG_ORDER.hidden, OPERATOR_REPORT_CALENDAR, '노동조합', '철도'];
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const uid = (p, n) => `${p}7057000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 메뉴 찾기 표의 도구 중 자료 이름에 일반 낱말이라도 단체 색이 있는 화면은 여기서 '예시' 이름으로 새로 깐다.
async function openReading(page) {
  const rows = [['예시 기사 제목 하나', 'example.com'], ['예시 칼럼 제목', 'example.org'], ['예시 소식 정리', 'example.net']].map(([title, site], i) => ({
    id: uid('a', i + 1), url: `https://${site}/${i + 1}`, title, site, saved_at: `2026-11-2${i + 1}T01:00:00Z`, read_at: i ? '2026-11-24T02:00:00Z' : null, body_state: 'ok', body_at: '2026-11-21T01:00:10Z', business_area_id: null, updated_at: '2026-11-21T01:00:10Z'}));
  await openHome(page);
  await page.route(SB + '/rest/v1/app_reading_items**', r => { const one = (new URL(r.request().url()).searchParams.get('id') || '').replace(/^eq\./, ''); return r.fulfill({json: one ? rows.filter(x => x.id === one) : rows}); });
  await page.evaluate(() => window.KPTURouter.go('reading'));
  await expect(page.locator('#readingView .rd-row').first()).toBeVisible();
}
async function openBrief(page) {
  const docs = [['예시 계획', '예시 계획.pdf'], ['예시 연구 보고서', '예시 보고서.pdf'], ['예시 편람', '예시 편람.pdf']].map(([title, file_name], i) => ({
    id: uid('d', i + 1), workspace_id: 'w', category: '기타', visibility: 'private', title, file_name, mime_type: 'application/pdf', file_id: 'FILE_' + 'abc'[i].repeat(10), created_at: `2026-10-0${6 - i}T00:00:00Z`}));
  await openHome(page, {beforeLoad: async () => {
    await page.route(SB + '/rest/v1/app_document_briefs**', r => r.fulfill({json: []}));
    await page.route(SB + '/rest/v1/app_library_folders**', r => r.fulfill({json: r.request().method() === 'GET' ? [{id: 'f-brief'}] : []}));
    await page.route(SB + '/rest/v1/app_library_folder_items**', r => r.fulfill({json: docs.map(d => ({document_id: d.id}))}));
    await page.route(SB + '/rest/v1/app_documents?**', r => r.request().method() === 'GET' && new URL(r.request().url()).searchParams.get('id')?.startsWith('in.') ? r.fulfill({json: docs}) : r.fallback());
  }});
  await page.evaluate(() => window.KPTURouter.go('brief'));
  await expect(page.locator('#briefView .br-row').first()).toBeVisible();
}
async function openTeam(page) {
  const owner = 'home-test', stamp = '2026-09-15T01:00:00Z';
  const orgs = ['예시 거래처 A', '예시 거래처 B', '예시 거래처 C'].map((name, i) => ({id: 'o' + i, workspace_id: 'w', name, active: true, created_by: owner, updated_at: stamp}));
  await openHome(page, {features: []});
  await page.route(SB + '/rest/v1/app_suborganizations?**', r => { const id = new URL(r.request().url()).searchParams.get('id'); return r.fulfill({json: id ? orgs.filter(o => 'eq.' + o.id === id) : orgs}); });
  await page.route(SB + '/rest/v1/app_suborganization_assignees?**', r => { const q = new URL(r.request().url()).searchParams; return r.fulfill({json: q.get('user_id') ? [{user_id: owner}] : orgs.map(o => ({organization_id: o.id, user_id: owner}))}); });
  await page.evaluate(() => window.KPTURouter.go('team'));
  await expect(page.locator('#soOrganizationList [data-so-org]').first()).toBeVisible();
}
async function openLibrary(page) {
  const area = (id, name, sort) => ({id, workspace_id: 'workspace-1', name, description: null, parent_id: null, status: 'active', visibility: 'private', owner_id: 'user-1', sort_order: sort, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', metadata: {project_system: 'v2', management_version: 2}});
  await bootLibrary(page, 390, {
    folders: [{id: 'fa', name: '예시 폴더 A'}, {id: 'fb', name: '예시 폴더 B'}],
    docs: [libDoc('d1', 's1', {category: '정책자료', title: '예시 계획안'}), libDoc('d2', 's1', {category: '기타', title: '예시 회의록'}), libDoc('d3', 's2', {category: '기타', title: '예시 안내문'}), libDoc('d4', null, {category: '기타', title: '예시 양식'})],
    init: {spaces: [area('s1', '예시 사업 A', 10), area('s2', '예시 사업 B', 20)]},
  });
}
// 사진: 사진 칸은 차분한 단색 그림(지어낸 것 — 실제 사진 없음).
function solidPng(r, g, b, size = 48) {
  const crc = buf => { let c, k, t = []; for (let n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of buf) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
async function openPhotos(page) {
  const colors = [[164, 190, 205], [190, 205, 170], [214, 196, 170], [182, 172, 205], [205, 178, 178], [170, 200, 196]];
  const OD = ['2026-10-03', '2026-10-03', '2026-10-03', '2026-10-02', '2026-10-02', '2026-10-01'].map((day, i) => ({id: 'O' + i, name: `예시 사진 ${i + 1}.jpg`, day, taken_at: `${day}T0${3 + i}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: `${day}T03:00:00.000Z`, size_bytes: 100}));
  await page.addInitScript(() => { window.KPTUOdWarm = {run: () => null}; });
  await openHome(page, {beforeLoad: async () => {
    for (const t of ['app_diary_stars', 'app_photo_tags', 'app_photo_tag_items']) await page.route(u => u.origin === SB && u.pathname === '/rest/v1/' + t, r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') { const i = Math.max(0, OD.findIndex(o => o.id === body.id)); const [cr, cg, cb] = colors[i % colors.length]; return r.fulfill({status: 200, contentType: 'image/png', body: solidPng(cr, cg, cb)}); }
      if (body.action === 'status') return r.fulfill({json: {configured: true, connected: true, folder: {name: '카메라'}, can_delete: true, whole: true}});
      if (body.action === 'sync') return r.fulfill({json: {more: false, indexing: false, changed: 0}});
      if (body.action === 'library') return r.fulfill({json: {items: body.folder_id ? [] : OD, next_cursor: null, indexing: false}});
      if (body.action === 'months') return r.fulfill({json: {months: {'2026-10': OD.length}, total: OD.length}});
      return r.fulfill({status: 400, json: {error: 'action_invalid'}});
    });
  }});
  if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
  else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', {name: '사진', exact: true}).click(); }
  await expect(page.locator('#photosView')).toBeVisible();
}
// 공통 동작 그림: 잊지 말기 첫 줄을 손가락으로 민 모습(왼쪽 = 줄 메뉴, 오른쪽 = 여러 개 선택).
async function swipeFirst(page, dx) {
  const row = page.locator('#basketRows [data-basket-row-item]').first();
  await expect(row).toBeVisible();
  await row.evaluate((el, dx) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y}));
    fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
  }, dx);
  await page.waitForTimeout(500);
}
const go = view => async page => { await openHome(page); await page.evaluate(v => window.KPTURouter.go(v), view); };
// 아스날은 경기 기록 자료에 실제 선수 이름이 들어 있어 그림을 찍지 않는다.
// [줄 id, 여는 방법]. 줄 id = app/help-content.mjs 쓰는 법 줄(그림 파일 이름).
const SHOTS = [
  ['home', async page => { await openHome(page); }],
  ['basket', page => basket.open(page, 390)],
  ['reading', openReading],
  ['calendar', page => calendar.open(page, 390)],
  ['note', page => notes.open(page, 390)],
  ['meetings', page => meetings.open(page, 390)],
  ['library', openLibrary],
  ['files', page => files.open(page, 390)],
  ['brief', openBrief],
  ['team', openTeam],
  ['hwp', go('hwp')],
  ['photos', openPhotos],
  ['outside', page => outside.open(page, 390)],
  ['calls', page => calls.open(page, 390)],
  ['telegram', page => telegram.open(page, 390)],
  ['profile', go('profile')],
  ['swipe-left', async page => { await basket.open(page, 390); await swipeFirst(page, -90); }],
  ['swipe-right', async page => { await basket.open(page, 390); await swipeFirst(page, 90); }],
];

// 그림 높이(폭 390)는 쓰는 법 글(help-content.mjs shots[].h) 한 곳에서 읽는다 — 화면 위쪽부터 그 높이만큼 자른다.
const HEIGHT = new Map(TOPIC_IDS.flatMap(id => (topic(id).shots || []).map(s => [s.file.replace(/\.webp$/, ''), s.h])));
// 운영 화면은 WORK ON+ 얼굴(girok) 빌드다(pages-deploy.yml). 저장소 그대로는 노조 얼굴이라, 빌드가 바꾸는 두 곳(얼굴 이름 한 줄·앱 바탕 HTML 글자)을
// 같은 함수(scripts/brand-face.mjs)로 바꿔 내보낸다. 그래서 그림 글자는 쓰는 법 글(word())과 같은 말이다.
const GIROK = faceOf('girok');
async function girokFace(page) {
  await page.route(u => u.pathname.endsWith('/app/brand/face.mjs'), r => r.fulfill({contentType: 'text/javascript', body: `export const FACE_ID = '${GIROK.id}';\n`}));
  const shell = faceHtml(readFileSync(new URL('../../../app/index.html', import.meta.url), 'utf8'), GIROK, {keepOriginals: true});
  await page.route(u => u.pathname === '/app/' || u.pathname === '/app/index.html', r => r.fulfill({contentType: 'text/html; charset=utf-8', body: shell}));
}
// 시험 도구 기본 자료 중 단체 색 글자(예전 기본 단계 이름·'테스트 조직')는 그림에서만 지금 기본값·'예시' 이름으로 바꿔 받는다(앱 코드는 그대로).
async function neutralRows(page) {
  const stages = DEFAULT_STAGES.map((row, i) => ({id: 'stage-' + (i + 1), ...row, sort_order: i + 1, created_at: '2026-10-01T00:00:00Z'}));
  await page.addInitScript(stageRows => {
    const real = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const res = await real(input, init);
      try {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET' || !res.ok) return res;
        if (url.pathname.endsWith('/rest/v1/app_dispute_stages')) return new Response(JSON.stringify(stageRows), {status: 200, headers: {'content-type': 'application/json'}});
        if (url.pathname.endsWith('/rest/v1/app_suborganizations')) {
          const rows = await res.clone().json();
          if (Array.isArray(rows)) return new Response(JSON.stringify(rows.map(r => r?.name === '테스트 조직' ? {...r, name: '예시 거래처 A'} : r)), {status: 200, headers: {'content-type': 'application/json'}});
        }
      } catch {}
      return res;
    };
  }, stages);
}
// 운영자 기능 화면(기록+ 얼굴에서도 운영자에게만 열림, 글자 검사 예외 화면)은 노조 색 낱말 검사를 하지 않는다.
const OPERATOR = new Set(['calls', 'telegram', 'outside']);
async function toWebp(page, png) {
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.7).split(',')[1];
  }, png.toString('base64'));
}

for (const [id, open] of SHOTS) {
  test(`쓰는 법 그림: ${id}`, async ({page, context}) => {
    await girokFace(page);
    await neutralRows(page);
    await installViewPrefsServer(page, null, {base: FAKE_PREFS});
    await open(page);
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
    await page.waitForTimeout(1500);
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    const text = await page.evaluate(() => document.body.innerText);
    for (const name of REAL) expect(text.includes(name), `${id} 화면에 실제 단체 이름 '${name}'이 보이면 안 된다`).toBe(false);
    if (!OPERATOR.has(id)) expect(text.match(FORBIDDEN)?.[0] ?? null, `${id} 화면에 기록+ 얼굴에 없어야 할 낱말`).toBe(null);
    expect(/[\w.-]+@[\w-]+\.(com|net|kr)\b/.test(text), `${id} 화면에 메일 주소가 보이면 안 된다`).toBe(false);
    const h = HEIGHT.get(id);
    expect(h, `${id} 그림이 쓰는 법 글에 있다`).toBeTruthy();
    const png = await page.screenshot({type: 'png', clip: {x: 0, y: 0, width: 390, height: h}});
    const conv = await context.newPage();
    const webp = Buffer.from(await toWebp(conv, png), 'base64');
    await conv.close();
    writeFileSync(new URL(`${id}.webp`, OUT), webp);
  });
}
