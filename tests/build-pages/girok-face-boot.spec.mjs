import { test, expect } from '@playwright/test';
import { signInWithSession } from '../app-e2e/helpers/session-login.mjs';
import { chooseBasketKind } from '../app-e2e/helpers/basket-kind.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { FORBIDDEN } from '../../scripts/girok-words-allow.mjs';

// APP-올인원다이어리 단계 2: `node scripts/build-pages.mjs <입력> <출력> --face=girok`로 만든 기록+ 빌드가 따로 뜨는지 본다.
// 이름·manifest·아이콘은 WORK ON+(S67-49), 메뉴 이름은 girok 기본 단어, 같은 흉내 서버로 켜진다. 메뉴·경로를 실제로 빼는 일은 단계 3 다음 PR이라 여기서는 글자만 본다.
// S67-43: 홈·활동 기록·거래처·부서·직원·노트·일정·쓰는 법 화면 글자에 노조 색 글자(FORBIDDEN)가 없는지 PC·폰에서 본다.
// Served at PAGES_GIROK_ORIGIN (pages-build-check.yml).
const origin = process.env.PAGES_GIROK_ORIGIN || 'http://127.0.0.1:8126';

// customWords: 내 프로필 custom_words(서버 값). 없으면 고친 이름 없음.
// features: 서버 app_my_features 답(S67-62 바탕 낱말 묶음 'nojo_words' 등). 없으면 빈 목록. at: 어느 빌드(기본 girok).
async function boot(page, { customWords = null, features = [], at = origin, now = null } = {}) {
  if (now) await page.clock.setFixedTime(new Date(now));
  const user = { id: 'girok-user', email: 'girok@example.org' }, workspace = { id: 'girok-workspace', name: 'QA', slug: 'qa' };
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**', route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data = [];
    if (path === '/auth/v1/token') data = { access_token: 'qa', refresh_token: 'qa-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user };
    else if (path === '/auth/v1/user') data = user;
    else if (path === '/rest/v1/app_workspace_members') data = [{ workspace_id: workspace.id, user_id: user.id, role: 'owner' }];
    else if (path === '/rest/v1/app_workspaces') data = [workspace];
    else if (path === '/rest/v1/app_profiles' && (url.searchParams.get('select') || '').includes('custom_words')) data = [{ custom_words: customWords }];
    else if (path === '/rest/v1/app_profiles') data = [{ user_id: user.id, display_name: 'QA' }];
    else if (path === '/rest/v1/rpc/app_my_features') data = features;
    else if (path.startsWith('/functions/')) data = { connected: false, enabled: false, tasks: [], events: [], calendars: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(at + '/app/login/?return=' + encodeURIComponent(at + '/app/?view=home'));
  await expect(page).toHaveTitle('로그인 · WORK ON+');
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}

// 화면이 그려질 때까지: 그 화면 칸이 보이고, '불러오는 중' 같은 기다림 글이 사라질 때까지.
async function settle(page, view) {
  const panel = { home: '#homeView', meetings: '#meetingsView', team: '#teamView', calendar: '#calendarView', help: '#helpView', note: '#basketView[data-kind="note"]' }[view];
  if (panel) await expect(page.locator(panel)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}
async function shownTexts(page, scope = 'body') {
  return page.evaluate(scope => {
    const seen = [];
    for (const el of document.querySelectorAll(scope === 'body' ? 'body *' : scope.split(',').map(s => `${s.trim()}, ${s.trim()} *`).join(','))) {
      if (el.closest('script,style,template,[hidden]')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      for (const node of el.childNodes) if (node.nodeType === 3 && node.textContent.trim()) seen.push(node.textContent.trim());
      for (const name of ['aria-label', 'title', 'placeholder']) if (el.getAttribute(name)) seen.push(el.getAttribute(name));
    }
    return seen;
  }, scope);
}
async function noUnionWords(page, where) {
  const text = await shownTexts(page);
  const bad = text.filter(t => FORBIDDEN.test(t));
  expect(bad, `${where}: 기록+ 화면에 노조 색 글자`).toEqual([]);
}

test('girok 빌드: 이름·manifest·아이콘은 WORK ON+, 메뉴 이름은 기본 단어로 뜬다', async ({ page }) => {
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await expect(page.locator('.topbar .brand span')).toHaveText('WORK ON+');
  await expect(page).toHaveTitle('홈 · WORK ON+');
  await expect(page.locator('#appNav .nav-btn[data-view="meetings"]')).toContainText('활동 기록');
  await expect(page.locator('#appNav .nav-btn[data-view="team"]')).toContainText('거래처·직원');
  await page.evaluate(() => window.KPTURouter.go('meetings'));
  await expect(page).toHaveTitle('활동 기록 · WORK ON+');
  await expect(page.locator('[data-topline-where] li').first()).toHaveText('활동 기록');
  await page.evaluate(() => window.KPTURouter.go('team'));
  await expect(page).toHaveTitle('거래처·부서·직원 · WORK ON+');
  const manifest = await (await page.request.get(origin + '/app/windows-manifest.json')).json();
  expect(manifest).toMatchObject({ name: 'WORK ON+', short_name: 'WORK ON+' });
  const icon = await (await page.request.get(origin + '/app/app-icon.svg')).text();
  expect(icon).toContain('aria-label="WORK ON+"');
  const body = await page.locator('body').innerText();
  for (const word of ['노동조합+', '사업 관리', '조직 관리']) expect(body, word).not.toContain(word);
  for (const view of ['home', 'meetings', 'team', 'calendar', 'help']) {
    await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    await noUnionWords(page, `PC ${view}`);
  }
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('기록+ 폰 화면: 홈·활동 기록·거래처·부서·직원·노트에 노조 색 글자가 없다(화면 캡처)', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  const shots = [['home', '홈'], ['meetings', '활동 기록'], ['team', '거래처·부서·직원'], ['note', '노트']];
  for (const [view, name] of shots) {
    if (view === 'note') await chooseBasketKind(page, 'note');
    else await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    await noUnionWords(page, `폰 ${name}`);
    await page.screenshot({ path: testInfo.outputPath(`girok-phone-${view}.png`) });
  }
  expect(errors).toEqual([]);
  await context.close();
});

// S67-56: 운영이 이 얼굴(girok)이 된다. 고친 이름이 있는 사람(운영자 값 = 지금 화면 이름 그대로 15칸, docs/ops/custom-words-operator.apply.sql)은
// 앱 바탕(빌드가 바꾼 index.html 글자)·메뉴·홈·활동 기록·거래처 화면 모두 자기 이름 그대로 본다.
const OPERATOR = JSON.parse(readFileSync(new URL('../../docs/ops/custom-words-operator.apply.sql', import.meta.url), 'utf8').match(/set custom_words = '(\{[^']*\})'::jsonb/)[1]);
// 이름 칸의 girok 기본 이름 — 고친 이름이 있으면 글자 하나로는 나오면 안 된다(메뉴·제목·버튼·칸 이름 자리).
// 칸 밖 낱말(조직→대상 등, 문장 안 설명 글)은 사람별로 고칠 수 없다(docs/design/girok-custom-words.md 7절의 남은 결정)라 여기서 보지 않는다.
const SLOT_DEFAULTS = new Set(['활동 기록', '거래처·직원', '거래처·부서·직원', '프로젝트', '프로젝트 관리', '관리 대상', '주요 거래처', '+ 활동 기록']);

test('girok 빌드 + 고친 이름(지금 화면 이름 15칸): 앱 바탕·메뉴·홈·사업/조직 화면이 지금 글자 그대로다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, { customWords: OPERATOR });
  await expect(page.locator('.topbar .brand span')).toHaveText('WORK ON+');
  // 앱 바탕(index.html, 빌드가 girok 글자로 바꾼 자리): 메뉴·아래 막대·사업영역 창·자료실 걸러보기.
  await expect(page.locator('#appNav .nav-btn[data-view="meetings"]')).toHaveText('사업 관리');
  await expect(page.locator('#appNav .nav-btn[data-view="team"]')).toHaveText('조직 관리');
  await expect(page.locator('#areaWindowTitle')).toHaveText('사업영역 관리');
  await expect(page.locator('.area-window-back')).toHaveAttribute('aria-label', '사업 관리로 돌아가기');
  await expect(page.locator('#projectsView')).toHaveAttribute('aria-label', '사업영역 목록');
  await expect(page.locator('#meetingsListCard .add-list-head h2')).toHaveText('사업 관리'); // S70-57: 화면 첫 줄 제목은 없앰(앱 머리 줄) — 읽기용 제목
  const shell = await page.evaluate(() => [...document.querySelectorAll('[data-word-aria-label]')].map(el => [el.getAttribute('data-word-aria-label'), el.getAttribute('aria-label')]));
  expect(shell.length).toBeGreaterThan(0);
  // S67-62부터 앱 바탕은 빌드가 바꾼 글자를 모두 남기므로, 남긴 자리는 '이 사람의 word(원래 글자)'와 같아야 한다:
  // 이름 칸 글자는 고친 이름(= 원래 글자), 칸 밖 낱말은 girok 기본(예: S67-63 '주간 보고' → '주간 정리', 이 사람은 바탕 nojo가 아님).
  const { out: expected } = await wordsIn(page, shell.map(([from]) => [from]));
  shell.forEach(([from, shown], i) => expect(shown, from).toBe(expected[i]));
  expect(shell.filter(([from]) => from.includes('사업 관리')).every(([from, shown]) => shown === from), '이름 칸 글자는 고친 이름 그대로').toBe(true);
  await expect(page).toHaveTitle('홈 · WORK ON+');
  for (const [view, title] of [['home', '홈'], ['meetings', '사업 관리'], ['team', '조직 관리']]) {
    await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    await expect(page).toHaveTitle(`${title} · WORK ON+`);
    const bad = (await shownTexts(page)).filter(t => SLOT_DEFAULTS.has(t));
    expect(bad, `${view}: 고친 이름 대신 기본 이름`).toEqual([]);
  }
  await expect(page.locator('[data-topline-where] li').first()).toHaveText('조직 관리');
  expect(errors).toEqual([]);
});

test('girok 빌드 + 고친 이름 없음: 메뉴·화면 이름이 WORK ON+ 기본 단어다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await expect(page.locator('#appNav .nav-btn[data-view="meetings"]')).toHaveText('활동 기록');
  await expect(page.locator('#appNav .nav-btn[data-view="team"]')).toHaveText('거래처·직원');
  await expect(page.locator('#areaWindowTitle')).toHaveText('프로젝트 관리');
  await page.evaluate(() => window.KPTURouter.go('team'));
  await settle(page, 'team');
  await expect(page).toHaveTitle('거래처·부서·직원 · WORK ON+');
  await noUnionWords(page, 'PC team (고친 이름 없음)');
});

// S67-62 바탕 낱말 묶음: 서버 허용 표 'nojo_words'인 사람(사용자, docs/ops/nojo-words-operator.apply.sql)은 girok 운영 빌드에서도
// 노동조합+ 낱말 전체가 바탕이고 그 위에 고친 이름 15칸이 얹힌다 → 화면 글자가 nojo 빌드(바뀌기 전 운영)와 한 글자도 다르지 않아야 한다.
// 같은 흉내 서버·같은 시각으로 두 빌드를 띄워 화면마다 보이는 글자 전부와, JS word() 고정 글자 전부를 견준다.
const nojoOrigin = process.env.PAGES_BUILD_ORIGIN || 'http://127.0.0.1:8125';
const MINJIN = { customWords: OPERATOR, features: ['arsenal', 'calls', 'files', 'outside', 'telegram', 'nojo_words'], now: '2026-11-20T01:00:00Z' };
// #2828 '남은 위험 1·2'의 예(칸 밖 낱말·운영자 기능 안 글자).
const RISK_SAMPLES = [['조직 선택'], ['선택한 조직'], ['관련 조직'], ['조직 명칭'], ['+ 사업장 추가'], ['쟁의 단계'], ['+ 사업 만들기'], ['담당 조직'], ['투쟁 사업장'],
  ['우리 쪽 주장과 부딪히는 대목', 'brief'], ['조합원을 찾기'], ['사업영역 관리'], ['조직 관리', 'title'], ['담당조직 선택']];
// app/의 word('글자')·word('글자','자리') 고정 글자(정규식으로 모음 — 전수 AST 검사는 scripts/check-girok-words.mjs).
function wordLiterals() {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(new URL(`../../${dir}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!/rhwp|node_modules|-\d+\.\d+/.test(entry.name)) walk(path); continue; }
      if (!/\.m?js$/.test(entry.name)) continue;
      for (const m of readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').matchAll(/\bword\('((?:[^'\\\n]|\\.)+)'(?:\s*,\s*'([a-z]+)')?\)/g)) out.push([m[1], m[2]]);
    }
  };
  walk('app');
  return out;
}
// 화면이 지금 쓰는 brand.mjs(같은 모듈 주소)로 word()를 불러 본다.
async function wordsIn(page, list) {
  return page.evaluate(async list => {
    const src = [...document.querySelectorAll('link[rel="modulepreload"],script[type="module"]')].map(el => el.href || el.src).find(u => /\/brand\/brand\.mjs/.test(u))
      || [...performance.getEntriesByType('resource')].map(e => e.name).find(u => /\/brand\/brand\.mjs/.test(u));
    const { word, CUSTOMIZED } = await import(src);
    return { customized: CUSTOMIZED, out: list.map(([text, slot]) => word(text.replace(/\\'/g, "'"), slot)) };
  }, list);
}
const VIEWS = ['home', 'meetings', 'team', 'projects', 'calendar', 'diary', 'library', 'help', 'profile', 'calls', 'telegram', 'brief'];
async function screenTexts(page) {
  const seen = {};
  await settle(page, 'home');
  seen.shell = (await shownTexts(page)).join('\n');
  seen.title = await page.title();
  for (const view of VIEWS) {
    await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    seen[view] = [await page.title(), ...(await shownTexts(page))].join('\n');
  }
  return seen;
}

test('girok 빌드 + 바탕 nojo + 사용자 15칸 = nojo 빌드 화면 글자(앱 바탕·화면 12개·word() 고정 글자 전부)', async ({ browser }) => {
  test.setTimeout(240000);
  const literals = [...RISK_SAMPLES, ...wordLiterals()];
  expect(literals.length).toBeGreaterThan(200);
  const run = async at => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page, { ...MINJIN, at });
    const words = await wordsIn(page, literals);
    const shell = await page.evaluate(() => ({
      faced: document.documentElement.hasAttribute('data-word-faced'),
      marks: [...document.querySelectorAll('[data-word-aria-label],[data-word-title],[data-word-placeholder],[data-word-alt]')].length
    }));
    const texts = await screenTexts(page);
    await context.close();
    return { words, shell, texts, errors };
  };
  const nojo = await run(nojoOrigin), girok = await run(origin);
  expect(girok.shell.faced, 'girok 빌드는 얼굴 단어가 구워진 바탕').toBe(true);
  expect(nojo.shell.faced).toBe(false);
  expect(girok.words.customized, '바탕 nojo → 앱 바탕을 원래 글자로 다시 입힘').toBe(true);
  expect(nojo.words.customized, 'nojo 빌드에서 사용자 값은 아무것도 바꾸지 않음').toBe(false);
  for (let i = 0; i < literals.length; i += 1) expect(girok.words.out[i], literals[i].join('#')).toBe(nojo.words.out[i]);
  for (const [text] of RISK_SAMPLES.filter(([, slot]) => !slot)) expect(girok.words.out[literals.findIndex(l => l[0] === text)], text).toBe(text);
  for (const key of Object.keys(nojo.texts)) expect(girok.texts[key], `${key} 화면 글자`).toBe(nojo.texts[key]);
  expect(girok.errors).toEqual(nojo.errors);
});

test('girok 빌드 + 바탕 없음(기본 사용자) + 고친 이름 없음: 화면 11개(자료실 밖)에 노조 색 글자가 없다', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, { features: [], now: MINJIN.now });
  const { customized } = await wordsIn(page, []);
  expect(customized).toBe(false);
  await noUnionWords(page, 'PC 앱 바탕');
  const bad = {};
  // 자료실은 뺀다: 자료 분류 선택 칸(<option> 교섭·투쟁)이 아직 word()를 거치지 않는다 — 바탕 낱말 묶음과 상관없는 앞선 문제(PR 본문 '범위 밖 발견').
  for (const view of VIEWS.filter(v => v !== 'library')) {
    await page.evaluate(v => window.KPTURouter.go(v), view);
    await settle(page, view);
    const found = (await shownTexts(page)).filter(t => FORBIDDEN.test(t));
    if (found.length) bad[view] = found;
  }
  expect(bad).toEqual({});
});

// S67-57: 내 프로필의 기본 정보·담당 칸·주간 캘린더 칸·내 묶음(사용자 캡처의 칸들). 칸이 모두 그려질 때까지 기다린다.
const PROFILE_PANELS = '#profileView .ps-panel:first-child, #psWorkplacePanel, #psReportPanel, #psCollabPanel';
async function openProfile(page) {
  await page.evaluate(() => window.KPTURouter.go('profile'));
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psReportPanel h3')).toBeVisible();
  await expect(page.locator('#psCollabPanel [data-cg="new"][data-kind="union"]')).toBeVisible();
  await expect(page.locator('#psWorkplacePanel h3')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test('girok 빌드 + 고친 이름 없음: 내 프로필 기본 정보·담당 칸·주간 캘린더·내 묶음에 노조 색 글자가 없다', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 412, height: 915 });
  await boot(page);
  await openProfile(page);
  await expect(page.locator('#psUnion')).toHaveAttribute('placeholder', '소속명 (예: ○○회사·○○단체)');
  await expect(page.locator('#psDept')).toHaveAttribute('placeholder', '부서명 (예: ○○팀)');
  await expect(page.locator('#psTitle')).toHaveAttribute('placeholder', '직책 (예: 팀장)');
  await expect(page.locator('#psReportPanel h3')).toHaveText('주간 정리 일정 캘린더');
  await expect(page.locator('#psCollabPanel [data-cg="new"][data-kind="union"]')).toHaveText('+ 소속 묶음 만들기');
  const bad = (await shownTexts(page, PROFILE_PANELS)).filter(t => FORBIDDEN.test(t));
  expect(bad, '내 프로필: 기록+ 화면에 노조 색 글자').toEqual([]);
  await page.locator('#psCollabPanel [data-cg="new"][data-kind="union"]').click();
  await expect(page.locator('#psCollabPanel .cg-form-title')).toHaveText('소속 묶음 만들기');
  await expect(page.locator('#psCollabPanel .cg-field span').first()).toHaveText('소속명');
  const badForm = (await shownTexts(page, '#psCollabPanel')).filter(t => FORBIDDEN.test(t));
  expect(badForm, '묶음 만들기 창').toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('girok-phone-profile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

// 사용자(바탕 nojo + 15칸): 소속·주간 칸 이름은 이름 바꾸기 칸이 아니라 바탕 낱말 묶음으로 지금 글자 그대로다(DB 변경 없음).
test('girok 빌드 + 사용자(바탕 nojo + 15칸): 내 프로필 글자가 지금 화면 그대로다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, MINJIN);
  await openProfile(page);
  await expect(page.locator('#psUnion')).toHaveAttribute('placeholder', '노조명 (예: ○○노동조합 ○○지부)');
  await expect(page.locator('#psUnion')).toHaveAttribute('aria-label', '노조명');
  await expect(page.locator('#psDept')).toHaveAttribute('placeholder', '부서명 (예: ○○사업팀)');
  await expect(page.locator('#psTitle')).toHaveAttribute('placeholder', '직책 (예: 국장)');
  await expect(page.locator('#psReportPanel')).toHaveAttribute('aria-label', '주간 보고 일정 캘린더');
  await expect(page.locator('#psReportPanel h3')).toHaveText('주간 보고 일정 캘린더');
  await expect(page.locator('#psReportPanel small')).toHaveText("주간 보고 '주요 일정'에 넣을 일정이 있는 구글 캘린더");
  await expect(page.locator('#psWorkplacePanel h3')).toHaveText('담당조직 현황');
  await expect(page.locator('#psCollabPanel .cg-muted').first()).toHaveText('같은 부서·같은 노조 사람과 일정·자료·조직·사업을 선택해서 나눠 볼 수 있어요. 나누는 건 항목마다 직접 켜요.');
  await expect(page.locator('#psCollabPanel [data-cg="new"][data-kind="dept"]')).toHaveText('+ 부서 묶음 만들기');
  await expect(page.locator('#psCollabPanel [data-cg="new"][data-kind="union"]')).toHaveText('+ 노조 묶음 만들기');
  await page.locator('#psCollabPanel [data-cg="new"][data-kind="union"]').click();
  await expect(page.locator('#psCollabPanel .cg-form-title')).toHaveText('노조 묶음 만들기');
  await expect(page.locator('#psCollabPanel .cg-field span').first()).toHaveText('노조명');
  await expect(page.locator('#psCollabPanel [data-cg-in="union"]')).toHaveAttribute('placeholder', '노조명');
  expect(errors).toEqual([]);
});
