const JOURNALS = [
  ["child-development", "Child Development"],
  ["developmental-science", "Developmental Science"],
  ["developmental-psychology", "Developmental Psychology"],
  ["jecp", "Journal of Experimental Child Psychology"],
  ["infancy", "Infancy"],
  ["journal-of-child-language", "Journal of Child Language"],
  ["language-learning-development", "Language Learning and Development"],
  ["journal-of-memory-and-language", "Journal of Memory and Language"],
  ["applied-psycholinguistics", "Applied Psycholinguistics"],
  ["first-language", "First Language"]
];

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Use POST to trigger a manual update." });
    return;
  }

  try {
    const from = new Date();
    from.setDate(from.getDate() - 180); // 增加到 180 天
    const candidates = await fetchCrossrefCandidates(from.toISOString().slice(0, 10));

    // 添加调试信息
    console.log(`[Update] Found ${candidates.length} candidates from Crossref`);

    const summarized = await summarizePapers(candidates);
    const saveResult = await saveToGitHub(summarized);

    response.status(200).json({
      message: saveResult.saved
        ? `更新完成：新增/合并 ${summarized.length} 条候选记录（来自近 180 天），并已写回 GitHub。`
        : `更新完成：返回 ${summarized.length} 条候选记录。${saveResult.reason}`,
      papers: summarized,
      saved: saveResult.saved,
      saveResult,
      debug: {
        candidatesFound: candidates.length,
        timeRange: "180 days"
      }
    });
  } catch (error) {
    response.status(500).json({
      message: "更新函数运行失败。",
      error: error.message,
      hint: "请检查 Vercel 环境变量 MODEL_API_KEY、MODEL_BASE_URL、MODEL_NAME、GITHUB_TOKEN、GITHUB_REPO、GITHUB_BRANCH，以及 GitHub token 的 Contents: Read and write 权限。"
    });
  }
}

async function fetchCrossrefCandidates(fromDate) {
  const batches = await Promise.all(
    JOURNALS.map(async ([journalId, journal]) => {
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("query.container-title", journal);
      url.searchParams.set("filter", `from-pub-date:${fromDate},type:journal-article`);
      url.searchParams.set("sort", "published");
      url.searchParams.set("order", "desc");
      url.searchParams.set("rows", "100"); // 增加到 100 篇
      url.searchParams.set("mailto", "private-literature-radar@example.com");

      const result = await fetch(url);
      if (!result.ok) {
        console.error(`[Crossref] Failed to fetch ${journal}: HTTP ${result.status}`);
        return [];
      }
      const payload = await result.json();
      const items = payload.message?.items ?? [];
      console.log(`[Crossref] ${journal}: API returned ${items.length} papers`);

      const matched = items.filter((item) => matchesJournal(item, journal));
      console.log(`[Crossref] ${journal}: ${matched.length} papers matched after filtering`);

      return matched.map((item) => toPaper(item, journalId, journal));
    })
  );

  const seen = new Set();
  const deduped = batches
    .flat()
    .filter((paper) => {
      const key = paper.doi || paper.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));

  console.log(`[Crossref] Total unique papers: ${deduped.length}`);
  return deduped;
}

function matchesJournal(item, journal) {
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
    // 检查是否包含主要关键词
    const matchCount = journalWords.filter((word) => word.length > 3 && titleLower.includes(word)).length;
    return matchCount >= 2 || journalWords.some((w) => w.length > 8 && titleLower.includes(w));
  });
}

