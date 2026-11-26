import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
import {installTgServer,telegramRows} from '../tg-room-day-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 텔레그램 소식(S70-57): 맨 위 칸 '텔레그램 소식에서 찾기' = 날짜별 방·날 목록 거르기(telegram-feed.js lineHit — 방 이름·줄 글).
// 방 상세 안에서는 같은 칸이 그 방 찾기를 맡는다(tg-room-view.spec.mjs). 서버는 흉내(tg-room-day-server.mjs), 이름·내용은 지어낸 것.
export default {
  name:'텔레그램 소식',label:'텔레그램 소식에서 찾기',query:'간부방',before:5,after:2,match:'예시 간부방',
  rows:page=>page.locator('#tgList [data-tg-rd]'),
  async open(page){
    await openHome(page,{beforeLoad:async()=>{
      for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
      await installTgServer(page,{items:telegramRows()});
    }});
    await page.evaluate(()=>window.KPTURouter.go('telegram'));
    await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
  },
};
