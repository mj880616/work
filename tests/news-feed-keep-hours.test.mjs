// S67-24 DB-보관기간정리: 언론 기사는 받은 지 72시간 뒤 DB 정리(public.app_news_prune)가 지운다.
// 지운 기사가 피드에 아직 남아 있어도 다시 넣지 않도록, 게시 시각이 72시간보다 오래된 피드 글은 수집기가 넣지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const H=await import('../supabase/functions/news-feed/handler.ts');
const sql=readFileSync(new URL('../supabase/migrations/20261120130000_news_outside_retention.sql',import.meta.url),'utf8');

test('news feed keep hours equal the database rule (72 hours)',()=>{
 assert.equal(H.KEEP_HOURS,72);
 assert.match(sql,/interval '72 hours'/);
});

test('tooOldForNews: only a known publish time older than 72 hours is skipped',()=>{
 const now=Date.parse('2026-11-20T00:00:00Z');
 assert.equal(H.tooOldForNews('2026-11-16T23:59:00Z',now),true,'72시간 1분 전');
 assert.equal(H.tooOldForNews('2026-11-17T00:01:00Z',now),false,'71시간 59분 전');
 assert.equal(H.tooOldForNews(null,now),false,'시각 모름은 넣음(받은 시각으로 3일 뒤 정리)');
 assert.equal(H.tooOldForNews('not a date',now),false);
 assert.equal(H.tooOldForNews('2026-11-25T00:00:00Z',now),false,'앞날 시각은 넣음');
});

test('the media step skips old feed items before ranking (counted as dropped)',()=>{
 const src=readFileSync(new URL('../supabase/functions/news-feed/handler.ts',import.meta.url),'utf8');
 const i=src.indexOf('if (tooOldForNews(it.published_at, nowMs)) { dropped++; continue; }');
 assert.ok(i>0);assert.ok(i<src.indexOf('const rank = newsRank({ source, list, title: it.title'));
});
