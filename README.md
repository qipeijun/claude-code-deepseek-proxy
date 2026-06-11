<p align="center">
  <img src="https://img.shields.io/badge/Node.js-≥22-00e676?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-00e676?style=flat" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Fastify-5.x-000000?style=flat&logo=fastify&logoColor=white" alt="Fastify">
</p>

<h1 align="center">Claude Code DeepSeek Proxy</h1>

<p align="center">
一个 Anthropic 协议兼容的本地中转代理，使 DeepSeek 完整驱动 Claude Code 的<br>
主 agent、子 agent 和并行 agent——含请求规范化、模型名双向映射与容灾切换。
</p>

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Claude Code │────▶│  本代理 :8787    │────▶│ DeepSeek Anthropic │
└──────────────┘     └──────────────────┘     └───────────────────┘
                            │  Web 管理后台
                            │  方案切换 · 路由配置 · 实时指标 · 版本历史
```

## 目录

- [背景](#背景)
- [快速开始](#快速开始)
- [核心能力](#核心能力)
- [项目结构](#项目结构)
- [API 参考](#api-参考)
- [上游接入方式](#上游接入方式)
- [环境变量](#环境变量)
- [开发指南](#开发指南)

## 背景

直接以 DeepSeek Anthropic API 作为 Claude Code 的 `ANTHROPIC_BASE_URL` 存在两个系统性问题：

| 问题 | 表现 | 影响范围 |
|------|------|----------|
| **请求格式冲突** | 子 agent 同时携带 `thinking: { type: "disabled" }` 与 `reasoning_effort`，DeepSeek 在校验层面将其判定为矛盾字段，返回 400 拒绝 | 所有子 agent、并行 agent 不可用 |
| **模型名不匹配** | Claude Code 以 `claude-sonnet-4-6` 发起请求，上游响应体中的 `model` 字段返回 `deepseek-v4-pro`。Claude Code 依赖响应中的模型名做后续路由决策，不认识的名称会导致状态机紊乱 | 整个会话行为异常 |

本代理在前两者之间完成请求规范化、模型名双向映射与容灾切换，使 DeepSeek 对 Claude Code 而言表现为一个透明、完整的 Anthropic 兼容后端。

## 快速开始

### 1. 安装与启动

```bash
git clone https://github.com/qipeijun/claude-code-deepseek-proxy.git
cd claude-code-deepseek-proxy
npm install
npm start
```

启动后访问 `http://127.0.0.1:8787/admin` 完成上游配置，保存后立即生效，无需重启。

一键脚本（环境检查 + 自动释放端口）：

```bash
./start.sh              # macOS / Linux 前台启动
./start.sh --dev        # 开发模式（tsx watch）
./start.sh --bg         # 后台运行，日志 → logs/proxy.log
```

### 2. 配置 Claude Code 客户端

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="你在 admin 中设置的鉴权密码"   # 未设鉴权则任意值
```

> API Key、上游地址、路由规则均在 admin Web 页面配置，持久化于 SQLite 数据库 `config-store.db`。若不希望 Key 落盘，可在 Provider 配置中将 Key 留空，改用 `apiKeyEnv` 字段引用环境变量。首次启动时自动从旧 `config-store.json` 迁移数据（如有）。

## 核心能力

### 请求规范化

Claude Code 子 agent 发起的请求中，`thinking.type === "disabled"` 与 `reasoning_effort` 同时存在。DeepSeek 的校验逻辑认为：关掉思考后不应再指定 effort 值。代理在请求发出前检测此模式并移除冲突字段，仅处理 `disabled` 场景，主 agent 的扩展思考（`enabled`）完全不受影响。

### 模型名双向映射

- **请求侧**：将外部模型名（如 `claude-sonnet-4-6`）替换为路由配置的上游模型名（如 `deepseek-v4-pro`）。
- **响应侧**：逆向还原——JSON 响应直接替换 `model` 及 `message.model` 字段；SSE 流式响应逐事件边界缓冲后改写 `data:` 行中的模型名。

### 模型路由

支持两种匹配策略：
- **exact**：完全匹配，优先级最高。
- **prefix**：前缀匹配，多个命中时取最长前缀。

无匹配路由时返回 404，格式遵循 Anthropic error schema。

### Fallback 容灾

仅在路由中显式声明 `fallback` 数组时才启用切换。触发条件：上游返回 5xx / 429，或请求异常。按 fallback 数组顺序依次尝试，全部失败后才返回错误。不做静默降级，不会自动兜底到其他模型。

### 内容块兼容性校验

发出前检查 `system` 与 `messages[].content` 中各 block 的 `type` 是否在 Provider 声明的能力范围内。不支持的类型会被过滤，同时注入提示文本告知模型该内容被省略，不会中断对话。

### 连接池管理

按上游 origin 缓存 undici Agent，复用 TCP 与 TLS 连接。槽位控制并发上限（默认 32），请求完成后释放槽位供后续使用。

### 热重载

在 admin 中保存配置方案后，代理自动加载最新配置，无需重启。

### 实时指标

内存环形缓冲区存储最近 200 条请求记录，admin 仪表盘展示请求总数、活跃连接、延迟分布、吞吐量及连接池使用率。

### 认证

支持 `Authorization: Bearer <token>` 与 `x-api-key: <token>` 两种方式。鉴权密码在 admin 中配置，或通过 `authTokenEnv` 引用环境变量。`/healthz` 及管理 API 端点跳过认证。

### 版本历史

每次保存时自动记录方案快照，可在 admin 中预览历史版本 JSON 或一键回滚。

## 项目结构

```
src/
├── index.ts              入口 — 加载配置 → 构建服务器 → 监听端口
├── server.ts              Fastify 服务器 — 路由注册、认证、代理 + fallback 编排
├── killPort.ts            启动前释放端口（lsof -sTCP:LISTEN → kill + 轮询验证）
├── types.ts               Zod schema 定义
├── errors.ts              ProxyError + Anthropic 格式错误响应
├── util.ts                工具函数
├── config/
│   ├── config.ts          Provider 解析（baseUrl / apiKey / apiKeyEnv）
│   ├── defaultConfig.ts   内置默认配置（空路由，引导到 admin 页面）
│   ├── liveConfig.ts      运行时配置管理 — 热重载 + 模块级可变引用
│   └── store.ts           持久化存储 — SQLite（better-sqlite3）WAL 模式 + 事务保护
├── proxy/
│   ├── router.ts          模型路由 — exact > prefix > 最长前缀优先
│   ├── http.ts            上游 HTTP — undici Agent 连接池 + AbortController 超时
│   ├── modelRewrite.ts    模型名映射 — 请求替换 / 响应还原（JSON + SSE 流）
│   ├── contentBlocks.ts   内容块校验 — 不支持类型过滤 + 提示注入
│   ├── requestNormalize.ts 请求规范化 — 清洗子 agent 矛盾字段
│   └── metrics.ts          实时指标 — 环形缓冲区 + 延迟 / 吞吐量统计
└── admin/
    ├── admin.html          管理后台页面
    ├── adminRoutes.ts      Admin API — 方案 CRUD + 上游模型查询 + 热重载
    ├── adminStatic.ts      静态文件服务（页面及 JS 预加载至内存）
    ├── style.css           管理后台样式（工业终端风格）
    └── js/                 前端逻辑模块
