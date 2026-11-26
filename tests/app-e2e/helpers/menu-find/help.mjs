import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
// 쓰는 법(S71-33 HELP-머리한줄): 맨 위 칸 '쓰는 법에서 찾기' = 쓰는 법 줄 거르기(help.js matchTopic — 이름·설명·따라하기 글).
// 폰 틀은 묶음별 줄(details), PC 틀은 왼쪽 목차 단추. 운영자 기능이 없는 계정(16줄).
export default {
  name:'쓰는 법',label:'쓰는 법에서 찾기',query:'PDF 스캔',before:16,after:1,match:'브리핑 룸',
  rows:page=>page.locator((page.viewportSize()?.width||1280)>760?'#helpView [data-hp-pick]':'#helpView details.hp-item'),
  async open(page){
    await openHome(page,{features:[]});
    await page.evaluate(()=>window.KPTURouter.go('help'));
    await expect(page.locator('#helpView')).toBeVisible();
  },
};
