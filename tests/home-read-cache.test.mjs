import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHomeCache} from '../app/home-read-cache.js';
const now=Date.parse('2026-10-06T01:00:00Z');
function fixture(){
  const values=new Map();let ctx={owner:'one',workspaceId:'w'};
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const cache=createHomeCache({storage,keyPrefix:'kptu_owner_cache:home-read-v1:',context:()=>ctx});
  return {cache,values,setContext:v=>ctx=v};
}
test('home copy projects only approved display fields and drops retired counts',()=>{
  const {cache,values}=fixture();
  cache.save('calendar',{day:'2026-10-06',rows:[{title:'event',start:'2026-10-06',end:'2026-10-07',allDay:true,color:'var(--kptu-primary-ink)',description:'secret',location:'secret',attendees:['secret'],url:'secret'}]},now);
  cache.save('tasks',{unlinkedCount:3,names:[{id:'t',names:['project']}],tasks:[{title:'duplicate'}]},now);
  const copy=JSON.parse(values.get('kptu_owner_cache:home-read-v1:one'));
  assert.deepEqual(Object.keys(copy).sort(),['cards','owner','savedAt','version','workspaceId']);
  assert.deepEqual(Object.keys(copy.cards.calendar.rows[0]).sort(),['allDay','calendarId','color','end','id','start','title']);
  assert.deepEqual(copy.cards.tasks.names,[{id:'t',names:['project']}]);
  assert.equal(copy.cards.tasks.unlinkedCount,undefined);
  assert.equal(JSON.stringify(copy).includes('secret'),false);
  assert.equal(JSON.stringify(copy).includes('duplicate'),false);
});
test('calendar expires at KST midnight; independent card ages remain seven days',()=>{
  const {cache}=fixture();
  cache.save('calendar',{day:'2026-10-06',rows:[]},now);
  cache.save('tasks',{unlinkedCount:0,names:[]},now);
  assert.ok(cache.read(now).calendar);
  assert.equal(cache.read(Date.parse('2026-10-06T15:00:00Z')).calendar,undefined);
  cache.save('dday',{rows:[]},now+6*86400000);
  assert.equal(cache.read(now+7*86400000).tasks,undefined);
  assert.ok(cache.read(now+7*86400000).dday);
});
test('wrong owner, workspace, version and malformed copies are ignored',()=>{
  const {cache,values,setContext}=fixture();cache.save('tasks',{unlinkedCount:2,names:[]},now);
  setContext({owner:'two',workspaceId:'w'});assert.deepEqual(cache.read(now),{});
  setContext({owner:'one',workspaceId:'other'});assert.deepEqual(cache.read(now),{});
  setContext({owner:'one',workspaceId:'w'});
  const key='kptu_owner_cache:home-read-v1:one',saved=values.get(key);
  for(const patch of [{owner:'two'},{workspaceId:'other'},{version:2},{savedAt:NaN},{cards:{calendar:{savedAt:now,day:'2026-10-06',rows:null}}}]){
    values.set(key,JSON.stringify({...JSON.parse(saved),...patch}));assert.deepEqual(cache.read(now),{});
  }
  values.set(key,'broken');assert.deepEqual(cache.read(now),{});
});
test('oversize copy and unavailable storage never throw or replace the last success',()=>{
  const {cache,values}=fixture();cache.save('dday',{rows:[]},now);const before=[...values.values()][0];
  cache.save('calendar',{day:'2026-10-06',rows:[{title:'가'.repeat(8000),start:'2026-10-06',end:'2026-10-07',allDay:true,color:''}]},now);
  assert.equal([...values.values()][0],before);
  const unavailable=createHomeCache({storage:{getItem(){throw Error()},setItem(){throw Error()}},keyPrefix:'copy:',context:()=>({owner:'one',workspaceId:'w'})});
  assert.deepEqual(unavailable.read(now),{});assert.doesNotThrow(()=>unavailable.save('dday',{rows:[]},now));
});
test('invalid cached event dates are ignored without discarding the other valid cards',()=>{
  const {cache,values}=fixture();cache.save('tasks',{unlinkedCount:1,names:[]},now);
  const key='kptu_owner_cache:home-read-v1:one',copy=JSON.parse(values.get(key));
  for(const dates of [{start:'bad-date',end:'2026-10-07'},{start:1,end:2}]){
    copy.cards.calendar={savedAt:now,day:'2026-10-06',rows:[{...dates,allDay:false,title:'bad',color:''}]};
    values.set(key,JSON.stringify(copy));
    assert.equal(cache.read(now).calendar,undefined);assert.deepEqual(cache.read(now).tasks.names,[]);
  }
});

test('retired record copies are ignored on read and removed on the next valid save',()=>{
  const {cache,values}=fixture();
  const key='kptu_owner_cache:home-read-v1:one';
  values.set(key,JSON.stringify({version:1,owner:'one',workspaceId:'w',savedAt:now,cards:{
    updates:{savedAt:now,week:'2026-10-04T15:00:00.000Z',rows:[{type:'basket',note_id:'n',text:'old record'}]},
    tasks:{savedAt:now,unlinkedCount:3,names:[{id:'t',names:['project']}]},
  }}));
  assert.equal(cache.read(now).updates,undefined);
  assert.deepEqual(cache.read(now).tasks,{savedAt:now,names:[{id:'t',names:['project']}]});
  const old=values.get(key);
  cache.save('updates',{week:'2026-10-04T15:00:00.000Z',rows:[]},now);
  assert.equal(values.get(key),old);
  cache.save('dday',{rows:[]},now);
  const saved=JSON.parse(values.get(key));
  assert.equal(saved.cards.updates,undefined);
  assert.equal(saved.cards.tasks.unlinkedCount,undefined);
  assert.deepEqual(saved.cards.tasks.names,[{id:'t',names:['project']}]);
});

test('retired basket display projections never create storage even with approved summary or raw excerpts',()=>{
  for(const row of [
    {type:'basket',note_id:'n',text:'승인😀'.repeat(35),summary:'approved'},
    {type:'basket',note_id:'n',text:'😀'.repeat(81),excerpt:true,raw_text:'must not persist'},
  ]){
    const {cache,values}=fixture();
    cache.save('updates',{week:'2026-10-04T15:00:00.000Z',rows:[row]},now);
    assert.deepEqual(cache.read(now),{});assert.equal(values.size,0);
  }
});
test('update changes one saved card in place and keeps its saved time (CAL-저장본먼저)',()=>{
  const {cache}=fixture();
  cache.save('calendar',{day:'2026-10-06',rows:[{id:'a',calendarId:'c',title:'지운 일정',start:'2026-10-06',end:'2026-10-07',allDay:true,color:''},{id:'b',calendarId:'c',title:'남는 일정',start:'2026-10-06',end:'2026-10-07',allDay:true,color:''}]},now);
  cache.update('calendar',card=>({...card,rows:card.rows.filter(r=>r.id!=='a')}),now+1000);
  const card=cache.read(now+1000).calendar;
  assert.deepEqual(card.rows.map(r=>r.title),['남는 일정']);assert.equal(card.savedAt,now);
  cache.update('dday',card=>card,now);assert.equal(cache.read(now).dday,undefined);
});
