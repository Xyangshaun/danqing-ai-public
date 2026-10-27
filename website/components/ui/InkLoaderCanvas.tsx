'use client';

import { useEffect, useRef } from 'react';

/**
 * 物理水墨入场动画 Canvas 渲染器
 *
 * 基于参考图效果重新设计:
 * - 墨滴从屏幕顶部受重力下落,遵循抛物线运动
 * - 撞击水面瞬间产生同心扩散波纹,波纹受粘度阻尼衰减
 * - 中心形成高浓度墨团,边缘羽化(模拟宣纸/水墨晕染)
 * - 4 颗卫星墨滴以不同质量/初速度飞溅,遵循动量守恒
 * - 底部拖出两条流动墨线(模拟水中墨丝扩散)
 * - 红色印章/品牌标识从墨团中浮现
 *
 * 物理参数全部集中在 PHYSICS_CONFIG 中,便于调优与对比。
 */

/* ================================================================
   物理参数配置
   ================================================================ */
const PHYSICS_CONFIG = {
  gravity: 9.8 * 600,          // px/s², 墨滴受重力加速度
  dropMass: 1.0,               // 墨滴质量 (kg, 相对单位)
  dropRestitution: 0.35,       // 水面碰撞恢复系数 (0-1, 越小能量损失越多)
  waterDrag: 0.96,             // 水中运动阻力系数 (每帧速度衰减)
  splashViscosity: 2.8,        // 墨团扩散粘度 (越大扩散越慢)
  splashDecay: 0.42,           // 墨团浓度衰减速率
  rippleSpeed: 260,            // 波纹扩散速度 px/s
  rippleDamping: 0.85,         // 波纹振幅衰减系数
  satelliteCount: 4,           // 卫星墨滴数量
  satelliteMassMin: 0.15,      // 卫星墨滴最小质量
  satelliteMassMax: 0.35,      // 卫星墨滴最大质量
  satelliteSpeedMin: 90,       // 飞溅最小初速度 px/s
  satelliteSpeedMax: 190,      // 飞溅最大初速度 px/s
  trailViscosity: 1.8,         // 墨丝拖尾粘度
  frameRateCap: 60,            // 最高帧率
};

/* 动画阶段 */
type Phase = 'falling' | 'impact' | 'diffusing' | 'ending';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  opacity: number;
  life: number;
  maxLife: number;
}

interface Ripple {
  radius: number;
  amplitude: number; // 0-1
  width: number;
}

interface Trail {
  points: { x: number; y: number; width: number }[];
  opacity: number;
  life: number;
  maxLife: number;
}

interface InkState {
  startedAt: number;
  lastTime: number;
  phase: Phase;
  dropY: number;
  dropVy: number;
  dropRadius: number;
  splashRadius: number;
  splashOpacity: number;
  ripples: Ripple[];
  satellites: Particle[];
  trails: Trail[];
  brandOpacity: number;
  impactTime: number;
  width: number;
  height: number;
  dpr: number;
}

export interface InkLoaderCanvasProps {
  phase: 'animating' | 'fading';
}

export function InkLoaderCanvas({ phase }: InkLoaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const stateRef = useRef<InkState>({
    startedAt: -1,
    lastTime: -1,
    phase: 'falling',
    dropY: -120,
    dropVy: 0,
    dropRadius: 10,
    splashRadius: 0,
    splashOpacity: 1,
    ripples: [],
    satellites: [],
    trails: [],
    brandOpacity: 0,
    impactTime: -1,
    width: 0,
    height: 0,
    dpr: 1,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stateRef.current.dpr = dpr;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      stateRef.current.width = w;
      stateRef.current.height = h;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    // 初始化卫星墨滴(角度均分,距离/质量随机)
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const satellites: Particle[] = [];
    for (let i = 0; i < PHYSICS_CONFIG.satelliteCount; i++) {
      const angle = (i / PHYSICS_CONFIG.satelliteCount) * Math.PI * 2 + Math.random() * 0.4;
      const mass = PHYSICS_CONFIG.satelliteMassMin +
        Math.random() * (PHYSICS_CONFIG.satelliteMassMax - PHYSICS_CONFIG.satelliteMassMin);
      const speed = PHYSICS_CONFIG.satelliteSpeedMin +
        Math.random() * (PHYSICS_CONFIG.satelliteSpeedMax - PHYSICS_CONFIG.satelliteSpeedMin);
      satellites.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        mass,
        radius: 4 + mass * 16,
        opacity: 0,
        life: 0,
        maxLife: 1.2 + Math.random() * 0.6,
      });
    }
    stateRef.current.satellites = satellites;

    // 初始化底部墨丝拖尾
    stateRef.current.trails = [
      createTrail(centerX - 40, centerY + 35, -1),
      createTrail(centerX + 50, centerY + 45, 1),
    ];

    const startTime = performance.now();
    stateRef.current.startedAt = startTime;
    stateRef.current.lastTime = startTime;

    const render = (time: number) => {
      const state = stateRef.current;
      const dt = Math.min((time - state.lastTime) / 1000, 0.05); // 限制最大步长,避免卡顿突变
      state.lastTime = time;

      updatePhysics(state, dt);
      draw(ctx, state);

      if (phase !== 'fading') {
        rafRef.current = requestAnimationFrame(render);
      } else {
        // 淡出阶段继续渲染一帧,利用 canvas 自身 opacity 由父级控制
        rafRef.current = requestAnimationFrame(render);
      }
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      style={{ opacity: phase === 'fading' ? 0 : 1, transition: 'opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
    />
  );
}

function createTrail(x: number, y: number, direction: number): Trail {
  const points = [];
  const segments = 18;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: x + direction * (t * t * 180),
      y: y + Math.sin(t * Math.PI * 0.9) * 28 + t * 40,
      width: 14 * (1 - t) + 2,
    });
  }
  return { points, opacity: 0, life: 0, maxLife: 2.0 };
}

