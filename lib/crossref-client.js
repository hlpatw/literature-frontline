// Crossref API Client - 统一的文献获取模块
// 用于 api/update.js 和 netlify/functions/update.js

/**
 * 从文件加载非研究文章排除规则
 * 如果文件不存在，返回默认规则
 */
let exclusionRules = null;

function loadExclusionRules() {
  if (exclusionRules) return exclusionRules;

  // 默认排除规则（如果配置文件不存在）
  const defaultRules = {
    titlePatterns: [
      "issue information", "table of contents", "editorial board",
      "announcement", "call for papers", "book review", "corrigendum",
      "erratum", "retraction", "editorial", "preface", "foreword"
    ],
    subtypes: [
      "editorial", "letter", "news", "book-review", "issue-information",
      "front-matter", "correction", "retraction", "commentary", "obituary"
    ]
  };

  try {
    // 在Node.js环境中尝试读取配置文件
    if (typeof require !== "undefined") {
      const fs = require("fs");
      const path = require("path");
      const configPath = path.join(__dirname, "..", "data", "non-research-exclusions.json");
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf8");
        exclusionRules = { ...defaultRules, ...JSON.parse(content) };
        return exclusionRules;
      }
    }
  } catch (error) {
    console.warn("[Crossref] Failed to load exclusion rules, using defaults:", error.message);
  }

  exclusionRules = defaultRules;
  return exclusionRules;
}

/**
 * 检查是否为有效的研究文章
 * @param {Object} item - Crossref API返回的单条记录
 * @param {Object} journalConfig - 期刊配置
 * @returns {boolean} - 是否应该包含此文章
 */
export function isValidResearchArticle(item, journalConfig) {
  const rules = loadExclusionRules();

  // 1. 检查subtype字段（Crossref的类型分类）
  const subtype = item.subtype;
  if (subtype && rules.subtypes.includes(subtype.toLowerCase())) {
    return false;
  }

  // 2. 检查标题模式
  const title = (item.title?.[0] ?? "").toLowerCase().trim();
  for (const pattern of rules.titlePatterns) {
    if (title.startsWith(pattern.toLowerCase()) || title.includes(pattern.toLowerCase())) {
      return false;
    }
  }

  // 3. 检查是否有摘要（可选，由环境变量控制）
  if (process.env.CROSSREF_HAS_ABSTRACT === "true") {
    const abstract = (item.abstract ?? "").trim();
    if (!abstract || abstract.toLowerCase() === "abstract not available") {
      return false;
    }
  }

  return true;
}

/**
 * 解析发布日期
 * 优先级: published > published-print > published-online > deposited
 * @param {Object} item - Crossref API返回的单条记录
 * @returns {Object} - { full: "YYYY-MM-DD", year: YYYY, isEstimated: boolean }
 */
export function parsePublishedDate(item) {
  const dateSources = [
    item.published,
    item["published-print"],
    item["published-online"],
    item.deposited
  ];

  for (const source of dateSources) {
    const dateParts = source?.["date-parts"]?.[0];
    if (dateParts && Array.isArray(dateParts) && dateParts.length > 0) {
      const year = Number(dateParts[0]);
      // 验证年份合理性
      if (year >= 1900 && year <= 2100) {
        const month = Number(dateParts[1] ?? 1);
        const day = Number(dateParts[2] ?? 1);
        return {
          full: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          year,
          isEstimated: !dateParts[2]
        };
      }
    }
  }

  // 最后兜底：使用当前日期
  const now = new Date();
  return {
    full: now.toISOString().slice(0, 10),
    year: now.getFullYear(),
    isEstimated: true
  };
}

/**
 * 清除HTML标签和多余空格
 */
export function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 构建作者列表
 */
export function buildAuthors(item) {
  return (item.author ?? [])
    .map((author) => [author.given, author.family].filter(Boolean).join(" "))
    .filter(Boolean);
}

/**
 * 推断主题标签（简单版本，后续可由LLM增强）
 */
export function inferTopics(title, abstract) {
  const text = `${title} ${abstract}`.toLowerCase();
  const topics = [];

  // 语言发展相关
  if (/language|word|vocabulary|syntax|semantic|pragmatic|speech|phonology/.test(text)) {
    topics.push("儿童语言发展");
  }
  if (/vocabulary|word learning|lexical/.test(text)) {
    topics.push("词汇学习");
  }
  if (/semantic|pragmatic|meaning/.test(text)) {
    topics.push("语义语用学习");
  }

  // 认知发展相关
  if (/cognitive|memory|attention|executive|inhibitory|control/.test(text)) {
    topics.push("儿童认知发展");
  }
  if (/executive function|working memory|inhibitory control/.test(text)) {
    topics.push("执行功能");
  }

  // 婴儿研究
  if (/infant|baby|babie|newborn|neonatal/.test(text)) {
    topics.push("婴儿发展");
  }

  // 社会性发展
  if (/social|emotion|attachment|temperament|.test(text)) {
    topics.push("社会性发展");
  }

  // 特定任务/范式
  if (/eye-tracking|eye movement|gaze|looking time/.test(text)) {
    topics.push("眼动追踪");
  }
  if (/preferential looking|habituation/.test(text)) {
    topics.push("偏好注视");
  }

  return topics.length ? topics : ["待分类"];
}

/**
 * 将Crossref记录转换为论文对象
 */
