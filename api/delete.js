export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ message: "Use POST to delete a paper." });
    return;
  }

  const { id, doi } = await request.json();

  if (!id && !doi) {
    response.status(400).json({ message: "Missing paper id or doi." });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) {
    return response.status(200).json({
      message: "未配置 GITHUB_TOKEN / GITHUB_REPO，仅执行本地删除。",
      synced: false
    });
  }

  try {
    // 获取当前 papers.json
    const currentFile = await getGitHubFile(repo, "data/papers.json", branch, token);
    const existing = currentFile.content ? JSON.parse(currentFile.content) : [];

    // 删除匹配的文献
    const filtered = existing.filter((paper) => {
      const paperId = paper.doi || paper.id;
      const targetId = doi || id;
      return paperId !== targetId && (paper.id !== id);
    });

    if (filtered.length === existing.length) {
      return response.status(404).json({ message: "Paper not found." });
    }

    // 写回 GitHub
    await putGitHubFile(repo, "data/papers.json", JSON.stringify(filtered, null, 2) + "\n", currentFile.sha, branch, token, `Delete paper: ${id}`);

    response.status(200).json({
      message: "文献已删除并同步到 GitHub。",
      synced: true,
      remainingCount: filtered.length
    });
  } catch (error) {
    response.status(500).json({
      message: "删除失败：" + error.message,
      synced: false
    });
  }
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
