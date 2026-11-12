import test from 'node:test';
import assert from 'node:assert/strict';

// S61-9 FORGET-요청방향(요청함 11/13 05:14, 명진 확정 05:19): 명진이 남에게 부탁·요청한 일은 잊지 말기 '처리 전'에 명진 할 일로 뜨지 않는다.
// 길마다(소식 journal-memorable · 텔레그램 요청 telegram.ts · 챙길 것 todo-radar.ts · 다시 거르기 todo-recheck.ts) 같은 규칙을 순수 함수로 확인한다.
// 이름·글은 모두 지어낸 것이다. 네트워크 없음.
const jm=await import('../../supabase/functions/ai-assist/journal-memorable.ts');
const {parseTelegram,TELEGRAM_INSTRUCTIONS}=await import('../../supabase/functions/collector-feed/telegram.ts');
const {buildTodoRadarInstructions,parseTodoRadar}=await import('../../supabase/functions/ai-assist/todo-radar.ts');
const {RECHECK_VERDICTS,RECHECK_KEEP}=await import('../../supabase/functions/ai-assist/todo-recheck.ts');

const F1='f0000000-0000-4000-8000-000000000001',F2='f0000000-0000-4000-8000-000000000002';
const rows=[{id:F1,source:'telegram',title:'가상지부 자료',summary:'나가 가상지부에 자료를 요청함.',points:[],room:'',counterpart:''},
  {id:F2,source:'call',title:'가상 회신',summary:'가상지부가 나에게 회신을 요청함.',points:[],room:'',counterpart:''}];

test('소식: 지시문에 방향 규칙, 답 형식에 from_me 필수', ()=>{
  assert.match(jm.MEMORABLE_INSTRUCTIONS,/'나'\(이 사용자\)가 다른 사람·조직에게 부탁·요청·지시·문의한 일은 그 사람이 할 일이다/);
  assert.match(jm.MEMORABLE_INSTRUCTIONS,/이 사용자에게 온 부탁·요청\(상대 → 나\)만 task다/);
  const it=jm.MEMORABLE_SCHEMA.properties.items.items;
  assert.ok(it.required.includes('from_me'));assert.equal(it.properties.from_me.type,'boolean');
});

test("소식: '내가 ○○지부에 자료 요청'을 할 일(task)로 고른 답은 버리고, 나에게 온 요청은 그대로 받는다", ()=>{
  const out=jm.parseMemorable(JSON.stringify({items:[
    {n:1,kind:'task',org:'가상지부',line:'가상지부 자료 보내기.',why:'자료 요청',from_me:true},
    {n:2,kind:'task',org:'가상지부',line:'가상지부에 회신하기.',why:'회신 요청',from_me:false}]}),rows);
  assert.deepEqual(out.map(p=>[p.feed_item_id,p.kind]),[[F2,'task']]);
  // 할 일이 아닌 종류(기억할 것·일정)는 방향과 상관없이 받는다(상대가 하기로 한 약속을 기억해 두는 줄).
  const note=jm.parseMemorable(JSON.stringify({items:[{n:1,kind:'note',org:'가상지부',line:'가상지부가 자료 보내기로 함.',why:'내가 요청',from_me:true}]}),rows);
  assert.deepEqual(note.map(p=>p.kind),['note']);
  // from_me가 없는 옛 답 형식은 이전과 같게 받는다.
  assert.equal(jm.parseMemorable(JSON.stringify({items:[{n:2,kind:'task',org:'',line:'회신.',why:''}]}),rows).length,1);
  assert.equal(jm.askedByMe('task',true),true);assert.equal(jm.askedByMe('task','true'),false);assert.equal(jm.askedByMe('event',true),false);
});

test('텔레그램 소식: 업무방에도 누가 누구에게 부탁했는지 쓰게 한다', ()=>{
  assert.match(TELEGRAM_INSTRUCTIONS,/업무 단체방이든 개인 대화방이든 소식에 부탁·요청·지시·문의가 있으면 summary에 누가 누구에게 부탁했는지/);
  assert.match(TELEGRAM_INSTRUCTIONS,/'나'가 부탁한 일을 '나'가 부탁받은 일처럼 쓰지 않는다/);
});

