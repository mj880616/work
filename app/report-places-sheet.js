// MTG-사업보고 6단계: 사업 보고의 두 고르기 창. 둘 다 공용 고르기 창(choice-sheet.js)을 그대로 쓴다.
// ① pickReportPlaces: [연결할 곳] — 업데이트 '기록할 곳 선택' 창과 같은 모양(체크·여러 곳·오른쪽 아래 [저장]), 바구니(미분류)만 없다.
// ② pickReport: 프로젝트·담당조직 화면의 [연결] — 사업 보고 전체(모든 종류)에서 하나를 고른다.
import {createChoiceSheet} from './choice-sheet.js';
import {readPlaces,placeSources,placeSheetHtml,placeValue,placeList,togglePlace,choiceCountText,placeName,PLACE_LIMIT} from './update-places.js';
import {pickerLine,pickableReports} from './report-links-model.mjs';
import {seoulParts} from './meeting-time.js';
import {reportRuntime} from './report-links.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let placesSheet=null,placesActive=null,placesCache=null,placesCacheOwner='';
const owner=()=>reportRuntime()?.context?.read?.()?.user?.id||'';

// 고를 수 있는 곳(담당조직·프로젝트) 목록. 한 번 읽으면 사용자가 같은 동안 기억한다(이름표 그리기에도 쓴다).
export async function loadReportPlaces(rt=reportRuntime()){
  if(placesCache&&placesCacheOwner===owner())return placesCache;
  await Promise.all([import('./organization-order.js'),import('./project-catalog.js')]);
  const read=await readPlaces(placeSources(rt),{rt});
  if(!read)throw new Error('연결할 곳을 불러오지 못했어요.');
  placesCache=read;placesCacheOwner=owner();return read;
}
export const forgetReportPlaces=()=>{placesCache=null};
// 이름표: 읽은 목록에 없으면(보관된 프로젝트 등) fallback 이름.
export function targetName(places,target,fallbackNames=new Map()){
  return placeName(places,{kind:target.kind,id:target.id})||fallbackNames.get(target.kind+':'+target.id)||'';
}
function ensurePlacesSheet(){
  placesSheet||=createChoiceSheet({id:'reportPlacesSheet',titleId:'reportPlacesSheetTitle',historyKey:'kptuReportPlaces',
    canOpen:()=>!!placesActive,choices:()=>loadReportPlaces().then(p=>{if(placesActive)placesActive.places=p}),
    render:()=>{if(placesActive)placesActive.pending=placeList(placesActive.chosen);return {title:'연결할 곳 선택',search:'조직·프로젝트 이름 검색',split:true,html:placeSheetHtml(placesActive?.places,placesActive?.pending,esc,{basket:false,references:false})}},
    multi:()=>placesActive?{pressed:value=>placesActive.pending.some(p=>placeValue(p)===value),label:choiceCountText(placesActive.pending).replace('바구니(미분류) 선택됨','연결 안 함')}:null,
    onSelect:(kind,value)=>{if(!placesActive)return;const next=togglePlace(placesActive.pending,value);if(next)placesActive.pending=next;else placesActive.onLimit?.(`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`)},
    onCommit:()=>{if(placesActive)placesActive.onCommit(placeList(placesActive.pending))},
    onError:error=>placesActive?.onLimit?.(error?.message||'연결할 곳을 불러오지 못했어요.')});
  return placesSheet;
}
// chosen: [{kind,id}]. onCommit(list)는 [저장]을 눌렀을 때만 불린다(취소·Esc·뒤로가기는 그대로 둠).
export function pickReportPlaces(trigger,{chosen=[],onCommit,onMessage}={}){
  placesActive={chosen:placeList(chosen),pending:[],places:null,onCommit,onLimit:onMessage};
  return ensurePlacesSheet().open('places',trigger);
}

let reportSheet=null,reportActive=null;
const dayText=m=>{if(!m?.meeting_at||Number.isNaN(Date.parse(m.meeting_at)))return '';const p=seoulParts(m.meeting_at);return `${p.month+1}.${p.day}`};
function ensureReportSheet(){
  reportSheet||=createChoiceSheet({id:'reportPickSheet',titleId:'reportPickSheetTitle',historyKey:'kptuReportPick',
    canOpen:()=>!!reportActive,choices:async()=>{},
    render:()=>{
      const rows=reportActive?.rows||[];
      const html=rows.length?rows.map(m=>`<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:0" data-depth="0" data-sheet-value="${esc(m.id)}" aria-pressed="false" title="${esc(pickerLine(m))}"><span class="home-choice-name">${esc(pickerLine(m))}${dayText(m)?` · ${esc(dayText(m))}`:''}</span></button>`).join(''):'<p class="home-choice-label">연결할 사업 보고가 없어요.</p>';
      return {title:reportActive?.title||'사업 보고 연결',search:'이름·종류 검색',html};
    },
    onSelect:(kind,value)=>{const pick=reportActive?.onPick;if(value)queueMicrotask(()=>reportSheet.close().then(()=>pick?.(value)))}});
  return reportSheet;
}
// reports: 모든 사업 보고. linkedIds: 이미 이 곳에 연결된 id(목록에서 뺀다).
export function pickReport(trigger,{reports,linkedIds=new Set(),title,onPick}={}){
  reportActive={rows:pickableReports(reports,linkedIds),title,onPick};
  return ensureReportSheet().open('report',trigger);
}