function updatePhysics(state: InkState, dt: number) {
  const { width, height } = state;
  const centerX = width / 2;
  const centerY = height / 2;
  const elapsed = (state.lastTime - state.startedAt) / 1000;

  // 阶段 1: 墨滴坠落
  if (state.phase === 'falling') {
    state.dropVy += PHYSICS_CONFIG.gravity * dt;
    state.dropY += state.dropVy * dt;

    // 撞击水面判断(中心线)
    if (state.dropY >= centerY) {
      state.dropY = centerY;
      state.phase = 'impact';
      state.impactTime = state.lastTime;

      // 根据撞击速度计算初始 splash 半径(动量 → 扩散能量)
      const impactEnergy = 0.5 * PHYSICS_CONFIG.dropMass * state.dropVy * state.dropVy;
      state.splashRadius = 18 + Math.sqrt(impactEnergy) * 0.012;

      // 生成同心波纹
      for (let i = 0; i < 3; i++) {
        state.ripples.push({
          radius: 10 + i * 8,
          amplitude: 0.9 - i * 0.22,
          width: 3 - i * 0.6,
        });
      }

      // 激活卫星墨滴
      state.satellites.forEach((p) => {
        p.opacity = 1;
      });

      // 激活拖尾
      state.trails.forEach((t) => {
        t.opacity = 1;
      });
    }
  }

  // 阶段 2/3: 扩散
  if (state.phase === 'impact' || state.phase === 'diffusing') {
    if (state.splashRadius < Math.max(width, height) * 0.55) {
      state.splashRadius += (PHYSICS_CONFIG.rippleSpeed * dt) / PHYSICS_CONFIG.splashViscosity;
    }
    state.splashOpacity -= PHYSICS_CONFIG.splashDecay * dt;
    if (state.splashOpacity < 0) state.splashOpacity = 0;

    // 波纹扩散与衰减
    state.ripples.forEach((r) => {
      r.radius += PHYSICS_CONFIG.rippleSpeed * dt;
      r.amplitude *= 1 - (1 - PHYSICS_CONFIG.rippleDamping) * dt * 2;
    });

    // 卫星墨滴运动:速度受水阻力衰减,同时被 splash 中心吸引(粘度)
    state.satellites.forEach((p) => {
      if (p.opacity <= 0) return;
      p.vx *= PHYSICS_CONFIG.waterDrag;
      p.vy *= PHYSICS_CONFIG.waterDrag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      p.opacity = Math.max(0, 1 - p.life / p.maxLife);
    });

    // 拖尾扩散与消散
    state.trails.forEach((t) => {
      t.life += dt;
      t.opacity = Math.max(0, 0.85 * (1 - t.life / t.maxLife));
      // 点向外轻微扩散,模拟墨丝在水中舒展
      t.points.forEach((pt, idx) => {
        const factor = idx / t.points.length;
        pt.x += Math.sin(factor * Math.PI) * 2 * dt;
        pt.width *= 1 + 0.08 * dt;
      });
    });

    // 品牌名在撞击后 0.35s 浮现
    if (elapsed > 0.55 && state.brandOpacity < 1) {
      state.brandOpacity = Math.min(1, state.brandOpacity + dt * 1.8);
    }

    if (state.splashOpacity <= 0.05 && state.brandOpacity >= 0.9) {
      state.phase = 'diffusing';
    }
  }
}

