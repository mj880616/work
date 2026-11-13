// BRIEF-브리핑룸 ③ 화면(?view=brief, 메뉴 '브리핑 룸'). #briefView의 유일한 그리기 주인. 설계 docs/design/brief-room.md 6절, 시안 PR 2542.
// - 목록: 자료실 '브리핑 요청함' 폴더 자료 + 브리핑을 받은 자료. 줄마다 [브리핑 받기] / 만드는 중 n/m / 한 줄 요지 / 실패 한 줄.
// - 보기: 한 줄 요지 + 네 칸(닿는 것·할 일·부딪힘·꼭 읽을 대목 — 원문 그대로, 쪽 번호는 원문 그 쪽으로). 폰은 목록 대신, 761px~는 오른쪽 칸.
// - [브리핑 받기]만 AI를 부른다(명진 결정 1). 서버 document-actions brief-start, 진행·결과는 표 app_document_briefs를 owner RLS로 읽기만.
// - [자료 넣기]·놓기: 자료실 등록 창을 '브리핑 요청함' 폴더로 연다(자료 원본은 자료실 한 곳, 폴더는 없으면 owner RLS로 하나 만든다).
// - 서버 저장만(기기 저장 없음). 글자는 textContent로만 넣는다.
import {BRIEF_FOLDER,BRIEF_POLL_MS,BRIEF_SELECT,briefSections,fileBadge,isStalled,latestByDocument,listRows,sourceUrl,startError} from './brief-room-model.mjs';
import {waitHtml,failHtml,emptyEl} from './wait-state.js';
import {notify} from './small-notice.js';

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const enc=encodeURIComponent;
const ACTIONS='/functions/v1/document-actions';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
const btn=(cls,text,data)=>{const b=el('button',cls,text);b.type='button';for(const [k,v] of Object.entries(data||{}))b.dataset[k]=v;return b};

function install(){
  if(document.getElementById('briefView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="briefView" class="view-panel hidden" aria-label="브리핑 룸"><div class="br-wrap"><div class="br-list" data-br-list></div><div class="br-detail" data-br-detail hidden></div></div></section>');
}

const state={folderId:null,docs:[],folderDocs:new Set(),briefs:new Map(),open:null,loading:false,failed:false,timer:null,asked:new Set()};
const view=()=>document.getElementById('briefView');
const wide=()=>window.matchMedia?.('(min-width: 761px)').matches;
const here=()=>window.KPTURouter?.current==='brief'&&!document.hidden;

async function findFolder(){
  const rows=await rt().api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(ws())}&project_id=is.null&parent_id=is.null&deleted_at=is.null&name=eq.${enc(BRIEF_FOLDER)}&select=id&order=created_at.asc&limit=1`,{refreshSession:false,singleFlight:false});
  return Array.isArray(rows)&&rows[0]?.id||null;
}
// '회의 녹음' 폴더(PR 2485)와 같은 규칙: 맨 위·프로젝트 없음, 없으면 맨 아래 순서로 하나.
async function ensureFolder(){
  const have=await findFolder();if(have)return have;
  const tops=await rt().api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(ws())}&project_id=is.null&parent_id=is.null&select=sort_order&limit=500`,{refreshSession:false,singleFlight:false});
  const sort=(Array.isArray(tops)?tops:[]).reduce((m,f)=>Math.max(m,Number(f.sort_order)||0),0)+1;
  const made=await rt().api('/rest/v1/app_library_folders',{method:'POST',prefer:'return=representation',body:{workspace_id:ws(),project_id:null,parent_id:null,name:BRIEF_FOLDER,sort_order:sort}});
  window.dispatchEvent(new CustomEvent('kptu:library-folders-changed'));
  return Array.isArray(made)&&made[0]?.id||await findFolder();
}

async function load(){
  if(!ws()||!rt()?.api)return;
  state.loading=true;
  try{
    const w=enc(ws());
    const [folderId,briefRows]=await Promise.all([findFolder(),rt().api(`/rest/v1/app_document_briefs?workspace_id=eq.${w}&select=${BRIEF_SELECT}&order=created_at.desc&limit=300`,{refreshSession:false,singleFlight:false})]);
    state.folderId=folderId;
    state.briefs=latestByDocument(briefRows);
    const items=folderId?await rt().api(`/rest/v1/app_library_folder_items?workspace_id=eq.${w}&folder_id=eq.${enc(folderId)}&select=document_id&limit=500`,{refreshSession:false,singleFlight:false}):[];
    state.folderDocs=new Set((Array.isArray(items)?items:[]).map(i=>i.document_id));
    const ids=[...new Set([...state.folderDocs,...state.briefs.keys()])].slice(0,500);
    state.docs=ids.length?await rt().api(`/rest/v1/app_documents?workspace_id=eq.${w}&id=in.(${ids.map(enc).join(',')})&select=id,title,file_name,mime_type,file_id,drive_url,file_size,created_at&limit=500`,{refreshSession:false,singleFlight:false}):[];
    state.failed=false;
  }catch{state.failed=true}
  finally{state.loading=false}
}

