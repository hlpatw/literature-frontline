const state = {
  journals: [],
  papers: [],
  selectedId: null,
  filters: {
    search: "",
    journal: "all",
    year: "all",
    month: "all"
  }
};

const FALLBACK_JOURNALS = [
  { id: "child-development", name: "Child Development", publisher: "SRCD / Wiley", field: "developmental-psychology", priority: "flagship" },
  { id: "developmental-science", name: "Developmental Science", publisher: "Wiley", field: "developmental-cognitive-science", priority: "flagship" },
  { id: "developmental-psychology", name: "Developmental Psychology", publisher: "APA", field: "developmental-psychology", priority: "flagship" },
  { id: "jecp", name: "Journal of Experimental Child Psychology", publisher: "Elsevier", field: "experimental-child-psychology", priority: "core" },
  { id: "infancy", name: "Infancy", publisher: "ICIS / Wiley", field: "infant-development", priority: "core" },
  { id: "journal-of-child-language", name: "Journal of Child Language", publisher: "Cambridge University Press", field: "language-development", priority: "flagship" },
  { id: "language-learning-development", name: "Language Learning and Development", publisher: "Taylor & Francis", field: "language-development", priority: "core" },
  { id: "journal-of-memory-and-language", name: "Journal of Memory and Language", publisher: "Elsevier", field: "psycholinguistics", priority: "flagship" },
  { id: "applied-psycholinguistics", name: "Applied Psycholinguistics", publisher: "Cambridge University Press", field: "applied-psycholinguistics", priority: "core" },
  { id: "first-language", name: "First Language", publisher: "SAGE", field: "language-development", priority: "core" }
];

const FALLBACK_PAPERS = [
  {
    id: "demo-2026-06-18-jcl",
    journalId: "journal-of-child-language",
    journal: "Journal of Child Language",
    title: "Demonstration record: pragmatic cue use in early word learning",
    authors: ["Example Author", "Demo Researcher"],
    doi: "10.0000/demo.jcl.2026.001",
    url: "https://doi.org/10.0000/demo.jcl.2026.001",
    publishedDate: "2026-06-18",
    topics: ["儿童语言发展", "词汇学习", "语用线索"],
    ageGroup: "3-5岁儿童",
    paradigm: "新词学习任务；指称选择；眼动或反应选择",
    methods: "混合效应逻辑回归；被试与项目随机效应；模型比较",
    researchQuestionZh: "儿童是否会利用说话者意图和语境线索来限制新词指称范围？",
    researchQuestionEn: "Do children use speaker intention and contextual cues to constrain novel word meanings?",
    abstractZh: "这是一条演示记录，用于展示 dashboard 的字段结构。真实工作流会从期刊元数据和摘要中提取问题、样本、任务、方法和发现。",
    abstractEn: "This demonstration record shows the dashboard schema. In the live workflow, metadata and abstracts are converted into structured bilingual summaries.",
    keyFindingsZh: "演示结果：语境与说话者线索可被整理为可检索标签，并进入月度报告。",
    keyFindingsEn: "Demo finding: contextual and speaker cues can be converted into searchable tags and monthly reports.",
    status: "demo",
    source: "manual"
  }
];

