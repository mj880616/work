// HELP-메뉴안쓰는법 · HELP-처음쓰는사람안내(시안 docs/design/mockups/help-howto.html · help-first-use.html, 명진 확정 11/16).
// ① 계정 › 쓰는 법('앱 정보' 바로 아래 — 폰 [메뉴] 창 계정 줄 · 폴드/PC [계정 ▾] 메뉴, S69-71. 왼쪽 메뉴에는 없음) → 쓰는 법 화면(폰: 줄을 누르면 펼침, 넓은 화면: 목차 | 내용)
// ② 각 화면 ⋯ 맨 아래 '쓰는 법' → 그 메뉴 줄이 펼쳐진(고른) 채로 ③ 운영자 기능 메뉴 줄은 서버 기능 목록에 있을 때만
// ④ 조직 관리·사업 관리·브리핑 룸이 비어 있을 때 따라하기 3단계 ⑤ 앱 내려받기 기기별 탭(지금 기기 탭 먼저).
// 화면 사진: SHOT_DIR=docs/design/screens/s64-02 로 돌릴 때만(지어낸 이름만 보임).
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
import {screenFind} from './helpers/screen-find.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const WIDTHS = [['phone-412', 412, 915], ['fold-880', 880, 900], ['pc-1440', 1440, 900]];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const shot = async (page, name) => { if (process.env.SHOT_DIR) { await page.waitForTimeout(300); await page.screenshot({path: `${process.env.SHOT_DIR}/${name}.png`}); } };
const help = page => page.locator('#helpView');

async function openHelpFromMenu(page) {
  // S69-71(명진 11/24 "쓰는법 계정 안으로 들여보내줘"): 왼쪽 메뉴 맨 아래 줄은 없고, 계정 메뉴 '앱 정보' 바로 아래 한 줄.
  await expect(page.locator('#appNav .nav-help, #appNav [data-view="help"]')).toHaveCount(0);
  const phone = (page.viewportSize()?.width || 0) <= 760;
  await accountButton(page).click();
  const rows = page.locator(phone ? '#mobileAccountGroup .account-action' : '#sidebarAccountPanel .account-action');
  const names = await rows.evaluateAll(list => list.filter(el => el.getClientRects().length).map(el => (el.querySelector('.account-action-name') || el).textContent.trim()));
  expect(names.indexOf('쓰는 법')).toBe(names.indexOf('앱 정보') + 1);
  await page.locator(phone ? '#mobileAccountGroup [data-help-menu]' : '#sidebarAccountPanel [data-help-menu]').click();
  await expect(help(page)).toBeVisible();
}

