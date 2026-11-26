import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// S69-41: [앱 폴더 모으기]를 자료실 위 줄에서 내 프로필 '구글 드라이브' 칸으로 옮김(app/drive-folders-panel.js).
// S70-29(2026-11-25 사용자 '다 없애 1회용 기능'): [한곳으로 모으기] 버튼은 지웠다(서버가 맨 위 앱 폴더를 처음 만들 때 저절로).
// 칸은 '앱이 쓰는 드라이브 폴더: 내 드라이브 › (앱 폴더 이름) [열기 ↗]' 한 줄만.
// S71-36 PROFILE-설정화면: 내 프로필 첫 화면 '구글 드라이브 ›'(요약: 앱 폴더 이름) → 그 장 안 공용 설정 줄 '앱이 쓰는 폴더 · 내 드라이브 › 이름 · 열기 ↗'.
// 고정 페이지 profile-workplaces-fixture.html(가짜 서버 — 실제 Supabase·Drive 없음). 가짜 폴더 id·이름만.
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
const ROOT_URL='https://drive.google.com/drive/folders/appRootFolder0001';
async function openProfile(page,drive){
  await page.goto(url);
  await page.evaluate(d=>{window.__state.drive=d},drive);
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
}
async function enterDrive(page){
  await page.locator('#psRoot [data-ps-open="drive"]').click();
  await expect(page.locator('#profileView [data-ps-page="drive"]')).toBeVisible();
}

for(const [label,width] of [['폰 390',390],['PC 1280',1280]]){
  test(`${label}: 위치 한 줄 + [열기 ↗]만 — 모을 것이 남아도 [한곳으로 모으기]·확인창·결과 줄 없음, 화면은 세기만`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page,{
      plan:{ok:true,root_name:'웹2',root_url:ROOT_URL,count:2,kinds:{basket:1,edit_backup:1},rename:3},
      run:[],after:null,
    });
    const panel=page.locator('#psDriveFoldersPanel');
    // 자리: 첫 화면 '자료' 묶음 '내 기록 백업' 줄 바로 다음 줄, 요약은 앱 폴더 이름.
    await expect(page.locator('#psRoot [data-ps-open="backup"] + [data-ps-open="drive"] .sl-sum')).toHaveText('웹2 폴더');
    await enterDrive(page);
    await expect(panel).toBeVisible();
    await expect(page.locator('#profileView [data-ps-page="drive"] .sl-page-title')).toHaveText('구글 드라이브');
    const open=panel.locator('a[data-dfp-open]');
    await expect(open.locator('.sl-label')).toHaveText('앱이 쓰는 폴더');
    await expect(open.locator('.sl-desc')).toHaveText('내 드라이브 › 웹2');
    await expect(open).toContainText('열기');
    await expect(open).toContainText('↗');
    await expect(open).toHaveAttribute('href',ROOT_URL);
    await expect(open).toHaveAttribute('rel',/noopener/);
    await expect(panel.locator('button')).toHaveCount(0);
    await expect(panel).not.toContainText('한곳으로 모으기');
    await expect(panel.locator('.dfp-done, .dfp-result')).toHaveCount(0);
    // 콤팩트: 줄 하나 44px 안팎 — 큰 카드·안내문 없음.
    const line=await open.boundingBox();
    expect(line.height).toBeLessThan(64);
    const asks=await page.evaluate(()=>window.__state.driveAsks);
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every(b=>JSON.stringify(b)==='{"dry_run":true}')).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('같은 이름이 있어 둔 것은 작게 한 마디, 드라이브 연결이 없으면 첫 화면 줄이 없다',async({page})=>{
  const panel=page.locator('#psDriveFoldersPanel');
  // S69-42: 같은 자리에 새 이름 폴더가 이미 있어 그대로 둔 것은 작게 한 마디(합치지 않음).
  await openProfile(page,{plan:{ok:true,root_name:'WORK ON+',root_url:ROOT_URL,count:0,kinds:{},rename:0,rename_dup:1},run:[],after:null});
  await enterDrive(page);
  await expect(panel.locator('[data-dfp-dup]')).toContainText('같은 이름 있어 그대로');
  await expect(panel.locator('[data-dfp-dup] .sl-sum')).toHaveText('1');
  await expect(panel.locator('button')).toHaveCount(0);
  // 연결 없음(세기 실패) → 첫 화면 줄 없음
  await openProfile(page,null);
  await expect(page.locator('#psRoot [data-ps-open="backup"]')).toBeVisible();
  await expect(page.locator('#psRoot [data-ps-open="drive"]')).toHaveCount(0);
  await expect(page.locator('#psDriveFoldersPanel')).toBeHidden();
});