```

## API 参考

### Anthropic Messages 代理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/messages` | POST | Messages API（含 SSE 流式） |
| `/v1/messages/count_tokens` | POST | Token 计数 |
| `/v1/models` | GET | 列出可用模型 |
| `/healthz` | GET | 健康检查 |

### 管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/admin` | GET | 管理后台页面 |
| `/api/admin/profiles` | GET / POST | 列出 / 创建配置方案 |
| `/api/admin/profiles/:id` | PUT / DELETE | 更新 / 删除方案 |
| `/api/admin/profiles/activate` | POST | 激活方案 |
| `/api/admin/profiles/:id/history` | GET | 方案版本历史 |
| `/api/admin/profiles/:id/rollback` | POST | 回滚到历史版本 |
| `/api/admin/upstream-models` | POST | 查询上游可用模型 |
| `/api/admin/metrics` | GET | 实时性能指标 |
| `/api/admin/reload` | POST | 热重载配置 |
| `/api/admin/kill-port` | POST | 释放当前端口 |

## 上游接入方式

### 方案 A：直连 DeepSeek（推荐）

延迟最低，一跳直达。在 admin 中填入 `https://api.deepseek.com/anthropic` 及 API Key 即可。

### 方案 B：经 New API 网关

需要统一管理 Key、用量统计或团队限流时，可前置 [New API](https://github.com/QuantumNous/new-api)：

```
Claude Code → 本代理 :8787 → New API :3000 → DeepSeek Anthropic
```

在 New API 中添加 DeepSeek 渠道后，将本代理的 Provider 地址设为 `http://127.0.0.1:3000`，Key 填入 New API 令牌。多一跳约增加 5ms 本地延迟。

### 与 ccswitch 并行运行

[ccswitch-deepseek](https://github.com/qipeijun/ccswitch-deepseek) 是面向 Codex CLI 的协议翻译代理（OpenAI Responses → DeepSeek Chat Completions），监听 `11435` 端口。两者可同时运行，共享同一 DeepSeek Key，互不影响。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | `production` 时输出 JSON 格式日志 | — |
| `LOG_LEVEL` | 日志级别 | `info` |
| `CONFIG_STORE_PATH` | SQLite 数据库文件路径 | `./config-store.db` |
| `CONFIG_STORE_MIGRATE_FROM` | 旧 JSON 配置文件路径（仅首次 SQLite 迁移时使用） | `./config-store.json` |
| `UPSTREAM_MAX_CONNECTIONS` | 上游连接池上限 | `32` |

## 开发指南

```bash
npm install          # 安装依赖
npm start            # 直接启动（tsx）
npm run dev          # 开发模式（tsx watch）
npm run build        # TypeScript 编译至 dist/
npm test             # 运行全部测试（vitest）
npm run test:watch   # 测试 watch 模式
npm run typecheck    # 仅类型检查
```

**技术栈**：Node.js ≥ 22 · Fastify 5 · undici 7 · Zod · Vitest · pino · TypeScript，ESM。

测试使用 Fastify 的 `app.inject()` 发起请求，不绑定真实端口，无端口冲突。

## License

MIT © [qipeijun](https://github.com/qipeijun)
