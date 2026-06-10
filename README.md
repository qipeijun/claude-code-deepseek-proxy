# Claude Code DeepSeek Proxy

让 DeepSeek 无缝驱动 Claude Code 的 Anthropic 兼容中转代理——路由匹配、模型名映射、失败自动切换。

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Claude Code │────▶│  本代理 :8787    │────▶│ DeepSeek Anthropic │
└──────────────┘     └──────────────────┘     └───────────────────┘
                            │  管理后台 /admin
                            │  方案切换 · 路由配置 · 实时指标
```

## 为什么需要

直接用 DeepSeek 接 Claude Code 有两个问题：

1. **子代理请求被拒**——Claude Code 子代理同时携带 `thinking: { type: "disabled" }` 和 `reasoning_effort`，DeepSeek 严格校验直接 400。
2. **模型名对不上**——Claude Code 用 `claude-sonnet-4-6` 发请求，上游返回 `deepseek-v4-pro`，不映射回来会导致行为异常。

本代理在中间做：请求规范化 → 路由匹配 → 模型名映射 → 上游转发 → 失败 fallback。

## 快速开始

```bash
git clone https://github.com/qipeijun/claude-code-deepseek-proxy.git
cd claude-code-deepseek-proxy
npm install
npm start
```

启动后打开 `http://127.0.0.1:8787/admin` 完成配置（上游地址、API Key、模型路由），保存激活后重启。

Claude Code 客户端设置：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="你在 admin 中设置的鉴权密码"   # 未设鉴权则随便填
```

> 不需要 `.env` 文件。API Key 等所有配置通过 admin 页面填写，持久化保存在 `config-store.json`。如果不想 Key 落盘，可在 admin 中将 Key 留空，改为填写 `apiKeyEnv` 引用环境变量。

## 核心特性

- **请求规范化** — 子代理携带的 `thinking: disabled` + `reasoning_effort` 矛盾字段在发出前自动清洗，主代理扩展思考不受影响。
- **模型名映射** — 请求侧映射为上游模型名，响应侧（JSON + SSE 流）映射回原始模型名。SSE 流映射做了事件边界缓冲。
- **模型路由** — 支持 `exact` 精确匹配和 `prefix` 前缀匹配。exact 优先于 prefix，多个 prefix 命中取最长前缀。
- **Fallback 容灾** — 只有显式配置了 `fallback` 的路由才会切换。触发条件：5xx / 429 / 请求异常。不做静默降级或自动兜底。
- **内容块校验** — 发出前检查 `system` 和 `messages[].content` 的 type 是否在上游能力范围内，不支持的类型直接报错。
- **连接池管理** — 按上游 origin 缓存 undici Agent，复用 TCP + TLS 连接，槽位控制并发（默认 32）。
- **实时指标** — 内存环形缓冲区存储最近 200 条请求，admin 仪表盘展示延迟分布、吞吐量、连接池使用率。
- **可视化配置管理** — `http://127.0.0.1:8787/admin` 提供三步配置向导（上游连接 → 模型路由 → 高级设置），支持多套方案一键切换。
- **认证** — 支持 `Authorization: Bearer` 和 `x-api-key`，在 admin 中填写或通过 `authTokenEnv` 引用环境变量。`/healthz` 和管理 API 跳过认证。

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/messages` | POST | Anthropic Messages API（支持 SSE 流） |
| `/v1/messages/count_tokens` | POST | Token 计数 |
| `/v1/models` | GET | 列出可用模型 |
| `/healthz` | GET | 健康检查 |
| `/admin` | GET | 管理后台页面 |
| `/api/admin/profiles` | GET / POST | 列出 / 创建配置方案 |
| `/api/admin/profiles/:id` | PUT / DELETE | 更新 / 删除方案 |
| `/api/admin/profiles/activate` | POST | 激活方案 |
| `/api/admin/upstream-models` | POST | 查询上游可用模型 |
| `/api/admin/metrics` | GET | 实时性能指标 |

## 通过 New API 网关中转

需要统一管理 Key、用量统计或团队限流时，可在前面加一层 [New API](https://github.com/QuantumNous/new-api)：

```
Claude Code → 本代理 :8787 → New API :3000 → DeepSeek Anthropic
```

1. 启动 New API 并在其管理界面添加 DeepSeek 渠道（`https://api.deepseek.com/anthropic`，模型 `deepseek-v4-pro`）
2. 在 New API 中创建令牌
3. 在本代理 admin 中将 provider 地址改为 `http://127.0.0.1:3000`，Key 填入 New API 令牌

直连延迟最低（一跳），经 New API 多一跳（~5ms 本地）但获得 Web 界面管理、多 Key 轮换、用量统计和限流能力。

## 与 ccswitch 并行运行

[ccswitch-deepseek](https://github.com/qipeijun/ccswitch-deepseek) 是面向 Codex CLI 的另一中转代理，做 OpenAI Responses API → DeepSeek Chat Completions 协议翻译，监听 `11435` 端口。两者独立运行、互不影响，共享同一 DeepSeek Key。

## 环境变量

代理自身读取的硬编码变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | `production` 时输出 JSON 日志 | 开发模式 |
| `LOG_LEVEL` | debug / info / warn / error | `info` |
| `CONFIG_STORE_PATH` | 配置持久化文件路径 | `./config-store.json` |
| `UPSTREAM_MAX_CONNECTIONS` | 上游连接池上限 | `32` |

通过 admin 配置引用的变量（用户自定义名称）：Provider 的 `apiKeyEnv`、Server 的 `authTokenEnv` 均可指定任意环境变量名，代理启动时读取。

## 开发

```bash
npm install          # 安装依赖
npm start            # 直接启动（tsx，无需编译）
npm run dev          # 开发模式（tsx watch，文件变更自动重启）
npm run build        # TypeScript 编译到 dist/
npm test             # 运行全部测试（vitest）
npm run test:watch   # 测试 watch 模式
npm run typecheck    # 仅类型检查
```

技术栈：Node.js >= 22 / Fastify 5 / undici 7 / Zod / Vitest / pino，ESM。

## License

MIT
