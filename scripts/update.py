import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from time import sleep
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "site" / "papers.json"
TIMEZONE = timezone(timedelta(hours=8))
PUBMED = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
SOURCE_ERRORS = (URLError, OSError, ValueError, KeyError, ElementTree.ParseError)


def publication_date(work):
    for field in ("published-online", "published", "published-print"):
        parts = work.get(field, {}).get("date-parts", [[]])[0]
        if len(parts) == 3 and all(isinstance(part, int) for part in parts):
            return date(*parts)
    return None


def fetch_journal(journal, start, today, date_field):
    endpoint = f"https://api.crossref.org/journals/{journal['issn']}/works"
    params = {
        "filter": f"type:journal-article,from-{date_field}:{start},until-{date_field}:{today}",
        "select": "DOI,title,author,published,published-online,published-print,created,update-to",
        "rows": 500,
        "cursor": "*",
    }
    email = os.getenv("CROSSREF_EMAIL")
    if email:
        params["mailto"] = email

    papers = []
    while True:
        request = Request(
            f"{endpoint}?{urlencode(params)}",
            headers={"User-Agent": "AcademicSearch/1.0"},
        )
        with urlopen(request, timeout=25) as response:
            batch = json.load(response)["message"]
        for work in batch["items"]:
            published = publication_date(work)
            titles = work.get("title", [])
            title = unescape(re.sub(r"<[^>]+>", "", titles[0])).strip() if titles else ""
            doi = work.get("DOI", "").strip().lower()
            created = work.get("created", {}).get("date-time")
            indexed = datetime.fromisoformat(created).astimezone(TIMEZONE).date() if created else None
            if not title or not doi:
                continue
            authors = [
                " ".join(filter(None, (author.get("given"), author.get("family"))))
                or author.get("name", "")
                for author in work.get("author", [])
            ]
            papers.append({
                "doi": doi,
                "title": title,
                "journal": journal["name"],
                "date": published.isoformat() if published else None,
                "indexedDate": indexed.isoformat() if indexed else None,
                "indexedSource": "Crossref" if indexed else None,
                "articleType": crossref_type(work),
                "authors": list(filter(None, authors)),
            })
        if len(batch["items"]) < params["rows"]:
            return papers
        params["cursor"] = batch["next-cursor"]


def crossref_type(work):
    updates = {item.get("type") for item in work.get("update-to", [])}
    for labels, category in [
        ({"retraction", "withdrawal"}, "撤稿"),
        ({"correction", "corrigendum", "erratum", "addendum"}, "更正"),
        ({"expression_of_concern"}, "关注声明"),
    ]:
        if updates & labels:
            return category
    return "期刊文章"


def pubmed_get(action, params):
    sleep(0.35)
    query = urlencode({"db": "pubmed", "tool": "academic_search", **params})
    with urlopen(f"{PUBMED}/{action}.fcgi?{query}", timeout=25) as response:
        return response.read()


def xml_date(node):
    if node is None:
        return None
    year, month, day = (node.findtext(part, "") for part in ("Year", "Month", "Day"))
    if not (year and month and day):
        return None
    try:
        month_number = int(month) if month.isdigit() else datetime.strptime(month[:3], "%b").month
        return date(int(year), month_number, int(day)).isoformat()
    except ValueError:
        return None


def pubmed_type(article):
    types = {node.text for node in article.findall("PublicationTypeList/PublicationType")}
    for labels, category in [
        ({"Retraction of Publication"}, "撤稿"),
        ({"Published Erratum", "Corrected and Republished Article"}, "更正"),
        ({"Expression of Concern"}, "关注声明"),
        ({"Systematic Review", "Meta-Analysis", "Review"}, "综述"),
        ({"Clinical Trial", "Randomized Controlled Trial"}, "临床试验"),
        ({"News", "Editorial", "Comment", "Letter"}, "新闻／评论"),
        ({"Case Reports"}, "病例报告"),
    ]:
        if types & labels:
            return category
    return "期刊文章"


