// 일회용 조사 4차(S47-34): 공공운수노조 글 쪽 본문 칸 안쪽 확인. GET만.
import * as P from "../supabase/functions/outside-feed/parse.ts";
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const idx of ["56545","56544","56537","56512"]){
  const r=await fetch(`https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=${idx}`,{headers:{"User-Agent":UA,Accept:"text/html"}});const t=P.decodeBody(new Uint8Array(await r.arrayBuffer()),r.headers.get("content-type"));await sleep(2500);
  const inner=P.bodyBlocks(t,/^publishList_write$/);
  const s=inner.replace(/<script\b[\s\S]*?<\/script>/gi,"<script/>").replace(/\s+/g," ");
  console.log(`IDX ${idx} innerLen=${inner.length} text=${JSON.stringify(P.htmlToText(inner).slice(0,300))}`);
  console.log(`  HTML ${JSON.stringify(s.slice(0,1500))}`);
}
