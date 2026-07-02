// 完全独立的 update API - 不依赖外部模块
// 所有逻辑内联，避免模块导入问题

export default async function handler(request, response) {
  // 允许 GET 方法进行测试
  if (request.method !== "POST" && request.method !== "GET") {
    return response.status(405).json({ message: "Use POST to trigger a manual update." });
  }

  try {
    console.log("[Update] Starting standalone update...");

    const daysLookback = Number(process.env.CROSSREF_DAYS_LOOKBACK || 180);
    const from = new Date();
    from.setDate(from.getDate() - daysLookback);
    const fromDate = from.toISOString().slice(0, 10);

    // 期刊配置（内置ISSN）
    const JOURNALS = [
      { id: "child-development", name: "Child Development", issn: ["0009-3920", "1467-8624"] },
      { id: "developmental-science", name: "Developmental Science", issn: ["1363-755X", "1467-7684"] },
      { id: "developmental-psychology", name: "Developmental Psychology", issn: ["0012-1649", "1939-0599"] },
      { id: "jecp", name: "Journal of Experimental Child Psychology", issn: ["0022-0965", "1096-0457"] },
      { id: "infancy", name: "Infancy", issn: ["1532-7078"] },
      { id: "journal-of-child-language", name: "Journal of Child Language", issn: ["0305-0009"] },
      { id: "language-learning-development", name: "Language Learning and Development", issn: ["1547-5441", "1547-3341"] },
      { id: "journal-of-memory-and-language", name: "Journal of Memory and Language", issn: ["0749-596X", "1096-0821"] },
      { id: "applied-psycholinguistics", name: "Applied Psycholinguistics", issn: ["0142-7164", "1469-1817"] },
      { id: "first-language", name: "First Language", issn: ["0142-7237"] }
    ];

    // 排除规则
    const EXCLUDE_PATTERNS = [
      "issue information", "table of contents", "editorial board",
      "announcement", "book review", "corrigendum", "erratum"
    ];
    const EXCLUDE_SUBTYPES = ["editorial", "letter", "news", "book-review", "issue-information"];

    // 获取单个期刊的文献
    async function fetchJournal(journal) {
      const url = new URL("https://api.crossref.org/works");

      // 先用最基本的参数测试
      url.searchParams.set("query", journal.name);
      url.searchParams.set("rows", "5");

      console.log(`[Crossref] Fetching ${journal.name}`);
      console.log(`[Crossref] URL: ${url}`);

      let result = await fetch(url);

      // 如果遇到 429 错误，等待后重试
      if (result.status === 429) {
        console.warn(`[Crossref] ${journal.name}: Rate limited, waiting 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        result = await fetch(url);
      }

      if (!result.ok) {
        console.error(`[Crossref] ${journal.name}: HTTP ${result.status}`);
        return { journalName: journal.name, error: `HTTP ${result.status}`, count: 0, items: [] };
      }

      const payload = await result.json();
      const items = payload.message?.items ?? [];
      console.log(`[Crossref] ${journal.name}: Got ${items.length} items before filtering`);

      // 过滤非研究文章
      const validItems = items.filter(item => {
        const subtype = item.subtype?.toLowerCase();
        if (subtype && EXCLUDE_SUBTYPES.includes(subtype)) return false;

        const title = (item.title?.[0] ?? "").toLowerCase();
        for (const pattern of EXCLUDE_PATTERNS) {
          if (title.includes(pattern)) return false;
        }
        return true;
      });

      console.log(`[Crossref] ${journal.name}: Got ${validItems.length} items after filtering`);

      return { journalName: journal.name, count: validItems.length, items: validItems };

      // 转换格式
      return validItems.map(item => {
        const dateParts = item.published?.["date-parts"]?.[0] ?? [];
        const year = dateParts[0] ?? new Date().getFullYear();
        const month = String(dateParts[1] ?? 1).padStart(2, "0");
        const day = String(dateParts[2] ?? 1).padStart(2, "0");

        return {
          id: item.DOI ? `doi-${item.DOI.toLowerCase().replace(/\//g, "-")}` : `crossref-${item.DOI}`,
          journalId: journal.id,
          journal: journal.name,
          title: item.title?.[0] ?? "Untitled",
          authors: (item.author ?? []).map(a => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
          doi: item.DOI ?? "",
          url: `https://doi.org/${item.DOI}`,
          publishedDate: `${year}-${month}-${day}`,
          abstractEn: item.abstract ?? "Abstract not available.",
          status: "candidate",
          source: "crossref"
        };
      });
    }

    // 获取所有期刊 - 串行执行以避免速率限制
    const results = [];
    for (const journal of JOURNALS) {
      const result = await fetchJournal(journal);
      results.push(result);
      // 每个请求之间延迟 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const batches = results.filter(r => !r.error).map(r => r.items);
    const errors = results.filter(r => r.error);

    // 去重
    const seen = new Set();
    const papers = batches.flat().filter(p => {
      const key = p.doi || p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));

    console.log(`[Update] Found ${papers.length} papers from ${JOURNALS.length} journals`);

    // 检查是否配置了模型
    if (!process.env.MODEL_API_KEY || !process.env.MODEL_BASE_URL) {
      return response.status(200).json({
        message: `获取到 ${papers.length} 条候选记录。模型未配置，未进行摘要生成。`,
        papers: papers.slice(0, 10),
        total: papers.length,
        debug: { daysLookback, fromDate }
      });
    }

    // 调用模型生成摘要（仅前5条测试）
    const summarized = [];
    for (const paper of papers.slice(0, 5)) {
      try {
        const prompt = `Extract structured info from this paper:\n\nTitle: ${paper.title}\nAbstract: ${paper.abstractEn}\n\nReturn JSON with: researchQuestionZh, researchQuestionEn, abstractZh, abstractEn, topics (array)`;

        const modelResponse = await fetch(`${process.env.MODEL_BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.MODEL_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.MODEL_NAME || "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });

        if (modelResponse.ok) {
          const data = await modelResponse.json();
          const content = data.choices?.[0]?.message?.content;
          const parsed = JSON.parse(content);
          summarized.push({ ...paper, ...parsed, status: "summarized" });
        } else {
          summarized.push({ ...paper, status: "candidate", modelNote: "Model call failed" });
        }
      } catch (e) {
        console.error("[Model] Error:", e.message);
        summarized.push({ ...paper, status: "candidate", modelNote: e.message });
      }
    }

    const rest = papers.slice(5);
    const allPapers = [...summarized, ...rest.map(p => ({ ...p, status: "candidate" }))];

    return response.status(200).json({
      message: `更新完成：返回 ${allPapers.length} 条记录（其中 ${summarized.length} 条已生成摘要）`,
      papers: allPapers,
      saved: false,
      debug: {
        candidatesFound: papers.length,
        daysLookback,
        fromDate,
        journalResults: results.map(r => ({
          name: r.journalName || "unknown",
          count: r.count,
          error: r.error
        }))
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
