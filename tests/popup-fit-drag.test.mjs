// UI-창잘림·끌어옮기기: 버튼 옆 작은 창의 폭은 공용 부품(anchored-popup.js placeAnchored·createChoiceSheet width)이 정한다.
// 창마다 CSS로 따로 넓히면(min-width·width) 계산보다 넓게 그려져 화면 밖으로 잘리므로 다시 생기지 않게 막는다.
// 끌어 옮기기는 공용 dragByTitle 하나이고, 옮긴 자리는 어디에도 저장하지 않는다(닫으면 잊음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const app=new URL('../app/',import.meta.url);
const read=name=>readFileSync(new URL(name,app),'utf8');

test('no stylesheet widens an anchored choice sheet on its own',()=>{
  const bad=[];
  for(const name of readdirSync(app).filter(n=>n.endsWith('.css'))){
    const css=read(name).replace(/\/\*[\s\S]*?\*\//g,'');
    for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const panelLevel=m[1].replace(/\([^()]*\)/g,g=>g.replace(/,/g,'|')).split(',').some(sel=>/\.home-choice-anchored\s*$/.test(sel.trim()));
      if(panelLevel&&/(^|[;\s])(min-|max-)?width\s*:/.test(m[2]))bad.push(`${name}: ${m[1].trim()}`);
    }
  }
  assert.deepEqual(bad,[]);
});

test('the shared parts measure the drawn box and drag by the title row only',()=>{
  const popup=read('anchored-popup.js'),sheet=read('choice-sheet.js'),menu=read('anchored-menu.js');
  assert.match(popup,/export function keepInside\(/);assert.match(popup,/export function dragByTitle\(/);
  assert.match(popup,/keepInside\(panel,edge\);\n  return side;/);
  assert.match(popup,/delete panel\.dataset\.anchorMoved/);
  assert.doesNotMatch(popup,/localStorage|sessionStorage|indexedDB/);
  assert.match(sheet,/<header class="anchored-drag-title">/);assert.match(sheet,/dragByTitle\(sheet,'header'\)/);
  assert.match(sheet,/maxWidth:width\|\|/);
  assert.match(read('report-area-tag.js'),/width:420\}/);
  // ⋯ menus have no title row: they are not dragged, and their left edge uses the width they were really drawn at.
  assert.doesNotMatch(menu,/dragByTitle/);assert.match(menu,/const box=panel\.getBoundingClientRect\(\),width=box\.width/);
});
