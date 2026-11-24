import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// S69-41: [앱 폴더 모으기]를 자료실 위 줄에서 내 프로필 '구글 드라이브' 칸으로 옮김(app/drive-folders-panel.js).
// '앱이 쓰는 드라이브 폴더: 내 드라이브 › (앱 폴더 이름) [열기 ↗] [한곳으로 모으기]' + 결과 한 줄, 이미 모았으면 '모아 둠'.
// 고정 페이지 profile-workplaces-fixture.html(가짜 서버 — 실제 Supabase·Drive 없음). 가짜 폴더 id·이름만.
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
const ROOT_URL='https://drive.google.com/drive/folders/appRootFolder0001';
async function openProfile(page,drive){
  await page.goto(url);
  await page.evaluate(d=>{window.__state.drive=d},drive);
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
}

for(const [label,width] of [['폰 390',390],['PC 1280',1280]]){
  test(`${label}: 한 줄 → [한곳으로 모으기] → 확인 → 옮기고 이름 맞춤 → 결과 한 줄·'모아 둠'`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page,{
      plan:{ok:true,root_name:'웹2',root_url:ROOT_URL,count:2,kinds:{basket:1,edit_backup:1},rename:3},
      run:[{ok:true,root_name:'WORK ON+',root_url:ROOT_URL,moved:2,failed:0,left:0,kinds:{basket:1,edit_backup:1},renamed:3,rename_failed:0,rename_left:0}],
      after:{ok:true,root_name:'WORK ON+',root_url:ROOT_URL,count:0,kinds:{},rename:0},
    });
    const panel=page.locator('#psDriveFoldersPanel');
    await expect(panel).toBeVisible();
    // 자리: '내 기록 백업' 칸 바로 다음.
    await expect(page.locator('#psBackupPanel + #psDriveFoldersPanel')).toHaveCount(1);
    await expect(panel.locator('h3')).toHaveText('구글 드라이브');
    await expect(panel.locator('.dfp-line')).toContainText('앱이 쓰는 드라이브 폴더:');
    await expect(panel.locator('.dfp-where')).toHaveText('내 드라이브 › 웹2');
    const open=panel.locator('a.dfp-open');
    await expect(open).toHaveText('열기 ↗');
    await expect(open).toHaveAttribute('href',ROOT_URL);
    await expect(open).toHaveAttribute('rel',/noopener/);
    const btn=panel.getByRole('button',{name:'한곳으로 모으기'});
    await expect(btn).toBeVisible();
    // 콤팩트: 한 줄(폰은 두 줄까지) — 큰 카드·안내문 없음.
    const line=await panel.locator('.dfp-line').boundingBox();
    expect(line.height).toBeLessThan(width<500?44:26);
    await btn.click();
    await expect(page.locator('.kptu-ask-text')).toHaveText("앱 폴더 2개를 '웹2' 아래로 모으고, 옛 이름 3개를 새 이름으로 바꿀까요?");
    await expect(page.locator('.kptu-ask-note')).toContainText('삭제하지 않고 자리·이름만 바꿔요');
    await page.locator('.kptu-ask-actions button.primary').click();
    await expect(panel.locator('.dfp-result')).toHaveText("앱 폴더 2개를 'WORK ON+' 아래로 모았어요 · 이름 3개를 새 이름으로 바꿨어요.");
    await expect(panel.locator('.dfp-where')).toHaveText('내 드라이브 › WORK ON+');
    await expect(panel.locator('.dfp-done')).toHaveText('모아 둠');
    await expect(panel.getByRole('button',{name:'한곳으로 모으기'})).toHaveCount(0);
    // 화면은 폴더 id를 보내지 않는다(세기 → 실행 한 번 → 다시 세기). 몸통은 {dry_run:true} 또는 {}뿐.
    const asks=await page.evaluate(()=>window.__state.driveAsks);
    expect(asks.filter(b=>!b.dry_run)).toEqual([{}]);
    expect(asks.every(b=>JSON.stringify(b)==='{"dry_run":true}'||JSON.stringify(b)==='{}')).toBe(true);
    expect(asks.at(-1)).toEqual({dry_run:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('이미 다 모았으면 버튼 대신 모아 둠, 취소하면 바꾸지 않는다, 드라이브 연결이 없으면 칸이 없다',async({page})=>{
  await openProfile(page,{plan:{ok:true,root_name:'WORK ON+',root_url:ROOT_URL,count:0,kinds:{},rename:0},run:[],after:null});
  const panel=page.locator('#psDriveFoldersPanel');
  await expect(panel.locator('.dfp-done')).toHaveText('모아 둠');
  await expect(panel.locator('button')).toHaveCount(0);
  // 취소
  await openProfile(page,{plan:{ok:true,root_name:'WORK ON+',root_url:ROOT_URL,count:0,kinds:{},rename:1},run:[],after:null});
  await panel.getByRole('button',{name:'한곳으로 모으기'}).click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('앱 폴더의 옛 이름 1개를 새 이름으로 바꿀까요?');
  await page.locator('.kptu-ask-actions button.secondary').click();
  await expect(page.locator('.kptu-ask-text')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'한곳으로 모으기'})).toBeEnabled();
  expect((await page.evaluate(()=>window.__state.driveAsks)).filter(b=>!b.dry_run)).toEqual([]);
  // 연결 없음(세기 실패) → 칸 감춤
  await openProfile(page,null);
  await expect(page.locator('#psDriveFoldersPanel')).toBeHidden();
});
