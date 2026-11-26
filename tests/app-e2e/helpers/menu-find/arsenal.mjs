import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeMatches, filterMatches} from '../../../../app/arsenal-model.mjs';
import {openHome} from '../home-entry.mjs';
// 아스날(S70-57): 맨 위 칸 '아스날에서 찾기' = 경기 목록 상대·제목 거르기(옛 화면 안 '상대 검색' 칸, arsenal.js filters.query → filterMatches).
// 경기 자료는 저장소 app/arsenal/matches.js 그대로(경기가 더해져도 개수는 같은 규칙으로 센다).
const ctx = {window: {}};
runInNewContext(readFileSync(new URL('../../../../app/arsenal/matches.js', import.meta.url), 'utf8'), ctx);
const all = normalizeMatches(ctx.window.ARSENAL_MATCHES), query = '아틀레티코', hit = filterMatches(all, {query});
export default {
  name:'아스날',label:'아스날에서 찾기',query,before:all.length,after:hit.length,match:hit[0]?.title,
  rows:page=>page.locator('#arsenalRoot [data-ars-row]'),
  async open(page){
    await openHome(page);
    await page.evaluate(()=>window.KPTURouter.go('arsenal'));
    await expect(page.locator('#arsenalView')).toBeVisible();
  },
};
