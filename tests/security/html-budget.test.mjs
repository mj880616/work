import test from 'node:test';
import assert from 'node:assert/strict';
import {createHtmlBudget,escapedChunks} from '../../supabase/functions/drive-summary/html-budget.mjs';
const encode=text=>new TextEncoder().encode(text).length;
test('exact whole HTML budget reserves its suffix and uses actual UTF8 escaped fragment bytes',()=>{
 const s=createHtmlBudget(14,'</p>');assert.equal(s.append('<p>'),true);assert.equal(s.append('한😀'),true);assert.equal(s.append('x'),false);assert.equal(s.finish(),'<p>한😀</p>');assert.equal(encode(s.finish()),14);
});
test('escape chunks preserve baseline bytes for surrogate/control/CRLF/html at actual4096 boundary',()=>{
 const values=['x'.repeat(4095)+'😀&\r\n한글<>"\'', 'x'.repeat(4095)+'\uD800', '\r'.repeat(4096)+'\n', '\u0001'.repeat(16384)];
 for(const text of values){const actual=[...escapedChunks(text,true)].join('');const expected=text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\r/g,'&#13;');assert.equal(actual,expected);assert.equal(encode(actual),encode(expected));}
});
