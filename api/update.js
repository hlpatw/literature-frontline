// Vercel API Function for literature radar update
// 独立实现，不依赖外部模块

export default async function handler(request, response) {
  // 允许 GET 方法进行测试
  if (request.method !== "POST" && request.method !== "GET") {
    return response.status(405).json({ message: "Use POST to trigger a manual update." });
  }

  try {
    console.log("[Update] Starting update...");

    const daysLookback = Number(process.env.CROSSREF_DAYS_LOOKBACK || 180);
    const rowsPerJournal = Number(process.env.CROSSREF_ROWS_PER_JOURNAL || 10);
    const from = new Date();
    from.setDate(from.getDate() - daysLookback);
    const fromDate = from.toISOString().slice(0, 10);

    // 期刊配置（内置ISSN）- 限制数量以避免超时
    const JOURNALS = [
      { id: "child-development", name: "Child Development", issn: ["0009-3920", "1467-8624"] },
      { id: "developmental-science", name: "Developmental Science", issn: ["1363-755X", "1467-7684"] },
      { id: "developmental-psychology", name: "Developmental Psychology", issn: ["0012-1649", "1939-0599"] },
      { id: "jecp", name: "Journal of Experimental Child Psychology", issn: ["0022-0965", "1096-0457"] },
      { id: "infancy", name: "Infancy", issn: ["1532-7078"] }
    ];

    // 排除规则
    const EXCLUDE_PATTERNS = [
      "issue information", "table of contents", "editorial board",
      "announcement", "book review", "corrigendum", "erratum",
      "retraction", "editorial", "preface", "foreword"
    ];
    const EXCLUDE_SUBTYPES = ["editorial", "letter", "news", "book-review", "issue-information"];

    // 清除HTML标签
    function stripTags(value) {
      return String(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    }

    // 推断主题标签
    function inferTopics(title, abstract) {
      const text = `${title} ${abstract}`.toLowerCase();
      const topics = [];

      if (/language|word|vocabulary|syntax|semantic|pragmatic|speech/.test(text)) topics.push("儿童语言发展");
      if (/vocabulary|word learning|lexical/.test(text)) topics.push("词汇学习");
      if (/cognitive|memory|attention|executive/.test(text)) topics.push("儿童认知发展");
      if (/infant|baby|babie/.test(text)) topics.push("婴儿发展");
      if (/social|emotion|attachment/.test(text)) topics.push("社会性发展");

      return topics.length ? topics : ["待分类"];
    }

    // 获取单个期刊的文献
    async function fetchJournal(journal) {
      const url = new URL("https://api.crossref.org/works");

      // 使用期刊名称查询
      url.searchParams.set("query", journal.name);
      url.searchParams.set("rows", String(rowsPerJournal));

      console.log(`[Crossref] Fetching ${journal.name}...`);

      let result = await fetch(url);

      // 如果遇到 429 错误，等待后重试
      if (result.status === 429) {
        console.warn(`[Crossref] ${journal.name}: Rate limited, waiting 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = await fetch(url);
      }

      if (!result.ok) {
        console.error(`[Crossref] ${journal.name}: HTTP ${result.status}`);
        return { journalName: journal.name, error: `HTTP ${result.status}`, count: 0, items: [] };
      }

      const payload = await result.json();
      const items = payload.message?.items ?? [];
      console.log(`[Crossref] ${journal.name}: Got ${items.length} items`);

      // 过滤非研究文章并转换格式
      const validItems = items.filter(item => {
        const subtype = item.subtype?.toLowerCase();
        if (subtype && EXCLUDE_SUBTYPES.includes(subtype)) return false;

        const title = (item.title?.[0] ?? "").toLowerCase();
        for (const pattern of EXCLUDE_PATTERNS) {
          if (title.includes(pattern)) return false;
        }
        return true;
      }).map(item => {
        const dateParts = item.published?.["date-parts"]?.[0] ?? item["published-print"]?.["date-parts"]?.[0] ?? [];
        const year = dateParts[0] ?? new Date().getFullYear();
        const month = String(dateParts[1] ?? 1).padStart(2, "0");
        const day = String(dateParts[2] ?? 1).padStart(2, "0");
        const publishedDate = `${year}-${month}-${day}`;

        return {
          id: item.DOI ? `doi-${item.DOI.toLowerCase().replace(/\//g, "-")}` : `crossref-${item.URL}`,
          journalId: journal.id,
          journal: journal.name,
          title: stripTags(item.title?.[0] ?? "Untitled"),
          authors: (item.author ?? []).map(a => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
          doi: item.DOI ?? "",
          url: item.URL ?? `https://doi.org/${item.DOI}`,
          publishedDate,
          topics: inferTopics(item.title?.[0] ?? "", item.abstract ?? ""),
          abstractEn: stripTags(item.abstract ?? "Abstract not available."),
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
      });

      console.log(`[Crossref] ${journal.name}: ${validItems.length} valid items after filtering`);

      return { journalName: journal.name, count: validItems.length, items: validItems };
    }

    // 快速串行获取所有期刊（无延迟）
    const results = [];
    for (const journal of JOURNALS) {
      const result = await fetchJournal(journal);
      results.push(result);
    }

    const batches = results.filter(r => !r.error).map(r => r.items);
    const errors = results.filter(r => r.error);

    // 去重
    const seen = new Set();
    let papers = batches.flat().filter(p => {
      const key = p.doi || p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));

    console.log(`[Update] Total unique papers: ${papers.length}`);
    if (errors.length > 0) {
      console.error(`[Update] Errors: ${errors.map(e => `${e.journalName}: ${e.error}`).join(", ")}`);
    }

    // 调用模型生成摘要（限制数量以避免超时）
    let summarized = [];
    if (process.env.MODEL_API_KEY && process.env.MODEL_BASE_URL) {
      const limit = Number(process.env.UPDATE_SUMMARY_LIMIT ?? 2);
      const selected = papers.slice(0, limit);

      for (const paper of selected) {
        try {
          const prompt = `你是心理语言学和儿童认知发展方向的博士研究助理。请基于下面的期刊论文元数据和摘要，输出严格 JSON，不要 Markdown。

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

          const modelResponse = await fetch(`${process.env.MODEL_BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${process.env.MODEL_API_KEY}`
            },
            body: JSON.stringify({
              model: process.env.MODEL_NAME || "deepseek-chat",
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: "You extract structured fields from academic article metadata. Return valid JSON only." },
                { role: "user", content: prompt }
              ]
            })
          });

          if (modelResponse.ok) {
            const data = await modelResponse.json();
            const content = data.choices?.[0]?.message?.content;
            if (content) {
              try {
                const parsed = JSON.parse(content.replace(/```json\s*/i, "").replace(/```/g, "").trim());
                summarized.push({
                  ...paper,
                  ...parsed,
                  topics: Array.isArray(parsed.topics) && parsed.topics.length ? parsed.topics : paper.topics,
                  status: "summarized",
                  source: `${paper.source}+model`
                });
              } catch (e) {
                console.error("[Model] JSON parse error:", e.message);
                summarized.push({ ...paper, status: "candidate", modelNote: "JSON parse failed" });
              }
            }
          } else {
            summarized.push({ ...paper, status: "candidate", modelNote: `HTTP ${modelResponse.status}` });
          }
        } catch (e) {
          console.error("[Model] Error:", e.message);
          summarized.push({ ...paper, status: "candidate", modelNote: e.message });
        }
      }

      const rest = papers.slice(limit);
      papers = [...summarized, ...rest.map(p => ({ ...p, status: "candidate" }))];
    }

    // 保存到 GitHub
    let saveResult = { saved: false, reason: "未配置保存功能" };
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      try {
        saveResult = await saveToGitHub(papers);
      } catch (e) {
        console.error("[GitHub] Save error:", e.message);
        saveResult = { saved: false, reason: e.message };
      }
    }

    return response.status(200).json({
      message: saveResult.saved
        ? `更新完成：返回 ${papers.length} 条记录（其中 ${summarized.length} 条已生成摘要），并已保存到 GitHub。`
        : `更新完成：返回 ${papers.length} 条记录（其中 ${summarized.length} 条已生成摘要）。`,
      papers,
      saved: saveResult.saved,
      saveResult,
      debug: {
        candidatesFound: papers.length,
        summarizedCount: summarized.length,
        daysLookback,
        fromDate,
        journalErrors: errors.map(e => ({ name: e.journalName, error: e.error }))
      }
    });

  } catch (error) {
    console.error("[Update] Error:", error);
    return response.status(500).json({
      message: "更新函数运行失败。",
      error: error.message,
      stack: error.stack
    });
  }
}

// GitHub 相关函数
async function saveToGitHub(newPapers) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  // 获取现有文件
  const currentFile = await getGitHubFile(repo, "data/papers.json", branch, token);
  const existing = currentFile.content ? JSON.parse(currentFile.content) : [];

  // 合并论文
  const merged = mergeByDoi(existing, newPapers);

  // 保存到 GitHub
  await putGitHubFile(repo, "data/papers.json", JSON.stringify(merged, null, 2) + "\n", currentFile.sha, branch, token, "Update literature radar papers");

  // 生成月度报告
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
