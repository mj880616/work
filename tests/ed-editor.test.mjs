import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import MarkdownIt from '../app/markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
import {orderedLabel,bulletGlyph,autoMarker,cleanDoc,emptyDoc,isEmptyDoc,safeHref,nextCircled,circled,circledValue,docBytes,TEXT_STYLES} from '../app/ed-schema.mjs';
import {toPlain,toTelegram,toHangul,RULE_TEXT} from '../app/ed-text.mjs';
import {markdownToDoc,plainToDoc} from '../app/ed-markdown.mjs';
// ED-통합편집기 ①a: 편집기 라이브러리 반입(버전 한 곳·해시·라이선스·같은 주소만), 저장 형식 ed1 정리(허용 목록),
// 글자 꺼내기(raw_text·텔레그램·한글), [서식으로 바꾸기] 변환, 읽기 그리기 모듈의 옛 삼성 문법 규칙.
const pin=JSON.parse(readFileSync('scripts/editor/editor-pin.json','utf8'));
const dir=pin.folder,name=`${pin.bundle.name}-${pin.bundle.version}`;
const md=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:false});
const p=(text,attrs={style:'body2'})=>({type:'paragraph',attrs,...(text?{content:[{type:'text',text}]}:{})});
const doc=(...content)=>({v:'ed1',doc:{type:'doc',content}});