function draw(ctx: CanvasRenderingContext2D, state: InkState) {
  const { width, height } = state;
  const centerX = width / 2;
  const centerY = height / 2;

  ctx.clearRect(0, 0, width, height);

  // 背景纸色已由父级提供,canvas 保持透明

  // ---- 中心墨团晕染(高斯模糊模拟) ----
  if (state.splashOpacity > 0) {
    drawInkBlob(ctx, centerX, centerY, state.splashRadius, state.splashOpacity);
  }

  // ---- 中心实心墨核 ----
  if (state.phase !== 'falling' || state.dropY >= centerY - 20) {
    const coreRadius = Math.max(4, 22 - state.splashRadius * 0.04);
    const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius * 3);
    coreGradient.addColorStop(0, `rgba(20, 20, 20, ${0.9 * state.splashOpacity})`);
    coreGradient.addColorStop(0.4, `rgba(45, 45, 45, ${0.5 * state.splashOpacity})`);
    coreGradient.addColorStop(1, 'rgba(26, 26, 26, 0)');
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, coreRadius * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 坠落中的墨滴 ----
  if (state.phase === 'falling') {
    const dropGradient = ctx.createRadialGradient(
      centerX - state.dropRadius * 0.3,
      state.dropY - state.dropRadius * 0.3,
      0,
      centerX,
      state.dropY,
      state.dropRadius
    );
    dropGradient.addColorStop(0, 'rgba(60, 60, 60, 0.95)');
    dropGradient.addColorStop(0.55, 'rgba(26, 26, 26, 0.9)');
    dropGradient.addColorStop(1, 'rgba(26, 26, 26, 0)');
    ctx.fillStyle = dropGradient;
    ctx.beginPath();
    ctx.ellipse(centerX, state.dropY, state.dropRadius * 0.9, state.dropRadius * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 同心波纹 ----
  state.ripples.forEach((r) => {
    if (r.amplitude <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = `rgba(26, 26, 26, ${r.amplitude * 0.5})`;
    ctx.lineWidth = r.width;
    ctx.beginPath();
    ctx.arc(centerX, centerY, r.radius, 0, Math.PI * 2);
    ctx.stroke();

    // 外圈微弱朱砂色(与参考图氛围呼应)
    ctx.strokeStyle = `rgba(200, 57, 46, ${r.amplitude * 0.08})`;
    ctx.lineWidth = r.width * 1.8;
    ctx.beginPath();
    ctx.arc(centerX, centerY, r.radius * 1.05, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // ---- 底部墨丝拖尾 ----
  state.trails.forEach((t) => {
    if (t.opacity <= 0) return;
    drawSmoothTrail(ctx, t.points, t.opacity);
  });

  // ---- 卫星墨滴 ----
  state.satellites.forEach((p) => {
    if (p.opacity <= 0) return;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 2);
    g.addColorStop(0, `rgba(30, 30, 30, ${p.opacity})`);
    g.addColorStop(0.6, `rgba(60, 60, 60, ${p.opacity * 0.5})`);
    g.addColorStop(1, 'rgba(26, 26, 26, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // ---- 品牌名 ----
  if (state.brandOpacity > 0) {
    ctx.save();
    ctx.font = '600 1rem "Noto Serif SC", "Songti SC", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(60, 60, 60, ${state.brandOpacity * 0.85})`;
    ctx.fillText('丹青有AI', centerX, centerY + 75);
    ctx.restore();
  }

  // ---- 红色印章(DQ) ----
  if (state.brandOpacity > 0.3) {
    ctx.save();
    const sealX = centerX + 95;
    const sealY = centerY - 65;
    const sealAlpha = Math.min(1, (state.brandOpacity - 0.3) / 0.7);

    // 印章背景
    ctx.fillStyle = `rgba(200, 57, 46, ${0.85 * sealAlpha})`;
    roundRect(ctx, sealX - 28, sealY - 18, 56, 36, 4);
    ctx.fill();

    // 印章文字
    ctx.font = '600 18px "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(250, 248, 243, ${sealAlpha})`;
    ctx.fillText('DQ', sealX, sealY);

    // 垂直金色小字
    ctx.font = '500 12px "Noto Serif SC", serif';
    ctx.fillStyle = `rgba(201, 169, 97, ${0.85 * sealAlpha})`;
    ctx.fillText('丹', sealX + 42, sealY - 10);
    ctx.fillText('青', sealX + 42, sealY + 2);
    ctx.fillText('不', sealX + 42, sealY + 14);
    ctx.fillText('渝', sealX + 42, sealY + 26);
    ctx.restore();
  }
}

/**
 * 绘制羽化墨团:用多个半透明径向渐变叠加,模拟水墨在宣纸上晕染
 */
function drawInkBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  opacity: number
) {
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = radius * (0.35 + t * 0.85);
    const alpha = opacity * (0.55 - t * 0.4);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(22, 22, 22, ${alpha})`);
    g.addColorStop(0.55, `rgba(45, 45, 45, ${alpha * 0.45})`);
    g.addColorStop(0.85, `rgba(80, 80, 80, ${alpha * 0.12})`);
    g.addColorStop(1, 'rgba(26, 26, 26, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 用二次贝塞尔曲线平滑绘制墨丝拖尾
 */
function drawSmoothTrail(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; width: number }[],
  opacity: number
) {
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(40, 40, 40, ${opacity * 0.7})`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    ctx.lineWidth = (p0.width + p1.width) / 2;

    if (i === 0) {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
    }
    ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    if (i === points.length - 2) {
      ctx.lineTo(p1.x, p1.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
