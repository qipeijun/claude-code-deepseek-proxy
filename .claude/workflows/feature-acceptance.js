export const meta = {
  name: 'feature-acceptance',
  description: '功能验收：并行调度代码审查 + 产品设计专家 → 交叉验证 → 验收报告',
  phases: [
    { title: '审查', detail: '代码审查 + 产品设计并行验收' },
    { title: '报告', detail: '交叉验证 + 汇总验收报告' },
  ],
};

// args: { criteria: [{id, item, source, verifyMethod}], codeLocations: string[], projectType: "frontend"|"backend"|"fullstack" }
const { criteria = [], codeLocations = [], projectType = 'fullstack' } = (typeof args === 'object' && args !== null) ? args : {};

if (criteria.length === 0) {
  return { report: '## 验收报告\n\n**状态**：无法执行\n\n未提供验收标准。请从对话上下文中提取验收清单后再试。' };
}

const codeLocationStr = codeLocations.length > 0
  ? `\n代码位置：${codeLocations.join(', ')}`
  : '';

const criteriaText = criteria.map((c, i) =>
  `${i + 1}. ${c.item}（来源：${c.source}，验证方法：${c.verifyMethod}）`
).join('\n');

const baseContext = `以下是需要验收的功能的验收标准：

${criteriaText}
${codeLocationStr}

请逐条核对每个验收项，标注是否通过。额外发现的问题单独标注为"额外发现"。
`;

// ── Schemas ──

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'array', items: { type: 'number' }, description: '通过的验收项编号列表' },
    failed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criteriaId: { type: 'number', description: '验收项编号' },
          issue: { type: 'string', description: '具体问题描述' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'], description: 'blocking=阻塞上线, major=重要问题, minor=小问题' },
          reproduction: { type: 'string', description: '复现步骤或证据' },
        },
        required: ['criteriaId', 'issue', 'severity'],
      },
      description: '未通过的验收项',
    },
    extra_findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          location: { type: 'string', description: '文件位置' },
        },
        required: ['title', 'description'],
      },
      description: '超出验收范围的额外发现',
    },
  },
  required: ['passed', 'failed', 'extra_findings'],
};

const PRODUCT_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'array', items: { type: 'number' }, description: '通过的验收项编号列表' },
    failed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criteriaId: { type: 'number' },
          issue: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
        },
        required: ['criteriaId', 'issue'],
      },
    },
    ux_issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          scenario: { type: 'string', description: '出问题的交互场景' },
        },
        required: ['title', 'description'],
      },
      description: '交互/体验层面的额外发现',
    },
    edge_cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: '边界场景描述' },
          risk: { type: 'string', description: '未处理的风险' },
        },
        required: ['scenario', 'risk'],
      },
      description: '未覆盖的边界场景',
    },
  },
  required: ['passed', 'failed', 'ux_issues', 'edge_cases'],
};

// ── Phase 1: 并行验收 ──
phase('审查');

const reviewers = [];

// 代码视角：按项目类型选择审查专家
if (projectType === 'frontend' || projectType === 'fullstack') {
  reviewers.push({
    key: 'frontend-review',
    label: '前端代码审查',
    agentType: '前端代码审查专家',
    prompt: `你是前端代码审查专家。${baseContext}
请审查前端代码实现，重点关注：组件设计、类型安全、异步逻辑、接口异常处理、样式隔离。
对于每个验收项，如果代码实现正确则标记为通过；如果存在问题，标记为未通过并给出具体问题描述。`,
    schema: REVIEW_SCHEMA,
  });
}

if (projectType === 'backend' || projectType === 'fullstack') {
  reviewers.push({
    key: 'backend-review',
    label: '通用代码审查',
    agentType: '通用代码审查专家',
    prompt: `你是通用代码审查专家。${baseContext}
请审查后端/脚本代码实现，重点关注：逻辑正确性、错误处理、并发安全、数据安全、接口契约。
对于每个验收项，如果代码实现正确则标记为通过；如果存在问题，标记为未通过并给出具体问题描述。`,
    schema: REVIEW_SCHEMA,
  });
}

// 产品视角
reviewers.push({
  key: 'product-review',
  label: '产品设计审查',
  agentType: '产品设计专家',
  prompt: `你是产品设计专家。${baseContext}
请从产品视角审查，重点关注：
1. 交互状态是否完整（加载中、空状态、错误状态、边界情况）
2. 用户路径是否通畅（是否有死胡同、是否缺少返回/取消）
3. 字段规则是否合理（必填/选填、校验规则、默认值）
4. 文案是否清晰（按钮、提示、错误消息）
对于每个验收项，从用户体验角度判断是否达标。`,
  schema: PRODUCT_REVIEW_SCHEMA,
});

log(`启动 ${reviewers.length} 个专家并行验收...`);

const results = await parallel(
  reviewers.map(r => () =>
    agent(r.prompt, {
      label: r.label,
      agentType: r.agentType,
      schema: r.schema,
    })
  )
);

// ── Phase 2: 汇总报告 ──
phase('报告');

