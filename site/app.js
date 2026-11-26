import { setupCalendar } from "./calendar.js";
import { setupEasyScholar } from "./easyscholar.js";

const byId = (id) => document.getElementById(id);
const resultList = byId("results");
const status = byId("status");
const more = byId("more");
const details = byId("paper");
const journalGroup = byId("journal-group");
const dateMode = byId("date-mode");
const clearDate = byId("clear-date");
const compactLayout = matchMedia("(max-width: 48rem)");
const dateInBeijing = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
const pageSize = 30;
let limit = pageSize;
let snapshot;
let matches = [];
let selected = -1;
let journalGroups;
let exactDate = "";
let latestDates;
const easyScholar = setupEasyScholar();

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

const paperKey = (paper) => paper.doi || `pmid:${paper.pmid}`;
const activeDay = () => exactDate || latestDates[dateMode.value];

function selectPaper(index, focusDetails = false) {
  selected = index;
  resultList.querySelector('[aria-current="true"]')?.removeAttribute("aria-current");
  const paper = matches[index];
  byId("detail-empty").hidden = Boolean(paper);
  byId("detail-body").hidden = byId("paper-nav").hidden = !paper;
  details.classList.toggle("has-paper", Boolean(paper));
  easyScholar.showJournal(paper?.journal ?? "");
  if (!paper) return;
  resultList.querySelectorAll(".paper-row")[index]?.setAttribute("aria-current", "true");
  byId("previous").disabled = index === 0;
  byId("next").disabled = index === matches.length - 1;
  byId("paper-journal").textContent = paper.journal;
  byId("paper-type").textContent = paper.articleType || "期刊文章";
  byId("paper-date").textContent = paper.date || "未提供具体日期";
  byId("paper-indexed").textContent = paper.indexedDate
    ? `${paper.indexedDate} · ${paper.indexedSource}` : "未提供";
  byId("paper-title").textContent = paper.title;
  const author = byId("paper-authors");
  author.textContent = paper.authors[0] || "暂无作者信息";
  author.title = paper.authors[0] || "";
  byId("paper-doi").textContent = paper.doi || "未提供";
  byId("paper-link").href = paper.doi
    ? `https://doi.org/${paper.doi.split("/").map(encodeURIComponent).join("/")}`
    : `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(paper.pmid)}/`;
  byId("paper-link").textContent = paper.doi ? "查看原文" : "查看 PubMed";
  if (focusDetails && compactLayout.matches) {
    details.scrollIntoView({ block: "start" });
    byId("paper-title").focus({ preventScroll: true });
  }
}

function paperRow(paper) {
  const row = element("button", "", "paper-row");
  row.type = "button";
  row.dataset.paperKey = paperKey(paper);
  row.setAttribute("aria-controls", "paper");
  const title = element("span", paper.title, "row-title");
  title.lang = "en";
  const authors = paper.authors.slice(0, 2).join(" · ");
  const meta = element("span", "", "row-meta");
  meta.append(element("span", paper.articleType || "期刊文章", "article-type"),
    element("span", paper.journal, "journal"));
  if (authors) meta.append(element("span", authors + (paper.authors.length > 2 ? " 等" : "")));
  row.append(title, meta);
  return row;
}

