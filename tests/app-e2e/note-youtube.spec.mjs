import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteField } from './helpers/note-editor.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// NOTE-유튜브보기 (합성 데이터): 노트 읽기 화면에서 유튜브 링크 아래 작은 영상 칸 → ▶를 눌러야 youtube-nocookie 재생 칸이 생긴다.
// 재생 주소는 링크에서 꺼낸 영상 ID로 새로 만든 것이고, 이상한 주소(javascript:·다른 사이트·닮은 이름)에는 칸이 없다. 편집 중에는 칸이 없다.
const A='dQw4w9WgXcQ',B='M7lc1UVf-VE',C='aqz-KE-bpKQ';
const t=(text,marks)=>marks?{type:'text',text,marks}:{type:'text',text};
const link=href=>[{type:'link',attrs:{href}}];
const p=(...content)=>({type:'paragraph',attrs:{style:'body2'},content});
const DOC={v:'ed1',doc:{type:'doc',content:[
 p(t('회의 전에 볼 영상 '),t('여기',link(`https://www.youtube.com/watch?v=${A}&t=1m5s`)),t(' 참고')),
 // 링크 표시 없이 글자로만 붙여 넣은 주소도 칸이 생긴다(글자는 그대로).
 p(t(`짧은 주소 https://youtu.be/${B}?si=zz 끝.`)),
 {type:'bullet_list',content:[{type:'list_item',content:[p(t('쇼츠',link(`https://m.youtube.com/shorts/${C}`)))]}]},
 p(t('나쁜 링크',link('javascript:alert(1)//youtu.be/'+A)),t(' '),t('닮은 이름',link(`https://youtube.com.evil.example/watch?v=${A}`)),t(' '),t('다른 곳',link('https://example.org/watch?v='+A))),
 {type:'code_block',content:[t(`https://youtu.be/${A}`)]},
]}};
function store(){
 const at='2026-11-18T01:00:00Z',row=(id,title,raw_text,extra={})=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...extra});
 return [
  row('n-doc','합성 영상 노트','회의 전에 볼 영상 여기 참고',{doc:DOC}),
  // 옛 마크다운 노트(doc 없음) — 같은 칸.
  row('n-md','합성 마크다운 영상',`## 볼 것\n\n- [교육 영상](https://www.youtube.com/watch?v=${B})\n`,{updated_at:'2026-11-17T01:00:00Z'}),
  // 있는 그대로 보기 노트 — 글자는 그대로, 칸은 글 끝에.
  row('n-plain','합성 그대로 영상',`통화 메모\nhttps://youtu.be/${C}`,{updated_at:'2026-11-16T01:00:00Z'}),
 ];
}
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwAEtgHUFkkvVgAAAABJRU5ErkJggg==','base64');
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const rows=store(),errors=[],outside=[];
 page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 // 밖으로 나가는 요청은 이 두 곳만 대신 받고, 무엇을 불렀는지 적는다.
 await page.route('https://i.ytimg.com/**',r=>{outside.push(r.request().url());return r.fulfill({contentType:'image/png',body:PNG});});
 await page.route('https://www.youtube-nocookie.com/**',r=>{outside.push(r.request().url());return r.fulfill({contentType:'text/html',body:'<!doctype html><title>player</title><body style="background:#000"></body>'});});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;if(!q.has('note_id'))return r.fallback();return r.fulfill({json:[]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await chooseBasketKind(page,'note');
 return {rows,errors,outside};
}
const noteRow=(page,text)=>page.locator('[data-note-host] [data-note-row]').filter({hasText:text});
async function openNote(page,text,width){const row=noteRow(page,text);if(width<761)await row.tap();else await row.click();const body=page.locator('[data-note-detail] [data-basket-read-text]');await expect(body).toBeVisible();return body;}
const noOverflow=el=>el.evaluate(n=>n.getBoundingClientRect().right<=document.documentElement.clientWidth+1);

for(const width of [412,884,1280]){
 test.describe(`${width}`,()=>{
 test.use({hasTouch:width<761});
 test(`a saved note: a small video box under each YouTube link, the player only after ▶, built from the id ${width}`,async({page},info)=>{
  const f=await fixture(page,width);
  const body=await openNote(page,'합성 영상 노트',width);
  const boxes=body.locator('.ed-video');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(0)).toHaveAttribute('data-ed-video',A);
  await expect(boxes.nth(1)).toHaveAttribute('data-ed-video',B);
  await expect(boxes.nth(2)).toHaveAttribute('data-ed-video',C);
  // 링크 글자는 그대로(누르면 밖으로), 글자로 쓴 주소도 그대로. 칸은 링크가 든 문단 바로 뒤, 목록은 그 줄 안.
  await expect(body.locator('a.ed-link').first()).toHaveAttribute('href',`https://www.youtube.com/watch?v=${A}&t=1m5s`);
  await expect(body.locator('a.ed-link').first()).toHaveAttribute('target','_blank');
  await expect(body).toContainText(`짧은 주소 https://youtu.be/${B}?si=zz 끝.`);
  expect(await boxes.nth(0).evaluate(n=>n.previousElementSibling?.textContent)).toContain('회의 전에 볼 영상');
  expect(await boxes.nth(2).evaluate(n=>n.parentElement?.tagName)).toBe('LI');
  // 그 전에는 재생 칸이 없고, 작은 그림만 ID로 만든 주소다.
  await expect(body.locator('iframe')).toHaveCount(0);
  await expect(boxes.nth(0).locator('img.ed-video-thumb')).toHaveAttribute('src',`https://i.ytimg.com/vi/${A}/mqdefault.jpg`);
  await expect(boxes.nth(0).locator('img.ed-video-thumb')).toHaveAttribute('referrerpolicy','no-referrer');
  expect(f.outside.every(u=>u.startsWith('https://i.ytimg.com/vi/'))).toBe(true);
  // 16:9, 화면 밖으로 넘치지 않음.
  const r=await boxes.nth(0).boundingBox();
  expect(Math.abs(r.width/r.height-16/9)).toBeLessThan(0.05);
  expect(await noOverflow(boxes.nth(0))).toBe(true);
  if(process.env.NOTE_YT_SHOTS)await page.screenshot({path:`${process.env.NOTE_YT_SHOTS}/note-youtube-${width}-before.png`});
  const play=boxes.nth(0).getByRole('button',{name:'유튜브 영상 재생'});
  if(width<761)await play.tap();else await play.click();
  const frame=boxes.nth(0).locator('iframe.ed-video-frame');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('src',`https://www.youtube-nocookie.com/embed/${A}?autoplay=1&playsinline=1&rel=0&start=65`);
  await expect(frame).toHaveAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
  await expect(frame).toHaveAttribute('allow','fullscreen; picture-in-picture; encrypted-media');
  await expect(frame).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
  // 누른 칸만 재생 칸이 된다.
  await expect(body.locator('iframe')).toHaveCount(1);
  await expect.poll(()=>f.outside.filter(u=>u.startsWith('https://www.youtube-nocookie.com/')).length).toBe(1);
  if(process.env.NOTE_YT_SHOTS)await page.screenshot({path:`${process.env.NOTE_YT_SHOTS}/note-youtube-${width}-playing.png`});
  // 편집 중에는 칸이 없다(편집기 안에는 링크만).
  await noteMenuAction(page,'data-note-edit',{width});
  const field=noteField(page);
  await expect(field.locator('.ed-link').first()).toBeVisible();
  await expect(field.locator('.ed-video')).toHaveCount(0);
  await expect(page.locator('[data-note-detail] [data-note-read]')).toBeHidden();
  expect(f.errors).toEqual([]);
  info.annotations.push({type:'outside',description:f.outside.join(' ')});
 });
 });
}

