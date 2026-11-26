// S63-10 NEWS-언론거르기: 언론 거르기·등급 규칙(supabase/functions/_shared/news-rank.ts) 표. 글은 모두 가짜.
// 1 노동 > 2 사회 > 3 정치·경제(노동·공공 관련만), null = 받지 않음. 노동 전문지는 전부 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {newsRank, listSection, dropCategory} from '../supabase/functions/_shared/news-rank.ts';
import {NEWS_CATALOG, newsSourceByKey} from '../supabase/functions/_shared/news-catalog.ts';

const GEN = {lists: ['https://x.test/rss/society', 'https://x.test/rss/economy', 'https://x.test/rss/politics'], sections: ['society', 'economy', 'politics']};
const [SOC, ECO, POL] = GEN.lists;
const MIXED = {lists: ['https://y.test/rss/all'], mixedAs: 'economy'};
const LABOR = {lists: ['https://z.test/rss/all'], beat: 'labor'};
const r = (source, list, title, more = {}) => newsRank({source, list, title, url: more.url || 'https://x.test/news/1', summary: more.summary, category: more.category, words: more.words});

const TABLE = [
  // [설명, source, list, 제목, 덧붙임, 기대]
  ['노동 전문지는 무엇이든 전부(부고도)', LABOR, LABOR.lists[0], '[부고] 가짜 위원장 모친상', {}, 1],
  ['노동 전문지 주식 글자도 전부', LABOR, LABOR.lists[0], '코스피 하락에 임금 걱정', {}, 1],
  ['사회 섹션 노동 기사 → 1', GEN, SOC, '가짜 가람노조 파업 돌입', {}, 1],
  ['정치 섹션이라도 노동 낱말이면 1', GEN, POL, '국회 노란봉투법 처리', {}, 1],
  ['경제 섹션 최저임금 → 1', GEN, ECO, '내년 최저임금 결정', {}, 1],
  ['사회 섹션 일반 기사 → 2', GEN, SOC, '가짜 시 교통사고 다발 구간', {}, 2],
  ['정치 섹션 공공기관 → 3', GEN, POL, '공공기관 통폐합 논의', {}, 3],
  ['경제 섹션 민영화 → 3', GEN, ECO, '가스 민영화 논란 재점화', {}, 3],
  ['정치 섹션 내 키워드에 맞음 → 3', GEN, POL, '가짜 특별법 여야 합의', {words: ['특별법']}, 3],
  ['정치 섹션 관련 없음 → 받지 않음', GEN, POL, '여야 대표 회동 결렬', {}, null],
  ['경제 섹션 관련 없음 → 받지 않음', GEN, ECO, '가짜 전자 신제품 출시', {}, null],
  ['주식(특징주) → 받지 않음', GEN, ECO, '[특징주] 가짜전자 상한가', {}, null],
  ['코스피 → 받지 않음', GEN, SOC, '코스피 2% 상승 마감', {}, null],
  ['코인 → 받지 않음', GEN, ECO, '비트코인 1억 돌파', {}, null],
  ['주식 글자라도 노동 낱말 함께면 남김', GEN, ECO, '가짜자동차 노조 파업에 주가 급락', {}, 1],
  ['날씨 꼬리표 → 받지 않음', GEN, SOC, '[날씨] 내일 전국 비', {}, null],
  ['운세 → 받지 않음', GEN, SOC, '오늘의 운세 11월 16일', {}, null],
  ['부고 → 받지 않음', GEN, SOC, '[부고] 가짜씨 별세', {}, null],
  ['인사 → 받지 않음(노동 낱말 있어도)', GEN, SOC, '[인사] 고용노동부', {}, null],
  ['스포츠 주소 → 받지 않음', GEN, SOC, '가짜 구단 우승', {url: 'https://x.test/sports/123'}, null],
  ['연예 카테고리 → 받지 않음', GEN, SOC, '가짜 배우 결혼', {category: '연예'}, null],
  ['카테고리 낱말 단위: 인사이트는 인사로 보지 않음', GEN, SOC, '가짜 도시 이야기', {category: '인사이트'}, 2],
  ['섞인 피드: 카테고리 사회 → 2', MIXED, MIXED.lists[0], '가짜 동네 화재', {category: '사회'}, 2],
  ['섞인 피드: 못 알아보면 매체 기본(경제) → 관련 없으면 받지 않음', MIXED, MIXED.lists[0], '가짜 회사 실적 발표', {}, null],
  ['섞인 피드: 매체 기본 경제라도 공공 낱말이면 3', MIXED, MIXED.lists[0], '지하철 요금 인상 검토', {}, 3],
  ['소개 글의 노동 낱말도 본다', GEN, POL, '가짜 법안 통과', {summary: '비정규직 처우 개선 내용'}, 1],
];

test('거르기·등급 표(맞는 예·안 맞는 예)', () => {
  for (const [what, source, list, title, more, want] of TABLE) assert.equal(r(source, list, title, more), want, what);
});

test('카테고리 칸은 낱말 단위', () => {
  assert.equal(dropCategory('뉴스 / 스포츠'), true);
  assert.equal(dropCategory('Entertainment'), true);
  assert.equal(dropCategory('사회 / 노동'), false);
  assert.equal(dropCategory('인사이트'), false);
});

test('카탈로그: 노동 전문지는 beat=labor, 종합지 섹션은 lists와 같은 차례, 섞인 피드는 mixedAs', () => {
  const labor = ['news-labortoday', 'news-beminor', 'news-worknworld', 'news-newsmin', 'news-redaily', 'news-laborplus', 'news-redian', 'news-psi', 'news-itf', 'news-labourstart'];
  for (const k of labor) assert.equal(newsSourceByKey(k)?.beat, 'labor', k);
  for (const s of NEWS_CATALOG) {
    if (s.beat === 'labor') continue;
    if (s.sections) {
      assert.equal(s.sections.length, s.lists.length, s.key);
      s.lists.forEach((l, i) => {
        if (s.region === 'opinion') { assert.equal(listSection(s, l), 'opinion', `${s.key} ${l}`); return; }
        const want = /society|national|50400012|sectionId=03/.test(l) ? 'society' : /economy|30100041|sectionId=02/.test(l) ? 'economy' : 'politics';
        assert.equal(listSection(s, l), want, `${s.key} ${l}`);
      });
    } else {
      assert.equal(s.lists.length, 1, `${s.key}: 섹션 없는 종합지는 전체 피드 하나`);
      assert.ok(s.mixedAs, `${s.key}: 섞인 피드 기본 섹션`);
    }
  }
});
