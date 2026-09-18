import json,re,subprocess,tempfile,os
from pathlib import Path
from collections import defaultdict
import requests

ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"contact-authors-hwp-full.json"
OUT=ROOT/"writer-samples"
INDEX=ROOT/"writer-samples-index.json"
UA={"User-Agent":"Mozilla/5.0 KPTU-writer-sample/2.0"}
BAD=set("""공공운수 민주노총 전국공공 전국철도 공공기관 공공철도 조직쟁의 정책기획 미디어소 노동안전 공공서비 관리자 문의사항 담당기자 연대본부 일반지부 대구지부 더유니온 운수노조 충북지부 경기지부 서울본부 서울지부 발전노조 내용을""".split())

def extract_selected_hwp(url):
    r=requests.get(url,headers=UA,timeout=45);r.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(r.content);p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=90)
        return z.stdout.decode("utf-8","replace") if z.returncode==0 else ""
    finally:
        try:os.unlink(p)
        except:pass

data=json.loads(SRC.read_text(encoding="utf-8"))
by=defaultdict(dict)
for row in data["items"]:
    # Only documents whose own HWP was matched to the current post are eligible.
    if not row.get("selected_hwp"):
        continue
    for c in row.get("contacts",[]):
        n=c.get("name")
        if not n or n in BAD or not re.fullmatch(r"[가-힣]{2,4}",n):
            continue
        # Prefer explicit 문의/담당 + role signals; medium confidence is retained
        # only when no high-confidence duplicate exists for the same person/document.
        old=by[n].get(row["idx"])
        rank={"high":2,"medium":1}.get(c.get("confidence"),0)
        oldrank=(old or {}).get("_contact_rank",-1)
        if rank>=oldrank:
            d=dict(row);d["_contact_rank"]=rank
            by[n][row["idx"]]=d

ranked=sorted(
    ((n,len(docs)) for n,docs in by.items() if len(docs)>=2),
    key=lambda x:(-x[1],x[0])
)[:20]

OUT.mkdir(parents=True,exist_ok=True)
for p in OUT.glob("*.md"):
    p.unlink()

index=[]
for name,count in ranked:
    docs=list(by[name].values())
    docs.sort(key=lambda x:(x.get("_contact_rank",0),x.get("date",""),x.get("idx",0)),reverse=True)

    # First take one document per genre, then fill to at most five with strongest/recent docs.
    chosen=[];seen_kind=set()
    for d in docs:
        if d.get("kind") not in seen_kind:
            chosen.append(d);seen_kind.add(d.get("kind"))
        if len(chosen)>=5:break
    chosen_ids={x["idx"] for x in chosen}
    for d in docs:
        if len(chosen)>=5:break
        if d["idx"] not in chosen_ids:
            chosen.append(d);chosen_ids.add(d["idx"])

    parts=[f"# {name} — 반복 담당자료 표본\n",f"전체 신뢰 매핑 문서 수: {count}\n"]
    samples=[]
    for d in chosen:
        try:
            text=extract_selected_hwp(d["selected_hwp"])
        except Exception as e:
            text=f"[추출 실패: {e}]"
        parts.append(f"## {d['date']} · {d['kind']} · {d['title']}\n\n{text}\n\n---\n")
        samples.append({
            "idx":d["idx"],"date":d["date"],"kind":d["kind"],"title":d["title"],
            "url":d["url"],"selected_hwp":d["selected_hwp"],
            "contact_rank":d.get("_contact_rank",0),"chars":len(text)
        })

    (OUT/f"{name}.md").write_text("\n".join(parts),encoding="utf-8")
    index.append({"name":name,"mapped_count":count,"samples":samples})

INDEX.write_text(json.dumps({"writers":index},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(index,ensure_ascii=False))
