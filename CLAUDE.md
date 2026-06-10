# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个面向 Claude Code 的 Anthropic 兼容中转服务，基于 Fastify。它将 Claude Code 主 agent 和子 agent 的模型请求显式路由到 DeepSeek `deepseek-v4-pro`（或其他 Anthropic 兼容上游），同时在响应中将上游模型名还原为原始请求的模型名。

## 常用命令

```bash
npm install          # 安装依赖
npm start            # 直接启动（tsx，无需编译）
npm run dev          # 开发模式（tsx watch，文件变更自动重启）
npm run build        # TypeScript 编译到 dist/（仅发布时需要）
npm test             # 运行全部测试（vitest run）
npm run test:watch   # 测试 watch 模式（vitest）
npm run typecheck    # 仅类型检查，不输出文件
```

## 架构概览

```
index.ts          入口 — 加载配置 → 构建服务器 → 监听端口
server.ts         Fastify 服务器 — 路由注册、认证、代理+fallback 编排
router.ts         模型路由匹配 — exact > prefix > 最长 prefix 优先
config.ts         Provider 解析（环境变量读取 + baseUrl/apiKey 解析）
http.ts           上游 HTTP 调用 — undici Agent 连接池复用，AbortController 超时
modelRewrite.ts   模型名改写 — 请求替换 upstreamModel，响应还原 externalModel，含 SSE 流改写
contentBlocks.ts  内容块校验 — 请求发出前拒绝上游不支持的内容块类型
errors.ts         ProxyError 类 + Anthropic 格式错误响应
types.ts          Zod schema 定义 + TypeScript 类型导出
defaultConfig.ts  内置默认配置 — 空 providers/routes，引导到 admin 页面配置
admin.ts          Admin API — 方案 CRUD + 上游模型列表查询
store.ts          配置持久化 — JSON 文件读写 + 写锁防并发覆盖
util.ts           工具函数 — isObject 等
```

## 核心设计决策

### 配置分层

- **admin Web 页面**：主要配置入口，创建方案 → 设为当前 → 重启生效
- **`config-store.json`**：持久化所有配置方案（JSON），通过 `CONFIG_STORE_PATH` 自定义路径
- **`defaultConfig.ts`**：空提供者和路由，首次启动引导用户打开 admin 页面完成配置
- Provider 的 `apiKey` 支持直接填写（存储在 config-store.json）或通过 `apiKeyEnv` 引用环境变量

### 路由匹配规则（`router.ts`）

1. `exact` 完全匹配优先于 `prefix`
2. 多个 `prefix` 匹配时，取最长前缀
3. 无匹配路由时返回 404 Anthropic 格式错误

### Fallback 机制（`server.ts` `proxyWithFallback`）

- 只有路由中显式配置了 `fallback` 数组的路由才会在上游失败时切换
- Fallback 触发条件：上游返回 5xx 或 429，或请求本身抛出异常
- 按 fallback 数组顺序依次尝试，全部失败才返回错误
- 不会自动兜底到 flash 或其他模型

### 模型名改写（`modelRewrite.ts`）

- 请求：将 `body.model` 替换为路由配置的 `upstreamModel`，转发到上游
- 响应（JSON）：将 `payload.model` 和 `payload.message.model` 还原为 `externalModel`（Claude Code 请求的原始模型名）
- 响应（SSE）：逐 event 改写 `data:` 行中的 model 字段
- 这是关键环节：Claude Code 会根据响应中的 model 名做后续决策，如果还原不正确会导致行为异常

### 内容块校验（`contentBlocks.ts`）

- 遍历请求的 `system` 和 `messages[].content`，收集所有 `type` 字段
- 对比 provider 的 `capabilities.contentBlocks` 声明
- 不支持的内容块返回明确错误，不做静默吞掉或字符串拼接

### 认证

- `server.authTokenEnv` 指定环境变量名（默认 `LOCAL_PROXY_API_KEY`）
- 支持 `Authorization: Bearer xxx` 和 `x-api-key` 两种方式
- `/healthz` 端点跳过认证

