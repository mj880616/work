import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import MarkdownIt from '../app/markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
import {safeHref} from '../app/ed-schema.mjs';
import {toPlain} from '../app/ed-text.mjs';
import {convertNote, buildConvertPlan, missingLetters, readableLetters, sample, resultText, progressText} from '../app/note-convert-model.mjs';
import {runNoteConvert} from '../app/note-convert.js';
// ED③ 1단계 PR A: 옛 마크다운 노트 일괄 변환(1회용). 합성 글만, 운영 자료 없음.
const md=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:false});md.linkify.set({fuzzyEmail:false});md.validateLink=url=>!!safeHref(url);
const at='2026-10-20T01:00:00.000Z';
const note=(id,raw_text,metadata={},extra={})=>({id,title:'제목 '+id,raw_text,metadata,updated_at:at,doc:null,...extra});

test('convertNote: headings, bold, lists, tables, quotes, code and callouts become format; every written letter stays',()=>{
  const raw='## 쟁점\n\n2026. 10. 21. 교섭\n\n- **기본급** 인상\n- [설명](https://example.org/a)\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |\n\n> [!NOTE]\n> 참고 글\n\n```mermaid\ngraph TD\n```\n\n1. 첫째\n2. 둘째';
  const r=convertNote(md,note('a',raw,{markdown:true}));
  assert.equal(r.ok,true,JSON.stringify(r));
  const types=r.doc.doc.content.map(n=>n.type);
  for(const t of ['heading','paragraph','bullet_list','table','blockquote','code_block','ordered_list'])assert.ok(types.includes(t),t);
  assert.equal(r.text,toPlain(r.doc));
  assert.doesNotMatch(r.text,/##|\*\*|\|---/);
  assert.match(r.text,/2026\. 10\. 21\. 교섭/);assert.match(r.text,/graph TD/);assert.match(r.text,/참고:/);
  assert.deepEqual(missingLetters(raw,r.text),[]);
});
test('convertNote refuses (and keeps the note) when letters would be lost, or the result is too long',()=>{
  // A reference-style link definition line is not shown by markdown, so its letters would vanish.
  const r=convertNote(md,note('b','본문 [참고][1]\n\n[1]: https://example.org/숨은글자'));
  assert.equal(r.ok,true,'the URL itself is not compared');
  const lost=convertNote(md,note('c','## 제목\n\n<!-- 숨은 메모 -->\n남는 글'));
  assert.equal(lost.ok,true,lost.detail);
  assert.deepEqual(missingLetters('가나다 라','가나다'),['라×1']);
  const long=convertNote(md,note('d','## 긴 글\n\n'+'가'.repeat(100001)));assert.equal(long.ok,false);assert.equal(long.reason,'too_long');
  assert.equal(readableLetters('[글](https://a.example/주소) ![그림](https://b.example/x.png)'),'[글] ![그림]');
});
test('buildConvertPlan: only markdown notes without a doc, backed up with the same updated_at',()=>{
  const notes=[
    note('md-ok','## 바꿀 노트',{markdown:true}),
    note('md-guess','**굵게** 추정',{}),
    note('plain','1. 쓴 그대로\n- 줄',{markdown:false}),
    note('plain-guess','2026.10.21. 기호 없음',{}),
    note('done','## 이미',{markdown:true},{doc:{v:'ed1',doc:{type:'doc',content:[]}}}),
    note('edited','## 백업 뒤 고침',{markdown:true},{updated_at:'2026-10-24T09:00:00.000Z'}),
    note('new','## 백업 뒤 새 노트',{markdown:true}),
  ];
  const backups=['md-ok','md-guess','plain','plain-guess','done','edited'].map(id=>({row_id:id,row_updated_at:'2026-10-20T01:00:00+00:00'}));
  const p=buildConvertPlan(notes,backups);
  assert.deepEqual(p.todo.map(n=>n.id),['md-ok','md-guess']);
  assert.deepEqual(p.changed.map(n=>n.id),['edited']);assert.deepEqual(p.noBackup.map(n=>n.id),['new']);
  assert.equal(p.already,1);assert.equal(p.plain,2);assert.equal(p.total,4);
});
test('sample picks distinct notes, at most n',()=>{
  const list=[1,2,3,4,5,6,7];let seed=1;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;
  const s=sample(list,5,rnd);assert.equal(s.length,5);assert.equal(new Set(s).size,5);assert.deepEqual(sample([1,2],5,rnd).sort(),[1,2]);
});

// A fake owner-RLS REST: backups (ids/times only) and notes; PATCH honours id, kind, doc=is.null and updated_at.
function server({backups=true,notes}){
  const rows=notes.map(n=>({...n})),calls=[];
  const api=async(path,options={})=>{
    const u=new URL('https://x'+path),q=u.searchParams,method=options.method||'GET';calls.push({method,path,body:options.body});
    if(u.pathname==='/rest/v1/app_ed3_text_backups'){
      if(!backups)throw Object.assign(new Error('missing'),{status:404});
      assert.equal(q.get('select'),'row_id,row_updated_at','only ids and times are read from the backup');
      return Number(q.get('offset'))?[]:rows.filter(r=>r.backed).map(r=>({row_id:r.id,row_updated_at:r.backedAt||at}));
    }
    if(u.pathname==='/rest/v1/app_notes'&&method==='GET')return Number(q.get('offset'))?[]:rows.map(({backed,backedAt,...r})=>r);
    if(u.pathname==='/rest/v1/app_notes'&&method==='PATCH'){
      const id=q.get('id').slice(3),hit=rows.filter(r=>r.id===id&&q.get('kind')==='eq.note'&&q.get('doc')==='is.null'&&!r.doc&&'eq.'+r.updated_at===q.get('updated_at'));
      for(const r of hit)Object.assign(r,options.body);return hit.map(r=>({id:r.id}));
    }
    throw new Error('unexpected '+path);
  };
  return {api,rows,calls};
}
const ws=()=>'w';
test('runNoteConvert: refuses without a backup, writes nothing',async()=>{
  const s=server({backups:false,notes:[note('a','## 글',{markdown:true})]});
  const r=await runNoteConvert({api:s.api,workspace:ws,md,confirm:async()=>true});
  assert.equal(r.status,'refused');assert.match(r.message,/백업/);assert.ok(s.calls.every(c=>c.method==='GET'));
});
test('runNoteConvert: shows a check first, writes one by one with guards, keeps updated_at, then only the rest on a second press',async()=>{
  const s=server({notes:[
    {...note('a','## 하나\n\n- **굵게**',{markdown:true}),backed:true},
    {...note('b','## 둘',{markdown:true}),backed:true},
    {...note('p','1. 쓴 그대로',{markdown:false}),backed:true},
    {...note('late','## 백업 뒤 고침',{markdown:true}),backed:true,backedAt:'2026-10-19T00:00:00.000Z'},
  ]});
  let seen=null;const progress=[];
  const r=await runNoteConvert({api:s.api,workspace:ws,md,confirm:async info=>{seen=info;return true;},onProgress:x=>progress.push(x.index)});
  assert.equal(seen.count,2);assert.equal(seen.check.length,2);assert.ok(seen.check.every(c=>c.result.ok));
  assert.equal(r.status,'done');assert.equal(r.done,2);assert.deepEqual(r.skipped.map(x=>x.id+':'+x.reason),['late:changed']);
  const patches=s.calls.filter(c=>c.method==='PATCH');assert.equal(patches.length,2);
  for(const p of patches){assert.deepEqual(Object.keys(p.body).sort(),['doc','raw_text']);assert.match(p.path,/kind=eq\.note&doc=is\.null&updated_at=eq\./);}
  const a=s.rows.find(x=>x.id==='a');assert.equal(a.updated_at,at);assert.equal(a.raw_text,'하나\n\n- 굵게');assert.equal(a.doc.v,'ed1');
  assert.equal(s.rows.find(x=>x.id==='p').doc,null,'plain note untouched');
  assert.deepEqual(progress,[0,1,2]);
  assert.match(resultText(r),/바꿈 2 · 건너뜀 1/);
  // Pressed again: nothing left to change, nothing written.
  const again=await runNoteConvert({api:s.api,workspace:ws,md,confirm:async()=>{throw new Error('must not ask');}});
  assert.equal(again.done,0);assert.equal(again.already,2);assert.equal(s.calls.filter(c=>c.method==='PATCH').length,2);
});
test('runNoteConvert: a note changed in another tab is skipped (0 rows), cancel writes nothing, a lost login stops',async()=>{
  const s=server({notes:[{...note('a','## 하나',{markdown:true}),backed:true},{...note('b','## 둘',{markdown:true}),backed:true}]});
  assert.equal((await runNoteConvert({api:s.api,workspace:ws,md,confirm:async()=>false})).status,'cancelled');
  assert.equal(s.calls.filter(c=>c.method==='PATCH').length,0);
  const api=async(path,options={})=>{if(options.method==='PATCH'&&path.includes('id=eq.a')){s.rows.find(r=>r.id==='a').updated_at='2026-10-24T10:00:00.000Z';}return s.api(path,options);};
  const r=await runNoteConvert({api,workspace:ws,md,confirm:async()=>true});
  assert.deepEqual(r.skipped.map(x=>x.id+':'+x.reason),['a:moved']);assert.equal(r.done,1);
  const t=server({notes:[{...note('c','## 셋',{markdown:true}),backed:true},{...note('d','## 넷',{markdown:true}),backed:true}]});
  const lost=async(path,options={})=>{if(options.method==='PATCH')throw Object.assign(new Error('x'),{status:401});return t.api(path,options);};
  const stop=await runNoteConvert({api:lost,workspace:ws,md,confirm:async()=>true});
  assert.equal(stop.status,'stopped');assert.equal(stop.skipped.length,1);assert.match(progressText({...stop,finished:true}),/멈춤/);
});
test('the one-time button is owner only, lives in the folder ⋯, and its files say they are removed in the next PR',()=>{
  const notes=readFileSync('app/basket-notes.js','utf8');
  assert.match(notes,/membership\?\.role === 'owner'/);assert.match(notes,/\['data-note-convert', '옛 마크다운 노트 변환'\]/);
  for(const f of ['app/note-convert.js','app/note-convert-model.mjs'])assert.match(readFileSync(f,'utf8'),/다음 PR에서/);
  const runner=readFileSync('app/note-convert.js','utf8');
  assert.doesNotMatch(runner,new RegExp(['service_role','local'+'Storage','session'+'Storage','functions/v1'].join('|')));
  assert.doesNotMatch(runner,/raw_text,metadata,updated_at&|select=.*raw_text.*app_ed3/);
});