test('an old markdown note gets the same box; its link letters stay',async({page})=>{
 const f=await fixture(page,1280);
 const body=await openNote(page,'합성 마크다운 영상',1280);
 await expect(body.locator('.ed-video')).toHaveCount(1);
 await expect(body.locator('.ed-video')).toHaveAttribute('data-ed-video',B);
 await expect(body.locator('li a')).toHaveText('교육 영상');
 await expect(body.locator('iframe')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('a note read as written: the letters stay exactly as written, the box goes at the end',async({page})=>{
 const f=await fixture(page,1280);
 const body=await openNote(page,'합성 그대로 영상',1280);
 await expect(body).toHaveAttribute('data-note-view','plain');
 await expect(body.locator('.ed-video')).toHaveCount(1);
 await expect(body.locator('.ed-video')).toHaveAttribute('data-ed-video',C);
 // 칸에는 글자가 없다(밑줄 자리·복사가 그대로).
 await expect(body).toHaveText(f.rows.find(r=>r.id==='n-plain').raw_text);
 await body.locator('.ed-video-play').click();
 await expect(body.locator('iframe')).toHaveAttribute('src',`https://www.youtube-nocookie.com/embed/${C}?autoplay=1&playsinline=1&rel=0`);
 expect(f.errors).toEqual([]);
});