function stateNode(row){
  const s=row.state;
  if(s.kind==='start'){const b=btn('br-start mini primary','브리핑 받기',{brStart:row.doc.id});return b}
  if(s.kind==='making')return el('span','br-st',s.text);
  if(s.kind==='done')return el('span','br-st',s.date);
  return el('span','br-st br-st-bad',s.text);
}

function drawList(){
  const box=view()?.querySelector('[data-br-list]');if(!box)return;
  const head=el('div','br-head');
  head.append(el('h2','br-title','브리핑 룸'),btn('br-add mini','자료 넣기',{brAdd:'1'}));
  const drop=el('p','br-drop',`여기에 파일을 놓아도 돼요 · 자료실 '${BRIEF_FOLDER}' 폴더에 함께 저장돼요`);drop.dataset.brDrop='1';
  if(state.failed&&!state.docs.length){box.replaceChildren(head,drop);box.insertAdjacentHTML('beforeend',failHtml({retry:'data-br-retry'}));return}
  const rows=listRows({docs:state.docs,folderIds:state.folderDocs,briefs:state.briefs});
  const list=el('div','br-rows');
  for(const row of rows){
    const r=el('div','br-row');r.dataset.brOpen=row.doc.id;r.tabIndex=row.state.kind==='done'?0:-1;r.setAttribute('role',row.state.kind==='done'?'button':'group');
    if(state.open===row.doc.id)r.classList.add('is-open');
    const badge=el('span','br-k',fileBadge(row.doc.file_name,row.doc.mime_type));badge.dataset.k=badge.textContent;
    const name=el('span','br-nm',String(row.doc.title||row.doc.file_name||'이름 없는 자료'));
    r.append(badge,name,stateNode(row));
    if(row.state.kind==='done')r.append(el('span','br-one',row.state.text));
    if(row.state.kind==='making')r.append(el('span','br-one br-muted','몇 분 걸려요, 다른 화면에 가도 돼요'));
    list.append(r);
  }
  if(!rows.length)list.append(emptyEl('넣은 자료 없음 — [자료 넣기]로 긴 자료를 넣고 [브리핑 받기]'));
  box.replaceChildren(head,drop,list);
}

function drawDetail(){
  const box=view()?.querySelector('[data-br-detail]'),listBox=view()?.querySelector('[data-br-list]');if(!box)return;
  const doc=state.docs.find(d=>d.id===state.open),b=doc?state.briefs.get(doc.id):null;
  if(!doc||b?.status!=='done'||!b.brief){box.hidden=true;box.replaceChildren();if(listBox)listBox.hidden=false;view()?.classList.remove('br-reading');return}
  view()?.classList.add('br-reading');
  if(listBox)listBox.hidden=!wide();
  const bar=el('div','br-head');
  if(!wide()){const back=btn('br-back icon-btn','‹',{brBack:'1'});back.setAttribute('aria-label','목록으로');bar.append(back)}
  bar.append(el('h2','br-title br-doc',String(doc.title||doc.file_name||'')));
  const src=sourceUrl(doc);
  if(src){const a=el('a','br-src mini','원문 열기');a.href=src;a.target='_blank';a.rel='noopener';bar.append(a)}
  const meta=el('p','br-meta',[fileBadge(doc.file_name,doc.mime_type),b.page_count?`${b.page_count}쪽`:'',b.finished_at?`${new Date(b.finished_at).getMonth()+1}/${new Date(b.finished_at).getDate()} 브리핑`:''].filter(Boolean).join(' · '));
  const lead=el('p','br-lead');lead.append(el('b',null,'한 줄 요지'),document.createTextNode(' — '+b.brief.lead));
  const parts=[bar,meta,lead];
  for(const sec of briefSections(b.brief)){
    const s=el('section','br-sec');
    const h=el('h3',null,sec.title);if(sec.key==='quotes')h.append(el('small',null,' 원문 그대로'));
    s.append(h);
    if(sec.key==='quotes'){
      if(!sec.quotes.length)s.append(emptyEl('원문에서 확인된 대목 없음'));
      for(const q of sec.quotes){
        const box=el('blockquote','br-q'),pg=el('span','br-pg');
        const link=sourceUrl(doc,q.page);
        if(q.page){const a=el(link?'a':'span',null,`${q.page}쪽`);if(link){a.href=link;a.target='_blank';a.rel='noopener'}pg.append(a)}
        if(q.heading)pg.append(document.createTextNode(`${q.page?' · ':''}${q.heading}`));
        if(pg.childNodes.length)box.append(pg);
        box.append(document.createTextNode(`“${q.text}”`));
        s.append(box);
        if(q.why)s.append(el('p','br-why','왜: '+q.why));
      }
    }else if(sec.lines.length){const ul=el('ul');for(const line of sec.lines)ul.append(el('li',null,line));s.append(ul)}
    else s.append(el('p','br-muted','—'));
    parts.push(s);
  }
  box.replaceChildren(...parts);box.hidden=false;
}

