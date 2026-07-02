// 简单的健康检查端点
export default async function handler(request, response) {
  return response.status(200).json({
    status: "ok",
    message: "API is working!",
    env: {
      hasModelKey: !!process.env.MODEL_API_KEY,
      hasBaseUrl: !!process.env.MODEL_BASE_URL,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      hasGithubRepo: !!process.env.GITHUB_REPO
    },
    timestamp: new Date().toISOString()
  });
}
