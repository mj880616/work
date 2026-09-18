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
UA={"User-Agent":"Mozilla/5.0 KPTU-author-research/3.0"}
TARGET={"성명","보도자료","취재요청"}
PHONE=re.compile(r"(?:02|0[3-6][1-5]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}")
ROLE_WORDS=("사무국장","정책국장","조직국장","사업국장","노안국장","교육선전국장","미디어국장","기획국장","대외협력국장","본부장","위원장","국장","부장","팀장","실장","차장","간사","담당자","담당")
ROLE_RE=re.compile("|".join(map(re.escape,ROLE_WORDS)))
CUE_RE=re.compile(r"(?:취재연락|취재문의|보도문의|문의(?:\s*및\s*담당)?|담당자?|연락처)")
STOP={"공공운수","민주노총","전국공공","전국철도","공공기관","공공철도","조직쟁의","정책기획","미디어소","노동안전","공공서비","연대본부","일반지부","대구지부","서울본부","서울지부","충북지부","경기지부","발전노조","운수노조","의료연대","공공기관사업","노동안전보건"}
TITLE_STOP={"성명","성명서","보도자료","취재요청","취재요청서","기자회견","공공운수노조","전국공공운수사회서비스노조","민주노총"}

def clean(s):return re.sub(r"\s+"," ",s or "").strip()

def title_tokens(title):
    t=re.sub(r"^\s*\[[^\]]+\]\s*","",title or "")
    toks=re.findall(r"[가-힣A-Za-z0-9]{2,}",t)
    return [x for x in toks if x not in TITLE_STOP and not re.fullmatch(r"20\d{2}",x)]

def score_doc(title,url,text):
    toks=title_tokens(title);hay=(unquote(url)+" "+clean(text[:3500])).lower();hits=[];score=0
    for tok in toks:
        if tok.lower() in hay:
            hits.append(tok);score+=2 if len(tok)>=4 else 1
    return score,hits

def valid_name(n):
    return bool(n and re.fullmatch(r"[가-힣]{2,4}",n) and n not in STOP and not n.endswith(("노조","본부","지부","연맹","공사","센터","사업단","위원회","협의회")))

def candidate_tokens(s):
    return [(m.group(),m.start(),m.end()) for m in re.finditer(r"[가-힣]{2,4}",s) if valid_name(m.group())]

def normalize_phone(p):
    return re.sub(r"[.\s]+","-",p) if p else None

def cue_contacts(text_all):
    found=[];seen=set()
    for cm in CUE_RE.finditer(text_all):
        win=text_all[cm.start():min(len(text_all),cm.start()+520)]
        for rm in ROLE_RE.finditer(win):
            before=win[max(0,rm.start()-90):rm.start()]
            after=win[rm.end():min(len(win),rm.end()+55)]
            bt=candidate_tokens(before)
            at=candidate_tokens(after)

            # "직책 이름"이면 뒤의 첫 이름을 우선. "이름 조직/직책"이면 앞의 가장 가까운 유효 이름 사용.
            name=None
            if at and re.match(r"^[\s:：()\[\],./-]*[가-힣]{2,4}",after):
                name=at[0][0]
            elif bt:
                name=bt[-1][0]
            if not valid_name(name):continue

            pos=rm.start()
            phs=list(PHONE.finditer(win))
            near=[p for p in phs if abs(p.start()-pos)<=150]
            phone=normalize_phone(near[0].group()) if near else None
            role=rm.group()
            key=(name,phone or "",role)
            if key in seen:continue
            seen.add(key)
            found.append({
                "name":name,"role":role,"phone":phone,
                "confidence":"high" if phone else "medium",
                "snippet":clean(win[:min(len(win),260)])
            })
    return found

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
            if not t:continue
            score,hits=score_doc(item["title"],u,t)
            candidates.append((score,len(t),u,t,hits))
        except Exception:continue
    if not candidates:return None
    candidates.sort(key=lambda x:(x[0],x[1]),reverse=True)
    best=candidates[0];toks=title_tokens(item["title"])
    if len(toks)>=3 and best[0]<2:return None
    return {"score":best[0],"chars":best[1],"url":best[2],"text":best[3],"hits":best[4],"candidate_count":len(candidates)}

def one(item):
    try:
        r=requests.get(item["url"],headers=UA,timeout=25);r.raise_for_status()
        soup=BeautifulSoup(r.text,"html.parser");links=[]
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

        text_all=clean(best["text"][:50000])
        contacts=cue_contacts(text_all)
        return {
          "idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"url":item["url"],
          "contacts":contacts,"has_hwp":True,"text_chars":len(best["text"]),
          "selected_hwp":best["url"],"title_match_score":best["score"],"title_match_hits":best["hits"],
          "hwp_candidate_count":best["candidate_count"]
        },None
    except Exception as e:return None,repr(e)

items=[x for x in json.loads(SRC.read_text(encoding="utf-8"))["items"] if x.get("kind") in TARGET and x.get("date","").startswith(YEAR)]
rows=[];errors=[]
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(one,x):x for x in items}
    for i,f in enumerate(as_completed(futs),1):
        row,err=f.result()
        if row:rows.append(row)
        else:errors.append({"idx":futs[f]["idx"],"error":err})
        if i%50==0:print(YEAR,"DONE",i,"/",len(items),flush=True)

summary={
    "year":YEAR,"requested":len(items),"completed":len(rows),
    "with_hwp":sum(bool(x.get("has_hwp")) for x in rows),
    "matched_hwp":sum(bool(x.get("selected_hwp")) for x in rows),
    "with_named":sum(bool(x.get("contacts")) for x in rows),
    "high_confidence_docs":sum(any(c.get("confidence")=="high" for c in x.get("contacts",[])) for x in rows),
    "medium_or_better_docs":sum(any(c.get("confidence") in {"high","medium"} for c in x.get("contacts",[])) for x in rows),
    "errors":errors
}
OUT.write_text(json.dumps({"summary":summary,"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k!="errors"},ensure_ascii=False),flush=True)
