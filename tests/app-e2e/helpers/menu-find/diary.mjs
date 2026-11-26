import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 하루 기록(S70-57): 맨 위 칸 '하루 기록에서 찾기' = [목록] 보기의 하루 기록 글 찾기(diary-list.js setQuery, 옛 [data-diary-lv-q] 칸 자리).
// 흉내 낸 하루 기록 2편(같은 달). 글은 지어낸 것.
const at='2026-10-05T01:00:00Z';
const diary=(id,day,raw_text)=>({id,workspace_id:'w',kind:'diary',title:null,journal_day:day,raw_text,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}});
export default {
  name:'하루 기록',label:'하루 기록에서 찾기',query:'산책',before:2,after:1,match:'가을 산책',
  rows:page=>page.locator('#diaryRoot [data-diary-all] [data-diary-lv-open]'),
  async open(page){
    const rows=[diary('d3','2026-10-03','가을 산책 다녀옴'),diary('d4','2026-10-04','글만 쓴 날')];
    await openHome(page);
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{const q=new URL(r.request().url()).searchParams;
      if(r.request().method()!=='GET')return r.fallback();if(q.get('metadata'))return r.fulfill({json:[]});
      return r.fulfill({json:rows.filter(x=>!q.get('kind')||'eq.'+x.kind===q.get('kind'))})});
    await page.evaluate(()=>window.KPTURouter.go('diary'));
    await expect(page.locator('#diaryView')).toBeVisible();
    await page.locator('#diaryRoot [data-diary-view="list"]').click();
    await expect(page.locator('#diaryRoot [data-diary-all]')).toBeVisible();
  },
};