for (const [label, width, height] of WIDTHS) {
  test(`쓰는 법: 메뉴 맨 아래에서 열고, 메뉴마다 한 줄 → 펼치면 따라하기·예시 화면·[열기] (${label})`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({width, height});
    await openHome(page, {features: []});
    await openHelpFromMenu(page);
    await expect(page).toHaveURL(/view=help/);
    // S71-33 HELP-머리한줄: 맨 위 안내 글·화면 안 찾기 칸 없음(렌더에서 뺌).
    await expect(help(page).locator('.hp-sum, .hp-top, [data-hp-find]')).toHaveCount(0);
    await expect(help(page)).not.toContainText('개인 업무 수첩');
    if (width <= 760) {
      await expect(help(page).locator('.hp-gl').first()).toHaveText('많이 쓰는 곳');
      const rows = help(page).locator('details.hp-item');
      await expect(rows.first().locator('.hp-name')).toHaveText('조직 관리');
      await expect(help(page).locator('[data-hp-topic="calendar"] .hp-short')).toHaveText('구글 캘린더·할 일·하루 기록');
      await shot(page, `${label}-1-help-list`);
      await help(page).locator('[data-hp-topic="team"] > summary').click();
      const body = help(page).locator('[data-hp-topic="team"] .hp-body');
      await expect(body.locator('ol.hp-ls li')).toHaveCount(4);
      // S71-33 HELP-그림: 글자로 그린 예시 대신 화면 그림(alt 글, 실제로 불러와짐).
      const img = body.locator('[data-hp-shots] img');
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute('alt', /예시 이름/);
      await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
      await expect(page).toHaveURL(/topic=team/);
      await shot(page, `${label}-2-help-open`);
      // 한 번에 하나만 펼친다.
      await help(page).locator('[data-hp-topic="calendar"] > summary').click();
      await expect(help(page).locator('[data-hp-topic="team"]')).not.toHaveAttribute('open', '');
      await expect(help(page).locator('[data-hp-topic="calendar"] [data-hp-shots] img')).toBeVisible();
      // S68-58(명진 11/23 폰 캡처): '내 기록은 누가 보나'를 펼치면 첫 문장은 한 번만, 상자에는 제공/미제공 두 줄.
      await help(page).locator('[data-hp-topic="privacy"] > summary').click();
      const priv = help(page).locator('[data-hp-topic="privacy"] .hp-body');
      await expect(priv.locator('.hp-lead')).toHaveText('내가 기록한 내용은 운영자가 볼 수 없습니다.');
      await expect(priv.locator('[data-hp-privacy] p')).toHaveText(['운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각.', '제공되지 않는 정보: 유저가 기록·업로드한 정보.']);
      expect((await priv.innerText()).split('내가 기록한 내용은 운영자가 볼 수 없습니다.').length).toBe(2);
      await help(page).locator('[data-hp-topic="calendar"] > summary').click();
      await help(page).locator('[data-hp-topic="calendar"] [data-hp-go]').click();
    } else {
      const toc = help(page).locator('[data-hp-toc]');
      await expect(toc.locator('.hp-gl').first()).toHaveText('많이 쓰는 곳');
      await expect(toc.locator('[aria-current="true"]')).toHaveText('조직 관리');
      await expect(help(page).locator('[data-hp-detail] .hp-dt')).toHaveText('조직 관리');
      await toc.locator('[data-hp-pick="brief"]').click();
      const detail = help(page).locator('[data-hp-detail]');
      await expect(detail.locator('.hp-dt')).toHaveText('브리핑 룸');
      await expect(detail).toContainText('글자가 없는 스캔 PDF는 읽지 못해요.');
      await expect(page).toHaveURL(/topic=brief/);
      await shot(page, `${label}-1-help-brief`);
      await toc.locator('[data-hp-pick="privacy"]').click();
      // S68-58(명진 11/23): 첫 문장은 한 번만(lead), 상자에는 제공/미제공 두 줄.
      await expect(detail.locator('.hp-lead')).toHaveText('내가 기록한 내용은 운영자가 볼 수 없습니다.');
      await expect(detail.locator('[data-hp-privacy] p')).toHaveText(['운영자에게 제공되는 정보: 이메일주소, 가입일, 마지막 사용 시각.', '제공되지 않는 정보: 유저가 기록·업로드한 정보.']);
      expect((await detail.innerText()).split('내가 기록한 내용은 운영자가 볼 수 없습니다.').length).toBe(2);
      await expect(detail.locator('.hp-contact a').first()).toHaveAttribute('href', /^mailto:/);
      await toc.locator('[data-hp-pick="calendar"]').click();
      await detail.locator('[data-hp-go]').click();
    }
    await expect(page.locator('#calendarView')).toBeVisible();
    // 뒤로가기는 쓰는 법으로.
    await page.goBack();
    await expect(help(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
}

// S71-33 HELP-머리한줄(명진 11/26 "맨위 안내멘트 지우고 검색창을 제목줄로 올려 돋보기로"): 폰 머리 줄은 한 줄 [W] 쓰는 법 · (빈 칸) · 돋보기.
// 돋보기를 누르면 그 자리에서 칸이 열리고('쓰는 법에서 찾기'), 치면 예전처럼 낱말이 든 줄만.
for (const [label, width, height] of [['phone-390', 390, 844], ['pc-1280', 1280, 900]]) {
  test(`찾기: 맨 위 칸 하나 '쓰는 법에서 찾기' — 낱말이 든 줄만, 없으면 한 줄 (${label})`, async ({page}) => {
    await page.setViewportSize({width, height});
    await openHome(page, {features: []});
    await openHelpFromMenu(page);
    if (width <= 760) {
      const head = page.locator('#appView > .mobile-shell-header');
      const open = head.locator('.sf-open');
      await expect(open).toBeVisible();
      await expect(open).toHaveAttribute('aria-label', '쓰는 법에서 찾기');
      // 머리 줄은 한 줄: 이름과 돋보기가 같은 높이 줄에 있고 머리 줄 높이는 한 줄(56px 이하).
      const [hb, ob] = [await head.boundingBox(), await open.boundingBox()];
      expect(hb.height).toBeLessThanOrEqual(56);
      expect(ob.y).toBeGreaterThanOrEqual(hb.y); expect(ob.y + ob.height).toBeLessThanOrEqual(hb.y + hb.height + 1);
      await expect(head).toContainText('쓰는 법');
      // 쓰는 법 화면 첫 줄은 묶음 이름(안내 글 없음).
      await expect(help(page).locator('.hp > *').first()).toHaveClass(/hp-list/);
    }
    const find = await screenFind(page);
    await expect(find).toHaveAttribute('placeholder', '쓰는 법에서 찾기');
    await find.fill('PDF 스캔');
    const rows = help(page).locator(width <= 760 ? 'details.hp-item' : '[data-hp-pick]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('브리핑 룸');
    await find.fill('없는낱말');
    await expect(help(page).locator('[data-wait-empty]')).toHaveText('찾는 글이 없어요');
    await find.fill('');
    await expect(rows).toHaveCount(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('사진 내용 찾기 줄은 서버 기능 목록에 그 기능이 있을 때만', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await openHome(page, {features: ['photo_content']});
  await openHelpFromMenu(page);
  await help(page).locator('[data-hp-toc] [data-hp-pick="photos"]').click();
  await expect(help(page).locator('[data-hp-detail]')).toContainText('사진 속 내용 낱말');
});
test('사진 내용 찾기 줄은 기능이 없으면 없다', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await openHome(page, {features: []});
  await openHelpFromMenu(page);
  await help(page).locator('[data-hp-toc] [data-hp-pick="photos"]').click();
  await expect(help(page).locator('[data-hp-detail]')).toContainText('사진을 길게 눌러');
  await expect(help(page).locator('[data-hp-detail]')).not.toContainText('사진 속 내용 낱말');
});

test('운영자 기능 메뉴 줄은 서버 기능 목록에 있을 때만(다른 사람은 줄 자체가 없음)', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await openHome(page, {features: []});
  await openHelpFromMenu(page);
  const toc = help(page).locator('[data-hp-toc]');
  await expect(toc.locator('[data-hp-pick="files"]')).toHaveCount(1);
  for (const id of ['calls', 'telegram', 'arsenal', 'outside']) await expect(toc.locator(`[data-hp-pick="${id}"]`)).toHaveCount(0);
  await expect(toc.locator('.hp-gl', {hasText: '운영자'})).toHaveCount(0);
});

test('운영자 계정은 운영자 묶음 줄이 있다', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await openHome(page);
  await openHelpFromMenu(page);
  const toc = help(page).locator('[data-hp-toc]');
  for (const id of ['calls', 'telegram', 'arsenal', 'outside']) await expect(toc.locator(`[data-hp-pick="${id}"]`)).toHaveCount(1);
});

for (const [label, width, height] of [['phone-412', 412, 915], ['pc-1440', 1440, 900]]) {
  test(`화면 ⋯ 맨 아래 '쓰는 법' → 그 메뉴 줄이 펼쳐진 채로 (조직 관리·사업 관리, ${label})`, async ({page}) => {
    await page.setViewportSize({width, height});
    await openHome(page);
    await page.evaluate(() => window.KPTURouter.go('team'));
    await page.locator('#soTeamMore').click();
    const item = page.locator('#soTeamMenu [data-help-open="team"]');
    await expect(item).toBeVisible();
    expect(await page.locator('#soTeamMenu button').last().textContent()).toBe('쓰는 법');
    await shot(page, `${label}-3-team-more`);
    await item.click();
    await expect(help(page)).toBeVisible();
    await expect(page).toHaveURL(/topic=team/);
    if (width <= 760) await expect(help(page).locator('[data-hp-topic="team"]')).toHaveAttribute('open', '');
    else await expect(help(page).locator('[data-hp-toc] [aria-current="true"]')).toHaveText('조직 관리');
    await page.evaluate(() => window.KPTURouter.go('meetings'));
    // BIZ-머리한줄(S71-23, 명진 11/26 "쓰는 법 여기 있을 필요 없고"): 사업 관리는 첫 줄 ⋯가 없고 [+] 메뉴에도 '쓰는 법'이 없다(계정 › 쓰는 법에서 사업 관리 글은 그대로).
    await page.locator('#newMeetingBtn').click();
    await expect(page.locator('#bizAddMenu')).toBeVisible();
    await expect(page.locator('#bizAddMenu')).not.toContainText('쓰는 법');
    await expect(page.locator('#bizAddMenu [data-help-open]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
}

async function openEmpty(page) {
  await openHome(page, {features: [], beforeLoad: async () => {
    for (const t of ['app_suborganizations', 'app_suborganization_assignees', 'app_spaces', 'app_meetings', 'app_document_briefs', 'app_library_folders', 'app_library_folder_items'])
      await page.route(`${SB}/rest/v1/${t}**`, r => r.request().method() === 'GET' ? r.fulfill({json: []}) : r.fallback());
  }});
}
for (const [label, width, height] of WIDTHS) {
  test(`처음 쓰는 사람: 비어 있는 조직 관리·사업 관리·브리핑 룸에 따라하기 3단계 (${label})`, async ({page}) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({width, height});
    await openEmpty(page);
    for (const [view, title, action] of [['team', '맡은 조직별 상황을 쌓아 두는 곳이에요', '+ 담당조직'], ['meetings', '회의·면담·집회처럼 날짜 있는 활동을 남기는 곳이에요', '+ 사업 만들기'], ['brief', '긴 자료를 넣으면, 자료 짜임대로 요약해 줘요', '자료 넣기']]) {
      await page.evaluate(v => window.KPTURouter.go(v), view);
      const card = page.locator(`#${view}View [data-first-use="${view}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator('.fu-title')).toHaveText(title);
      await expect(card.locator('.fu-step')).toHaveCount(3);
      await expect(card.locator('[data-fu-action]')).toHaveText(action);
      await expect(card.locator('[data-help-open]')).toHaveText('쓰는 법 보기');
      if (view === 'meetings') await expect(page.locator('#bizWeekBox')).toBeHidden(); // 같은 뜻 안내 두 번 금지
      await shot(page, `${label}-4-empty-${view}`);
    }
    // [쓰는 법 보기] → 그 줄.
    await page.locator('#briefView [data-first-use] [data-help-open]').click();
    await expect(page).toHaveURL(/topic=brief/);
    // [+ 담당조직] → 담당조직 추가 창.
    await page.evaluate(() => window.KPTURouter.go('team'));
    await page.locator('#teamView [data-fu-action="team"]').click();
    await expect(page.locator('#soEditModal')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('기록이 있으면 안내 대신 목록(조직 관리)', async ({page}) => {
  await page.setViewportSize({width: 412, height: 915});
  await openHome(page);
  await page.evaluate(() => window.KPTURouter.go('team'));
  await expect(page.locator('#soOrganizationList [data-so-org]').first()).toBeVisible();
  await expect(page.locator('[data-first-use]')).toHaveCount(0);
});

test.describe('아이폰', () => {
  test.use({userAgent: IPHONE, viewport: {width: 412, height: 915}});
  test("계정 › 앱 내려받기: 아이폰 탭이 먼저 열린 기기별 안내", async ({page}) => {
    await page.route('**/app/phone-app.json*', r => r.fulfill({status: 404, body: ''}));
    await openHome(page, {features: []});
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileAccountGroup [data-app-download="other"]').click();
    const modal = page.locator('#appGuideModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[role="tab"][aria-selected="true"]')).toHaveText('아이폰');
    await expect(modal.locator('.adg-panel')).toContainText('홈 화면에 추가');
    await expect(modal.locator('[data-sfm-cancel]')).toHaveCount(0);
    await shot(page, 'phone-412-5-app-guide-iphone');
    await modal.locator('[data-adg-tab="android"]').click();
    await expect(modal.locator('[data-adg-android]')).toHaveText('안드로이드 앱 내려받기');
    await modal.locator('[data-sfm-ok]').click();
    await expect(modal).toHaveCount(0);
  });
});

test.describe('맥', () => {
  test.use({userAgent: MAC, viewport: {width: 1440, height: 900}});
  test('쓰는 법 › 앱 내려받기: 맥 탭이 먼저', async ({page}) => {
    await openHome(page, {features: []});
    await openHelpFromMenu(page);
    await help(page).locator('[data-hp-pick="appdl"]').click();
    const guide = help(page).locator('[data-app-guide]');
    await expect(guide.locator('[role="tab"][aria-selected="true"]')).toHaveText('맥');
    await expect(guide).toContainText('Dock에 추가');
    await shot(page, 'pc-1440-5-app-guide-mac');
    await guide.locator('[data-adg-tab="windows"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(guide.locator('[role="tab"][aria-selected="true"]')).toHaveText('맥');
  });
});
