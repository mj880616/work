import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countColors,compareColors,checkBaseline} from './hardcoded-colors.mjs';
test('direct colors never exceed baseline',()=>assert.deepEqual(checkBaseline().errors,[]));
test('new hex or rgb colors in existing and new files fail',()=>{
 const baseline={'ui.css':1};
 for(const color of ['#abc','#abcd','#abcdef','#abcdef12','rgb(1,2,3)','rgba(1,2,3,.2)']){
  const count=countColors('ui.css','a{color:#fff;background:'+color+'}');
  assert.equal(count,2);assert.equal(compareColors({'ui.css':count},baseline).errors.length,1);
  assert.equal(compareColors({'new.js':countColors('new.js','const color="'+color+'"')},baseline).errors.length,1);
 }
});
test('decreases pass and request baseline refresh',()=>{
 const result=compareColors({'ui.css':0},{'ui.css':1});assert.deepEqual(result.errors,[]);assert.equal(result.reduced.length,1);
});
test('only approved exclusions skip colors',()=>{
 assert.equal(countColors('base-ui.css',':root{--kptu-bg:#fff} #abc{color:#123}'),1);
 for(const name of ['theme-tokens.css','page-design-core.js','public-page-editor.js'])assert.equal(countColors(name,'color:#fff'),0);
 assert.equal(countColors('other.js','const color="#fff"'),1);
});
