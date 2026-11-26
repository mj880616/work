// S69 READ-첨부본문(사용자 11/24 "제목이 점점 힘들어지는.. 이건데"): 페이지 본문이 비거나 짧으면(기관 게시판 — 본문은 첨부 PDF·HWP)
// 그 페이지의 첨부 파일 글자를 본문으로 쓴다. news-feed(사람이 연 원문 읽기 open)와 note-import(저장한 글·노트 '주소로 가져오기')가 함께 부른다.
// - 언제: readArticlePage 결과가 bot_check·paywall이 아니고, 본문 블록이 전문(ok)이 아니거나 글자가 ATTACH_PAGE_MIN 미만일 때만.
// - 무엇으로: 부르는 쪽이 이미 쓰는 공용 읽기(같은 주소 규칙·이름 풀이 확인·리다이렉트·시간·간격)의 getBytes. 새 읽기 길·외부 서비스 없음.
// - 결과: 첨부 글자로 만든 전문 블록(문단 p) — 페이지에 있던 사진 블록은 앞에 그대로 둔다. 못 읽으면 처음 결과 그대로.
import { attachmentLinks, readAttachment, type ByteReader } from "../_shared/attach-text.ts";
import { BODY_LIMITS, textBlocks, type Block } from "../_shared/feed-extract.ts";
import { cut } from "../outside-feed/parse.ts";
import { BODY_MAX, type PageInfo, type PageRule } from "./page.ts";

export const ATTACH_PAGE_MIN = 200; // 페이지 본문 글자가 이보다 적으면 첨부를 본다(page.ts FULL_MIN_CHARS와 같은 값)

export const needsAttachment = (page: PageInfo) =>
  page.state === "ok" && !(page.blocks.state === "ok" && page.blocks.chars >= ATTACH_PAGE_MIN);

export async function withAttachment(page: PageInfo, html: string, pageUrl: string, reader: ByteReader, rule: PageRule,
  log?: (code: string, detail?: Record<string, unknown>) => void): Promise<PageInfo> {
  if (!needsAttachment(page)) return page;
  const links = attachmentLinks(html, pageUrl);
  if (!links.length) return page;
  const got = await readAttachment(reader, links, log);
  if (!got) return page;
  const ex = textBlocks(got.text, { key: rule.key, rule: rule.rule, minChars: 1 });
  if (ex.state !== "ok") return page;
  const imgs = page.blocks.blocks.filter((b: Block) => b.t === "img");
  const blocks = [...imgs, ...ex.blocks.slice(0, BODY_LIMITS.blocks - imgs.length)]; // 블록 상한(DB 검사와 같음)
  const captions = imgs.filter((b) => b.t === "img" && b.cap).length;
  return {
    ...page, body: cut(ex.text, BODY_MAX), body_kind: "full",
    blocks: { ...ex, blocks, images: imgs.length, captions, scope: "attachment" },
  };
}