## 技术栈

- **运行时**：Node.js >= 22，ESM（`"type": "module"`）
- **框架**：Fastify 5 + `@fastify/cors`
- **HTTP 客户端**：undici 7（Agent 连接池复用 + AbortController 超时）
- **配置校验**：Zod（`appConfigSchema` 在 `types.ts` 定义）
- **测试**：Vitest，使用 Fastify 的 `app.inject()` 做集成测试，不 mock 网络层
- **日志**：pino（Fastify 内置），可通过 `LOG_LEVEL` 环境变量控制

## 可视化配置管理

启动后访问 `http://127.0.0.1:8787/admin`，提供 Web 界面对配置方案进行管理：

- **配置方案（Profile）**：一组完整的服务器/Povider/路由配置，可创建多个方案
- **一键切换**：激活不同方案后，重启服务即生效
- **持久化存储**：所有方案保存在 `config-store.json`（已加入 `.gitignore`）
- **无认证**：管理页面和 `/api/admin/*` API 不需要认证令牌

启动优先级：
1. 优先读取 `config-store.json` 中标记为 `active` 的方案
2. 无活动方案时回退到内置默认配置（空路由，启动后引导 admin 页面配置）

### Admin API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/admin` | GET | 管理页面 HTML |
| `/api/admin/profiles` | GET | 列出所有方案 |
| `/api/admin/profiles` | POST | 创建方案 `{name, config}` |
| `/api/admin/profiles/:id` | PUT | 更新方案 |
| `/api/admin/profiles/:id` | DELETE | 删除方案 |
| `/api/admin/profiles/activate` | POST | 激活方案 `{id}` |

### Store 模块（`src/store.ts`）

JSON 文件持久化，零原生依赖。通过 `CONFIG_STORE_PATH` 环境变量可自定义存储路径。

## 测试

- 测试文件在 `tests/` 目录，使用 Vitest
- `tests/helpers.ts` 提供 `makeConfig()`（构造测试用 AppConfig）和 `createUpstream()`（启动临时 Fastify 实例模拟上游）
- 测试使用 `app.inject()` 发起请求，不绑定真实端口，速度快且无端口冲突
- 上游模拟也使用真实 Fastify 实例，按请求次数返回不同响应，用于测试 fallback 等场景

## New API 集成（LLM 网关）

