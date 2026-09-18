import json,re,statistics
from pathlib import Path
from collections import defaultdict,Counter

INDIR=Path("analysis/kptu-corpus/text")
OUT=Path("analysis/kptu-corpus/feature-summary.json")

def sent_split(t):
    return [x.strip() for x in re.split(r"(?<=[.!?다요함됨])\s+",t) if x.strip()]

def count_any(t,words):
    return sum(t.count(w) for w in words)

rows=[]
for p in sorted(INDIR.glob("*.json")):
    d=json.loads(p.read_text(encoding="utf-8"))
    for x in d.get("items",[]):
        t=x.get("text","")
        sents=sent_split(t)
        lead=" ".join(sents[:2])[:1200]
        f={
          "idx":x["idx"],"kind":x["kind"],"year":x["date"][:4],"date":x["date"],
          "title":x["title"],"author":x.get("author"),"priority_topic":x.get("priority_topic",False),
          "text_chars":len(t),"title_chars":len(x.get("title","")),
          "sentence_count":len(sents),
          "avg_sentence_chars":round(statistics.mean([len(s) for s in sents]),1) if sents else 0,
          "lead_chars":len(lead),
          "number_mentions":len(re.findall(r"\d[\d,.%억만원명개조년월일시분-]*",t)),
          "quote_marks":sum(t.count(q) for q in ["“","”","‘","’","\""]),
          "demand_terms":count_any(t,["요구","촉구","철회","중단","개선","마련해야","나서야","책임"]),
          "judgment_terms":count_any(t,["규탄","비판","문제","부당","위험","심각","우려"]),
          "evidence_terms":count_any(t,["따르면","자료","조사","통계","연구","결과","사례","실태"]),
          "event_terms":count_any(t,["기자회견","토론회","결의대회","집회","간담회","일시","장소"]),
          "reporter_terms":count_any(t,["취재","보도","언론사","문의","담당자"]),
          "low_text":x.get("low_text",False),
        }
        rows.append(f)

by=defaultdict(list)
for r in rows: by[(r["kind"],r["year"])].append(r)

def med(vals):
    vals=sorted(vals)
    if not vals:return 0
    n=len(vals)
    return vals[n//2] if n%2 else round((vals[n//2-1]+vals[n//2])/2,1)

metrics=["text_chars","title_chars","sentence_count","avg_sentence_chars","number_mentions","quote_marks","demand_terms","judgment_terms","evidence_terms","event_terms","reporter_terms"]
groups={}
for k,v in sorted(by.items()):
    groups[f"{k[0]}-{k[1]}"]={"count":len(v)}
    for m in metrics:
        groups[f"{k[0]}-{k[1]}"][f"median_{m}"]=med([x[m] for x in v])
summary={
 "documents":len(rows),
 "low_text":sum(1 for r in rows if r["low_text"]),
 "by_group":groups,
 "authors":Counter(r.get("author") or "미상" for r in rows).most_common(),
 "items":rows
}
OUT.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"documents":summary["documents"],"low_text":summary["low_text"],"groups":{k:v["count"] for k,v in groups.items()}},ensure_ascii=False))

# corpus text available: rerun marker
