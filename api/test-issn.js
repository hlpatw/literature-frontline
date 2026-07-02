// 测试 ISSN 过滤功能

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ message: "Use GET to test ISSN filtering." });
  }

  try {
    const journal = { id: "infancy", name: "Infancy", issn: ["1532-7078"] };
    const url = new URL("https://api.crossref.org/works");

    // 使用 ISSN 过滤
    url.searchParams.set("filter", "issn:1532-7078,from-pub-date:2024-01-01");
    url.searchParams.set("rows", "5");
    url.searchParams.set("sort", "published");
    url.searchParams.set("order", "desc");

    console.log(`[Test] URL: ${url}`);

    const result = await fetch(url);

    if (!result.ok) {
      return response.status(500).json({
        error: `HTTP ${result.status}`,
        url: url.toString()
      });
    }

    const payload = await result.json();
    const items = payload.message?.items ?? [];

    return response.status(200).json({
      journal: journal.name,
      issn: journal.issn,
      itemsFound: items.length,
      sampleItems: items.map(item => ({
        title: item.title?.[0],
        doi: item.DOI,
        containerTitle: item["container-title"],
        published: item.published
      })),
      url: url.toString()
    });

  } catch (error) {
    return response.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
