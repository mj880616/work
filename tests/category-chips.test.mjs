import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleCategoryOff} from '../app/category-chips.js';

const names=['교섭','투쟁','교육'];
test('a kind chip turns that kind off and on without touching the others',()=>{
  const off=toggleCategoryOff(names,new Set(),'투쟁');
  assert.deepEqual([...off],['투쟁']);
  assert.deepEqual([...toggleCategoryOff(names,off,'투쟁')],[]);
  assert.deepEqual([...toggleCategoryOff(names,off,'교육')].sort(),['교육','투쟁']);
});
test('the all chip turns everything off when all are on, otherwise everything on',()=>{
  assert.deepEqual([...toggleCategoryOff(names,new Set(),'all')].sort(),[...names].sort());
  assert.deepEqual([...toggleCategoryOff(names,new Set(['교육']),'all')],[]);
  assert.deepEqual([...toggleCategoryOff(names,new Set(names),'all')],[]);
});
test('toggling never changes the set it was given',()=>{
  const off=new Set(['교육']);
  toggleCategoryOff(names,off,'교섭');toggleCategoryOff(names,off,'all');
  assert.deepEqual([...off],['교육']);
});
// 2026-10-24 명진 결정: 담당조직·프로젝트 상세 [자료]는 '회의'를 기본으로 켠 채(아무것도 끄지 않고) 열린다. 자료실 기본('회의'만 꺼짐)과 다르다.
test('organization and project details start with every kind on, 회의 included',async()=>{
  const {DETAIL_DEFAULT_OFF,detailDefaultOff}=await import('../app/category-chips.js');
  assert.deepEqual([...DETAIL_DEFAULT_OFF],[]);
  const a=detailDefaultOff(),b=detailDefaultOff();
  assert.equal(a.has('회의'),false);assert.notEqual(a,b);
  a.add('회의');assert.equal(detailDefaultOff().has('회의'),false);
});

// LIB-소분류 ②: 큰 분류가 하나만 켜졌을 때만 소분류 줄이 뜨고, 고른 소분류는 그때만 거른다. 세 화면이 같은 '숨길 분류 모음'으로 거른다.
test('subcategory row: shows for a sole parent and filters only inside it',async()=>{
  const {soleParent,activeSubcategory,hiddenCategories}=await import('../app/category-chips.js');
  const dc=await import('../app/document-categories.js');
  dc.setDocumentCategories(['교섭','선전','기타','선전›투쟁속보','선전›소식지']);
  const tops=dc.topDocumentCategories();
  assert.equal(soleParent(tops,new Set()),'');
  assert.equal(soleParent(tops,new Set(['교섭','기타'])),'선전');
  // 큰 분류 여럿이 켜져 있으면 고른 소분류는 쓰이지 않는다.
  assert.equal(activeSubcategory(tops,new Set(),'선전›투쟁속보'),'');
  assert.equal(activeSubcategory(tops,new Set(['교섭','기타']),'선전›투쟁속보'),'선전›투쟁속보');
  assert.equal(activeSubcategory(tops,new Set(['선전','기타']),'선전›투쟁속보'),'');
  assert.equal(activeSubcategory(tops,new Set(['교섭','기타']),'선전›없는것'),'');
  // 꺼 둔 큰 분류는 소분류까지 숨긴다.
  assert.deepEqual([...hiddenCategories(tops,new Set(['선전']))].sort(),['선전','선전›소식지','선전›투쟁속보'].sort());
  // 선전 전체: 선전과 그 소분류 모두 보임.
  assert.deepEqual([...hiddenCategories(tops,new Set(['교섭','기타']),'')].sort(),['교섭','기타']);
  // 선전 › 투쟁속보만.
  assert.deepEqual([...hiddenCategories(tops,new Set(['교섭','기타']),'선전›투쟁속보')].sort(),['교섭','기타','선전','선전›소식지'].sort());
  // toggleCategoryOff는 큰 분류 이름만 다룬다(소분류는 칩 줄에 없다).
  assert.deepEqual([...toggleCategoryOff(tops,new Set(),'all')].sort(),[...tops].sort());
  dc.resetDocumentCategories();
});