function draw(){drawList();drawDetail();schedule()}
// 다 됐다·못 했다 알림은 공용 작은 알림(위쪽, 브리핑 룸 화면에 있을 때만 — 폰 알림 없음).
function toast(text,error=false){notify(text,{error,record:false})}

const making=()=>[...state.briefs.values()].some(b=>b.status==='queued'||b.status==='running');
function schedule(){
  clearTimeout(state.timer);
  if(!making()||!here())return;
  state.timer=setTimeout(poll,BRIEF_POLL_MS);
}
async function poll(){
  if(!here())return;
  const before=new Map([...state.briefs].map(([k,v])=>[k,v.status]));
  await load();
  for(const [doc,b] of state.briefs){
    if(before.get(doc)&&before.get(doc)!=='done'&&b.status==='done'){const d=state.docs.find(x=>x.id===doc);toast(`브리핑이 다 됐어요 — ${d?.title||d?.file_name||''}`)}
    // 서버가 멈춘 작업(시간 다 씀·잇기 실패)은 화면이 한 번씩 이어 달라고 한다.
    if(isStalled(b,Date.now())&&!state.asked.has(b.id+b.updated_at)){state.asked.add(b.id+b.updated_at);void rt().api(ACTIONS,{method:'POST',body:{action:'brief-step',brief_id:b.id},refreshSession:false,singleFlight:false}).catch(()=>{})}
  }
  draw();
}

async function start(id,button){
  if(button)button.disabled=true;
  try{
    const data=await rt().api(ACTIONS,{method:'POST',body:{action:'brief-start',document_id:id},refreshSession:false,singleFlight:false,timeoutMs:30000});
    if(data?.brief?.id)state.briefs.set(id,data.brief);
    // 폴더 밖 자료(자료실 ⋯에서 받은 것)도 목록에 보이게 다시 읽는다.
    if(!state.docs.some(d=>d.id===id))await load();
  }catch(e){toast(startError(e?.status===429?'ai_monthly_cap':e?.status===404?'not_found':''),true)}
  draw();
}

async function add(files=null){
  try{
    const id=await ensureFolder();
    await window.KPTUViewLoader?.load?.('library');
    const ok=await window.KPTULibrary?.startUploadInFolder?.(id,files);
    if(!ok)toast('자료 등록 창을 열지 못했어요',true);
  }catch{toast('자료 넣기를 열지 못했어요',true)}
}

function bind(){
  const v=view();if(!v||v.dataset.brBound)return;v.dataset.brBound='1';
  v.addEventListener('click',e=>{
    const t=e.target;
    const s=t.closest?.('[data-br-start]');if(s){e.stopPropagation();void start(s.dataset.brStart,s);return}
    if(t.closest?.('[data-br-add]')){void add();return}
    if(t.closest?.('[data-br-retry]')){void refresh();return}
    if(t.closest?.('[data-br-back]')){state.open=null;draw();return}
    const row=t.closest?.('[data-br-open]');if(row&&state.briefs.get(row.dataset.brOpen)?.status==='done'){state.open=row.dataset.brOpen;draw();v.querySelector('[data-br-detail]')?.scrollIntoView?.({block:'start'})}
  });
  v.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-br-open][role=button]')){e.preventDefault();e.target.click()}});
  // 파일 놓기: 화면 아무 곳에나 놓으면 자료 등록 창(브리핑 요청함 폴더)에 담는다.
  v.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files')){e.preventDefault();v.classList.add('br-dropping')}});
  v.addEventListener('dragleave',e=>{if(e.target===v)v.classList.remove('br-dropping')});
  v.addEventListener('drop',e=>{const files=[...(e.dataTransfer?.files||[])];v.classList.remove('br-dropping');if(!files.length)return;e.preventDefault();void add(files)});
  window.addEventListener('kptu:documents-changed',()=>{if(window.KPTURouter?.current==='brief')void refresh()});
  window.addEventListener('resize',()=>{if(window.KPTURouter?.current==='brief')drawDetail()});
  document.addEventListener('visibilitychange',()=>{if(here())void poll()});
}

async function refresh(){
  const list=view()?.querySelector('[data-br-list]');
  if(list&&!state.docs.length)list.innerHTML=waitHtml({rows:3});
  await load();draw();
}

install();bind();
// 자료실 자료 ⋯ [브리핑 받기]·[브리핑 보기](library-upload.js luOpenBrief): 그 자료를 열고, 받기면 [브리핑 받기]와 같은 길로 시작한다.
async function takeAsked(){
  const ask=window.KPTUBriefOpen;window.KPTUBriefOpen=null;
  if(!ask||typeof ask.id!=='string')return;
  state.open=ask.id;
  const b=state.briefs.get(ask.id);
  if(ask.start&&(!b||b.status==='failed'))await start(ask.id,null);
  else draw();
}
window.KPTURouter?.on?.('brief',()=>{void refresh().then(takeAsked)});
void refresh().then(takeAsked);
