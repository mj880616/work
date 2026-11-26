import {start} from '../news-server.mjs';
// 읽을 거리(S70-54 ②): 맨 위 칸 '읽을 거리에서 찾기' = setQuery(제목·문장 거르기).
export default {
  name:'읽을 거리',label:'읽을 거리에서 찾기',query:'키워드',before:5,after:1,match:'가짜 키워드 기사',
  rows:page=>page.locator('#outsideRoot [data-nw-key]'),
  async open(page,width){
    await start(page,width);
    await page.evaluate(()=>window.KPTURouter.go('outside'));
    await page.locator('#outsideRoot [data-nw-key="news:c1"]').waitFor();
  },
};