本代理支持通过 [New API](https://github.com/QuantumNous/new-api) 网关中转，统一管理 API Key、用量统计和限流。

### 部署位置

```
/Users/qipeijun/new-api-deploy  →  Docker Compose 部署
http://localhost:3000           →  Web 管理界面
```

### 前置步骤：配置 New API 渠道

1. 启动 New API：`cd ~/new-api-deploy && docker compose up -d`
2. 打开 `http://localhost:3000`，登录管理员账号
3. 进入 **渠道管理** → 添加渠道：
   - **类型**：选择 DeepSeek 或自定义 Anthropic 兼容渠道
   - **Base URL**：`https://api.deepseek.com/anthropic`
   - **密钥**：你的 DeepSeek API Key
   - **模型**：`deepseek-v4-pro`
4. 进入 **令牌管理** → 创建一个 API Key（记下来，作为 `NEWAPI_KEY`）

### 本代理接入 New API

1. 在 `.env` 中添加：
   ```bash
   NEWAPI_KEY=sk-your-newapi-token
   ```

2. 在 `config.yaml` 中取消 `newapi` provider 注释，并把路由的 `provider` 从 `deepseek` 改为 `newapi`：
   ```yaml
   providers:
     newapi:
       type: anthropic
       baseUrl: http://127.0.0.1:3000
       apiKeyEnv: NEWAPI_KEY
       timeoutMs: 300000     # New API 内部还要转发，超时设大一些
       capabilities:
         contentBlocks:
           - text
           - tool_use
           - tool_result
           - thinking

   routes:
     - match:
         prefix: claude-sonnet
       provider: newapi       # 改为 newapi
       upstreamModel: deepseek-v4-pro
   ```

3. 重启本代理：`npm start`

### 拓扑

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐
│  Claude Code │────▶│ 本代理 :8787 │────▶│ New API:3000 │────▶│ DeepSeek Anthropic │
└──────────────┘     └──────────────┘     └──────────────┘     └───────────────────┘
                                            │  管理界面
                                            │  - API Key 管理
                                            │  - 用量统计
                                            │  - 渠道负载均衡
                                            │  - 限流控制
```

### 两种上游方案对比

| | 方案 A：直连 | 方案 B：经 New API |
|---|---|---|
| **配置复杂度** | 低，改 .env 即可 | 中，需配置 New API 渠道 |
| **Key 管理** | 手动改 .env | Web 界面，支持多 Key 轮换 |
| **用量统计** | 无 | Web 界面查看 |
| **限流/计费** | 无 | 支持 |
| **延迟** | 最低 | 多一跳 (~5ms 本地) |
| **适用场景** | 个人快速使用 | 团队共享、需要管理 |

## ccswitch 集成（Codex CLI 翻译代理）

本项目和 [ccswitch-deepseek](https://github.com/qipeijun/ccswitch-deepseek) 是两个独立的中转代理，服务不同的客户端，**可以同时运行**：

| | 本项目 (claude-code-deepseek-proxy) | ccswitch-deepseek |
|---|---|---|
| **目标客户端** | Claude Code | Codex CLI |
| **协议** | Anthropic Messages API → DeepSeek Anthropic | OpenAI Responses API → DeepSeek Chat Completions |
| **端口** | 8787 | 11435 |
| **协议层** | 直接转发，不改协议格式 | 完整协议翻译（Responses ↔ Chat Completions） |

### ccswitch 配置方法

```bash
# 1. 进入 ccswitch 项目目录
cd /Users/qipeijun/code/githubProject/ccswitch-deepseek

# 2. 配置 API Key（首次）
cp env_example .env
# 编辑 .env 文件：
#   api_key=sk-your-deepseek-api-key

# 3. 启动
npm start
# 输出示例:
#   ccswitch-deepseek started
#   http://127.0.0.1:11435/v1/responses
#   model: deepseek-v4-pro
```

ccswitch 不需要 `config.yaml`。它在 `index.js` 中硬编码了上游模型为 `deepseek-v4-pro`，端口为 `11435`。修改模型需要在 `index.js` 第 12 行的 `MODEL` 常量中改。

### Codex CLI 客户端配置

当 ccswitch 启动后，Codex CLI 自动检测 `http://127.0.0.1:11435/v1` 并使用它。不需要额外设置环境变量。

### 两代理同时运行

```
┌──────────────┐     ┌──────────────┐
│  Claude Code │────▶│ 本代理 :8787 │────▶ DeepSeek Anthropic API
└──────────────┘     └──────────────┘
┌──────────────┐     ┌──────────────┐
│  Codex CLI   │────▶│ ccswitch    │────▶ DeepSeek Chat Completions API
└──────────────┘     │ :11435       │
                     └──────────────┘
```

两端互不影响，共享同一个 DeepSeek API Key（配置在各自的 `.env` 中）。

## 日志

- 开发环境（`NODE_ENV !== "production"`）默认使用 `pino-pretty` 输出彩色人类可读日志，日志级别 `debug`
- 生产环境输出 JSON 格式日志，级别 `info`
- 通过 `LOG_LEVEL` 环境变量控制日志级别（`debug` / `info` / `warn` / `error`）
- 启动时打印配置概览 banner，包含监听地址、认证方式、上游 provider 和路由规则

## 关键约定

- 不支持的 Anthropic 内容块返回清晰错误，不做字符串拼接兜底
- 只有显式配置了 `fallback` 的路由才会在上游失败时切换
- 不自动兜底到 flash
- provider 的 `baseUrl` 和 `baseUrlEnv` 互斥，必须且只能配置一个（Zod refine 校验）
- `route.match` 的 `exact` 和 `prefix` 互斥，必须且只能配置一个
