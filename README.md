# Claude Code DeepSeek Proxy

一个面向 Claude Code 的 Anthropic 兼容中转服务，用来把 Claude Code 主 agent 和子 agent 的模型请求显式路由到 DeepSeek `deepseek-v4-pro` 或其他 Anthropic 兼容上游。

## 快速开始

```bash
cp config.example.yaml config.yaml
npm install
export LOCAL_PROXY_API_KEY="local-secret"
export DEEPSEEK_API_KEY="sk-..."
npm run dev
```

Claude Code 侧配置：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_API_KEY="local-secret"
```

## 接口

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- `GET /v1/models`
- `GET /healthz`

## 配置原则

- `config.yaml` 只放路由和环境变量名称，不直接保存密钥。
- `routes` 支持 `exact` 和 `prefix`，`exact` 优先于 `prefix`，更长的 `prefix` 优先。
- 只有显式配置了 `fallback` 的路由才会在上游失败时切换，不自动兜底到 flash。
- 不支持的 Anthropic 内容块会返回清晰错误，不做字符串拼接兜底。