const els = {
  searchInput: document.querySelector("#searchInput"),
  journalFilter: document.querySelector("#journalFilter"),
  yearFilter: document.querySelector("#yearFilter"),
  monthFilter: document.querySelector("#monthFilter"),
  stats: document.querySelector("#stats"),
  timeline: document.querySelector("#timeline"),
  paperList: document.querySelector("#paperList"),
  paperDetail: document.querySelector("#paperDetail"),
  resultCount: document.querySelector("#resultCount"),
  updateButton: document.querySelector("#updateButton"),
  updateStatus: document.querySelector("#updateStatus"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportMarkdownButton: document.querySelector("#exportMarkdownButton")
};

async function init() {
  const [journals, papers] = await Promise.all([
    fetchJson("data/journals.json").catch(() => FALLBACK_JOURNALS),
    fetchJson("data/papers.json").catch(() => FALLBACK_PAPERS)
  ]);

  state.journals = journals;
  state.papers = normalizePapers(papers);
  state.selectedId = state.papers[0]?.id ?? null;

  bindEvents();
  renderFilters();
  render();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Cannot load ${path}`);
  }
  return response.json();
}

function normalizePapers(papers) {
  return papers
    .map((paper) => ({
      ...paper,
      date: new Date(`${paper.publishedDate}T00:00:00`)
    }))
    .sort((a, b) => b.date - a.date);
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });

  [els.journalFilter, els.yearFilter, els.monthFilter].forEach((select) => {
    select.addEventListener("change", (event) => {
      state.filters[event.target.dataset.filter] = event.target.value;
      render();
    });
  });

  els.updateButton.addEventListener("click", runManualUpdate);
  els.exportJsonButton.addEventListener("click", exportJson);
  els.exportMarkdownButton.addEventListener("click", exportMarkdown);

  // 删除按钮事件委托
  document.body.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      const paperId = deleteButton.dataset.delete;
      deletePaper(paperId);
    }
  });
}

function renderFilters() {
  els.journalFilter.dataset.filter = "journal";
  els.yearFilter.dataset.filter = "year";
  els.monthFilter.dataset.filter = "month";

  els.journalFilter.innerHTML = [
    option("all", "全部期刊"),
    ...state.journals.map((journal) => option(journal.id, journal.name))
  ].join("");

  const years = unique(state.papers.map((paper) => String(paper.date.getFullYear())));
  els.yearFilter.innerHTML = [option("all", "全部年份"), ...years.map((year) => option(year, year))].join("");

  els.monthFilter.innerHTML = [
    option("all", "全部月份"),
    ...Array.from({ length: 12 }, (_, index) => {
      const value = String(index + 1).padStart(2, "0");
      return option(value, `${value}月`);
    })
  ].join("");
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function render() {
  const papers = getFilteredPapers();
  if (!papers.some((paper) => paper.id === state.selectedId)) {
    state.selectedId = papers[0]?.id ?? null;
  }

  renderStats(papers);
  renderTimeline(papers);
  renderPaperList(papers);
  renderDetail(papers.find((paper) => paper.id === state.selectedId));
}

function getFilteredPapers() {
  return state.papers.filter((paper) => {
    const text = [
      paper.title,
      paper.journal,
      paper.authors?.join(" "),
      paper.researchQuestionZh,
      paper.researchQuestionEn,
      paper.abstractZh,
      paper.abstractEn,
      paper.keyFindingsZh,
      paper.keyFindingsEn,
      paper.topics?.join(" "),
      paper.methods,
      paper.paradigm,
      paper.ageGroup
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const year = String(paper.date.getFullYear());
    const month = String(paper.date.getMonth() + 1).padStart(2, "0");

    return (
      (!state.filters.search || text.includes(state.filters.search)) &&
      (state.filters.journal === "all" || paper.journalId === state.filters.journal) &&
      (state.filters.year === "all" || year === state.filters.year) &&
      (state.filters.month === "all" || month === state.filters.month)
    );
  });
}

function renderStats(papers) {
  const journalCount = unique(papers.map((paper) => paper.journalId)).length;
  const topicCount = unique(papers.flatMap((paper) => paper.topics ?? [])).length;
  const latest = papers[0]?.publishedDate ?? "-";

  els.stats.innerHTML = [
    stat(papers.length, "当前文献"),
    stat(journalCount, "覆盖期刊"),
    stat(topicCount, "主题标签"),
    stat(latest, "最近更新")
  ].join("");
}

function stat(value, label) {
  return `<div class="stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderTimeline(papers) {
  const groups = new Map();
  papers.forEach((paper) => {
    const day = paper.publishedDate;
    const month = day.slice(0, 7);
    const year = day.slice(0, 4);
    const key = `${year}|${month}|${day}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  });

  if (!groups.size) {
    els.timeline.innerHTML = `<div class="empty">没有匹配的日期记录。</div>`;
    return;
  }

  els.timeline.innerHTML = Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, count]) => {
      const [year, month, day] = key.split("|");
      return `
        <div class="time-node">
          <strong>${escapeHtml(day)}</strong>
          <span>${escapeHtml(year)} / ${escapeHtml(month.slice(5))}月</span>
          <span>${count} 篇</span>
        </div>
      `;
    })
    .join("");
}

function renderPaperList(papers) {
  els.resultCount.textContent = `${papers.length} 篇匹配文献`;

  if (!papers.length) {
    els.paperList.innerHTML = `<div class="empty">没有匹配的文献。可以调整筛选条件或导入新数据。</div>`;
    return;
  }

  els.paperList.innerHTML = papers
    .map((paper) => {
      const active = paper.id === state.selectedId ? " active" : "";
      return `
        <div class="paper-card${active}" data-id="${escapeHtml(paper.id)}">
          <button type="button" class="delete-icon" data-delete="${escapeHtml(paper.id)}" title="删除这篇文献">×</button>
          <div class="paper-card-content" data-id="${escapeHtml(paper.id)}">
            <h4>${escapeHtml(paper.title)}</h4>
            <p class="meta">${escapeHtml(paper.journal)} · ${escapeHtml(paper.publishedDate)} · ${escapeHtml(formatAuthors(paper.authors))}</p>
            <div class="tags">${renderTags(paper.topics)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".paper-card-content").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      render();
    });
  });
}