test("텔레그램 요청: 근거 메시지가 모두 '나'가 보낸 것이면 나에게 온 요청이 아니다(단체방 '다들 ~해 주세요' 포함)", ()=>{
  const item=(refs,quote,to='all')=>({title:'가상 자료',summary:'나가 각 지부에 자료를 요청함.',refs,organization:'',project:'',ask_me:{ask:true,to,request:'가상 자료 보내기',quote,due:''}});
  const self=i=>i===0||i===2; // m1·m3은 '나'
  // AI가 내 말을 근거로 고름 → 버림(이전부터).
  let r=parseTelegram(JSON.stringify({items:[item(['m1'],'m1')]}),3,[],[],self);
  assert.equal(r.items[0].ask,null);assert.equal(r.askDropped,1);
  // 근거 소식이 모두 내 메시지인데 근거 메시지만 다른 줄로 적음 → 버림(이번에 넓힌 검사).
  r=parseTelegram(JSON.stringify({items:[item(['m1','m3'],'m2')]}),3,[],[],self);
  assert.equal(r.items[0].ask,null);assert.equal(r.askDropped,1);assert.equal(r.items.length,1,'소식은 남긴다');
  // 상대가 나에게 한 부탁은 그대로 뜬다.
  r=parseTelegram(JSON.stringify({items:[item(['m1','m2'],'m2','me')]}),3,[],[],self);
  assert.equal(r.items[0].ask.request,'가상 자료 보내기');assert.equal(r.askDropped,0);
});

test("챙길 것: 내가 남에게 부탁한 일은 owner=other(명진 할 일 아님), 상대가 하기로 했으면 상대 약속 '(내가 요청)'", ()=>{
  const ins=buildTodoRadarInstructions();
  assert.match(ins,/기록 주인이 다른 사람·조직에게 부탁·요청·지시한 일은 그 사람이 할 일이다/);
  assert.match(ins,/summary 끝에 '\(내가 요청\)'을 붙인다/);
  const packed=[{kind:'note',id:'a0000000-0000-4000-8000-000000000009',day:'2026-11-12',at:0,text:'가상지부에 자료 요청함',ref:'r1'}];
  const base={kind:'request',due:'',source:'r1',evidence:'가상지부에 자료 요청함',mentions_me:false};
  const wrap=o=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}]});
  const out=parseTodoRadar(wrap({items:[{...base,summary:'가상지부 자료 보내기.',counterpart:false,owner:'other'},
    {...base,summary:'가상지부 자료 보내기(내가 요청).',counterpart:true,owner:'other'}]}),packed,'2026-11-12');
  assert.equal(out.excluded_owner,1,'내 할 일로는 안 남음');
  assert.deepEqual(out.items.map(i=>[i.counterpart,i.summary]),[[true,'가상지부 자료 보내기(내가 요청).']],'상대 약속으로만');
});

test('챙길 것 다시 거르기: 내가 부탁한 일(requested_by_me)은 남기지 않는다', ()=>{
  assert.ok(RECHECK_VERDICTS.includes('requested_by_me'));assert.ok(!RECHECK_KEEP.includes('requested_by_me'));
});

test('통화: 약속 후보의 주체 편(우리측·상대측·제3자)을 점 끝에 남긴다 — 이름은 옮기지 않음', async ()=>{
  const {sections,pointsOf}=await import('../../supabase/functions/collector-feed/call-analysis.ts');
  const md=['## 약속 후보','### 1. 가상지부에 자료 요청','- 주체: 가상인물 (우리측)','- 원문표현: “근거비밀”','### 2. 가상지부 자료 보내기','- 주체: 가상지부 (상대측)',
    '### 3. 가상 일','- 주체: 확인필요 (확인필요)','## 후속확인 필요사항','- 가상 확인'].join('\n');
  const s=sections(md);
  assert.deepEqual(s.promises,['- 가상지부에 자료 요청 (우리가 할 일)','- 가상지부 자료 보내기 (상대가 할 일)','- 가상 일']);
  const pts=pointsOf(s);
  assert.ok(pts.includes('[예정] 가상지부 자료 보내기 (상대가 할 일)'));
  assert.ok(!pts.some(p=>p.includes('가상인물')||p.includes('근거비밀')),'주체 이름·원문은 옮기지 않음');
});