test('one pinned editor bundle is used by the vendored folder and the editor module',()=>{
  assert.equal(dir,'app/editor-lib');
  assert.deepEqual(readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name),[name]);
  const editor=readFileSync('app/ed-editor.js','utf8');
  assert.deepEqual([...new Set([...editor.matchAll(/editor-lib\/(pm-ed1-[\d.]+)\//g)].map(m=>m[1]))],[name]);
  const source=readFileSync(`${dir}/SOURCE.md`,'utf8');
  for(const [pkg,spec] of Object.entries(pin.packages)){
    assert.match(spec.version,/^\d+\.\d+\.\d+$/,pkg);
    assert.match(spec.integrity,/^sha512-/,pkg);
    assert.equal(spec.license,'MIT',pkg);
    assert.ok(source.includes(spec.integrity),pkg);
  }
  const license=readFileSync(`${dir}/${name}/LICENSE`,'utf8');
  for(const pkg of Object.keys(pin.packages))assert.ok(license.includes(`== ${pkg}@${pin.packages[pkg].version}`),pkg);
});

test('vendored files match the recorded hashes and stay small',()=>{
  const rows=readFileSync(`${dir}/SHA256SUMS`,'utf8').trim().split('\n').map(line=>line.split(/  /));
  let total=0;
  for(const [hash,path] of rows){const data=readFileSync(`${dir}/${path}`);total+=data.length;assert.equal(createHash('sha256').update(data).digest('hex'),hash,path);}
  assert.ok(rows.some(([,path])=>path===`${name}/${pin.bundle.file}`));
  assert.ok(total<600*1024,`${total} bytes`);
});

test('the editor loads only same-origin files; readers never load the editor bundle',()=>{
  const strip=s=>s.replace(/^\s*\/\/.*$/gm,'');
  const editor=strip(readFileSync('app/ed-editor.js','utf8'));
  // No outside address (the link box's "https://…" hint and the https:// it puts before "example.org" name no host).
  // (The SVG namespace name for the drawn icons is an identifier, not an address anything is loaded from.)
  assert.doesNotMatch(editor.replaceAll('http://www.w3.org/2000/svg',''),/https?:\/\/[a-z0-9]/i);
  assert.doesNotMatch(editor,/\?v=/);
  assert.doesNotMatch(editor,/innerHTML\s*=/);
  for(const file of ['app/ed-render.mjs','app/ed-schema.mjs','app/ed-text.mjs','app/ed-markdown.mjs']){
    const src=strip(readFileSync(file,'utf8'));
    assert.doesNotMatch(src,/editor-lib|import\(/,file);
    assert.doesNotMatch(src,/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/,file);
  }
});

test('the Web1 reader modules keep to syntax older Samsung Internet parses and never say "share" in class names',()=>{
  for(const file of ['app/ed-render.mjs','app/ed-schema.mjs']){
    const src=readFileSync(file,'utf8').replace(/^\s*\/\/.*$/gm,'');
    assert.doesNotMatch(src,/\?\.|\?\?|replaceChildren|structuredClone|\.at\(/,file);
  }
  const css=readFileSync('app/ed-doc.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  assert.doesNotMatch(css,/share/i);
  assert.doesNotMatch(readFileSync('app/ed-render.mjs','utf8').replace(/^\s*\/\/.*$/gm,''),/share/i);
});

test('cleanDoc keeps the allowed form and drops everything else, keeping letters',()=>{
  assert.equal(cleanDoc(null),null);
  assert.equal(cleanDoc({v:'ed1',doc:{type:'nope'}}),null);
  assert.deepEqual(cleanDoc({v:'ed1',doc:{type:'doc',content:[]}}),emptyDoc());
  const dirty={v:'ed1',doc:{type:'doc',content:[
    {type:'paragraph',attrs:{style:'body9',align:'diagonal',indent:99,onclick:'x'},content:[
      {type:'text',text:'가\u0000나',marks:[{type:'strong'},{type:'strong'},{type:'font',attrs:{}}]},
      {type:'text',text:'링크',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]},
      {type:'text',text:'좋은',marks:[{type:'link',attrs:{href:'https://ok.example/a'}}]},
    ]},
    {type:'script',content:[{type:'text',text:'남는 글'}]},
    {type:'heading',attrs:{level:7,align:'center'},content:[{type:'text',text:'제목'}]},
    {type:'image',attrs:{src:'https://evil.example/x.png',alt:'설명'}},
    {type:'image',attrs:{src:'share:abc_123',alt:'공유'}},
    {type:'bullet_list',content:[]},
    {type:'table',content:[{type:'table_row',content:[{type:'table_header',attrs:{colspan:99},content:[]}]}]},
  ]}};
  const c=cleanDoc(dirty).doc.content;
  assert.deepEqual(c[0].attrs,{style:'body2'});
  assert.deepEqual(c[0].content,[{type:'text',text:'가나',marks:[{type:'strong'}]},{type:'text',text:'링크'},{type:'text',text:'좋은',marks:[{type:'link',attrs:{href:'https://ok.example/a'}}]}]);
  assert.deepEqual(c[1],p('남는 글'));
  assert.deepEqual(c[2].attrs,{level:2,align:'center'});
  assert.deepEqual(c[3].attrs,{src:null,alt:'설명'});
  assert.deepEqual(c[4].attrs,{src:'share:abc_123',alt:'공유'});
  assert.equal(c[5].type,'table');
  assert.deepEqual(c[5].content[0].content[0],{type:'table_header',attrs:{colspan:1,rowspan:1},content:[p('')]});
  assert.equal(c.length,6);
});

test('cleanDoc stops at its limits instead of looping on deep or huge input',()=>{
  let deep={type:'paragraph',content:[{type:'text',text:'끝'}]};
  for(let i=0;i<200;i++)deep={type:'blockquote',content:[deep]};
  assert.ok(cleanDoc({type:'doc',content:[deep]}));
  const many={type:'doc',content:Array.from({length:30000},()=>p('가'))};
  assert.ok(cleanDoc(many).doc.content.length<=20000);
  assert.ok(docBytes(doc(p('가')))>0);
  assert.equal(isEmptyDoc(emptyDoc()),true);
  assert.equal(isEmptyDoc(doc(p('가'))),false);
});

test('safeHref accepts http(s)·mailto only',()=>{
  assert.equal(safeHref('https://a.example/'),'https://a.example/');
  assert.equal(safeHref('mailto:x@example.org'),'mailto:x@example.org');
  for(const bad of ['javascript:alert(1)','data:text/html,x','vbscript:x','/relative','file:///etc','',null])assert.equal(safeHref(bad),null,String(bad));
});

test('[①] gives the next circled number after the nearest one',()=>{
  assert.equal(nextCircled('',[]),'①');
  assert.equal(nextCircled('① 첫째 ',[]),'②');
  assert.equal(nextCircled('',['② 둘째','① 첫째']),'③');
  assert.equal(nextCircled('',['그냥 줄','③ 셋째']),'④');
  assert.equal(nextCircled('',['','① 첫째']),'①');
  assert.equal(nextCircled('',[null,'① 첫째']),'①');
  assert.equal(nextCircled('⑳',[]),'㉑');
  assert.equal(nextCircled('㊿',[]),'①');
  for(let n=1;n<=50;n++)assert.equal(circledValue(circled(n)),n);
  assert.deepEqual(TEXT_STYLES.map(([v])=>v),['h1','h2','h3','body1','body2','body3']);
});

const sample=doc(
  {type:'heading',attrs:{level:1},content:[{type:'text',text:'회의 결과'}]},
  {type:'paragraph',attrs:{style:'body2'},content:[{type:'text',text:'2026.10.21. 교섭'},{type:'hard_break'},{type:'text',text:'굵게',marks:[{type:'strong'}]}]},
  {type:'bullet_list',content:[{type:'list_item',content:[p('하나')]},{type:'list_item',content:[p('둘')]}]},
  {type:'ordered_list',attrs:{order:3},content:[{type:'list_item',content:[p('셋')]},{type:'list_item',content:[p('넷')]}]},
  {type:'blockquote',content:[p('인용 글')]},
  {type:'horizontal_rule'},
  {type:'table',content:[
    {type:'table_row',content:[{type:'table_header',content:[p('항목')]},{type:'table_header',content:[p('값')]}]},
    {type:'table_row',content:[{type:'table_cell',content:[p('가')]},{type:'table_cell',content:[p('1')]}]}]},
  {type:'image',attrs:{src:null,alt:'현장'}},
  {type:'paragraph',attrs:{style:'body2',align:'center'},content:[{type:'text',text:'끝',marks:[{type:'underline'}]}]},
);

test('toPlain: raw_text for search·AI·journal, with no format marks',()=>{
  assert.equal(toPlain(sample),['회의 결과','','2026.10.21. 교섭','굵게','','- 하나','- 둘','','3. 셋','4. 넷','','인용 글','',RULE_TEXT,'','항목 | 값','가 | 1','','[사진: 현장]','','끝'].join('\n'));
  assert.equal(toPlain(null),'');
  assert.equal(toPlain(emptyDoc()),'');
});

test('toTelegram: bullets "• " and the same letters',()=>{
  const t=toTelegram(sample);
  assert.match(t,/^회의 결과\n\n/);
  assert.match(t,/\n• 하나\n• 둘\n/);
  assert.match(t,/\n3\. 셋\n4\. 넷\n/);
  assert.doesNotMatch(t,/\*\*|__|~~/);
});

test('toHangul: escaped HTML with heading, bold, underline, table and center; tab-separated table text',()=>{
  const {text,html}=toHangul(doc(p('<b>&'),...sample.doc.content));
  assert.ok(html.includes('&lt;b&gt;&amp;'));
  assert.doesNotMatch(html,/<script|on\w+=/i);
  assert.ok(html.includes('font-size:16pt'));
  assert.ok(html.includes('<b>굵게</b>'));
  assert.ok(html.includes('<u>끝</u>'));
  assert.ok(html.includes('text-align:center'));
  assert.match(html,/<table[^>]*><tr><th[^>]*>항목<\/th><th[^>]*>값<\/th><\/tr>/);
  assert.ok(text.includes('항목\t값\n가\t1'));
});

test('[서식으로 바꾸기]: markdown letters become structure; images stay letters; unsafe links lose their link',()=>{
  const v=markdownToDoc(md,'## 회의\n\n**결정**: 진행\n\n3. 셋\n4. 넷\n\n> [!NOTE]\n> 참고 글\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |\n\n![사진](https://x.example/a.png)\n\n[나쁜](javascript:alert(1)) [좋은](https://ok.example/)\n\n```\ncode **그대로**\n```');
  const c=v.doc.content;
  assert.deepEqual(c[0],{type:'heading',attrs:{level:2},content:[{type:'text',text:'회의'}]});
  assert.deepEqual(c[1].content[0],{type:'text',text:'결정',marks:[{type:'strong'}]});
  assert.equal(c[2].type,'ordered_list');
  assert.equal(c[2].attrs.order,3);
  assert.equal(c[3].type,'blockquote');
  assert.deepEqual(c[3].content[0].content[0],{type:'text',text:'참고:',marks:[{type:'strong'}]});
  assert.equal(c[4].type,'table');
  assert.equal(c[4].content[0].content[0].type,'table_header');
  assert.match(toPlain({v:'ed1',doc:{type:'doc',content:[c[5]]}}),/이미지: 사진 \(https:\/\/x\.example\/a\.png\)/);
  // The unsafe link stays letters (never a link mark).
  assert.ok(c[6].content.every(n=>!(n.marks||[]).some(m=>m.type==='link'&&/javascript/.test(m.attrs.href))));
  assert.equal(c[6].content.filter(n=>(n.marks||[]).some(m=>m.type==='link')).length,1);
  assert.ok(JSON.stringify(c[6]).includes('https://ok.example/'));
  assert.deepEqual(c[7],{type:'code_block',content:[{type:'text',text:'code **그대로**'}]});
  assert.ok(!JSON.stringify(v).includes('"image"'));
});

test('plainToDoc: one paragraph per line, numbers and dashes stay letters',()=>{
  const v=plainToDoc('1. 하나\n\n- 둘\n2026.10.21. 회의');
  assert.deepEqual(v.doc.content.map(n=>n.type),['paragraph','paragraph','paragraph','paragraph']);
  assert.equal(toPlain(v),'1. 하나\n\n\n\n- 둘\n\n2026.10.21. 회의'.replace(/\n{3,}/g,'\n\n'));
});

const li=(...c)=>({type:'list_item',content:c});
test('list marker shapes: kept by cleanDoc, unknown names dropped',()=>{
  const v=cleanDoc(doc(
    {type:'ordered_list',attrs:{order:1,marker:'hangul'},content:[li(p('가'))]},
    {type:'bullet_list',attrs:{marker:'square'},content:[li(p('나'))]},
    {type:'bullet_list',attrs:{marker:'star'},content:[li(p('다'))]},
    {type:'ordered_list',attrs:{marker:'roman'},content:[li(p('라'))]}));
  assert.deepEqual(v.doc.content.map(n=>n.attrs?.marker),['hangul','square',undefined,undefined]);
});

test('list marker labels and the automatic order by depth',()=>{
  assert.deepEqual(['decimal','paren','parens','circled','hangul'].map(m=>orderedLabel(m,0,2)),['2.','2)','(2)','②','나.']);
  assert.equal(orderedLabel('hangul',0,15),'15.');
  assert.deepEqual([0,1,2,3,4].map(d=>orderedLabel(null,d,1)),['1.','1)','(1)','①','①']);
  assert.deepEqual([0,1,2,3].map(d=>bulletGlyph(null,d)),['•','◦','▪','▪']);
  assert.deepEqual(['disc','dash','circle','square'].map(m=>bulletGlyph(m,0)),['•','-','◦','▪']);
  assert.equal(autoMarker('ordered',9),'circled');
});

test('exports keep list marker shapes: 한글 copy (text and html), telegram, and plain only when a shape is saved',()=>{
  const nested=doc(
    {type:'ordered_list',content:[li(p('가'),{type:'ordered_list',content:[li(p('나'),{type:'ordered_list',content:[li(p('다'),{type:'ordered_list',content:[li(p('라'))]})]})]})]},
    {type:'ordered_list',attrs:{order:1,marker:'hangul'},content:[li(p('마')),li(p('바'))]},
    {type:'bullet_list',attrs:{marker:'dash'},content:[li(p('사'))]},
    {type:'bullet_list',content:[li(p('아'),{type:'bullet_list',content:[li(p('자'),{type:'bullet_list',content:[li(p('차'))]})]})]});
  const h=toHangul(nested);
  for(const line of ['1. 가','1) 나','(1) 다','① 라','가. 마','나. 바','- 사','• 아','◦ 자','▪ 차']){
    assert.ok(h.text.includes(line),`text ${line}`);
    assert.ok(h.html.includes(line),`html ${line}`);
  }
  assert.ok(toTelegram(nested).includes('① 라'));
  assert.ok(toTelegram(nested).includes('• 아'));
  // raw_text (search, AI) keeps the old "1. " and "- " unless a shape was chosen.
  const plain=toPlain(nested);
  assert.ok(plain.includes('1. 가')&&plain.includes('1. 나')&&plain.includes('1. 라'));
  assert.ok(plain.includes('가. 마')&&plain.includes('- 아')&&plain.includes('- 사'));
});

// ED-서식줄묶음 (2026-10-23 사용자 13:16, UI-화면정리 C 2026-10-28: [·][▾] 두 칸 → [· ▾] 한 칸): 폰 서식 줄은 [본문 2 ▾][굵게][· ▾][글자 ▾][문단 ▾][넣기 ▾][기호 ▾][↶][↷] 한 줄이고,
// 지금 있는 모든 버튼이 묶음 안에 같은 버튼(같은 명령)으로 들어 있다. 브라우저 없이 소스의 표를 읽어 구성·순서·빠짐을 본다.
const edSource=readFileSync('app/ed-editor.js','utf8');
const tableOf=name=>{const m=new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n?\\]);`).exec(edSource);assert.ok(m,name);return Function(`'use strict';const GROUP_KEYS=['gText','gPara','gInsert','gSym'];return (${m[1]})`)();};
test('phone toolbar: one grouped row in the requested order, every button still reachable once',()=>{
  const phone=tableOf('PHONE_ORDER'),groups=tableOf('GROUPS');
  assert.deepEqual(phone,['style','strong','symDot','gText','gPara','gInsert','gSym','undo','redo']);
  assert.deepEqual(groups.map(g=>[g[0],g[1]]),[['gText','글자 ▾'],['gPara','문단 ▾'],['gInsert','넣기 ▾'],['gSym','기호 ▾']]);
  const items=Object.fromEntries(groups.map(g=>[g[0],g[3]]));
  assert.deepEqual(items.gText,['em','underline','strike','color','highlight','clear']);
  assert.deepEqual(items.gPara,['align','bullet','ordered','indent','outdent','quote','rule']);
  assert.deepEqual(items.gInsert,['table','photo','link','plainPaste']);
  assert.deepEqual(items.gSym,['symNote','symArrow','symCircled','symBracket']);
  // Every existing button (the row and the [⌄] list) is on the phone row or in exactly one group, none twice.
  const tables=edSource.slice(edSource.indexOf('const BUTTONS = ['),edSource.indexOf('const ALIGNS'));
  const keys=[...tables.matchAll(/\['(\w+)', '[^']*', (?:'[^']*'|null)(?:, '\w+')?\]/g)].map(m=>m[1]);
  const existing=keys.filter(k=>!['rowBefore','rowAfter','colBefore','colAfter','rowDel','colDel','merge','split','head','fit','select','tableDel'].includes(k)&&!/^g[A-Z]/.test(k));
  const placed=[...phone.filter(k=>!/^g[A-Z]/.test(k)),...Object.values(items).flat()];
  assert.equal(new Set(placed).size,placed.length,'no button twice');
  assert.deepEqual([...new Set(existing)].filter(k=>!placed.includes(k)),[],'no button lost on a phone');
});
test('phone toolbar: grouping only moves the same button nodes (no copies, so each runs its old command)',()=>{
  const fn=/function setGrouped\(on\)[\s\S]*?\n  \}\n/.exec(edSource)[0];
  assert.match(fn,/tools\.replaceChildren\(\.\.\.PHONE_ORDER\.map\(k => buttons\[k\]\)/);
  // UI-화면정리 C: 폰도 PC와 같은 [· ▾] 한 칸. 따로 떨어진 [·]·[▾] 두 칸(점 넣기 단추·ed-pair)은 다시 생기지 않는다.
  assert.doesNotMatch(edSource,/dotNow|ed-pair/);
  assert.doesNotMatch(readFileSync('app/ed-doc.css','utf8'),/ed-pair/);
  assert.match(fn,/panels\[key\]\.replaceChildren\(\.\.\.items\.map\(k => buttons\[k\]\)/);
  assert.doesNotMatch(fn,/btn\(|createElement|cloneNode/);
  assert.match(fn,/tools\.replaceChildren\(\.\.\.homeTools, more\)/);
  assert.match(fn,/panels\.more\.replaceChildren\(\.\.\.homeMore\)/);
  // The group buttons open through the same panel switch.
  assert.match(edSource,/gText: 'gText', gPara: 'gPara', gInsert: 'gInsert', gSym: 'gSym'/);
  assert.match(edSource,/matchMedia\('\(max-width: 760px\)'\)/);
});
