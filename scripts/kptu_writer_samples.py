import json,re,subprocess,tempfile,os,html
from pathlib import Path
from collections import defaultdict
from urllib.parse import urljoin,unquote
import requests
from bs4 import BeautifulSoup

ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"contact-authors-hwp-full.json"
OUT=ROOT/"writer-samples"
INDEX=ROOT/"writer-samples-index.json"
UA={"User-Agent":"Mozilla/5.0 KPTU-writer-sample/3.0"}
BAD=set("""공공운수 민주노총 전국공공 전국철도 공공기관 공공철도 조직쟁의 정책기획 미디어소 노동안전 공공서비 관리자 문의사항 담당기자 연대본부 일반지부 대구지부 더유니온 운수노조 충북지부 경기지부 서울본부 서울지부 발전노조 내용을""".split())
TITLE_STOP=set("""성명 성명서 보도자료 취재요청 취재요청서 기자회견 공공운수노조 전국공공운수사회서비스노조 민주노총 요구 촉구 규탄 대한 관련 개최 발표 기자 노동자 노조 정부 공공""".split())

def clean(s):return re.sub(r"\s+"," ",s or "").strip()

def title_tokens(title):
    return [x for x in dict.fromkeys(re.findall(r"[가-힣A-Za-z0-9]{2,}",title or "")) if x not in TITLE_STOP]

def hwp_text_from_bytes(data):
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(data);p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=90)
        return z.stdout.decode("utf-8","replace") if z.returncode==0 else ""
    finally:
        try:os.unlink(p)
        except:pass

def extract_selected_hwp(url):
    r=requests.get(url,headers=UA,timeout=45);r.raise_for_status()
    return hwp_text_from_bytes(r.content)

def choose_hwp_from_page(row):
    r=requests.get(row["url"],headers=UA,timeout=30);r.raise_for_status()
    soup=BeautifulSoup(r.text,"html.parser")
    links=[]
    for a in soup.find_all("a",href=True):
        h=html.unescape(a["href"])
        if "FileDown.aspx" in h and re.search(r"\.hwp(?:&|$)",h,re.I):
            u=urljoin(row["url"],h)
            if u not in links:links.append(u)
    toks=title_tokens(row.get("title"))
    cand=[]
    for u in links[:6]:
        try:
            fr=requests.get(u,headers=UA,timeout=45);fr.raise_for_status()
            t=hwp_text_from_bytes(fr.content)
            hay=(unquote(u)+" "+clean(t[:3500])).lower()
            matched=[x for x in toks if x.lower() in hay]
            score=sum(2 if len(x)>=4 else 1 for x in matched)
            cand.append((score,len(t),u,t))
        except Exception:
            pass
    if not cand:return None,""
    cand.sort(key=lambda x:(x[0],x[1]),reverse=True)
    score,chars,u,t=cand[0]
    if len(toks)>=3 and score<2:return None,""
    return u,t

def plausible_legacy_contact(row,c):
    n=c.get("name");sn=c.get("snippet") or ""
    if not n or n not in sn:return False
    toks=title_tokens(row.get("title"))
    matched=[x for x in toks if x.lower() in sn.lower()]
    return len(matched)>=2 or any(len(x)>=4 for x in matched)

data=json.loads(SRC.read_text(encoding="utf-8"))
by=defaultdict(dict)
for row in data["items"]:
    for c in row.get("contacts",[]):
        n=c.get("name")
        if not n or n in BAD or not re.fullmatch(r"[가-힣]{2,4}",n):
            continue
        if row.get("selected_hwp"):
            rank={"high":3,"medium":2}.get(c.get("confidence"),1)
        else:
            if not plausible_legacy_contact(row,c):continue
            rank=1
        old=by[n].get(row["idx"])
        if not old or rank>=old.get("_contact_rank",-1):
            d=dict(row);d["_contact_rank"]=rank
            by[n][row["idx"]]=d

ranked=sorted(((n,len(docs)) for n,docs in by.items() if len(docs)>=2),key=lambda x:(-x[1],x[0]))[:20]

OUT.mkdir(parents=True,exist_ok=True)
for p in OUT.glob("*.md"):p.unlink()

index=[]
for name,count in ranked:
    docs=list(by[name].values())
    docs.sort(key=lambda x:(x.get("_contact_rank",0),x.get("date",""),x.get("idx",0)),reverse=True)
    chosen=[];seen_kind=set()
    for d in docs:
        if d.get("kind") not in seen_kind:
            chosen.append(d);seen_kind.add(d.get("kind"))
        if len(chosen)>=5:break
    ids={x["idx"] for x in chosen}
    for d in docs:
        if len(chosen)>=5:break
        if d["idx"] not in ids:chosen.append(d);ids.add(d["idx"])

    parts=[f"# {name} — 반복 담당자료 표본\n",f"신뢰 매핑 문서 수: {count}\n"]
    samples=[]
    for d in chosen:
        try:
            if d.get("selected_hwp"):
                hwp=d["selected_hwp"];txt=extract_selected_hwp(hwp)
            else:
                hwp,txt=choose_hwp_from_page(d)
        except Exception as e:
            hwp=None;txt=f"[추출 실패: {e}]"
        parts.append(f"## {d['date']} · {d['kind']} · {d['title']}\n\n{txt}\n\n---\n")
        samples.append({"idx":d["idx"],"date":d["date"],"kind":d["kind"],"title":d["title"],"url":d["url"],"selected_hwp":hwp,"contact_rank":d.get("_contact_rank",0),"chars":len(txt)})
    (OUT/f"{name}.md").write_text("\n".join(parts),encoding="utf-8")
    index.append({"name":name,"mapped_count":count,"samples":samples})

INDEX.write_text(json.dumps({"writers":index},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(index,ensure_ascii=False))
