import json,re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
import requests
from bs4 import BeautifulSoup

SRC=Path("analysis/kptu-corpus/selected-180.json")
OUT=Path("analysis/kptu-corpus/contact-authors-selected-180.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-contact-sample/1.0"}
PHONE=re.compile(r"(?:02|0[3-6][1-5]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}")
ROLES=("국장","부장","팀장","실장","위원장","사무국장","정책국장","조직국장","본부장","차장","간사","담당")
STOP=set("공공운수노조 민주노총 전국공공운수사회서비스노조 문의 담당 연락처 전화 보도자료 취재요청 성명 관리자 작성자 작성일 조회수 공공기관사업본부 공공기관사업팀 조직쟁의실 정책기획실".split())

def clean(s): return re.sub(r"\s+"," ",s or "").strip()

def name_from(pre):
    # Best signal: Korean personal-name token followed somewhere soon by a role.
    hits=[]
    for m in re.finditer(r"[가-힣]{2,4}",pre):
        tok=m.group()
        if tok in STOP: continue
        tail=pre[m.end():]
        role=next((r for r in ROLES if 0 <= tail.find(r) <= 65),None)
        if role and not tok.endswith(("노조","본부","지부","공사","센터","연맹")):
            hits.append((m.start(),tok,role))
    if hits:return hits[-1][1],hits[-1][2]
    # Fallback after 문의/담당: choose the last plausible Korean token before the phone.
    seg=re.split(r"(?:문의|담당|연락처|취재문의|보도문의)",pre)[-1]
    toks=[t for t in re.findall(r"[가-힣]{2,4}",seg) if t not in STOP and not t.endswith(("노조","본부","지부","공사","센터","연맹"))]
    return (toks[-1],None) if toks else (None,None)

def fetch(x):
    try:
        r=requests.get(x["url"],headers=UA,timeout=20); r.raise_for_status()
        txt=clean(BeautifulSoup(r.text,"html.parser").get_text(" ",strip=True))
        contacts=[];seen=set()
        for pm in PHONE.finditer(txt):
            pre=txt[max(0,pm.start()-180):pm.start()]
            if not re.search(r"(문의|담당|연락|국장|부장|팀장|실장|위원장|사무국장|본부장|차장|간사)",pre): continue
            name,role=name_from(pre)
            phone=re.sub(r"[.\s]+","-",pm.group())
            k=(name,phone)
            if k in seen:continue
            seen.add(k)
            contacts.append({"name":name,"role":role,"phone":phone,"snippet":clean(pre[-130:]+" "+pm.group())})
        return {**{k:x.get(k) for k in ["idx","date","kind","title","url"]},"contacts":contacts},None
    except Exception as e:return None,repr(e)

items=json.loads(SRC.read_text(encoding="utf-8"))["items"]
rows=[];errors=[]
with ThreadPoolExecutor(max_workers=10) as ex:
    futs={ex.submit(fetch,x):x for x in items}
    for fut in as_completed(futs):
        row,err=fut.result()
        if row:rows.append(row)
        else:errors.append({"idx":futs[fut]["idx"],"error":err})
counts={}
for r in rows:
    for c in r["contacts"]:
        if c["name"]:counts[c["name"]]=counts.get(c["name"],0)+1
summary={"documents":len(rows),"with_contact":sum(bool(r["contacts"]) for r in rows),"with_named":sum(any(c.get("name") for c in r["contacts"]) for r in rows),"errors":errors,"name_counts":sorted(counts.items(),key=lambda x:(-x[1],x[0]))}
OUT.write_text(json.dumps({"summary":summary,"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k!="errors"},ensure_ascii=False),flush=True)
