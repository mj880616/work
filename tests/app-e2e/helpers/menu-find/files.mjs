import {start, openFiles, treeGo, enterRow} from '../files-server.mjs';
// 파일(S70-57): 맨 위 칸 '파일에서 찾기' = 지금 칸의 찾기(setQuery — 이름 + 자료실이 읽은 글자, 치면 잠깐 뒤 흉내 서버 app_cloud_find_in).
// 화면 안 찾기 칸(.fx-search)은 없앴다. 원드라이브 '가짜 문서함' 목록(4줄)에서 '예산' → 1줄.
export default {
  name:'파일',label:'파일에서 찾기',query:'예산',before:4,after:1,match:'가짜 예산표.xlsx',
  rows:page=>page.locator('#filesRoot [data-fx-list] [data-fx-row]'),
  async open(page,width){
    await start(page,width);
    await openFiles(page,width);
    await treeGo(page,'od','');
    await enterRow(page,page.locator('#filesRoot [data-fx-row="od:OD!1"]'));
  },
};
