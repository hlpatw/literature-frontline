// 逐步测试 CrossrefClient 导入和初始化

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Use POST to trigger a manual update." });
  }

  try {
    console.log("[Test] Step 1: Testing module import...");

    // 测试模块导入
    const clientModule = await import("../lib/crossref-client.js");
    console.log("[Test] Module loaded:", Object.keys(clientModule));

    const { CrossrefClient } = clientModule;
    console.log("[Test] CrossrefClient class:", typeof CrossrefClient);

    // 测试客户端初始化
    console.log("[Test] Step 2: Testing client initialization...");
    const client = new CrossrefClient({
      useIssn: true,
      hasAbstract: true,
      rows: 10,
      daysLookback: 30
    });
    console.log("[Test] Client created:", client);

    // 测试单个期刊获取
    console.log("[Test] Step 3: Testing single journal fetch...");
    const testJournal = { id: "infancy", name: "Infancy", issn: ["1532-7078"] };
    const papers = await client.fetchJournal(testJournal, "2025-01-01");
    console.log("[Test] Papers fetched:", papers.length);

    return response.status(200).json({
      message: "测试成功！CrossrefClient 工作正常",
      steps: {
        moduleImport: "OK",
        clientInit: "OK",
        journalFetch: `OK - got ${papers.length} papers`
      },
      samplePapers: papers.slice(0, 2)
    });
  } catch (error) {
    console.error("[Test] Error:", error);
    return response.status(500).json({
      message: "测试失败",
      error: error.message,
      stack: error.stack
    });
  }
}
