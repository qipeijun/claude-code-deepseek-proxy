export const meta = {
  name: 'code-review-agent',
  description: '多角度代码审查：5 并行审查员 → 去重 → 对抗验证 + 爆炸半径 → 报告',
  phases: [
    { title: '审查', detail: '5 个角度并行扫描 git diff' },
    { title: '验证', detail: '对抗验证每个发现 + 爆炸半径分析' },
    { title: '报告', detail: '汇总生成审查报告' },
  ],
};

// args 为 git diff 文本字符串
const DIFF = typeof args === 'string' ? args : '';
if (!DIFF || DIFF.trim().length === 0) {
  return { report: '## Code Review Report\n\n**审查范围**：无变更（diff 为空）\n\n未发现 Bug。' };
}

// ── Structured Output Schemas ──

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: '文件路径' },
          line: { type: 'number', description: '行号' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: '严重度' },
          title: { type: 'string', description: '一句话标题' },
          summary: { type: 'string', description: '问题描述，包含根因' },
          failure_scenario: { type: 'string', description: '具体失败场景' },
        },
        required: ['file', 'severity', 'title', 'summary', 'failure_scenario'],
        additionalProperties: false,
      },
      description: '发现的问题列表，最多 8 条',
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    is_real: { type: 'boolean', description: '是否是真实存在的 Bug' },
    actual_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'false_alarm'], description: '重新评估后的真实严重度，误报则为 false_alarm' },
    reproduction: { type: 'string', description: '如何复现（如果是真实 Bug）' },
    fix_suggestion: { type: 'string', description: '最小修复方案' },
    blast_radius: {
      type: 'object',
      properties: {
        affected_callers: { type: 'array', items: { type: 'string' }, description: '受影响的调用方列表' },
        impact: { type: 'string', description: '影响范围评估' },
      },
      required: ['affected_callers', 'impact'],
      additionalProperties: false,
    },
  },
  required: ['is_real', 'actual_severity'],
  additionalProperties: false,
};

// ── Phase 1: 5 角度并行审查 ──
phase('审查');

const angles = [
  {
    key: 'A',
    name: '逐行审计',
    prompt: `你是逐行 diff 审计员。逐行审查下面的 git diff（重点关注 src/*.ts，忽略 README/admin.html/package*.json/.env* 等配置文件的变更）。

逐行检查每个变更：
- 条件反转/逻辑错误
- off-by-one 错误
- null/undefined 解引用
- 缺少 await
- falsy-zero 陷阱（0 被当作 falsy）
- 变量错用（复制粘贴残留）
- catch 块中异常被静默吞掉
- 异步代码中的竞态条件
- 资源泄漏（未关闭的连接/定时器）

最多返回 8 条发现。

Git Diff:
${DIFF}`,
  },
  {
    key: 'B',
    name: '删除行为审计',
    prompt: `你是删除行为审计员。审视下面的 git diff 中的每一行删除。

对每条删除：
1. 被删代码原本执行什么校验/守卫/行为？
2. 新代码是否重建了这个不变性？
3. 如果没重建，会造成什么后果？

与删除无关的增改行不需要关注。

最多返回 8 条发现。

Git Diff:
${DIFF}`,
  },
  {
    key: 'C',
    name: '交叉追踪',
    prompt: `你是交叉追踪审计员。检查下面 diff 中所有被修改的函数签名、新增异常、删除导出。

对每个变更的函数/类/导出：
1. 搜索项目中所有调用方/引用方
2. 变更的签名是否兼容所有调用方？
3. 新增的异常是否被所有调用方处理？
4. 删除的导出是否还有引用？
5. 是否有循环 import 风险？

你需要实际搜索代码库来验证，不要猜测。

最多返回 8 条发现。

Git Diff:
${DIFF}`,
  },
  {
    key: 'D',
    name: '语言陷阱',
    prompt: `你是 JavaScript/TypeScript 陷阱专家。审视下面的 git diff，只关注 JS/TS 特有的坑：

必查清单：
- == vs === 混用
- 闭包捕获循环变量（var 在 for 循环中）
- this 丢失（回调/事件中未 bind）
- 浮点数比较（直接 === 比较浮点数）
- 时区偏移（Date 处理未指定时区）
- 原型链污染（Object.assign / 展开运算符对原型属性的处理）
- Promise 未处理 reject（缺少 .catch 或 try/catch）
- Array 方法副作用（sort 修改原数组，splice 返回删除元素等容易误用的 API）
- JSON.parse 未 try/catch
- 正则表达式 ReDoS

不要报告类型错误（TypeScript 编译器会检查）。

最多返回 8 条发现。

Git Diff:
${DIFF}`,
  },
  {
    key: 'E',
    name: '性能盲点',
    prompt: `你是性能审计员。审视下面的 git diff，找出性能问题：

检查：
- 热路径上的重复计算（循环内重复调用、重复 JSON 解析）
- 同步阻塞 I/O（readFileSync 等在主线程中使用）
- 内存泄漏（闭包持有大对象长期不释放、事件监听器未移除）
- 连接池耗尽风险（http agent 连接数上限、未设置超时）
- N+1 查询模式
- 大对象不必要的深拷贝
- O(n^2) 算法可以用 O(n) 替代

提示：metrics.ts 的环形缓冲区 shift() 是 O(n) 操作。

最多返回 8 条发现。

Git Diff:
${DIFF}`,
  },
];

