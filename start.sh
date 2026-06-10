#!/usr/bin/env bash
# ──────────────────────────────────────────────
# claude-code-deepseek-proxy 一键启动脚本
# 支持 macOS / Linux
# ──────────────────────────────────────────────
set -euo pipefail

# ── 默认值 ──
PORT=8787
HOST="127.0.0.1"
MODE="start"       # start | dev
KILL_PORT=false
BACKGROUND=false
DRY_RUN=false
LOG_DIR="./logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 帮助信息 ──
usage() {
  cat <<EOF
用法: ./start.sh [选项]

选项:
  --dev           开发模式，文件变更自动重启（tsx watch）
  --kill-port     启动前强制释放端口 ${PORT}
  --bg            后台运行，日志写入 ${LOG_DIR}/
  --dry-run       仅检查环境，不实际启动
  -h, --help      显示帮助信息

示例:
  ./start.sh                    # 前台启动
  ./start.sh --dev              # 开发模式
  ./start.sh --bg               # 后台运行
  ./start.sh --kill-port --dev  # 释放端口后开发模式启动
EOF
  exit 0
}

# ── 参数解析 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)          MODE="dev" ;;
    --kill-port)    KILL_PORT=true ;;
    --bg|--background) BACKGROUND=true ;;
    --dry-run)      DRY_RUN=true ;;
    -h|--help)      usage ;;
    *)              echo -e "${RED}未知参数: $1${NC}"; echo; usage ;;
  esac
  shift
done

# ── 工具函数 ──
check_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
check_err()  { echo -e "  ${RED}✗${NC} $1"; }

# ── 查找占用端口的 PID（兼容多种平台） ──
find_port_pid() {
  local port=$1

  # 优先使用 lsof（macOS / Linux）—— 只查 LISTEN 状态，排除客户端连接
  # macOS 用 -sTCP:LISTEN，Linux 也可用；都支持该语法
  if command -v lsof &>/dev/null; then
    local pids
    pids=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids"
      return 0
    fi
  fi

  # Linux: 尝试 ss（iproute2，比 netstat 更现代）
  if command -v ss &>/dev/null; then
    local pid
    pid=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1 || true)
    if [ -n "$pid" ]; then
      echo "$pid"
      return 0
    fi
  fi

  # Linux: 尝试 /proc/net/tcp
  if [ -f /proc/net/tcp ]; then
    local hex_port
    hex_port=$(printf '%04X' "$port")
    local inode
    inode=$(awk -v hp="$hex_port" '$2 ~ hp {print $10}' /proc/net/tcp 2>/dev/null | head -1 || true)
    if [ -n "$inode" ]; then
      # 从 /proc/*/fd 反查 inode 获得 PID
      for proc_dir in /proc/[0-9]*; do
        if [ -d "$proc_dir/fd" ]; then
          if ls -l "$proc_dir/fd" 2>/dev/null | grep -q "socket:\[$inode\]"; then
            basename "$proc_dir"
            return 0
          fi
        fi
      done
    fi
  fi

  # macOS fallback: netstat
  if command -v netstat &>/dev/null; then
    local pid
    pid=$(netstat -anv -p tcp 2>/dev/null | grep ".$port " | awk '{print $9}' | head -1 || true)
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      echo "$pid"
      return 0
    fi
  fi

  return 1
}

# ── 释放端口占用 ──
kill_port() {
  local port=$1
  local pids
  pids=$(find_port_pid "$port" 2>/dev/null || true)

  if [ -z "$pids" ]; then
    check_ok "端口 ${port} 空闲"
    return 0
  fi

  check_warn "端口 ${port} 被进程 $(echo $pids | tr '\n' ' ')占用，正在释放..."

  for pid in $pids; do
    # 先尝试 kill（SIGTERM），1 秒后未退出再 kill -9
    if kill "$pid" 2>/dev/null; then
      sleep 0.3
      if kill -0 "$pid" 2>/dev/null; then
        # 进程未响应 SIGTERM，强制终止
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done

  sleep 0.5

  # 验证是否已释放
  local still
  still=$(find_port_pid "$port" 2>/dev/null || true)
  if [ -n "$still" ]; then
    check_err "端口 ${port} 释放失败（残留进程: $(echo $still | tr '\n' ' ')）"
    echo "  你可能需要 sudo 权限来释放该端口"
    return 1
  fi

  check_ok "端口 ${port} 已释放"
  return 0
}