function daysBefore(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function groupPapers(papers, key) {
  const groups = new Map();
  for (const paper of papers) {
    const label = paper[key];
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(paper);
  }
  return groups;
}

function dateSections(papers) {
  if (!papers.length) return [];
  const section = element("section", "", "day");
  section.append(element("h3", activeDay(), "day-date"), ...papers.map(paperRow));
  return [section];
}

function journalSections(journals, records, expanded) {
  return journals.map((journal) => {
    const papers = records.get(journal) ?? [];
    const section = element("details", "", "journal-section");
    section.dataset.journal = journal;
    section.open = expanded.has(journal);
    const summary = element("summary", "", "journal-summary");
    summary.append(element("span", journal), element("span", `${papers.length} 篇`, "journal-count"));
    section.append(summary);
    if (papers.length) section.append(...dateSections(papers));
    else section.append(element("p", "暂无符合条件的论文。", "detail-empty"));
    return section;
  });
}

function render(restoreFocus = false) {
  const words = byId("query").value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const group = journalGroups[journalGroup.value];
  const day = activeDay();
  const dateField = dateMode.value;
  const priorKey = matches[selected] && paperKey(matches[selected]);
  matches = snapshot.papers.filter((paper) => {
    if (paper[dateField] !== day || (group && !group.includes(paper.journal))) return false;
    const searchable = [paper.title, paper.journal, paper.doi, ...paper.authors].join(" ").toLowerCase();
    return words.every((word) => searchable.includes(word));
  });
  if (group) {
    const records = groupPapers(matches, "journal");
    matches = group.flatMap((journal) => records.get(journal) ?? []);
    const existing = [...resultList.querySelectorAll(".journal-section")];
    const sameGroup = existing.length === group.length &&
      existing.every((section, index) => section.dataset.journal === group[index]);
    const selectedJournal = matches.find((paper) => paperKey(paper) === priorKey)?.journal;
    const expanded = new Set(sameGroup
      ? existing.filter((section) => section.open).map((section) => section.dataset.journal)
      : [selectedJournal ?? matches[0]?.journal]);
    resultList.replaceChildren(...journalSections(group, records, expanded));
  } else {
    resultList.replaceChildren(...dateSections(matches.slice(0, limit)));
  }
  const shown = group ? matches.length : Math.min(limit, matches.length);
  status.textContent = "无匹配结果";
  if (shown) status.textContent = group ? `共 ${shown} 篇` : `${shown} / ${matches.length} 篇`;
  if (!matches.length) {
    resultList.append(element("p", "没有符合筛选条件的当日论文。", "detail-empty"));
  }
  more.hidden = Boolean(group) || matches.length <= limit;
  const retained = matches.slice(0, shown).findIndex((paper) => paperKey(paper) === priorKey);
  selectPaper(retained >= 0 ? retained : (compactLayout.matches || !matches.length ? -1 : 0));
  if (restoreFocus) resultList.querySelectorAll(".paper-row")[limit - pageSize]?.focus();
}

function stepPaper(offset) {
  const index = selected + offset;
  if (index < 0 || index >= matches.length) return;
  if (!journalGroup.value && index >= limit) {
    limit += pageSize;
    render();
  }
  selectPaper(index);
  const row = resultList.querySelectorAll(".paper-row")[index];
  const section = row?.closest(".journal-section");
  if (section) section.open = true;
  if (!compactLayout.matches) row?.scrollIntoView({ block: "nearest" });
}

resultList.addEventListener("click", (event) => {
  const row = event.target.closest(".paper-row");
  if (row) selectPaper(matches.findIndex((paper) => paperKey(paper) === row.dataset.paperKey), true);
});
byId("previous").addEventListener("click", () => stepPaper(-1));
byId("next").addEventListener("click", () => stepPaper(1));
byId("back-to-list").addEventListener("click", () => {
  const row = resultList.querySelectorAll(".paper-row")[selected];
  selectPaper(-1);
  const section = row?.closest(".journal-section");
  if (section) section.open = true;
  row?.focus();
});

try {
  const response = await fetch("./papers.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  snapshot = await response.json();
  for (const paper of snapshot.papers) paper.authors ??= [];
  const latestDate = dateInBeijing.format(new Date(snapshot.updatedAt));
  const earliestDate = daysBefore(latestDate, 29);
  latestDates = Object.fromEntries(["date", "indexedDate"].map((field) => {
    const days = snapshot.papers.map((paper) => paper[field])
      .filter((day) => day >= earliestDate && day <= latestDate);
    return [field, days.sort().at(-1) ?? latestDate];
  }));
  if (!snapshot.papers.some((paper) => paper.indexedDate)) dateMode.value = "date";
  journalGroups = snapshot.journalGroups ??
    Object.fromEntries(snapshot.journals.map((journal) => [journal, [journal]]));
  for (const group of Object.keys(journalGroups)) journalGroup.add(new Option(group, group));
  journalGroup.disabled = false;
  const timestamp = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(snapshot.updatedAt));
  byId("updated").textContent = `更新于 ${timestamp}（北京时间）`;
  if (snapshot.failedSources.length) {
    byId("updated").textContent += ` · 未更新：${snapshot.failedSources.join("、")}`;
  }
  byId("filters").addEventListener("submit", (event) => event.preventDefault());
  function refreshFilters() {
    clearDate.hidden = !exactDate;
    calendar.sync();
    limit = pageSize;
    render();
  }
  byId("filters").addEventListener("input", refreshFilters);
  const calendar = setupCalendar({
    min: earliestDate,
    max: latestDate,
    today: () => dateInBeijing.format(new Date()),
    defaultDate: activeDay,
    onChange(date) {
      exactDate = date;
      refreshFilters();
    },
  });
  clearDate.addEventListener("click", () => {
    calendar.clear();
    byId("open-calendar").focus();
  });
  more.addEventListener("click", () => {
    limit += pageSize;
    render(true);
  });
  refreshFilters();
} catch (error) {
  status.textContent = "文献加载失败，请刷新后重试。";
  byId("updated").textContent = "更新状态暂不可用";
  console.error(error);
}
