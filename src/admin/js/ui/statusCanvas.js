/* ═══════════════════════════════════════════════════════
   Status Banner Canvas — 光纤核心
   零依赖，原生 Canvas 2D
   ═══════════════════════════════════════════════════════ */

let canvas, ctx, w, h, animId;

// 光纤束：3-6 条水平线均匀分布
let strands = [];
// 光脉冲：在光纤上高速滑行的亮斑
let pulses = [];
// 火花：脉冲经过节点时爆发的小粒子
let sparks = [];

const STRAND_MIN = 3;
const STRAND_MAX = 6;
const PULSE_MAX = 10;
const SPARK_LIFE = 600; // ms

function rand(a, b) { return a + Math.random() * (b - a); }

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  w = rect.width;
  h = rect.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 重新分布光纤束
  const count = STRAND_MIN + Math.floor(Math.random() * (STRAND_MAX - STRAND_MIN + 1));
  strands = [];
  for (let i = 0; i < count; i++) {
    strands.push({ y: (h / (count + 1)) * (i + 1) });
  }
  pulses = [];
  sparks = [];
}

/** 生成一个光脉冲 */
function spawnPulse() {
  if (!strands.length) return;
  const s = strands[Math.floor(Math.random() * strands.length)];
  pulses.push({
    y: s.y,
    x: -20,
    speed: rand(0.6, 2.5),          // px/frame
    radius: rand(2, 4.5),
    alpha: rand(0.5, 0.9),
    sparkTimer: rand(800, 2500),     // 经过多久后爆发火花
    elapsed: 0,
  });
}

/** 在脉冲位置爆发火花粒子 */
function burstSparks(px, py) {
  const count = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const angle = rand(-0.6, 0.6) + (Math.random() < 0.5 ? Math.PI : 0); // 水平方向为主
    const vel = rand(0.3, 2.0);
    sparks.push({
      x: px, y: py,
      vx: Math.cos(angle) * vel,
      vy: Math.sin(angle) * vel,
      life: SPARK_LIFE,
      born: performance.now(),
      size: rand(0.6, 1.5),
    });
  }
}

/** 绘制光纤束（微弱的静态背景线） */
function drawStrands() {
  for (const s of strands) {
    ctx.beginPath();
    ctx.moveTo(0, s.y);
    ctx.lineTo(w, s.y);
    ctx.strokeStyle = 'rgba(0,230,118,0.04)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

/** 绘制单个光脉冲的辉光 */
function drawPulseGlow(x, y, radius, alpha) {
  // 外层大辉光
  const g1 = ctx.createRadialGradient(x, y, 0, x, y, radius * 6);
  g1.addColorStop(0, `rgba(0,255,140,${(alpha * 0.7).toFixed(3)})`);
  g1.addColorStop(0.3, `rgba(0,230,118,${(alpha * 0.35).toFixed(3)})`);
  g1.addColorStop(0.7, `rgba(0,230,118,0.02)`);
  g1.addColorStop(1, 'rgba(0,230,118,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);

  // 内核白热点
  const g2 = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g2.addColorStop(0, `rgba(255,255,255,${(alpha * 0.9).toFixed(3)})`);
  g2.addColorStop(0.4, `rgba(0,255,160,${(alpha * 0.8).toFixed(3)})`);
  g2.addColorStop(1, `rgba(0,230,118,0)`);
  ctx.fillStyle = g2;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** 绘制水平光晕拖尾 */
function drawTrail(x, y, radius, alpha) {
  const trailLen = radius * 8;
  const g = ctx.createLinearGradient(x - trailLen, y, x, y);
  g.addColorStop(0, 'rgba(0,230,118,0)');
  g.addColorStop(0.6, `rgba(0,230,118,${(alpha * 0.15).toFixed(3)})`);
  g.addColorStop(1, `rgba(0,230,118,${(alpha * 0.5).toFixed(3)})`);
  ctx.beginPath();
  ctx.moveTo(x - trailLen, y);
  ctx.lineTo(x, y);
  ctx.strokeStyle = g;
  ctx.lineWidth = radius * 0.8;
  ctx.stroke();
}

function tick() {
  ctx.clearRect(0, 0, w, h);
  const now = performance.now();

  drawStrands();

  // 生成脉冲
  if (pulses.length < PULSE_MAX && Math.random() < 0.04) {
    spawnPulse();
  }

  // 更新 & 绘制脉冲
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.x += p.speed;
    p.elapsed += 16.67; // ~60fps

    if (p.x > w + 30) {
      pulses.splice(i, 1);
      continue;
    }

    // 火花计时
    if (p.elapsed > p.sparkTimer) {
      burstSparks(p.x, p.y);
      p.sparkTimer = 999999; // 只爆发一次
    }

    drawTrail(p.x, p.y, p.radius, p.alpha);
    drawPulseGlow(p.x, p.y, p.radius, p.alpha);
  }

  // 更新 & 绘制火花
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    const age = now - s.born;
    if (age > s.life) {
      sparks.splice(i, 1);
      continue;
    }
    s.x += s.vx;
    s.y += s.vy;
    const fade = 1 - age / s.life;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size * fade, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,255,160,${(fade * 0.8).toFixed(3)})`;
    ctx.shadowColor = '#00e676';
    ctx.shadowBlur = 4 * fade;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  animId = requestAnimationFrame(tick);
}

export function startStatusCanvas() {
  canvas = document.getElementById('statusCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  animId = requestAnimationFrame(tick);
}

export function stopStatusCanvas() {
  if (animId) cancelAnimationFrame(animId);
  window.removeEventListener('resize', resize);
  pulses = [];
  sparks = [];
  strands = [];
}
