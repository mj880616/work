import {expect} from '@playwright/test';
import {openHome, OPERATOR_MENU_FEATURES} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 업데이트 기록(S71-31 RELNOTE-머리줄정리): 맨 위 칸 '업데이트 기록에서 찾기' = 개발 기록 목록 거르기(release-notes-ui.js — 화면 안 '낱말로 찾기' 칸을 없앴다).
// 운영자만 여는 화면(서버 허용 dev_inbox). 기록 글은 지어낸 것.
const note=(v,changes)=>({v,date:'2026-10-05',changes,checks:[]});
const notes={schema:1,current:'10/5-3',notes:[note('10/5-3',['노트 폴더가 생겼어요']),note('10/5-2',['사진 메뉴가 빨라졌어요']),note('10/5-1',['일정 색을 고를 수 있어요'])]};
export default {
  name:'업데이트 기록',label:'업데이트 기록에서 찾기',query:'사진',before:3,after:1,match:'10/5-2',
  rows:page=>page.locator('#updatesView .rn-note'),
  async open(page){
    // 기록은 시작 때 계정 메뉴 판 이름이 먼저 읽어 이 탭에 기억하므로, 앱을 열기 전에 흉내 낸 서버 답을 건다.
    await openHome(page,{features:[...OPERATOR_MENU_FEATURES,'dev_inbox'],beforeLoad:async()=>{
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_release_notes_read',r=>r.fulfill({json:notes}));
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_update_news_admin',r=>r.fulfill({json:{start_on:'2026-10-01',users:1,items:[]}}));
    }});
    await page.evaluate(()=>window.KPTURouter.go('updates'));
    await expect(page.locator('#updatesView .rn-note').first()).toBeVisible({timeout:15000});
  },
};
