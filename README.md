# Psycholinguistics Literature Radar

私人文献雷达 dashboard，用于追踪儿童语言发展、儿童认知发展、词汇学习、语义/语用学习相关顶刊文章。

## 当前功能

- 按期刊、年份、月份、日期浏览文献
- 中英文精简摘要字段
- 作者、研究问题、被试年龄/群体、实验任务/范式、方法与统计模型、核心发现、关键词标签
- 手动点击更新的工作流入口
- 本地 JSON 数据源，支持导出 JSON 与 Markdown 报告
- Vercel / Netlify serverless 更新接口模板，当前可从 Crossref 拉取近 90 天候选文献
- 预留国内模型总结配置，如通义千问、智谱、DeepSeek、Moonshot 等 OpenAI-compatible API

## 本地使用

直接用浏览器打开：

```text
index.html
```

如果浏览器拦截本地 `fetch(data/*.json)`，可以在此目录启动任意静态服务器，例如：

```powershell
python -m http.server 4173
```

然后访问：

```text
http://localhost:4173
```

## 部署

### Netlify

- Build command 留空
- Publish directory 填当前目录
- 可选函数目录：`netlify/functions`

### Vercel

- Framework 选择 Other
- Output directory 留空或当前目录
- 可选 API 目录：`api`

## 数据文件

- `data/journals.json`：目标期刊清单
- `data/papers.json`：文献记录
- `reports/`：可保存导出的 Markdown 报告

## 后续接入真实更新

`api/update.js` 与 `netlify/functions/update.js` 当前会查询 Crossref 的近 90 天期刊文章元数据，并在配置环境变量后调用 OpenAI-compatible 国内模型生成结构化双语摘要，再写回 GitHub 私人仓库。

不要把 API key 写进前端文件。请在 Vercel 或 Netlify 的 Environment Variables 中配置：

```text
MODEL_API_KEY=你的模型 API key
MODEL_BASE_URL=https://llmapi.paratera.com
MODEL_NAME=你要使用的模型名
UPDATE_SUMMARY_LIMIT=20

GITHUB_TOKEN=GitHub fine-grained token
GITHUB_REPO=你的用户名/你的私人仓库名
GITHUB_BRANCH=main
```

GitHub token 建议使用 Fine-grained personal access token，只给这个私人仓库 `Contents: Read and write` 权限。

工作流：

1. 在 dashboard 点击“手动更新”。
2. Serverless 函数抓取 Crossref 近 90 天候选文献。
3. 模型提取中英文摘要、研究问题、被试、范式、方法、核心发现和标签。
4. 函数把合并后的数据写回 `data/papers.json`。
5. 函数生成或更新 `reports/YYYY-MM.md` 月度报告。
6. Vercel/Netlify 检测到 GitHub 提交后自动重新部署。

建议继续增强：

1. 继续加入 OpenAlex、Semantic Scholar API 作为交叉校验来源。
2. 用期刊 ISSN / DOI / published date 去重。
3. 只抓取标题、摘要、作者、DOI、发布日期等公开元数据。
4. 将候选文献送入模型做结构化双语总结。
5. 人工确认后导出 JSON，并合并到 `data/papers.json`。

这样可以尽量减少漏抓和误收，同时避免期刊官网反爬导致的不稳定。
