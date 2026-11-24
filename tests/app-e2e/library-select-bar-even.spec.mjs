import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {setup,openLibrary} from './helpers/library-multi-delete-scenario.mjs';
import {libraryTopMenu} from './helpers/library-tree.mjs';
import {measureActBar,checkTextBar,textBarRows} from './helpers/act-bar-measure.mjs';
// UI-고르기줄(S48-54, 요청함 11/03 07:44 ③): 자료실 고르기 줄도 노트와 같은 공용 부품(.kptu-actbar-text).
// S69(명진 11/24 "선택됨 사업영역 바꾸기 ~~~ 메뉴가 양쪽 정렬이라 이상함. 왼쪽 정렬"): 'n개 선택됨' 바로 뒤 왼쪽부터 촘촘히·같은 작은 간격,
// 글자 잘림·가로 넘침 없음(좁으면 다음 줄 왼쪽부터), [취소]는 왼쪽 무리 끝, [삭제]는 글자만 빨강. 가짜 서버만 쓴다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const DIR='test-results/ui-audit';
for(const width of [412,768,1280])test(`UI-선택줄: 자료실 선택 줄 왼쪽부터 촘촘히 ${width}px`,async({page})=>{
  test.setTimeout(60000);mkdirSync(DIR,{recursive:true});
  const state=await setup(page,width);
  await openLibrary(page,BASE);
  await libraryTopMenu(page,'select');
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await page.locator('[data-lu-pick="n1"]').click();
  await expect(page.locator('#librarySelectCount')).toHaveText('1개 선택됨');
  const m=await measureActBar(page,'#librarySelectBar .lu-select-acts');
  checkTextBar(m,await textBarRows(page,'#librarySelectBar .lu-select-acts'),(a,e,l)=>expect(a,l).toEqual(e),`자료실 선택 줄 ${width}`);
  // 'n개 선택됨' 글자 바로 뒤에 첫 칸이 붙는다(줄 끝으로 밀리지 않음), [취소]는 맨 끝 칸이고 줄 오른쪽 끝에 붙지 않는다(넓은 화면).
  const g=await page.evaluate(()=>{const c=document.querySelector('#librarySelectCount').getBoundingClientRect(),acts=[...document.querySelectorAll('#librarySelectBar .lu-select-acts > .kptu-act')].filter(b=>b.getClientRects().length),first=acts[0].getBoundingClientRect(),last=acts.at(-1),bar=document.querySelector('#librarySelectBar').getBoundingClientRect();return {sameRow:Math.abs((first.top+first.height/2)-(c.top+c.height/2))<6,afterCount:first.left-c.right,lastId:last.id,tail:bar.right-last.getBoundingClientRect().right}});
  expect(g.lastId).toBe('librarySelectCancel');
  if(g.sameRow)expect(g.afterCount,'선택됨 글자 바로 뒤').toBeLessThanOrEqual(16);
  if(width>=1280)expect(g.tail,'오른쪽에 빈 자리가 남는다(퍼뜨리지 않음)').toBeGreaterThan(100);
  expect(m.n,'바꾸기 셋·(옮기기)·삭제·취소').toBeGreaterThanOrEqual(5);
  expect(m.dangerText,'삭제 글자 빨강').not.toBe(await page.locator('#librarySelectCancel').evaluate(b=>getComputedStyle(b).color));
  await page.screenshot({path:`${DIR}/s48-54-library-select-${width}.png`});
  process.stdout.write(`::notice title=s48-54 library ${width}::${JSON.stringify({n:m.n,widths:m.widths,rows:m.rows,bar:m.barWidth})}\n`);
  expect(state.deletes).toEqual([]);
  expect(state.errors).toEqual([]);
});