# ── 预检 ──
echo -e "${CYAN}── 环境检查 ──${NC}"

# Node.js
if ! command -v node &>/dev/null; then
  check_err "未找到 Node.js，请先安装 Node.js >= 22"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  check_err "Node.js 版本过低：$(node -v)，要求 >= 22"
  echo "  建议: nvm install 22 && nvm use 22"
  exit 1
fi
check_ok "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  check_err "未找到 npm"
  exit 1
fi
check_ok "npm $(npm -v)"

# node_modules
if [ ! -d "node_modules" ]; then
  check_err "node_modules 不存在，请先运行 npm install"
  exit 1
fi
check_ok "node_modules 已安装"

# tsx（--no-install 避免触发交互式安装提示）
if ! npx --no-install tsx --version &>/dev/null; then
  check_err "tsx 不可用，请先运行 npm install"
  exit 1
fi
check_ok "tsx 可用"

# 端口检查 / 释放
if $KILL_PORT; then
  kill_port "$PORT" || exit 1
else
  PORT_PID=$(find_port_pid "$PORT" 2>/dev/null || true)
  if [ -n "$PORT_PID" ]; then
    check_err "端口 ${PORT} 已被进程 $(echo $PORT_PID | tr '\n' ' ') 占用"
    echo "  使用 --kill-port 自动释放，或手动 kill $(echo $PORT_PID | tr '\n' ' ')"
    exit 1
  fi
  check_ok "端口 ${PORT} 空闲"
fi

# ── dry-run ──
if $DRY_RUN; then
  echo ""
  echo -e "${GREEN}环境检查通过，可以启动。${NC}"
  if $BACKGROUND; then
    echo "启动模式: 后台运行，日志 -> ${LOG_DIR}/proxy.log"
  else
    echo "启动模式: 前台运行"
  fi
  echo "启动命令: npx tsx src/index.ts --kill-port"
  exit 0
fi

# ── 构建启动命令 ──
CMD_ARGS=("tsx")
if [ "$MODE" = "dev" ]; then
  CMD_ARGS+=("watch")
fi
CMD_ARGS+=("src/index.ts")
if $KILL_PORT; then
  CMD_ARGS+=("--kill-port")
fi

# ── 后台模式 ──
if $BACKGROUND; then
  mkdir -p "$LOG_DIR"
  LOG_FILE="$LOG_DIR/proxy.log"
  PID_FILE="$LOG_DIR/proxy.pid"

  echo -e "${CYAN}── 后台启动 ──${NC}"
  # nohup + & 是 POSIX 兼容的后台化方式，跨 macOS/Linux 通用
  nohup npx "${CMD_ARGS[@]}" > "$LOG_FILE" 2>&1 &
  PID=$!
  echo $PID > "$PID_FILE"

  sleep 1
  if kill -0 $PID 2>/dev/null; then
    check_ok "代理已启动 (PID: $PID)"
    echo ""
    echo -e "  管理后台: ${CYAN}http://${HOST}:${PORT}/admin${NC}"
    echo -e "  日志文件: ${LOG_FILE}"
    echo -e "  PID 文件: ${PID_FILE}"
    echo ""
    echo -e "  停止服务: kill $PID"
  else
    check_err "启动失败，请查看日志: $LOG_FILE"
    exit 1
  fi
else
  # ── 前台模式 ──
  echo -e "${CYAN}── 启动服务 ──${NC}"
  echo -e "  代理地址: ${GREEN}http://${HOST}:${PORT}${NC}"
  echo -e "  管理后台: ${GREEN}http://${HOST}:${PORT}/admin${NC}"
  if [ "$MODE" = "dev" ]; then
    echo -e "  模式:     开发模式（文件变更自动重启）"
  fi
  echo ""
  echo -e "  按 ${YELLOW}Ctrl+C${NC} 停止服务"
  echo ""

  exec npx "${CMD_ARGS[@]}"
fi