// 收集所有结果
const allFailed = [];
const allExtraFindings = [];
const allUxIssues = [];
const allEdgeCases = [];
const passedSet = new Set();

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (!r) continue;
  const reviewer = reviewers[i];

  if (reviewer.key === 'product-review') {
    if (r.passed) r.passed.forEach(id => passedSet.add(id));
    if (r.failed) allFailed.push(...r.failed.map(f => ({ ...f, source: '产品设计专家' })));
    if (r.ux_issues) allUxIssues.push(...r.ux_issues);
    if (r.edge_cases) allEdgeCases.push(...r.edge_cases);
  } else {
    if (r.passed) r.passed.forEach(id => passedSet.add(id));
    if (r.failed) allFailed.push(...r.failed.map(f => ({ ...f, source: reviewer.label })));
    if (r.extra_findings) allExtraFindings.push(...r.extra_findings.map(f => ({ ...f, source: reviewer.label })));
  }
}

// 去重 passed（两个审查员都通过才算通过）
const codeReviewers = reviewers.filter(r => r.key !== 'product-review');
const codePassedSets = results
  .filter((_, i) => reviewers[i].key !== 'product-review')
  .map(r => r ? new Set(r.passed || []) : new Set());

const trulyPassed = new Set<number>();
for (const id of passedSet) {
  // 代码审查专家全部通过才算通过
  if (codePassedSets.every(s => s.has(id))) {
    trulyPassed.add(id);
  } else if (codePassedSets.some(s => !s.has(id))) {
    // 有代码审查专家没通过，从产品通过的里面也移除
    // （已经在上面的 allFailed 里了）
  }
}

// 统计
const totalCriteria = criteria.length;
const passedCount = trulyPassed.size;
const blocking = allFailed.filter(f => f.severity === 'blocking');
const blockingExtra = allExtraFindings.filter(f => f.severity === 'blocking');
const hasBlocking = blocking.length > 0 || blockingExtra.length > 0;

// 构建报告
let report = `## 验收结论\n\n`;
report += `- **状态**：${hasBlocking ? '🔴 不通过' : passedCount === totalCriteria ? '🟢 通过' : '🟡 有条件通过'}\n`;
report += `- **验收项总数**：${totalCriteria}  |  通过：${passedCount}  |  未通过：${totalCriteria - passedCount}\n`;
if (hasBlocking) {
  report += `- **阻塞问题**：${blocking.length + blockingExtra.length} 条（必须修才能上线）\n`;
}
report += `\n`;

// 验收标准逐项核对
report += `## 验收标准逐项核对\n\n`;
report += `| # | 验收项 | 来源 | 状态 |\n`;
report += `|---|--------|------|------|\n`;
for (let i = 0; i < criteria.length; i++) {
  const c = criteria[i];
  const id = i + 1;
  const pass = trulyPassed.has(id);
  const failedItems = allFailed.filter(f => f.criteriaId === id);
  const status = pass ? '✅ 通过' : failedItems.length > 0 ? `❌ 未通过（${failedItems.map(f => f.source).join('、')}）` : '⚠️ 待确认';
  report += `| ${id} | ${c.item} | ${c.source} | ${status} |\n`;
}
report += `\n`;

// 未通过详情
if (allFailed.length > 0) {
  report += `## 未通过详情\n\n`;
  for (const f of allFailed) {
    const c = criteria[f.criteriaId - 1];
    const emoji = f.severity === 'blocking' ? '🔴' : f.severity === 'major' ? '🟠' : '🟡';
    report += `### ${emoji} 验收项 #${f.criteriaId}：${c?.item || '未知'}\n\n`;
    report += `- **来源**：${f.source}\n`;
    report += `- **严重度**：${f.severity}\n`;
    report += `- **问题**：${f.issue}\n`;
    if (f.reproduction) report += `- **复现**：${f.reproduction}\n`;
    report += `\n`;
  }
}

// 额外发现
if (allExtraFindings.length > 0) {
  report += `## 🔵 额外发现（超出验收范围）\n\n`;
  report += `| # | 问题 | 严重度 | 来源 | 位置 |\n`;
  report += `|---|------|--------|------|------|\n`;
  allExtraFindings.forEach((f, i) => {
    const emoji = f.severity === 'blocking' ? '🔴' : f.severity === 'major' ? '🟠' : '🟡';
    report += `| ${i + 1} | ${emoji} ${f.title}：${f.description} | ${f.severity} | ${f.source} | ${f.location || '—'} |\n`;
  });
  report += `\n`;
}

// 交互体验问题
if (allUxIssues.length > 0) {
  report += `## 🟡 交互/体验问题\n\n`;
  for (const u of allUxIssues) {
    report += `- **${u.title}**：${u.description}`;
    if (u.scenario) report += `（场景：${u.scenario}）`;
    report += `\n`;
  }
  report += `\n`;
}

// 边界场景
if (allEdgeCases.length > 0) {
  report += `## ⚠️ 未覆盖的边界场景\n\n`;
  for (const e of allEdgeCases) {
    report += `- **${e.scenario}**：${e.risk}\n`;
  }
  report += `\n`;
}

return {
  report,
  summary: {
    status: hasBlocking ? 'fail' : passedCount === totalCriteria ? 'pass' : 'conditional',
    totalCriteria,
    passed: passedCount,
    failed: totalCriteria - passedCount,
    blockingCount: blocking.length + blockingExtra.length,
    extraFindings: allExtraFindings.length,
    uxIssues: allUxIssues.length,
    edgeCases: allEdgeCases.length,
  },
};