function renderDetail(paper) {
  if (!paper) {
    els.paperDetail.innerHTML = `<div class="empty">请选择一篇文献查看结构化摘要。</div>`;
    return;
  }

  els.paperDetail.innerHTML = `
    <h3>${escapeHtml(paper.title)}</h3>
    <p class="meta">${escapeHtml(paper.journal)} · ${escapeHtml(paper.publishedDate)} · DOI: ${escapeHtml(paper.doi ?? "-")}</p>
    <div class="tags">${renderTags(paper.topics)}</div>
    <div class="detail-actions">
      <button type="button" data-copy="citation">复制引用信息</button>
      <button type="button" data-copy="summary">复制双语摘要</button>
      ${paper.url ? `<a href="${escapeAttribute(paper.url)}" target="_blank" rel="noreferrer"><button type="button">打开 DOI</button></a>` : ""}
      <button type="button" data-delete="${escapeHtml(paper.id)}" class="delete-btn">删除这篇文献</button>
    </div>

    <div class="detail-section">
      ${kv("作者", formatAuthors(paper.authors))}
      ${kv("研究问题", `${paper.researchQuestionZh}<br>${paper.researchQuestionEn}`)}
      ${kv("被试年龄/群体", paper.ageGroup)}
      ${kv("实验任务/范式", paper.paradigm)}
      ${kv("方法与统计模型", paper.methods)}
    </div>

    <div class="detail-section">
      <h4>中文精简摘要</h4>
      <p>${escapeHtml(paper.abstractZh)}</p>
      <h4>English Brief Abstract</h4>
      <p>${escapeHtml(paper.abstractEn)}</p>
    </div>

    <div class="detail-section">
      <h4>核心发现</h4>
      <p>${escapeHtml(paper.keyFindingsZh)}</p>
      <p>${escapeHtml(paper.keyFindingsEn)}</p>
    </div>
  `;

  els.paperDetail.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyPaperText(paper, button.dataset.copy));
  });
}

