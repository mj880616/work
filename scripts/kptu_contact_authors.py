import json,re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
import requests
from bs4 import BeautifulSoup

SRC=Path("analysis/kptu-corpus/metadata-2023-2026.json")
OUT=Path("analysis/kptu-corpus/contact-authors-2023-2026.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-corpus-contact-research/1.0"}
WORKERS=6

PHONE_RE=re.compile(r"(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|01[016789][-\s]?\d{3,4}[-\s]?\d{4})")
ROLE_RE=re.compile(r"(국장|부장|팀장|실장|위원장|사무국장|정책국장|조직국장|본부장|차장|간사|담당자|담당)")
NAME_RE=re.compile(r"[가-힣]{2,4}")
STOP=set("""문의 담당 연락처 전화 이메일 공공운수노조 민주노총 전국공공운수사회서비스노조 공공기관사업본부 공공기관사업팀 조직쟁의실 정책기획실 정책실 관리자 작성자 작성일 조회수 보도자료 취재요청 성명 수정 삭제 목록 이전글 다음글 서울본부 철도노조""".split())

def clean(s):
    return re.sub(r"\s+"," ",s or "").strip()

def guess_name(prefix):
    # Prefer a Korean name whose following text contains a job-title before the phone.
    candidates=[]
    for m in NAME_RE.finditer(prefix):
        token=m.group()
        if token in STOP or token.endswith(("노조","본부","지부","연맹","공사","센터","실장","국장","부장","팀장","위원장")):
            continue
        tail=prefix[m.end():]
        role=ROLE_RE.search(tail)
        if role and role.start()<=70:
            candidates.append((m.start(),token,role.group()))
    if candidates:
        return candidates[-1][1],candidates[-1][2]
    # Contact blocks often look like "문의: 김OO ..."
    m=re.search(r"(?:문의|담당|취재문의|보도문의)\s*[:：\-]?\s*(?:[가-힣A-Za-z0-9·()]+\s+){0,5}?([가-힣]{2,4})\b",prefix)
    if m and m.group(1) not in STOP:
        return m.group(1),None
    return None,None

def fetch(item):
    try:
        r=requests.get(item["url"],headers=UA,timeout=25)
        r.raise_for_status()
        soup=BeautifulSoup(r.text,"html.parser")
        txt=clean(soup.get_text(" ",strip=True))
        contacts=[]
        seen=set()
        for pm in PHONE_RE.finditer(txt):
            phone=re.sub(r"\s+","-",pm.group()).replace(".","-")
            pre=txt[max(0,pm.start()-150):pm.start()]
            post=txt[pm.end():pm.end()+60]
            # Require contact-ish context, or a nearby role.
            if not re.search(r"(문의|담당|연락|국장|부장|팀장|실장|위원장|사무국장|본부장|차장)",pre):
                continue
            name,role=guess_name(pre)
            key=(name,phone)
            if key in seen: continue
            seen.add(key)
            contacts.append({"name":name,"role":role,"phone":phone,"snippet":clean(pre[-120:]+" "+pm.group()+" "+post[:30])})
        return {"idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"department":item.get("row_text"),"url":item["url"],"contacts":contacts},None
    except Exception as e:
        return None,repr(e)

items=json.loads(SRC.read_text(encoding="utf-8"))["items"]
results=[];errors=[]
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futs={ex.submit(fetch,x):x for x in items}
    for i,f in enumerate(as_completed(futs),1):
        row,err=f.result()
        if err: errors.append({"idx":futs[f]["idx"],"error":err})
        elif row: results.append(row)
        if i%100==0: print("DONE",i,flush=True)

with_contacts=[r for r in results if r["contacts"]]
name_counts={}
for r in with_contacts:
    for c in r["contacts"]:
        if c["name"]:
            name_counts[c["name"]]=name_counts.get(c["name"],0)+1
summary={
    "documents":len(results),
    "with_contact":len(with_contacts),
    "with_named_contact":sum(1 for r in results if any(c.get("name") for c in r["contacts"])),
    "errors":errors,
    "name_counts":sorted(name_counts.items(),key=lambda x:(-x[1],x[0]))
}
OUT.write_text(json.dumps({"summary":summary,"items":results},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k!="errors"},ensure_ascii=False),flush=True)
