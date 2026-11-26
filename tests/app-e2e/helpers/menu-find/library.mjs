import {bootLibrary,libDoc} from '../library-folder-server.mjs';
// 자료실(S70-54 ②): 맨 위 칸 '자료실에서 찾기' = luQuery → luRenderLibrary.
export default {
  name:'자료실',label:'자료실에서 찾기',query:'결의',before:2,after:1,
  rows:page=>page.locator('#documentList [data-lu-document]'),
  settle:page=>page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true)),
  async open(page,width){
    await bootLibrary(page,width,{docs:[libDoc('d1',null,{category:'정책',title:'가상 요구안'}),libDoc('d2',null,{category:'투쟁',title:'가상 결의문'})]});
  },
};