function toPaper(item, journalId, journal) {
  const doi = item.DOI ?? "";
  const dateParts = item.published?.["date-parts"]?.[0] ?? item["published-print"]?.["date-parts"]?.[0] ?? item["published-online"]?.["date-parts"]?.[0] ?? [];
  const publishedDate = [
    String(dateParts[0] ?? "1900").padStart(4, "0"),
    String(dateParts[1] ?? "01").padStart(2, "0"),
    String(dateParts[2] ?? "01").padStart(2, "0")
  ].join("-");

  return {
    id: doi ? `doi-${doi.toLowerCase().replaceAll("/", "-")}` : `crossref-${item.URL}`,
    journalId,
    journal,
    title: stripTags(item.title?.[0] ?? "Untitled"),
    authors: (item.author ?? []).map((author) => [author.given, author.family].filter(Boolean).join(" ")).filter(Boolean),
    doi,
    url: item.URL ?? (doi ? `https://doi.org/${doi}` : ""),
    publishedDate,
    topics: inferTopics(`${item.title?.[0] ?? ""} ${item.abstract ?? ""}`),
    ageGroup: "待模型提取 / Pending model extraction",
    paradigm: "待模型提取 / Pending model extraction",
    methods: "待模型提取 / Pending model extraction",
    researchQuestionZh: "待模型根据摘要提取。",
    researchQuestionEn: "Pending extraction from the abstract.",
    abstractZh: "待接入国内模型生成中文精简摘要。",
    abstractEn: stripTags(item.abstract ?? "Abstract not available from Crossref."),
    keyFindingsZh: "待模型提取核心发现。",
    keyFindingsEn: "Pending key-finding extraction.",
    status: "candidate",
    source: "crossref"
  };
}

async function summarizePapers(papers) {
  if (!process.env.MODEL_API_KEY || !process.env.MODEL_BASE_URL) {
    return papers.map((paper) => ({
      ...paper,
      status: "candidate",
      modelNote: "MODEL_API_KEY or MODEL_BASE_URL is not configured."
    }));
  }

  const limit = Number(process.env.UPDATE_SUMMARY_LIMIT ?? 20);
  const selected = papers.slice(0, limit);
  const rest = papers.slice(limit);
  const summarized = [];

  for (const paper of selected) {
    summarized.push(await summarizePaper(paper));
  }

  return [...summarized, ...rest];
}

async function summarizePaper(paper) {
  const prompt = `
你是心理语言学和儿童认知发展方向的博士研究助理。请基于下面的期刊论文元数据和摘要，输出严格 JSON，不要 Markdown，不要解释。

字段：
{
  "researchQuestionZh": "中文研究问题，1句",
  "researchQuestionEn": "English research question, 1 sentence",
  "abstractZh": "中文精简摘要，80-140字",
  "abstractEn": "English brief abstract, 50-90 words",
  "ageGroup": "被试年龄/群体；如摘要无法判断，写'摘要未说明'",
  "paradigm": "实验任务或范式；如无法判断，写'摘要未说明'",
  "methods": "方法与统计模型；如无法判断，写'摘要未说明'",
  "keyFindingsZh": "中文核心发现，1-3句",
  "keyFindingsEn": "English key findings, 1-3 sentences",
  "topics": ["3-6个中英文混合或中文关键词标签"]
}

论文：
Title: ${paper.title}
Journal: ${paper.journal}
Authors: ${paper.authors.join(", ")}
Date: ${paper.publishedDate}
DOI: ${paper.doi}
Abstract: ${paper.abstractEn}
`;

  try {
    const payload = await callModel(prompt);
    return {
      ...paper,
      ...payload,
      topics: Array.isArray(payload.topics) && payload.topics.length ? payload.topics : paper.topics,
      status: "summarized",
      source: `${paper.source}+model`
    };
  } catch (error) {
    return {
      ...paper,
      status: "candidate",
      modelNote: `Model summarization failed: ${error.message}`
    };
  }
}

async function callModel(prompt) {
  const baseUrl = process.env.MODEL_BASE_URL.replace(/\/$/, "");
  const model = process.env.MODEL_NAME || "deepseek-chat";
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract structured fields from academic article metadata. Return valid JSON only." },
      { role: "user", content: prompt }
    ]
  };
  let result = await postModelRequest(baseUrl, body);

  if (!result.ok && result.status === 400) {
    const fallbackBody = { ...body };
    delete fallbackBody.response_format;
    result = await postModelRequest(baseUrl, fallbackBody);
  }

  if (!result.ok) {
    throw new Error(`HTTP ${result.status}`);
  }

  const data = await result.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty model response");
  }
  return JSON.parse(extractJson(content));
}