def fetch_pubmed(journal, start, today):
    span = f"{start:%Y/%m/%d}:{today:%Y/%m/%d}"
    term = f'"{journal["pubmed"]}"[Journal] AND ({span}[EDAT] OR {span}[DP])'
    result = json.loads(pubmed_get("esearch", {"term": term, "retmode": "json", "retmax": 9999}))["esearchresult"]
    ids = result["idlist"]
    if len(ids) < int(result["count"]):
        raise ValueError("PubMed result exceeded the search limit")
    papers = []
    for offset in range(0, len(ids), 150):
        xml = ElementTree.fromstring(pubmed_get("efetch", {"id": ",".join(ids[offset:offset + 150]), "retmode": "xml"}))
        if xml.tag != "PubmedArticleSet":
            raise ValueError("Unexpected PubMed response")
        for record in xml.findall("PubmedArticle"):
            article = record.find("MedlineCitation/Article")
            title_node = article.find("ArticleTitle")
            title = "".join(title_node.itertext()).strip() if title_node is not None else ""
            pmid = record.findtext("MedlineCitation/PMID")
            if not title or not pmid:
                continue
            doi = record.findtext("PubmedData/ArticleIdList/ArticleId[@IdType='doi']", "").strip().lower()
            history = "PubmedData/History/PubMedPubDate"
            published = (xml_date(article.find("ArticleDate[@DateType='Electronic']"))
                         or xml_date(record.find(history + "[@PubStatus='epublish']"))
                         or xml_date(article.find("Journal/JournalIssue/PubDate")))
            indexed = (xml_date(record.find(history + "[@PubStatus='entrez']"))
                       or xml_date(record.find(history + "[@PubStatus='pubmed']")))
            authors = [" ".join(filter(None, (author.findtext("ForeName"), author.findtext("LastName"))))
                       or author.findtext("CollectiveName", "") for author in article.findall("AuthorList/Author")]
            papers.append({
                "doi": doi, "pmid": pmid, "title": title, "journal": journal["name"],
                "date": published, "indexedDate": indexed,
                "indexedSource": "PubMed" if indexed else None,
                "authors": list(filter(None, authors)), "articleType": pubmed_type(article),
            })
    return papers


def merge_paper(papers, incoming):
    doi, pmid = incoming.get("doi"), incoming.get("pmid")
    key = doi or f"pmid:{pmid}"
    old = papers.get(key, {})
    if doi and pmid:
        old = {**papers.pop(f"pmid:{pmid}", {}), **old}
    elif pmid:
        linked = next((item for item, paper in papers.items() if paper.get("pmid") == pmid), key)
        key, old = linked, papers.get(linked, old)
    combined = {**old, **{field: value for field, value in incoming.items() if value}}
    combined.setdefault("authors", [])
    if old.get("indexedSource") == "PubMed" and incoming.get("indexedSource") != "PubMed":
        combined.update(indexedDate=old["indexedDate"], indexedSource="PubMed")
        if old.get("date"):
            combined["date"] = old["date"]
    if incoming["articleType"] == "期刊文章" and old.get("articleType"):
        combined["articleType"] = old["articleType"]
    papers[key] = combined


def main():
    now = datetime.now(TIMEZONE)
    today = now.date()
    start = today - timedelta(days=29)
    journals = json.loads((ROOT / "journals.json").read_text(encoding="utf-8"))
    old = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    papers = {paper.get("doi") or f"pmid:{paper['pmid']}": paper for paper in old.get("papers", [])}
    failed = []
    groups = {}
    for journal in journals:
        name = journal["name"]
        groups.setdefault(journal.get("group", "独立期刊"), []).append(name)
        sources = [
            ("Crossref 发表日", lambda: fetch_journal(journal, start, today, "pub-date")),
            ("Crossref 新收录", lambda: fetch_journal(journal, start - timedelta(days=1), today, "created-date")),
        ]
        if journal.get("pubmed"):
            sources.append(("PubMed", lambda: fetch_pubmed(journal, start, today)))
        for label, fetch in sources:
            try:
                records = fetch()
            except SOURCE_ERRORS as error:
                print(f"{name} / {label}: {error}", flush=True)
                failed.append(f"{name} · {label}")
                continue
            print(f"{name} / {label}: {len(records)} records", flush=True)
            for record in records:
                merge_paper(papers, record)
    if len(failed) == 2 * len(journals) + sum(bool(journal.get("pubmed")) for journal in journals):
        raise SystemExit("No journals refreshed. Preserving the previous snapshot.")
    first_day, last_day = start.isoformat(), today.isoformat()
    journal_names = [journal["name"] for journal in journals]
    allowed_journals = set(journal_names)
    current = [paper for paper in papers.values()
               if paper["journal"] in allowed_journals
               and any(first_day <= (paper.get(field) or "") <= last_day for field in ("date", "indexedDate"))]
    snapshot = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "journals": journal_names,
        "journalGroups": groups,
        "failedSources": failed,
        "papers": sorted(current, key=lambda paper: (paper.get("date") or "", paper.get("doi") or ""), reverse=True),
    }
    pending = OUTPUT.with_suffix(".tmp")
    pending.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    pending.replace(OUTPUT)


if __name__ == "__main__":
    main()
