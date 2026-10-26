// ACT-사진 5단계: 담당조직·프로젝트 상세의 사업 보고 줄 오른쪽에 작은 그림 3장 + '외 n장'.
// 사진은 사업 보고 첨부(app_documents.meeting_id, 원본은 Drive 한 곳)다. 이 파일은 보여 주기만 하고 아무것도 저장하지 않는다(결정 B).
// 읽기: 줄마다 따로 묻지 않고 보이는 사업 보고 전체를 `meeting_id=in.(…)` 한 번(100건씩)으로 읽는다. 데이터 경로·권한은 기존 그대로(소유자 RLS).
// 그림: 이미 운영에 있는 library-files 의 `GET ?action=photo&document_id=<uuid>&size=small`(소유자 확인 뒤 Drive 섬네일). 새 서버 경로 없음.
// 받은 그림은 이 화면을 쓰는 동안 메모리(object URL)에만 두고, 로그인 사용자가 바뀌면 버린다.
import {reportRuntime} from './report-links.js';
import {reportIdChunks,groupReportPhotos,stripPlan,moreLabel} from './report-photos-model.mjs';

const enc=encodeURIComponent;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 사업 보고 줄들 → Map(사업 보고 번호 → 그림 자료 목록). 읽지 못하면 던진다(부르는 쪽이 줄만 그리고 넘어간다).
export async function readReportPhotos(reports,rt=reportRuntime()){
  const chunks=reportIdChunks(reports);if(!chunks.length)return new Map();
  const ws=rt.context?.read?.()?.workspace?.id;if(!ws)throw new Error('로그인 상태를 확인하지 못했어요.');
  const pages=await Promise.all(chunks.map(ids=>rt.api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&meeting_id=in.(${ids.map(enc).join(',')})&select=id,meeting_id,file_name,mime_type,created_at&order=created_at.asc,id.asc`)));
  return groupReportPhotos(pages.flat());
}

// 줄 안에 넣을 글(그림 칸 자리만 만든다. 그림은 mountReportPhotos 가 채운다). 그림이 없는 줄은 빈 글.
export function reportPhotosHtml(meetingId,photos){
  const plan=stripPlan(photos?.get?.(meetingId));if(!plan)return '';
  const more=moreLabel(plan);
  return `<span class="report-photo-strip" data-report-photos="${esc(meetingId)}" role="img" aria-label="사진 ${plan.total}장">${plan.shown.map(p=>`<span class="report-photo-thumb" data-report-photo="${esc(p.id)}"></span>`).join('')}${more?`<span class="report-photo-more" data-report-photo-more>${more}</span>`:''}</span>`;
}

// 작은 그림은 메모리에만(object URL). 같은 화면에서 다시 그릴 때 다시 받지 않는다.
const cache=new Map();let cacheOwner='';
const ownerOf=rt=>rt.context?.read?.()?.user?.id||'';
// 로그인 정보가 아직 안 읽힌 순간('')은 사용자 바뀜으로 보지 않는다. 안 그러면 막 받은 그림 주소를 거두어 가 그림이 빈 칸이 된다.
export function clearReportPhotoCache(){for(const flight of cache.values())flight.then(url=>URL.revokeObjectURL(url),()=>{});cache.clear()}
export function reportPhotoUrl(documentId,{rt=reportRuntime(),fetcher=globalThis.fetch}={}){
  const owner=ownerOf(rt);if(owner&&owner!==cacheOwner){if(cacheOwner)clearReportPhotoCache();cacheOwner=owner}
  if(cache.has(documentId))return cache.get(documentId);
  const flight=(async()=>{
    if(!(await rt.session.ensure()))throw new Error('session');
    const token=rt.session.read()?.access_token;if(!token)throw new Error('session');
    const query=new URLSearchParams({action:'photo',document_id:documentId,size:'small'});
    const response=await fetcher(`${rt.config.url}/functions/v1/library-files?${query}`,{headers:{apikey:rt.config.key,Authorization:'Bearer '+token}});
    if(!response.ok||!/^image\//.test(response.headers.get('content-type')||''))throw new Error('photo');
    return URL.createObjectURL(await response.blob());
  })();
  cache.set(documentId,flight);
  flight.catch(()=>{if(cache.get(documentId)===flight)cache.delete(documentId)});
  return flight;
}

// root 안의 그림 칸에 그림을 채운다. 화면에 보이는 칸만 받는다(접힌 줄은 펼친 뒤에 받음). 못 받으면 빈 칸 그대로(줄·누르기는 그대로 동작).
export function mountReportPhotos(root,{rt=reportRuntime(),isCurrent=()=>true}={}){
  const cells=[...(root?.querySelectorAll?.('[data-report-photo]:not([data-state])')||[])];
  const fill=cell=>{
    if(cell.dataset.state)return;cell.dataset.state='loading';
    reportPhotoUrl(cell.dataset.reportPhoto,{rt}).then(url=>{
      if(!isCurrent()||!cell.isConnected)return;
      const img=document.createElement('img');img.alt='';img.decoding='async';
      img.onload=()=>{cell.dataset.state='shown'};
      img.onerror=()=>{img.remove();cell.dataset.state='empty'};
      img.src=url;cell.append(img);
    },()=>{cell.dataset.state='empty'});
  };
  if(typeof IntersectionObserver!=='function'){cells.forEach(fill);return}
  const watch=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){watch.unobserve(e.target);fill(e.target)}},{rootMargin:'120px'});
  cells.forEach(cell=>watch.observe(cell));
}