async function postModelRequest(baseUrl, body) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.MODEL_API_KEY}`
    },
    body: JSON.stringify(body)
  });
}

function extractJson(content) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last >= first ? trimmed.slice(first, last + 1) : trimmed;
}

async function saveToGitHub(newPapers) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) {
    return { saved: false, reason: "未配置 GITHUB_TOKEN / GITHUB_REPO，因此未自动写回。" };
  }

  const currentFile = await getGitHubFile(repo, "data/papers.json", branch, token);
  const existing = currentFile.content ? JSON.parse(currentFile.content) : [];
  const merged = mergeByDoi(existing, newPapers);
  await putGitHubFile(repo, "data/papers.json", JSON.stringify(merged, null, 2) + "\n", currentFile.sha, branch, token, "Update literature radar papers");

  const reports = makeMonthlyReports(merged);
  for (const [path, content] of reports) {
    const currentReport = await getGitHubFile(repo, path, branch, token).catch(() => ({ sha: undefined, content: "" }));
    await putGitHubFile(repo, path, content, currentReport.sha, branch, token, `Update ${path}`);
  }

  return {
    saved: true,
    reason: "GitHub writeback complete.",
    paperCount: merged.length,
    reportCount: reports.length
  };
}

function mergeByDoi(existing, incoming) {
  const map = new Map();
  [...existing, ...incoming].forEach((paper) => {
    const key = paper.doi || paper.id;
    if (key) map.set(key.toLowerCase(), paper);
  });
  return Array.from(map.values()).sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));
}

function makeMonthlyReports(papers) {
  const grouped = new Map();
  papers.forEach((paper) => {
    const month = paper.publishedDate.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(paper);
  });

  return Array.from(grouped.entries()).map(([month, items]) => {
    const content = [
      `# Literature Radar Report: ${month}`,
      "",
      ...items.map((paper) => [
        `## ${paper.title}`,
        "",
        `- Journal: ${paper.journal}`,
        `- Date: ${paper.publishedDate}`,
        `- Authors: ${paper.authors.join(", ") || "-"}`,
        `- DOI: ${paper.doi || "-"}`,
        `- Topics: ${(paper.topics || []).join(", ")}`,
        "",
        `**研究问题**：${paper.researchQuestionZh || "-"}`,
        "",
        `**Research Question**: ${paper.researchQuestionEn || "-"}`,
        "",
        `**中文摘要**：${paper.abstractZh || "-"}`,
        "",
        `**English Abstract**: ${paper.abstractEn || "-"}`,
        "",
        `**核心发现**：${paper.keyFindingsZh || "-"}`,
        "",
        `**Key Findings**: ${paper.keyFindingsEn || "-"}`,
        ""
      ].join("\n"))
    ].join("\n");

    return [`reports/${month}.md`, content];
  });
}

async function getGitHubFile(repo, path, branch, token) {
  const result = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: githubHeaders(token)
  });

  if (result.status === 404) {
    return { sha: undefined, content: "" };
  }
  if (!result.ok) {
    throw new Error(`GitHub read failed: HTTP ${result.status}`);
  }

  const data = await result.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content || "", "base64").toString("utf8")
  };
}

async function putGitHubFile(repo, path, content, sha, branch, token, message) {
  const body = {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64")
  };
  if (sha) body.sha = sha;

  const result = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify(body)
  });

  if (!result.ok) {
    throw new Error(`GitHub write failed for ${path}: HTTP ${result.status}`);
  }
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "literature-radar-dashboard",
    "x-github-api-version": "2022-11-28"
  };
}

function inferTopics(text) {
  const lower = text.toLowerCase();
  const topics = [];
  if (/language|word|vocabulary|syntax|semantic|pragmatic|speech/.test(lower)) topics.push("儿童语言发展");
  if (/vocabulary|word learning|lexical/.test(lower)) topics.push("词汇学习");
  if (/semantic|pragmatic/.test(lower)) topics.push("语义语用学习");
  if (/cognitive|memory|attention|executive/.test(lower)) topics.push("儿童认知发展");
  return topics.length ? topics : ["待分类"];
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
