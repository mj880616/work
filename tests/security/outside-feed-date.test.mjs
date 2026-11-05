// S50-1 OUTSIDE-날짜모름: 날짜 찾기 순서(두 자리 연도·이름표·본문 서명), 날짜 모름 글 다시 채우기, 옛 글 처리.
// 네트워크 없음. 표본은 모두 지어낸 HTML이다(특정 사이트의 실제 구조를 흉내 내지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';

const P=await import('../../supabase/functions/outside-feed/parse.ts');
const {sourceByKey}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const NOW=Date.parse('2026-11-04T03:00:00Z');
const KST=(y,m,d)=>new Date(Date.UTC(y,m-1,d)-9*3600000).toISOString();

test('두 자리 연도 날짜 줄은 줄 전체가 날짜일 때만 읽는다(버전 번호 같은 오탐 방지)', () => {
  assert.equal(P.shortDate('번호\n19.03.08\n제목',NOW),KST(2019,3,8));
  assert.equal(P.shortDate('작성일 19-03-08 14:22',NOW),KST(2019,3,8));
  assert.equal(P.shortDate('v10.2.3 배포',NOW),null,'문장 속 숫자는 날짜가 아님');
  assert.equal(P.shortDate('99.99.99',NOW),null);
  assert.equal(P.shortDate('27.01.05',NOW),null,'미래 날짜');
});

test('이름표 붙은 날짜는 글 어디서든, 두 자리 연도도', () => {
  assert.equal(P.labeledDate('조회 20\n작성일: 2019.03.08\n',NOW),KST(2019,3,8));
  assert.equal(P.labeledDate('등록일 18-12-31',NOW),KST(2018,12,31));
  assert.equal(P.labeledDate('조회 2019.03.08',NOW),null,'이름표 없으면 여기서는 안 읽음');
});

test('목록 줄: 날짜 칸이 두 자리 연도여도 읽는다', () => {
  const src={...sourceByKey('pssp')};
  const html='<table><tr><td>6001</td><td><a href="./view.php?board=notice&nid=6001&page=1">[성명] 가상 성명 하나</a></td><td>19.03.08</td></tr>'
    +'<tr><td>6000</td><td><a href="./view.php?board=notice&nid=6000&page=1">[성명] 가상 성명 둘</a></td><td>2019-03-01</td></tr></table>';
  const out=P.parseListHtml(src,html,'https://pssp.org/bbs/list.php?board=notice',30,undefined,NOW);
  assert.deepEqual(out.map(i=>i.published_at),[KST(2019,3,8),KST(2019,3,1)]);
});

test('글 쪽 날짜: 메타·제목 뒤 날짜가 없으면 이름표 → 본문 끝 서명 → 본문 첫 날짜 순', () => {
  const T='[성명] 가상 성명';
  const label='<h1>'+T+'</h1>'+Array.from({length:30},(_,i)=>`<p>줄${i}</p>`).join('')+'<p>작성일 2019.03.08</p>';
  assert.equal(P.pageDate(label,T,NOW),KST(2019,3,8),'15줄 밖 이름표');
  const sign='<article><h1>'+T+'</h1><p>정부는 철회하라.</p><p>우리는 끝까지 싸운다.</p><p>2019년 3월 8일</p><p>가상 단체</p></article>';
  assert.equal(P.pageDate(sign,T,NOW),KST(2019,3,8),'끝부분 서명 날짜');
  const first='<article><h1>'+T+'</h1><p>2019. 3. 8. 발표된 계획을 철회하라.</p><p>덧붙인다.</p></article>';
  assert.equal(P.pageDate(first,T,NOW),KST(2019,3,8),'본문 안 첫 날짜');
  const short='<h1>'+T+'</h1><p>19.03.08</p><p>본문</p>';
  assert.equal(P.pageDate(short,T,NOW),KST(2019,3,8),'제목 바로 뒤 두 자리 연도 날짜 줄');
});

test('사이드 목록(본문 밖)의 날짜에는 속지 않는다', () => {
  const T='[성명] 가상 성명';
  const html='<article><h1>'+T+'</h1><p>날짜 없는 본문.</p></article><aside>'+Array.from({length:20},(_,i)=>`<p>메뉴${i}</p>`).join('')+'<ul><li>최근 글 2026.11.01</li></ul></aside>';
  assert.equal(P.pageDate(html,T,NOW),null);
});

test('기존 순서 유지: 메타가 있으면 본문 날짜보다 우선', () => {
  assert.equal(P.pageDate('<meta property="article:published_time" content="2026-10-28T09:10:00+09:00"><h1>가상</h1><p>2020-01-01</p>','가상',NOW),'2026-10-28T00:10:00.000Z');
});
