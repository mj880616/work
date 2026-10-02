import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// TASK-조직순서: unit checks of the shared order module, run in Node without a browser.
const source=readFileSync('app/organization-order.js','utf8');
function load(){
  const window={};
  vm.runInNewContext(source,{window});
  return window.KPTUOrganizationOrder;
}
const ORDER=[
  '전국철도노동조합',
  '서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합',
  '서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부',
  '메트로9호선노동조합','서울교통공사9호선지부',
  '김포도시철도지부','용인경전철지부'
];
const org=(name,i)=>({id:'o-'+i,name});
const names=list=>list.map(o=>o.name);
// A fixed shuffle so the input order never helps.
const shuffled=list=>list.map((x,i)=>({x,k:(i*7+3)%list.length})).sort((a,b)=>a.k-b.k).map(({x})=>x);
const known=ORDER.map(org);

test('13 organizations follow the decided order whatever the input order',()=>{
  const order=load();
  const input=shuffled(known);
  expect(names(input)).not.toEqual(ORDER);
  expect(names(order.sort(input))).toEqual(ORDER);
  expect(order.GROUPS.flat()).toEqual(ORDER);
  // sort returns a new array and leaves the input alone.
  expect(names(input)).not.toEqual(ORDER);
});

test('groups break exactly at the five decided boundaries',()=>{
  const order=load();
  expect(order.groups(shuffled(known)).map(names)).toEqual([
    ['전국철도노동조합'],
    ['서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합'],
    ['서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부'],
    ['메트로9호선노동조합','서울교통공사9호선지부'],
    ['김포도시철도지부','용인경전철지부']
  ]);
  // Groups with no organization leave no empty group, so screens never draw two lines in a row.
  expect(order.groups([org('용인경전철지부',1),org('전국철도노동조합',2),org('공항철도지부',3)]).map(names)).toEqual([
    ['전국철도노동조합'],['공항철도지부'],['용인경전철지부']
  ]);
  expect(order.groups([])).toEqual([]);
});

test('organizations outside the 13 come last in 가나다 order, in their own group',()=>{
  const order=load();
  const others=[org('한국소비자원지부',20),org('가축위생방역지원본부지부',21),org('국민연금지부',22),org('금화PSC지부',23)];
  const result=order.groups(shuffled([...others,...known]));
  expect(result).toHaveLength(6);
  expect(names(result.at(-1))).toEqual(['가축위생방역지원본부지부','국민연금지부','금화PSC지부','한국소비자원지부']);
  expect(names(result.flat()).slice(0,13)).toEqual(ORDER);
  // Matching is by exact name, as before: a name with an extra space is not one of the 13, and it is counted for the warning.
  const spaced=[org('전국철도노동조합 ',30),org('서울교통공사노동조합',31)];
  expect(names(order.sort(spaced))).toEqual(['서울교통공사노동조합','전국철도노동조합 ']);
  expect(order.unlisted(spaced)).toBe(1);
  expect(order.unlisted(known)).toBe(0);
});

test('궤도협의회 is left out of pickers only, and an existing choice of it is kept',()=>{
  const order=load();
  const list=[org('궤도협의회',40),...known];
  expect(order.PICKER_EXCLUDED).toEqual(['궤도협의회']);
  expect(names(order.forPicker(list))).not.toContain('궤도협의회');
  expect(order.forPicker(list)).toHaveLength(13);
  // A list that is not a picker still shows it, at the tail.
  expect(names(order.sort(list)).at(-1)).toBe('궤도협의회');
  // Already chosen: kept so saving the picker does not drop the existing link.
  expect(names(order.forPicker(list,['o-40']))).toContain('궤도협의회');
  // The input is not changed.
  expect(list).toHaveLength(14);
});

test('recent three come first, newest first, and stay in their place below',()=>{
  const order=load();
  const list=order.forPicker([org('궤도협의회',40),...known,org('국민연금지부',22)]);
  const {recent,groups}=order.withRecent(list,['o-12','o-22','missing','o-12','o-40','o-0','o-5']);
  // Unknown ids, repeats and organizations not offered are skipped; at most three.
  expect(order.RECENT_LIMIT).toBe(3);
  expect(names(recent)).toEqual(['용인경전철지부','국민연금지부','전국철도노동조합']);
  // The list below is the full ordered list, recent ones included (they appear twice on the screen).
  expect(names(groups.flat())).toEqual([...ORDER,'국민연금지부']);
  expect(names(order.withRecent(list,[]).recent)).toEqual([]);
  expect(names(order.withRecent(list,['o-1','o-2']).recent)).toEqual(['서울교통공사노동조합','부산지하철노동조합']);
});

test('the decided order is defined in one place in the app',()=>{
  const order=load();
  expect(Object.isFrozen(order.GROUPS)).toBe(true);
  expect(order.GROUPS.every(g=>Object.isFrozen(g))).toBe(true);
  const files=readdirSync('app').filter(name=>name.endsWith('.js')&&name!=='organization-order.js');
  const copies=files.filter(name=>readFileSync(`app/${name}`,'utf8').includes('지티엑스에이운영지부'));
  expect(copies).toEqual([]);
  // Every screen that orders organizations reads the shared module.
  for(const file of ['app/suborganizations.js','app/google-tasks.js'])expect(readFileSync(file,'utf8')).toContain('window.KPTUOrganizationOrder');
  const views=readFileSync('app/view-loader.js','utf8');
  const block=name=>{const rest=views.slice(views.indexOf(`async function ${name}()`)),end=rest.search(/\r?\n\}\r?\n/);expect(end).toBeGreaterThan(0);return rest.slice(0,end)};
  for(const name of ['tasks','projects','organizations'])expect(block(name)).toContain('await organizationOrder()');
  expect(block('calendar')).toContain("then(organizationOrder).then(()=>module('./suborganizations.js?v=11'");
  expect(views).toContain("module('./organization-order.js?v=1')");
});
