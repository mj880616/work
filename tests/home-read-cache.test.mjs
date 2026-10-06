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
test('home copy projects only approved display fields and truncates updates',()=>{
  const {cache,values}=fixture();
  cache.save('calendar',{day:'2026-10-06',rows:[{title:'event',start:'2026-10-06',end:'2026-10-07',allDay:true,color:'var(--kptu-primary-ink)',description:'secret',location:'secret',attendees:['secret'],url:'secret'}]},now);
  cache.save('updates',{week:'2026-10-04T15:00:00.000Z',rows:Array.from({length:8},()=>({organization_id:'o',name:'org',date:'2026-10-06',text:'a'.repeat(120),raw_text:'secret',detail_text:'secret'}))},now);
  cache.save('tasks',{unlinkedCount:3,names:[{id:'t',names:['project']}],tasks:[{title:'duplicate'}]},now);
  const copy=JSON.parse(values.get('kptu_owner_cache:home-read-v1:one'));
  assert.deepEqual(Object.keys(copy).sort(),['cards','owner','savedAt','version','workspaceId']);
  assert.deepEqual(Object.keys(copy.cards.calendar.rows[0]).sort(),['allDay','color','end','start','title']);
  assert.equal(copy.cards.updates.rows.length,5);assert.equal(copy.cards.updates.rows[0].text.length,80);
  assert.equal(JSON.stringify(copy).includes('secret'),false);
  assert.equal(JSON.stringify(copy).includes('duplicate'),false);
});
test('calendar expires at KST midnight and updates at Monday; independent card ages remain seven days',()=>{
  const {cache}=fixture();
  cache.save('calendar',{day:'2026-10-06',rows:[]},now);
  cache.save('updates',{week:'2026-10-04T15:00:00.000Z',rows:[]},now);
  cache.save('tasks',{unlinkedCount:0,names:[]},now);
  assert.ok(cache.read(now).calendar);
  assert.equal(cache.read(Date.parse('2026-10-06T15:00:00Z')).calendar,undefined);
  assert.ok(cache.read(Date.parse('2026-10-11T14:59:59Z')).updates);
  assert.equal(cache.read(Date.parse('2026-10-11T15:00:00Z')).updates,undefined);
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
    assert.equal(cache.read(now).calendar,undefined);assert.equal(cache.read(now).tasks.unlinkedCount,1);
  }
});
