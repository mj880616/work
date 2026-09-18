import os,json,re,subprocess,tempfile,html
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.parse import urljoin,unquote

import requests
from bs4 import BeautifulSoup

YEAR=os.environ["YEAR"]
ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"metadata-2023-2026.json"
OUT=Path(f"/tmp/hwp-contacts-{YEAR}.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-author-research/2.0"}
TARGET={"성명","보도자료","취재요청"}
PHONE=re.compile(r"(?:02|0[3-6][1-5]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}")
ROLE=r"(?:사무국장|정책국장|조직국장|사업국장|노안국장|교육선전국장|미디어국장|기획국장|대외협력국장|본부장|위원장|국장|부장|팀장|실장|차장|간사|담당자|담당)"
STOP={"공공운수","민주노총","전국공공","전국철도","공공기관","공공철도","조직쟁의","정책기획","미디어소","노동안전","공공서비","연대본부","일반지부","대구지부","서울본부","서울지부","충북지부","경기지부","발전노조","운수노조"}
TITLE_STOP={"성명","성명서","보도자료","취재요청","취재요청서","기자회견","공공운수노조","전국공공운수사회서비스노조","민주노총"}

def clean(s):
    return re.sub(r"\s+"," ",s or "").strip()

def title_tokens(title):
    t=re.sub(r"^\s*\[[^\]]+\]\s*","",title or "")
    toks=re.findall(r"[가-힣A-Za-z0-9]{2,}",t)
    return [x for x in toks if x not in TITLE_STOP and not re.fullmatch(r"20\d{2}",x)]

def score_doc(title,url,text):
    toks=title_tokens(title)
    hay=(unquote(url)+" "+clean(text[:3500])).lower()
    hits=[]
    score=0
    for tok in toks:
        if tok.lower() in hay:
            hits.append(tok)
            score += 2 if len(tok)>=4 else 1
    # A plausible current-post attachment should match multiple title terms when several exist.
    return score,hits

def extract_name(block):
    # Strongest signal: personal name immediately followed by a job title somewhere before the phone.
    hits=[]
    for m in re.finditer(r"([가-힣]{2,4})\s+(?:(?:공공운수노조|전국공공운수사회서비스노조|[가-힣A-Za-z0-9·()/_-]+)\s+){0,6}?("+ROLE+r")",block):
        name=m.group(1)
        if name in STOP or name.endswith(("노조","본부","지부","연맹","공사","센터","사업단")):
            continue
        hits.append((m.start(),name,m.group(2)))
    if hits:
        return hits[-1][1],hits[-1][2]

    # Fallback for "직책 이름" order.
    hits=[]
    for m in re.finditer("("+ROLE+r")\s*[:：-]?\s*([가-힣]{2,4})",block):
        name=m.group(2)
        if name in STOP: continue
        hits.append((m.start(),name,m.group(1)))
    if hits:
        return hits[-1][1],hits[-1][2]

    # Last-resort contact block after 문의/담당.
    seg=re.split(r"(?:취재연락|취재문의|보도문의|문의(?:\s*및\s*담당)?|담당자?|연락처)\s*[:：.#*·\-☛]*",block)[-1]
    toks=[x for x in re.findall(r"[가-힣]{2,4}",seg) if x not in STOP and not x.endswith(("노조","본부","지부","공사","센터","연맹"))]
    return (toks[-1],None) if toks else (None,None)

def hwp_text(data):
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(data);p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=60)
        return z.stdout.decode("utf-8","replace") if z.returncode==0 else ""
    finally:
        try:os.unlink(p)
        except:pass

def choose_hwp(item,links):
    candidates=[]
    for u in links[:6]:
        try:
            fr=requests.get(u,headers=UA,timeout=40);fr.raise_for_status()
            t=hwp_text(fr.content)
            if not t: continue
            score,hits=score_doc(item["title"],u,t)
            candidates.append((score,len(t),u,t,hits))
        except Exception:
            continue
    if not candidates:
        return None
    candidates.sort(key=lambda x:(x[0],x[1]),reverse=True)
    best=candidates[0]
    toks=title_tokens(item["title"])
    # If several distinctive title tokens exist, require some evidence that this HWP belongs to this post.
    if len(toks)>=3 and best[0] < 2:
        return None
    return {"score":best[0],"chars":best[1],"url":best[2],"text":best[3],"hits":best[4],"candidate_count":len(candidates)}

def one(item):
    try:
        r=requests.get(item["url"],headers=UA,timeout=25);r.raise_for_status()
        soup=BeautifulSoup(r.text,"html.parser")
        links=[]
        for a in soup.find_all("a",href=True):
            h=html.unescape(a["href"])
            if "FileDown.aspx" in h and re.search(r"\.hwp(?:&|$)",h,re.I):
                u=urljoin(item["url"],h)
                if u not in links:links.append(u)
        if not links:
            return {"idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"url":item["url"],"contacts":[],"has_hwp":False},None

        best=choose_hwp(item,links)
        if not best:
            return {"idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"url":item["url"],"contacts":[],"has_hwp":True,"match_failed":True,"hwp_link_count":len(links)},None

        text_all=clean(best["text"][:40000])
        contacts=[];seen=set()
        for pm in PHONE.finditer(text_all):
            pre=text_all[max(0,pm.start()-320):pm.start()]
            if not re.search(r"(문의|담당|연락|국장|부장|팀장|실장|위원장|사무국장|본부장|차장|간사)",pre):
                continue
            name,role=extract_name(pre)
            if not name: continue
            phone=re.sub(r"[.\s]+","-",pm.group())
            key=(name,phone)
            if key in seen: continue
            seen.add(key)
            cue=bool(re.search(r"(취재연락|취재문의|보도문의|문의|담당|연락처)",pre[-180:]))
            contacts.append({
                "name":name,"role":role,"phone":phone,
                "confidence":"high" if cue and role else "medium",
                "snippet":clean(pre[-190:]+" "+pm.group())
            })
        return {
          "idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"url":item["url"],
          "contacts":contacts,"has_hwp":True,"text_chars":len(best["text"]),
          "selected_hwp":best["url"],"title_match_score":best["score"],"title_match_hits":best["hits"],
          "hwp_candidate_count":best["candidate_count"]
        },None
    except Exception as e:
        return None,repr(e)

items=[x for x in json.loads(SRC.read_text(encoding="utf-8"))["items"] if x.get("kind") in TARGET and x.get("date","").startswith(YEAR)]
rows=[];errors=[]
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(one,x):x for x in items}
    for i,f in enumerate(as_completed(futs),1):
        row,err=f.result()
        if row: rows.append(row)
        else: errors.append({"idx":futs[f]["idx"],"error":err})
        if i%50==0: print(YEAR,"DONE",i,"/",len(items),flush=True)

summary={
    "year":YEAR,
    "requested":len(items),
    "completed":len(rows),
    "with_hwp":sum(bool(x.get("has_hwp")) for x in rows),
    "matched_hwp":sum(bool(x.get("selected_hwp")) for x in rows),
    "with_named":sum(bool(x.get("contacts")) for x in rows),
    "high_confidence_docs":sum(any(c.get("confidence")=="high" for c in x.get("contacts",[])) for x in rows),
    "errors":errors
}
OUT.write_text(json.dumps({"summary":summary,"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k!="errors"},ensure_ascii=False),flush=True)
