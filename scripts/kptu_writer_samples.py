import json,re,subprocess,tempfile,os
from pathlib import Path
from urllib.parse import urljoin
from collections import defaultdict,Counter
import requests
from bs4 import BeautifulSoup

ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"contact-authors-hwp-full.json"
OUT=ROOT/"writer-samples"
INDEX=ROOT/"writer-samples-index.json"
UA={"User-Agent":"Mozilla/5.0 KPTU-writer-sample/1.0"}
BAD=set("""공공운수 민주노총 전국공공 전국철도 공공기관 공공철도 조직쟁의 정책기획 미디어소 노동안전 공공서비 관리자 문의사항 담당기자""".split())

def clean(s):return re.sub(r"\s+"," ",s or "").strip()

def extract_hwp(url):
    r=requests.get(url,headers=UA,timeout=30);r.raise_for_status()
    soup=BeautifulSoup(r.text,"html.parser")
    links=[]
    for a in soup.find_all("a",href=True):
        h=a["href"]
        if "FileDown.aspx" in h and re.search(r"\.hwp(?:&|$)",h,re.I):
            u=urljoin(url,h.replace("&amp;","&"))
            if u not in links:links.append(u)
    if not links:return ""
    fr=requests.get(links[0],headers=UA,timeout=40);fr.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(fr.content);p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=75)
        return z.stdout.decode("utf-8","replace") if z.returncode==0 else ""
    finally:
        try:os.unlink(p)
        except:pass

data=json.loads(SRC.read_text(encoding="utf-8"))
by=defaultdict(dict)
for r in data["items"]:
    for c in r.get("contacts",[]):
        n=c.get("name")
        if not n or n in BAD or not re.fullmatch(r"[가-힣]{2,4}",n):continue
        by[n][r["idx"]]=r

ranked=sorted(((n,len(docs)) for n,docs in by.items() if len(docs)>=3),key=lambda x:(-x[1],x[0]))[:15]
OUT.mkdir(parents=True,exist_ok=True)
index=[]
for name,count in ranked:
    docs=list(by[name].values())
    docs.sort(key=lambda x:(x.get("date",""),x.get("idx",0)),reverse=True)
    # diversify by genre first, then fill with recent docs
    chosen=[];seen_kind=set()
    for d in docs:
        if d.get("kind") not in seen_kind:
            chosen.append(d);seen_kind.add(d.get("kind"))
        if len(chosen)>=4:break
    for d in docs:
        if len(chosen)>=4:break
        if d["idx"] not in {x["idx"] for x in chosen}:chosen.append(d)
    parts=[f"# {name} — 반복 담당자료 표본\n",f"전체 매핑 문서 수: {count}\n"]
    samples=[]
    for d in chosen:
        try:text=extract_hwp(d["url"])
        except Exception as e:text=f"[추출 실패: {e}]"
        parts.append(f"## {d['date']} · {d['kind']} · {d['title']}\n\n{text}\n\n---\n")
        samples.append({"idx":d["idx"],"date":d["date"],"kind":d["kind"],"title":d["title"],"url":d["url"],"chars":len(text)})
    (OUT/f"{name}.md").write_text("\n".join(parts),encoding="utf-8")
    index.append({"name":name,"mapped_count":count,"samples":samples})
INDEX.write_text(json.dumps({"writers":index},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(index,ensure_ascii=False))
