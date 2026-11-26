const endpoint = "https://www.easyscholar.cc/open/getPublicationRank";
const fields = [
  ["sci", "JCR 分区"],
  ["sciUp", "中科院升级版大类"],
  ["sciUpSmall", "中科院升级版小类"],
  ["sciif", "影响因子"],
  ["sciif5", "5 年影响因子"],
  ["jci", "JCI"],
  ["sciUpTop", "中科院 Top"],
];

function badgeLevel(field, value) {
  if (field === "sci") return Number(value.match(/\bQ\s*([1-4])\b/i)?.[1]) || 5;
  if (field === "sciUpTop") return 1;
  if (field === "sciUp" || field === "sciUpSmall") {
    const zone = value.match(/([1-4一二三四])\s*区|^([1-4一二三四])$/);
    const level = zone?.[1] ?? zone?.[2];
    return Number(level) || ({ 一: 1, 二: 2, 三: 3, 四: 4 })[level] || 5;
  }
  const score = Number.parseFloat(value);
  const thresholds = field === "jci" ? [3, 1, 0.5, 0] : [10, 4, 2, 1];
  const level = thresholds.findIndex((cutoff) => score >= cutoff);
  return level < 0 ? 5 : level + 1;
}

export function rankBadges(data) {
  const official = data?.officialRank;
  const values = { ...official?.all, ...official?.select };
  return fields.flatMap(([key, label]) => {
    const raw = values[key];
    const items = Array.isArray(raw) ? raw : [raw];
    return items
      .filter((item) => typeof item === "string" || typeof item === "number")
      .map((item) => String(item).trim())
      .filter((value) => value && !/^(?:NOT AVAILABLE|N\/A)$/i.test(value))
      .map((value) => ({ text: `${label} ${value}`, level: badgeLevel(key, value) }));
  });
}

export function setupEasyScholar() {
  const byId = (id) => document.getElementById(id);
  const settings = byId("easy-scholar-settings");
  const form = byId("easy-scholar-form");
  const input = byId("easy-scholar-key");
  const disconnect = byId("easy-scholar-disconnect");
  const tags = byId("journal-metric-tags");
  const status = byId("journal-metric-status");
  const initialMessage = "连接 easyScholar 后自动查询当前期刊。";
  let connection;
  let journal;
  let timer;
  let activeRequest;
  let lastStarted = 0;

  function display(message, labels = []) {
    const items = labels.map(({ text, level }) => {
      const tag = document.createElement("li");
      tag.textContent = text;
      tag.dataset.level = level;
      return tag;
    });
    tags.replaceChildren(...items);
    tags.hidden = !items.length;
    status.textContent = message;
  }

  function reset(message) {
    clearTimeout(timer);
    activeRequest?.abort();
    connection = undefined;
    disconnect.hidden = true;
    settings.hidden = false;
    display(message);
  }

  function refresh() {
    clearTimeout(timer);
    if (!connection || !journal) return;
    const cached = connection.cache.get(journal);
    if (cached) {
      display(cached.length ? "来源：easyScholar" : "easyScholar 暂无该刊的分区或影响因子。", cached);
      return;
    }
    display("正在查询 easyScholar…");
    if (!activeRequest) timer = setTimeout(load, Math.max(220, 550 - (Date.now() - lastStarted)));
  }

  async function load() {
    if (!connection || !journal) return;
    const current = connection;
    const name = journal;
    const request = new AbortController();
    activeRequest = request;
    lastStarted = Date.now();
    const timeout = setTimeout(() => request.abort(), 12000);
    try {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ publicationName: name, secretKey: current.key });
      const response = await fetch(url, {
        signal: request.signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
      });
      if (!response.ok) throw new Error("easyScholar request failed");
      const result = await response.json();
      if (connection !== current) return;
      if (Number(result.code) === 40002) {
        reset("easyScholar 密钥无效，请重新连接。");
        settings.open = true;
        input.focus();
        return;
      }
      if (Number(result.code) !== 200) {
        if (journal === name) display("easyScholar 未完成查询，请检查账户额度或稍后重试。");
        return;
      }
      const labels = rankBadges(result.data);
      current.cache.set(name, labels);
      if (journal === name) display(labels.length ? "来源：easyScholar" : "easyScholar 暂无该刊的分区或影响因子。", labels);
    } catch {
      if (connection === current && journal === name) {
        display("暂时无法连接 easyScholar，请稍后切换论文重试。");
      }
    } finally {
      clearTimeout(timeout);
      activeRequest = undefined;
      if (connection && (connection !== current || journal !== name)) refresh();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) {
      input.focus();
      return;
    }
    connection = { key, cache: new Map() };
    form.reset();
    settings.open = false;
    settings.hidden = true;
    disconnect.hidden = false;
    disconnect.focus({ preventScroll: true });
    refresh();
  });
  disconnect.addEventListener("click", () => {
    reset(initialMessage);
    settings.querySelector("summary").focus({ preventScroll: true });
  });

  return {
    showJournal(name) {
      if (name === journal) return;
      journal = name;
      refresh();
    },
  };
}