function kv(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><span>${value ?? "-"}</span></div>`;
}

function renderTags(tags = []) {
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function formatAuthors(authors = []) {
  if (!authors.length) return "-";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

async function runManualUpdate() {
  if (window.location.protocol === "file:") {
    els.updateStatus.textContent = "你当前打开的是本地 file:// 页面。请用 Vercel/Netlify 部署后的 https:// 网址打开，再点击手动更新。";
    return;
  }

  els.updateStatus.textContent = "正在请求更新接口...";
  const endpoints = ["/api/update", "/.netlify/functions/update"];
  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload.papers) && payload.papers.length) {
          mergePapers(payload.papers);
          renderFilters();
          render();
        }
        els.updateStatus.textContent = payload.message ?? `更新请求完成，返回 ${payload.papers?.length ?? 0} 条候选记录。`;
        return;
      }
      const errorText = await response.text();
      failures.push(`${endpoint}: HTTP ${response.status} ${errorText.slice(0, 120)}`);
    } catch (error) {
      failures.push(`${endpoint}: ${error.message}`);
    }
  }

  els.updateStatus.textContent = `更新接口不可用。当前地址：${window.location.href}。失败详情：${failures.join(" | ")}`;
}

function mergePapers(incoming) {
  const existingKeys = new Set(state.papers.map((paper) => paper.doi || paper.id));
  const fresh = incoming.filter((paper) => !existingKeys.has(paper.doi || paper.id));
  state.papers = normalizePapers([...state.papers, ...fresh]);
}

function exportJson() {
  downloadFile("literature-radar-export.json", JSON.stringify(state.papers, null, 2), "application/json");
}

function exportMarkdown() {
  const papers = getFilteredPapers();
  const lines = [
    "# Literature Radar Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    ...papers.flatMap((paper) => [
      `## ${paper.title}`,
      "",
      `- Journal: ${paper.journal}`,
      `- Date: ${paper.publishedDate}`,
      `- Authors: ${formatAuthors(paper.authors)}`,
      `- DOI: ${paper.doi ?? "-"}`,
      `- Topics: ${(paper.topics ?? []).join(", ")}`,
      "",
      `**研究问题**：${paper.researchQuestionZh}`,
      "",
      `**Research Question**: ${paper.researchQuestionEn}`,
      "",
      `**中文摘要**：${paper.abstractZh}`,
      "",
      `**English Abstract**: ${paper.abstractEn}`,
      "",
      `**核心发现**：${paper.keyFindingsZh}`,
      "",
      `**Key Findings**: ${paper.keyFindingsEn}`,
      ""
    ])
  ];

  downloadFile("literature-radar-report.md", lines.join("\n"), "text/markdown");
}

function copyPaperText(paper, mode) {
  const text =
    mode === "citation"
      ? `${formatAuthors(paper.authors)} (${paper.publishedDate.slice(0, 4)}). ${paper.title}. ${paper.journal}. ${paper.doi ?? ""}`
      : `${paper.title}\n\n中文摘要：${paper.abstractZh}\n\nEnglish abstract: ${paper.abstractEn}`;

  navigator.clipboard.writeText(text);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort().reverse();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function deletePaper(paperId) {
  const paper = state.papers.find((p) => p.id === paperId);
  if (!paper) return;

  // 确认删除
  const confirmed = confirm(`确定要删除这篇文献吗？\n\n${paper.title}`);
  if (!confirmed) return;

  // 从本地状态中删除
  state.papers = state.papers.filter((p) => p.id !== paperId);

  // 如果删除的是当前选中的文献，选中第一个
  if (state.selectedId === paperId) {
    state.selectedId = state.papers[0]?.id ?? null;
  }

  // 尝试同步到服务器
  try {
    const endpoints = ["/api/delete", "/.netlify/functions/delete"];
    let synced = false;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: paperId, doi: paper.doi })
        });
        if (response.ok) {
          synced = true;
          break;
        }
      } catch (e) {
        // 继续尝试下一个 endpoint
      }
    }

    if (synced) {
      els.updateStatus.textContent = `已删除文献，并已同步到服务器。`;
    } else {
      els.updateStatus.textContent = `已删除文献（本地）。服务器删除未配置，刷新后会恢复。`;
    }
  } catch (error) {
    els.updateStatus.textContent = `已删除文献（本地）。服务器删除失败：${error.message}`;
  }

  // 重新渲染
  renderFilters();
  render();
}

init().catch((error) => {
  document.body.innerHTML = `<main class="main"><div class="empty">加载失败：${escapeHtml(error.message)}</div></main>`;
});