// LIB-맨위다듬기(S53-18, 시안 docs/design/mockups/library-top-bar.html): '기타'는 늘 맨 끝, 고른 칩만 채움, 칩마다 자료 수(0도).
test('chip order keeps the stored order but always puts 기타 last',async()=>{
  const {chipOrder}=await import('../app/category-chips.js');
  assert.deepEqual(chipOrder(['교섭','기타','투쟁','홍보']),['교섭','투쟁','홍보','기타']);
  assert.deepEqual(chipOrder(['교섭','투쟁']),['교섭','투쟁']);
  const given=['기타','교섭'];chipOrder(given);assert.deepEqual(given,['기타','교섭']);
});
test('only picked chips are filled: 전체 when everything is on, the few on chips when narrowed, nothing when only a few are off',async()=>{
  const {filledChips}=await import('../app/category-chips.js');
  const all=['교섭','투쟁','교육','회의'];
  assert.deepEqual([...filledChips(all,new Set())],['all']);
  assert.deepEqual([...filledChips(all,new Set(['회의']))],[]);
  assert.deepEqual([...filledChips(all,new Set(['투쟁','교육','회의']))],['교섭']);
  assert.deepEqual([...filledChips(all,new Set(['교육','회의']))].sort(),['교섭','투쟁'].sort());
  assert.deepEqual([...filledChips(all,new Set(all))],[]);
});
test('category counts count every top category from zero, subcategories under their parent',async()=>{
  const {categoryCounts}=await import('../app/category-chips.js');
  const dc=await import('../app/document-categories.js');
  dc.setDocumentCategories(['교섭','선전','기타','선전›투쟁속보']);
  const counts=categoryCounts(dc.topDocumentCategories(),[{category:'교섭'},{category:'선전›투쟁속보'},{category:'선전'},{category:'없는 이름'}]);
  assert.deepEqual([...counts],[['교섭',1],['선전',2],['기타',1]]);
  assert.deepEqual([...categoryCounts(['교섭'],[])],[['교섭',0]]);
  dc.resetDocumentCategories();
});
// ORG-자료칩드롭다운(요청함 11/14): 상세 [자료] 종류는 [종류 전체 ▾] 상자 하나 — 목록 = 이름 + 건수, 0건은 흐리게 맨 뒤, 소분류는 큰 분류 아래, 사진 줄.
test('kind pick: options carry counts, zero kinds go last and disabled, subcategory under its parent, photo line',async()=>{
  const {kindPickOptions,kindPickState,hiddenCategories}=await import('../app/category-chips.js');
  const dc=await import('../app/document-categories.js');
  dc.setDocumentCategories(['교섭','선전','교육','기타','선전›투쟁속보']);
  const names=dc.topDocumentCategories(),docs=[{category:'교섭'},{category:'선전›투쟁속보'},{category:'선전'},{category:'교섭'}];
  assert.deepEqual(kindPickOptions(names,docs,{photos:3}).map(o=>[o.value,o.label,o.count,o.disabled]),[
    ['all','종류 전체',4,false],['k:교섭','교섭',2,false],['k:선전','선전',2,false],['s:선전›투쟁속보','선전 › 투쟁속보',1,false],
    ['photo','사진',3,false],['k:교육','교육',0,true],['k:기타','기타',0,true]]);
  assert.equal(kindPickOptions(names,docs).some(o=>o.value==='photo'),false);
  const pick=v=>{const p=kindPickState(names,v);return {hidden:[...hiddenCategories(names,p.off,p.sub)].sort(),photos:p.photos}};
  assert.deepEqual(pick('all'),{hidden:[],photos:false});
  assert.deepEqual(pick('k:교섭').hidden,['교육','기타','선전','선전›투쟁속보'].sort());
  assert.deepEqual(pick('s:선전›투쟁속보').hidden,['교섭','교육','기타','선전'].sort());
  assert.deepEqual(pick('photo'),{hidden:[],photos:true});
  assert.deepEqual(pick('k:없는 종류'),{hidden:[],photos:false});
  dc.resetDocumentCategories();
});
