import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {setup,openLibrary} from './helpers/library-multi-delete-scenario.mjs';
import {libraryTopMenu} from './helpers/library-tree.mjs';
import {measureActBar,checkActBar} from './helpers/act-bar-measure.mjs';
// UI-고르기줄(S48-54, 요청함 11/03 07:44 ③): 자료실 고르기 줄도 노트·사진과 같은 공용 부품(.kptu-actbar-text).
// 칸은 줄마다 같은 너비(최대 120px)·같은 간격, 글자 잘림·가로 넘침 없음(좁으면 낱말 단위로 다음 줄), [삭제]는 글자만 빨강. 가짜 서버만 쓴다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const DIR='test-results/ui-audit';
for(const width of [412,768,1280])test(`UI-고르기줄: 자료실 고르기 줄 같은 칸·같은 간격 ${width}px`,async({page})=>{
  test.setTimeout(60000);mkdirSync(DIR,{recursive:true});
  const state=await setup(page,width);
  await openLibrary(page,BASE);
  await libraryTopMenu(page,'select');
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await page.locator('[data-lu-pick="n1"]').click();
  await expect(page.locator('#librarySelectCount')).toHaveText('1개 골랐음');
  const m=await measureActBar(page,'#librarySelectBar .lu-select-acts');
  checkActBar(m,(a,e,l)=>expect(a,l).toEqual(e),`자료실 고르기 줄 ${width}`);
  expect(m.n,'바꾸기 셋·(옮기기)·삭제·취소').toBeGreaterThanOrEqual(5);
  expect(m.dangerText,'삭제 글자 빨강').not.toBe(await page.locator('#librarySelectCancel').evaluate(b=>getComputedStyle(b).color));
  await page.screenshot({path:`${DIR}/s48-54-library-select-${width}.png`});
  process.stdout.write(`::notice title=s48-54 library ${width}::${JSON.stringify({n:m.n,widths:m.widths,rows:m.rows,bar:m.barWidth})}\n`);
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});