export function toPaper(item, journalConfig) {
  const doi = item.DOI ?? "";
  const dateInfo = parsePublishedDate(item);
  const title = stripTags(item.title?.[0] ?? "Untitled");
  const abstract = stripTags(item.abstract ?? "Abstract not available.");
  const authors = buildAuthors(item);

  return {
    id: doi ? `doi-${doi.toLowerCase().replaceAll("/", "-")}` : `crossref-${item.URL}`,
    journalId: journalConfig.id,
    journal: journalConfig.name,
    title,
    authors,
    doi,
    url: item.URL ?? (doi ? `https://doi.org/${doi}` : ""),
    publishedDate: dateInfo.full,
    publishedYear: dateInfo.year,
    dateEstimated: dateInfo.isEstimated,
    topics: inferTopics(title, abstract),
    abstractEn: abstract,
    ageGroup: "待模型提取 / Pending model extraction",
    paradigm: "待模型提取 / Pending model extraction",
    methods: "待模型提取 / Pending model extraction",
    researchQuestionZh: "待模型根据摘要提取。",
    researchQuestionEn: "Pending extraction from the abstract.",
    abstractZh: "待接入国内模型生成中文精简摘要。",
    keyFindingsZh: "待模型提取核心发现。",
    keyFindingsEn: "Pending key-finding extraction.",
    status: "candidate",
    source: "crossref"
  };
}

/**
 * Crossref API 客户端类
 */
export class CrossrefClient {
  constructor(config = {}) {
    this.useIssn = config.useIssn ?? (process.env.CROSSREF_USE_ISSN !== "false");
    this.hasAbstract = config.hasAbstract ?? (process.env.CROSSREF_HAS_ABSTRACT !== "false");
    this.rows = config.rows ?? Number(process.env.CROSSREF_ROWS_PER_JOURNAL || 50);
    this.daysLookback = config.daysLookback ?? Number(process.env.CROSSREF_DAYS_LOOKBACK || 90);
    this.mailto = config.mailto || "literature-radar@example.com";
  }

  /**
   * 获取计算的开始日期
   */
  getFromDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.daysLookback);
    return date.toISOString().slice(0, 10);
  }

  /**
   * 构建Crossref API URL
   */
  buildUrl(journalConfig, fromDate) {
    const url = new URL("https://api.crossref.org/works");

    // 优先使用ISSN精确匹配
    if (this.useIssn && journalConfig.issn && journalConfig.issn.length > 0) {
      // Crossref支持多个ISSN的OR逻辑
      journalConfig.issn.forEach(issn => url.searchParams.append("issn", issn));
    } else {
      // 降级到标题匹配
      url.searchParams.set("query.container-title", journalConfig.name);
    }

    // 构建过滤器
    const filters = [`from-pub-date:${fromDate}`, "type:journal-article"];
    if (this.hasAbstract) {
      filters.push("has-abstract:true");
    }
    url.searchParams.set("filter", filters.join(","));

    url.searchParams.set("sort", "published");
    url.searchParams.set("order", "desc");
    url.searchParams.set("rows", String(this.rows));
    url.searchParams.set("select", "DOI,URL,title,container-title,author,published,published-print,published-online,abstract,type,subtype");
    url.searchParams.set("mailto", this.mailto);

    return url;
  }

  /**
   * 获取单个期刊的文献
   */
  async fetchJournal(journalConfig, fromDate) {
    const url = this.buildUrl(journalConfig, fromDate);

    try {
      const result = await fetch(url);
      if (!result.ok) {
        console.error(`[Crossref] ${journalConfig.name}: HTTP ${result.status}`);
        return [];
      }

      const payload = await result.json();
      const items = payload.message?.items ?? [];

      console.log(`[Crossref] ${journalConfig.name}: API returned ${items.length} papers (before filtering)`);

      // 过滤非研究文章并转换格式
      const validPapers = items
        .filter(item => isValidResearchArticle(item, journalConfig))
        .map(item => toPaper(item, journalConfig));

      console.log(`[Crossref] ${journalConfig.name}: ${validPapers.length} papers after filtering`);

      return validPapers;
    } catch (error) {
      console.error(`[Crossref] ${journalConfig.name}: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取所有期刊的文献
   */
  async fetchPapers(journalsConfig) {
    const fromDate = this.getFromDate();
    console.log(`[Crossref] Fetching papers from ${fromDate} (${this.daysLookback} days lookback)`);

    const batches = await Promise.all(
      journalsConfig.map(config => this.fetchJournal(config, fromDate))
    );

    // 去重
    const seen = new Set();
    const deduped = batches
      .flat()
      .filter(paper => {
        const key = paper.doi || paper.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));

    console.log(`[Crossref] Total unique papers: ${deduped.length}`);

    return deduped;
  }
}

/**
 * 期刊匹配函数（兼容旧版本逻辑）
 * @deprecated 推荐使用ISSN精确匹配，此函数仅作为降级方案
 */
export function matchesJournal(item, journal) {
  const containerTitles = item["container-title"] ?? [];
  const journalLower = journal.toLowerCase();

  // 精确匹配
  if (containerTitles.some((title) => title.toLowerCase() === journalLower)) {
    return true;
  }

  // 模糊匹配：处理期刊名称可能有细微差异的情况
  const journalWords = journalLower.split(/\s+/);
  return containerTitles.some((title) => {
    const titleLower = title.toLowerCase();
    const matchCount = journalWords.filter((word) =>
      word.length > 3 && titleLower.includes(word)
    ).length;
    return matchCount >= 2 || journalWords.some((w) =>
      w.length > 8 && titleLower.includes(w)
    );
  });
}