// 5 个角度并行执行，barrier 等待全部完成
const results = await parallel(
  angles.map(a => () =>
    agent(a.prompt, {
      label: `${a.key}: ${a.name}`,
      schema: FINDING_SCHEMA,
    })
  )
);

// 去重（file + line + title 相同视为重复）
const seen = new Set();
const allFindings = results
  .filter(Boolean)
  .flatMap(r => r.findings)
  .filter(f => {
    const key = `${f.file}:${f.line ?? '?'}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

log(`审查完成：5 个角度共发现 ${allFindings.length} 条（去重后）`);

if (allFindings.length === 0) {
  return {
    report: `## Code Review Report\n\n**审查范围**：${countStats(DIFF)}\n\n### 发现汇总\n\n| 严重度 | 数量 |\n|--------|------|\n| 严重 | 0 |\n| 高 | 0 |\n| 中 | 0 |\n| 低 | 0 |\n\n**未发现 Bug** ✅`,
  };
}

// ── Phase 2: 对抗验证 + 爆炸半径 ──
phase('验证');
log(`正在验证 ${allFindings.length} 条发现...`);

const verified = await parallel(
  allFindings.map(f => () =>
    agent(
      `你是独立代码审查员。请验证下面这个发现是否真实存在。

发现：
- 文件: ${f.file}
- 行号: ${f.line ?? '未知'}
- 标题: ${f.title}
- 描述: ${f.summary}
- 声称失败场景: ${f.failure_scenario}

任务：
1. 阅读文件，确认该发现是否为真实 Bug（不是误报）
2. 如果是真实 Bug，重新评估严重度（critical / high / medium / low）
3. 给出最小复现步骤
4. 给出最小修复方案
5. 搜索调用方，评估爆炸半径：如果修复此 Bug，哪些代码路径会受影响？

默认立场：宁可疑似误报判为 'false_alarm'，不要为了一致性而确认不确定的问题。

Git Diff（参考上下文）：
${DIFF.slice(0, 3000)}`,
      {
        label: `verify ${f.file}:${f.line ?? '?'}`,
        schema: VERDICT_SCHEMA,
      }
    ).then(v => ({ ...f, verdict: v }))
  )
);

// 过滤真实发现
const confirmed = verified
  .filter(Boolean)
  .filter(f => f.verdict?.is_real)
  .map(f => ({
    ...f,
    severity: f.verdict.actual_severity,
  }));

const falseAlarms = verified
  .filter(Boolean)
  .filter(f => !f.verdict?.is_real).length;

log(`验证完成：${confirmed.length} 条确认，${falseAlarms} 条误报`);

// ── Phase 3: 生成报告 ──
phase('报告');

// 按严重度排序
const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
confirmed.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

// 统计
const counts = { critical: 0, high: 0, medium: 0, low: 0 };
for (const f of confirmed) {
  counts[f.severity] = (counts[f.severity] || 0) + 1;
}

let report = `## Code Review Report\n\n`;
report += `### 审查范围\n`;
report += `- ${countStats(DIFF)}\n\n`;
report += `### 发现汇总\n\n`;
report += `| 严重度 | 数量 |\n|--------|------|\n`;
report += `| 🔴 严重 | ${counts.critical} |\n`;
report += `| 🟠 高 | ${counts.high} |\n`;
report += `| 🟡 中 | ${counts.medium} |\n`;
report += `| ⚪ 低 | ${counts.low} |\n`;
report += `| ~~误报~~ | ${falseAlarms} |\n\n`;
report += `### 详细发现\n\n`;

for (const f of confirmed) {
  const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' }[f.severity] ?? '⚪';
  report += `#### ${emoji} [${f.severity}] ${f.title}\n\n`;
  report += `| 项目 | 内容 |\n|------|------|\n`;
  report += `| **文件** | \`${f.file}\`${f.line ? `:${f.line}` : ''} |\n`;
  report += `| **根因** | ${f.summary} |\n`;
  report += `| **复现** | ${f.verdict?.reproduction || '—'} |\n`;
  report += `| **修复** | ${f.verdict?.fix_suggestion || '—'} |\n`;
  report += `| **爆炸半径** | ${f.verdict?.blast_radius?.impact || '—'} |\n`;
  if (f.verdict?.blast_radius?.affected_callers?.length > 0) {
    report += `| **受影响调用方** | ${f.verdict.blast_radius.affected_callers.map(c => `\`${c}\``).join(', ')} |\n`;
  }
  report += `\n`;
}

return { report, findings: confirmed };

// ── Helpers ──

function countStats(diff) {
  const lines = diff.split('\n');
  const files = new Set();
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const m = line.match(/[ab]\/(.+)/);
      if (m) files.add(m[1]);
    }
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return `文件数：${files.size}，改动行数：+${added} / -${removed}`;
}
