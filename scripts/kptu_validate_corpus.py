import json,re
from pathlib import Path
from collections import Counter

ROOT=Path("analysis/kptu-corpus")
OUT=ROOT/"validation-summary.json"

STOP={"보도자료","취재요청","성명","기자회견","공공운수노조","전국공공운수사회서비스노조","관련","대한","위한","및","요구","촉구","규탄","개최","노동자","정부","노조","노동조합"}

def toks(s):
    xs=re.findall(r"[가-힣A-Za-z0-9]{2,}",s or "")
    return [x.lower() for x in xs if x not in STOP and not re.fullmatch(r"20\d{2}",x)]

def row_author(row,date):
    m=re.search(r"조회수\s+\d+\s+(.+?)\s+\d+\s+"+re.escape(date)+r"$",row or "")
    return m.group(1).strip() if m else None

rows=[]
for p in (ROOT/"text").glob("*.json"):
    d=json.loads(p.read_text(encoding="utf-8"))
    for x in d.get("items",[]):
        tt=set(toks(x.get("title","")))
        body=set(toks(x.get("text","")))
        overlap=len(tt & body)
        ratio=overlap/max(1,min(len(tt),8))
        ra=row_author(x.get("row_text",""),x["date"])
        da=x.get("author")
        author_mismatch=bool(ra and da and ra!=da)
        suspicious=ratio<0.25 or author_mismatch
        rows.append({
          "idx":x["idx"],"kind":x["kind"],"date":x["date"],"title":x["title"],
          "row_author":ra,"detail_author":da,"title_tokens":sorted(tt),
          "overlap":overlap,"overlap_ratio":round(ratio,3),
          "text_source":x.get("text_source"),"text_chars":x.get("text_chars"),
          "low_text":x.get("low_text"),"author_mismatch":author_mismatch,
          "suspicious":suspicious
        })
bad=[x for x in rows if x["suspicious"]]
summary={"documents":len(rows),"suspicious_count":len(bad),"author_mismatch_count":sum(x["author_mismatch"] for x in rows),"low_overlap_count":sum(x["overlap_ratio"]<0.25 for x in rows),"suspicious":sorted(bad,key=lambda x:(not x["author_mismatch"],x["overlap_ratio"]))}
OUT.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"documents":len(rows),"suspicious_count":len(bad),"author_mismatch_count":summary["author_mismatch_count"],"low_overlap_count":summary["low_overlap_count"]},ensure_ascii=False))
for x in summary["suspicious"][:40]:
    print(x["idx"],x["date"],x["overlap_ratio"],x["row_author"],"=>",x["detail_author"],x["title"])
