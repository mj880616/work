// UI-화면폭넘침: grid의 칸 폭에 맨몸 `1fr`을 쓰면 안쪽 긴 글(줄바꿈 없는 제목·긴 주소) 폭만큼 칸이 늘어 화면이 폰 폭보다 넓어진다.
// 칸은 `minmax(0,1fr)`로 쓴다. 이 시험은 app/ 안의 CSS·JS·HTML 에서 맨몸 `Nfr` 칸 폭이 다시 생기면 실패한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

const SKIP=/hwp-lab|pdf-lib|editor-lib|node_modules|\.min\./;
function walk(dir,out=[]){
  for(const name of readdirSync(dir)){
    const p=join(dir,name);
    if(SKIP.test(p))continue;
    const st=statSync(p);
    if(st.isDirectory())walk(p,out);else if(/\.(css|js|mjs|html)$/.test(name))out.push(p);
  }
  return out;
}
test('grid-template-columns 에 맨몸 fr 칸 폭이 없다',()=>{
  const bad=[];
  for(const file of walk('app')){
    const text=readFileSync(file,'utf8');
    for(const m of text.matchAll(/grid-template-columns:\s*([^;}"'`]*)/g)){
      const value=m[1].replace(/minmax\([^)]*\)/g,'').replace(/repeat\(\s*auto-(?:fit|fill)\s*,[^)]*\)/g,'');
      if(/(^|[\s,(])\d*\.?\d+fr\b/.test(value))bad.push(`${file}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(bad,[],`맨몸 fr 는 minmax(0,Nfr) 로 쓴다:\n${bad.join('\n')}`);
});
