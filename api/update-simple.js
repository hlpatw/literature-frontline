// 简化版 update API - 用于诊断问题

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ message: "Use POST to trigger a manual update." });
  }

  try {
    console.log("[Update] Starting update process...");

    // 检查环境变量
    const envCheck = {
      MODEL_API_KEY: !!process.env.MODEL_API_KEY,
      MODEL_BASE_URL: !!process.env.MODEL_BASE_URL,
      GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
      GITHUB_REPO: process.env.GITHUB_REPO || "not set"
    };

    console.log("[Update] Environment check:", envCheck);

    // 简单返回测试数据
    return response.status(200).json({
      message: "简化测试：更新接口正常运行",
      envCheck,
      timestamp: new Date().toISOString()
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
