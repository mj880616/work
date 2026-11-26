// BLOG ① 익명 읽기 시험용 합성 저장소. 실제 share-page-read 처리 코드(handler.ts + blog.ts) 위에서 돈다. 운영 연결 없음.
// 작업공간 두 개: WS_OP(운영자, blog 허용) · WS_OTHER(다른 가입자 — 블로그 줄을 억지로 넣어 둬도 절대 나오면 안 됨).
const {createShareReadHandler}=await import('../../supabase/functions/share-page-read/handler.ts');
export const URL_='https://example.supabase.co/functions/v1/share-page-read';
export const ORIGIN='https://bokdoong.com';
export const WS_OP='51000000-0000-4000-8000-000000000001',WS_OTHER='51000000-0000-4000-8000-000000000002';
const id=n=>'52000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const IDS={blogOp:id(1),blogOther:id(2),boardA:id(11),boardB:id(12),boardOther:id(13),
 pageA:id(21),pageB:id(22),pageDraft:id(23),pageOther:id(24),pageLink:id(25),pageTrashNote:id(26),
 noteA:id(31),noteB:id(32),noteDraft:id(33),noteOther:id(34),noteTrash:id(35),noteSecret:id(36),
 mediaA:id(41),mediaOtherPage:id(42)};
export const KEYS={boardA:'a0a0a0a0a1',boardB:'b0b0b0b0b1',boardOther:'c0c0c0c0c1',postA:'aaaa000001',postB:'bbbb000001',
 postDraft:'dddd000001',postOther:'eeee000001',postTrash:'ffff000001'};
const doc=(text,extra=[])=>[{type:'doc',doc:{v:'ed1',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]},...extra]}}}];

export function store(){
 const s={
  allow:[{workspace_id:WS_OP,feature:'blog'}],
  blogs:[{id:IDS.blogOp,workspace_id:WS_OP,title:'사용자 블로그',intro:'한 줄 소개',enabled:true,indexable:false},
   {id:IDS.blogOther,workspace_id:WS_OTHER,title:'남의 블로그',intro:null,enabled:true,indexable:true}],
  boards:[{id:IDS.boardA,blog_id:IDS.blogOp,name:'생각',sort:0,public_key:KEYS.boardA},
   {id:IDS.boardB,blog_id:IDS.blogOp,name:'기록',sort:1,public_key:KEYS.boardB},
   {id:IDS.boardOther,blog_id:IDS.blogOther,name:'남의 게시판',sort:0,public_key:KEYS.boardOther}],
  posts:[{board_id:IDS.boardA,page_id:IDS.pageA,note_id:IDS.noteA,public_key:KEYS.postA,published_at:'2026-11-25T01:00:00Z',republished_at:null},
   {board_id:IDS.boardA,page_id:IDS.pageB,note_id:IDS.noteB,public_key:KEYS.postB,published_at:'2026-11-25T16:00:00Z',republished_at:'2026-11-27T02:00:00Z'},
   {board_id:IDS.boardB,page_id:IDS.pageDraft,note_id:IDS.noteDraft,public_key:KEYS.postDraft,published_at:'2026-11-20T01:00:00Z',republished_at:null},
   {board_id:IDS.boardB,page_id:IDS.pageTrashNote,note_id:IDS.noteTrash,public_key:KEYS.postTrash,published_at:'2026-11-21T01:00:00Z',republished_at:null},
   {board_id:IDS.boardOther,page_id:IDS.pageOther,note_id:IDS.noteOther,public_key:KEYS.postOther,published_at:'2026-11-22T01:00:00Z',republished_at:null}],
  pages:[{id:IDS.pageA,title:'첫 글',blocks:doc('공개 본문',[{type:'image',attrs:{src:'share:'+IDS.mediaA}},{type:'image',attrs:{src:'share:'+IDS.mediaOtherPage}}]),status:'published'},
   {id:IDS.pageB,title:'둘째 글',blocks:doc('둘째 본문'),status:'published'},
   {id:IDS.pageDraft,title:'내린 글',blocks:[],status:'draft'},
   {id:IDS.pageTrashNote,title:'휴지통 노트 글',blocks:doc('휴지통'),status:'published'},
   {id:IDS.pageOther,title:'남의 글',blocks:doc('남의 본문'),status:'published'},
   {id:IDS.pageLink,title:'링크로만 보낸 글',blocks:doc('링크 본문'),status:'published'}],
  notes:[{id:IDS.noteA,deleted_at:null,raw_text:'노트 원본 비밀(사본과 다름)'},{id:IDS.noteB,deleted_at:null,raw_text:'비밀'},{id:IDS.noteDraft,deleted_at:null,raw_text:'비밀'},
   {id:IDS.noteTrash,deleted_at:'2026-11-24T00:00:00Z',raw_text:'비밀'},{id:IDS.noteOther,deleted_at:null,raw_text:'비밀'},{id:IDS.noteSecret,deleted_at:null,raw_text:'게시 안 한 노트 비밀'}],
  media:[{id:IDS.mediaA,page_id:IDS.pageA,storage_path:'share/a.jpg'},{id:IDS.mediaOtherPage,page_id:IDS.pageOther,storage_path:'share/other.jpg'}],
  calls:[],
 };
 return s;
}
// app_operator_feature_workspace('blog')와 같은 셈: 허용된 작업공간이 정확히 하나일 때만.
export function reader(s){
 const log=(name,arg)=>s.calls.push([name,arg]);
 return {
  async linkByHash(){log('link');return null;},
  async pageById(){log('page');return null;},
  blog:{
   async workspace(){log('workspace');const w=[...new Set(s.allow.filter(r=>r.feature==='blog').map(r=>r.workspace_id))];return w.length===1?w[0]:null;},
   async blogByWorkspace(ws){log('blogByWorkspace',ws);const b=s.blogs.find(b=>b.workspace_id===ws);return b?{...b}:null;},
   async boardsForBlog(blogId){log('boardsForBlog',blogId);return s.boards.filter(b=>b.blog_id===blogId).map(b=>({...b}));},
   async postsForBoards(ids){log('postsForBoards',ids);return s.posts.filter(p=>ids.includes(p.board_id)).map(p=>({...p}));},
   async postByKey(key){log('postByKey',key);const p=s.posts.find(p=>p.public_key===key);return p?{...p}:null;},
   async pagesByIds(ids){log('pagesByIds',ids);return s.pages.filter(p=>ids.includes(p.id)).map(p=>({...p}));},
   async notesByIds(ids){log('notesByIds',ids);return s.notes.filter(n=>ids.includes(n.id)).map(n=>({id:n.id,deleted_at:n.deleted_at}));},
   async mediaForPage(pageId,ids){log('mediaForPage',[pageId,ids]);return s.media.filter(m=>m.page_id===pageId&&ids.includes(m.id)).map(m=>({id:m.id,storage_path:m.storage_path}));},
   async signMedia(path,sec){log('signMedia',[path,sec]);return 'https://example.supabase.co/storage/v1/object/sign/'+path+'?token=x';},
  },
 };
}
export function handler(s,options={}){return createShareReadHandler(reader(s),{log:()=>{},...options});}
export const ask=(h,body,{origin=ORIGIN}={})=>h(new Request(URL_,{method:'POST',headers:{...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));
export async function read(h,body,opts){const r=await ask(h,body,opts);return {status:r.status,headers:Object.fromEntries(r.headers),text:await r.text()};}
