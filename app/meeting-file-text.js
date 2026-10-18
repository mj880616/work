// MEET-파일로만들기: 결과 파일의 본문 글자를 이 기기 브라우저 안에서 읽는다(서버·외부 주소 호출 없음).
// - PDF: 저장소에 고정 버전으로 넣은 pdf.js(app/pdf-lib/, scripts/pdf/pdf-pin.json)로 글자만 읽는다.
// - HWP·HWPX: HWP 편집기와 같은 칸막이 편집기(hwp-frame.js, sandbox iframe)에 열어 쪽마다 그린 SVG의 글자를 모은다.
// 읽지 못하면 빈 글을 돌려주고, 부르는 쪽은 "결과 칸 비우고 파일만 첨부"로 처리한다.
import {linesFromGlyphs} from './meeting-file-parse.mjs';

const PDF_LIB=new URL('./pdf-lib/pdfjs-dist-6.3.289/',import.meta.url);
const MAX_PAGES=80,MAX_BYTES=30*1024*1024;
let pdfFlight=null;

function pdfjs(){
  if(!pdfFlight)pdfFlight=import(new URL('pdf.min.mjs',PDF_LIB).href).then(lib=>{
    lib.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',PDF_LIB).href;
    return lib;
  }).catch(err=>{pdfFlight=null;throw err});
  return pdfFlight;
}
export const kindOf=name=>{const ext=String(name||'').toLowerCase().match(/\.(pdf|hwpx?)$/)?.[1];return ext==='pdf'?'pdf':ext?'hwp':''};

async function readPdf(file){
  const lib=await pdfjs();
  const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:new URL('cmaps/',PDF_LIB).href,cMapPacked:true,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,stopAtErrors:false});
  const doc=await task.promise;
  try{
    const pages=[];
    for(let n=1;n<=Math.min(doc.numPages,MAX_PAGES);n++){
      const page=await doc.getPage(n);
      const content=await page.getTextContent();
      pages.push(content.items.map(item=>(item.str||'')+(item.hasEOL?'\n':'')).join('').replace(/[ \t]+\n/g,'\n').trim());
      page.cleanup();
    }
    return pages.filter(Boolean).join('\n\n');
  }finally{await task.destroy().catch(()=>{})}
}

// One hidden sandboxed editor reads HWP files one after another; it is removed when the batch ends.
export function createHwpReader(){
  let host=null,editor=null,flight=null;
  async function ready(){
    if(editor)return editor;
    if(!flight)flight=(async()=>{
      const {createSandboxedEditor}=await import('./hwp-frame.js');
      host=document.createElement('div');
      host.className='mff-hwp-reader';host.setAttribute('aria-hidden','true');host.inert=true;
      host.style.cssText='position:fixed;left:0;top:0;width:800px;height:600px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
      document.body.append(host);
      editor=await createSandboxedEditor(host);
      return editor;
    })().catch(err=>{flight=null;host?.remove();host=null;throw err});
    return flight;
  }
  async function read(file){
    const instance=await ready();
    const bytes=new Uint8Array(await file.arrayBuffer());
    const loaded=await instance.loadFile(bytes,file.name,{skipUnsavedGuard:true});
    const count=Math.min(Number(loaded?.pageCount)||await instance.pageCount(),MAX_PAGES);
    const pages=[];
    for(let page=0;page<count;page++){
      const svg=new DOMParser().parseFromString(await instance.getPageSvg(page),'image/svg+xml');
      const glyphs=[...svg.querySelectorAll('text')].filter(t=>!t.getAttribute('transform')).map(t=>({s:t.textContent,x:Number(t.getAttribute('x'))||0,y:Number(t.getAttribute('y'))||0,size:Number(t.getAttribute('font-size'))||10,w:Number(t.getAttribute('textLength'))||0}));
      pages.push(linesFromGlyphs(glyphs));
    }
    return pages.filter(Boolean).join('\n\n');
  }
  function close(){try{editor?.destroy()}catch{}editor=null;flight=null;host?.remove();host=null}
  return {read,close};
}

// 본문 글을 돌려준다. 못 읽으면 {text:'', error}.
export async function readFileText(file,{hwp}={}){
  const kind=kindOf(file?.name);
  if(!kind)return {text:'',error:'PDF·HWP만 본문을 읽어요'};
  if(file.size>MAX_BYTES)return {text:'',error:'30MB가 넘어 본문은 읽지 않았어요'};
  try{
    const text=kind==='pdf'?await readPdf(file):await (hwp||createHwpReader()).read(file);
    return text.trim()?{text:text.trim(),error:''}:{text:'',error:'본문 글자가 없어요'};
  }catch(err){
    console.warn('meeting file text read failed',file.name,err);
    return {text:'',error:'본문을 읽지 못했어요'};
  }
}
