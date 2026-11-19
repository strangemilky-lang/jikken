import { BIOMES, CRAWL_COLS, CRAWL_ROWS } from './constants';
import { clamp, randInt } from './items';
import type { Enemy, MazeCell, MazeEvent } from './types';

export const crawlKey = (x: number, y: number) => `${x},${y}`;

export function getBiome(stage: number) {
  const idx = Math.floor((stage - 1) / 3) % BIOMES.length;
  return BIOMES[idx];
}

export function createEnemy(stage: number, isBoss: boolean, rareSlimeBonusPct = 0): Enemy {
  const biome = getBiome(stage);
  const isGreatDemon = isBoss && (stage % 100 === 0);
  const isMidBoss = isBoss && !isGreatDemon && (stage % 10 === 0);
  const isRareEscape = !isBoss && Math.random() < (0.12 + Math.max(0, rareSlimeBonusPct) / 100);

  const mult = Math.pow(1.145, stage - 1);
  const atkMult = Math.pow(1.14, stage - 1);

  if (isRareEscape) {
    return {
      name: '👑 はぐれ黄金スライム',
      icon: '✨',
      isBoss: false,
      isMidBoss: false,
      isGreatDemon: false,
      isRareEscape: true,
      maxHp: Math.round(75 * mult),
      hp: Math.round(75 * mult),
      atk: Math.max(1, Math.round(4 * atkMult)),
      atkInterval: 1.8,
      defRate: 0.1,
    };
  }

  if (isGreatDemon) {
    const name = stage === 100 ? '【大魔王】深淵の大魔王' : `【覇王 ${stage}F】創世の魔王`;
    const maxHp = Math.round(220 * mult);
    return {
      name,
      icon: '😈',
      isBoss: true,
      isMidBoss: false,
      isGreatDemon: true,
      isRareEscape: false,
      maxHp,
      hp: maxHp,
      atk: Math.max(1, Math.round(10.5 * atkMult)),
      atkInterval: 1.35,
      defRate: Math.min(0.65, 0.4 + stage * 0.001),
    };
  }

  const tpl = isBoss ? biome.boss : biome.mobs[randInt(0, biome.mobs.length - 1)];
  const bossHpScale = isMidBoss ? 165 : isBoss ? 128 : 48;
  const maxHp = Math.round(bossHpScale * mult);
  const atk = Math.max(1, Math.round((isMidBoss ? 9.5 : isBoss ? 8.5 : 5.5) * atkMult));
  const defRate = isMidBoss
    ? Math.min(0.55, 0.28 + stage * 0.0018)
    : isBoss
      ? Math.min(0.4, 0.15 + stage * 0.002)
      : Math.min(0.22, Math.max(0, stage - 5) * 0.002);

  return {
    name: isMidBoss ? `【守護者】${tpl.name}` : isBoss ? `【BOSS】${tpl.name}` : tpl.name,
    icon: tpl.icon,
    isBoss,
    isMidBoss,
    isGreatDemon: false,
    isRareEscape: false,
    maxHp,
    hp: maxHp,
    atk,
    atkInterval: isBoss ? 1.45 : 1.65,
    defRate,
  };
}

/**
 * 歩数ベースのランダムエンカウント判定（5体固定上限なし）
 * 戦闘直後4歩は安全地帯、5歩目以降から歩数に応じてエンカウント確率が上昇する（平均約10歩に1体）。
 */
export function shouldTriggerRandomEncounter(
  stepsSinceLastEncounter: number,
  remainingStepsToStairs: number,
  rng: () => number = Math.random,
): boolean {
  if (remainingStepsToStairs <= 1) return false;
  if (stepsSinceLastEncounter < 5) return false;
  const chance = Math.min(0.30, 0.06 + (stepsSinceLastEncounter - 5) * 0.04);
  return rng() < chance;
}

/**
 * 迷宮内の分岐にも自然に迷い込む探索ターゲット選定（突然の逆走を防ぐため進行方向を優先）
 */
export function pickExplorationTarget(
  grid: number[][],
  cx: number,
  cy: number,
  angle: number,
  explored: Set<string>,
  stepped: Set<string>,
  stairs: MazeCell,
  events: MazeEvent[],
  rng: () => number = Math.random,
): { target: MazeCell; reason: 'stairs' | 'event' | 'explore' } {
  if (explored.has(crawlKey(stairs.x, stairs.y))) {
    return { target: { x: stairs.x, y: stairs.y }, reason: 'stairs' };
  }

  // 視界に入った未回収イベントがあれば優先して立ち寄る
  const visibleEvents = events.filter((ev) => !ev.triggered && explored.has(crawlKey(ev.x, ev.y)));
  if (visibleEvents.length > 0) {
    let nearest = visibleEvents[0];
    let bestD = Infinity;
    for (const ev of visibleEvents) {
      const d = Math.abs(ev.x - cx) + Math.abs(ev.y - cy);
      if (d < bestD) {
        bestD = d;
        nearest = ev;
      }
    }
    return { target: { x: nearest.x, y: nearest.y }, reason: 'event' };
  }

  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;
  const { dist, prev } = bfsGrid(grid, cx, cy, cols, rows);

  // 各マスへ向かう際の「最初の一歩」を逆引きする
  const firstStepMemo = new Map<string, [number, number]>();
  const getFirstStep = (kx: number, ky: number): [number, number] | null => {
    const k = crawlKey(kx, ky);
    if (kx === cx && ky === cy) return null;
    const cached = firstStepMemo.get(k);
    if (cached) return cached;
    let cur: [number, number] = [kx, ky];
    while (true) {
      const p = prev.get(crawlKey(cur[0], cur[1]));
      if (!p) return null;
      if (p[0] === cx && p[1] === cy) {
        firstStepMemo.set(k, cur);
        return cur;
      }
      cur = p;
    }
  };

  const hx = Math.cos(angle);
  const hy = Math.sin(angle);

  interface Candidate {
    x: number;
    y: number;
    d: number;
    isForward: boolean;
    dot: number;
    unexplored: boolean;
  }

  const candidates: Candidate[] = [];
  for (const [k, d] of dist) {
    if (d < 1) continue;
    const [x, y] = k.split(',').map(Number);
    if (x === stairs.x && y === stairs.y) continue;
    const isUnstepped = !stepped.has(k);
    const isUnexplored = !explored.has(k);
    if (!isUnstepped && !isUnexplored) continue;

    const fs = getFirstStep(x, y);
    if (!fs) continue;
    const dx = fs[0] - cx;
    const dy = fs[1] - cy;
    const dot = dx * hx + dy * hy;
    candidates.push({
      x,
      y,
      d,
      isForward: dot > -0.45,
      dot,
      unexplored: isUnexplored,
    });
  }

  if (candidates.length === 0) {
    return { target: { x: stairs.x, y: stairs.y }, reason: 'stairs' };
  }

  // 進行方向〜左右分岐（逆走ではない方向）に候補があれば必ずそこから選ぶ
  const forwardPool = candidates.filter((c) => c.isForward);
  const pool = forwardPool.length > 0 ? forwardPool : candidates;

  // 未踏破（霧の中）があり、かつ近すぎず遠すぎない範囲 (3〜14歩) を優先
  const unexpPool = pool.filter((c) => c.unexplored);
  const basePool = unexpPool.length > 0 ? unexpPool : pool;
  const mediumPool = basePool.filter((c) => c.d >= 3 && c.d <= 14);
  const finalPool = mediumPool.length > 0 ? mediumPool : basePool;

  // 少しランダム性を混ぜて分岐ごとに迷う感覚を作る
  const weighted = [...finalPool].sort((a, b) => {
    const scoreA = (a.dot > 0.4 ? 1.5 : 0) + (14 - Math.min(14, a.d)) * 0.15;
    const scoreB = (b.dot > 0.4 ? 1.5 : 0) + (14 - Math.min(14, b.d)) * 0.15;
    return scoreB - scoreA;
  });
  const topSlice = weighted.slice(0, Math.max(1, Math.min(6, weighted.length)));
  const chosen = topSlice[Math.floor(rng() * topSlice.length)];
  return { target: { x: chosen.x, y: chosen.y }, reason: 'explore' };
}

/**
 * 進行中の経路前方に雑魚敵を配置し、逆走エンカウントを防ぐ
 */
export function pickEncounterAheadCell(
  grid: number[][],
  cx: number,
  cy: number,
  angle: number,
  currentPath: MazeCell[] | null,
  stairs: MazeCell,
  preferClose: boolean,
): MazeCell | null {
  if (currentPath && currentPath.length >= 2) {
    const maxIdx = Math.min(currentPath.length - 1, preferClose ? 1 : 2);
    for (let idx = maxIdx; idx >= 1; idx--) {
      const cell = currentPath[idx];
      if (cell.x !== stairs.x || cell.y !== stairs.y) {
        return { x: cell.x, y: cell.y };
      }
    }
  }

  // パスが短い場合は視線前方の通行可能マスを探す
  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;
  const hx = Math.cos(angle);
  const hy = Math.sin(angle);
  let best: MazeCell | null = null;
  let bestDot = -2;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) continue;
    if (grid[ny][nx] === 1) continue;
    if (nx === stairs.x && ny === stairs.y) continue;
    const dot = dx * hx + dy * hy;
    if (dot > bestDot) {
      bestDot = dot;
      best = { x: nx, y: ny };
    }
  }
  return bestDot > -0.45 ? best : null;
}

/**
 * 迷宮全体の枝道も含めて黄金の宝箱イベントを配置する
 */
export function placeMazeEvents(
  depth: Map<string, number>,
  stairs: MazeCell,
  rng: () => number = Math.random,
): MazeEvent[] {
  const candidates: MazeCell[] = [];
  for (const [k, d] of depth) {
    if (d < 4) continue;
    const [x, y] = k.split(',').map(Number);
    if (x === stairs.x && y === stairs.y) continue;
    candidates.push({ x, y });
  }
  if (!candidates.length) return [];

  const count = rng() < 0.55 ? 1 : 2;
  const events: MazeEvent[] = [];

  for (let i = 0; i < count && candidates.length > 0; i++) {
    const pickIdx = Math.floor(rng() * candidates.length);
    const cell = candidates.splice(pickIdx, 1)[0];
    events.push({ type: 'chest', icon: '🎁', x: cell.x, y: cell.y, triggered: false });
  }
  return events;
}

export function generateMaze(cols = CRAWL_COLS, rows = CRAWL_ROWS): {
  grid: number[][];
  stairs: MazeCell;
  depth: Map<string, number>;
} {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const stack: Array<[number, number]> = [[1, 1]];
  grid[1][1] = 0;
  const dirs: Array<[number, number]> = [[2, 0], [-2, 0], [0, 2], [0, -2]];

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = dirs.filter(([dx, dy]) => {
      const nx = cx + dx;
      const ny = cy + dy;
      return nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && grid[ny][nx] === 1;
    });
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = opts[randInt(0, opts.length - 1)];
    grid[cy + dy / 2][cx + dx / 2] = 0;
    grid[cy + dy][cx + dx] = 0;
    stack.push([cx + dx, cy + dy]);
  }

  for (let i = 0; i < 16; i++) {
    const x = randInt(1, cols - 2);
    const y = randInt(1, rows - 2);
    if ((x + y) % 2 === 1) grid[y][x] = 0;
  }

  const { dist } = bfsGrid(grid, 1, 1, cols, rows);
  let stairs: MazeCell = { x: cols - 2, y: rows - 2 };
  let bestDist = -1;
  for (const [k, d] of dist) {
    if (d > bestDist) {
      bestDist = d;
      const [x, y] = k.split(',').map(Number);
      stairs = { x, y };
    }
  }

  return { grid, stairs, depth: dist };
}

export function bfsGrid(
  grid: number[][],
  sx: number,
  sy: number,
  cols = CRAWL_COLS,
  rows = CRAWL_ROWS,
): { dist: Map<string, number>; prev: Map<string, [number, number]> } {
  const dist = new Map<string, number>([[crawlKey(sx, sy), 0]]);
  const prev = new Map<string, [number, number]>();
  const q: Array<[number, number]> = [[sx, sy]];

  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = crawlKey(nx, ny);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || grid[ny][nx] === 1 || dist.has(k)) continue;
      dist.set(k, dist.get(crawlKey(x, y))! + 1);
      prev.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  return { dist, prev };
}

export function bfsPath(
  grid: number[][],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): MazeCell[] | null {
  const { prev } = bfsGrid(grid, sx, sy, grid[0].length, grid.length);
  const path: MazeCell[] = [];
  let cur: [number, number] | undefined = [tx, ty];
  if (!prev.has(crawlKey(tx, ty)) && !(sx === tx && sy === ty)) return null;
  while (cur) {
    path.unshift({ x: cur[0], y: cur[1] });
    cur = prev.get(crawlKey(cur[0], cur[1]));
  }
  return path;
}

export type SmoothSegment =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; len: number; ang: number }
  | { type: 'arc'; cx: number; cy: number; r: number; a0: number; da: number; len: number };

export function buildSmoothSegments(
  path: MazeCell[],
  goalIdx: number,
  startX: number,
  startY: number,
  cornerR = 0.42,
): SmoothSegment[] {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= goalIdx; i++) {
    pts.push({ x: path[i].x + 0.5, y: path[i].y + 0.5 });
  }
  if (pts.length === 0) return [];
  pts[0] = { x: startX, y: startY };
  if (pts.length === 1) return [];

  const simplified = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = simplified[simplified.length - 1];
    const b = pts[i];
    const d = pts[i + 1];
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cross) > 1e-5) {
      simplified.push(b);
    }
  }
  simplified.push(pts[pts.length - 1]);

  const segs: SmoothSegment[] = [];
  const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > 1e-5) {
      segs.push({ type: 'line', x1, y1, x2, y2, len, ang: Math.atan2(y2 - y1, x2 - x1) });
    }
  };

  let cur = simplified[0];
  for (let i = 1; i < simplified.length - 1; i++) {
    const p = simplified[i];
    const next = simplified[i + 1];
    const v1x = p.x - cur.x;
    const v1y = p.y - cur.y;
    const v2x = next.x - p.x;
    const v2y = next.y - p.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-5 || l2 < 1e-5) continue;

    const u1x = v1x / l1;
    const u1y = v1y / l1;
    const u2x = v2x / l2;
    const u2y = v2y / l2;
    const dot = clamp(u1x * u2x + u1y * u2y, -1, 1);

    if (dot > 0.999) continue;

    if (dot < -0.999) {
      pushLine(cur.x, cur.y, p.x, p.y);
      cur = p;
      continue;
    }

    const dMax = Math.min(cornerR, l1 * 0.45, l2 * 0.45);
    const tIn = { x: p.x - u1x * dMax, y: p.y - u1y * dMax };
    const tOut = { x: p.x + u2x * dMax, y: p.y + u2y * dMax };

    pushLine(cur.x, cur.y, tIn.x, tIn.y);

    const cross = u1x * u2y - u1y * u2x;
    if (Math.abs(dot) < 1e-3 && Math.abs(Math.abs(cross) - 1) < 1e-3) {
      const r = dMax;
      const n1x = cross > 0 ? -u1y : u1y;
      const n1y = cross > 0 ? u1x : -u1x;
      const cx = tIn.x + n1x * r;
      const cy = tIn.y + n1y * r;
      const a0 = Math.atan2(tIn.y - cy, tIn.x - cx);
      const da = cross > 0 ? Math.PI / 2 : -Math.PI / 2;
      segs.push({ type: 'arc', cx, cy, r, a0, da, len: r * (Math.PI / 2) });
    } else {
      const steps = 8;
      let prevPt = tIn;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const mt = 1 - t;
        const qx = mt * mt * tIn.x + 2 * mt * t * p.x + t * t * tOut.x;
        const qy = mt * mt * tIn.y + 2 * mt * t * p.y + t * t * tOut.y;
        pushLine(prevPt.x, prevPt.y, qx, qy);
        prevPt = { x: qx, y: qy };
      }
    }
    cur = tOut;
  }

  const last = simplified[simplified.length - 1];
  pushLine(cur.x, cur.y, last.x, last.y);
  return segs;
}

export function evalSmoothSeg(seg: SmoothSegment, s: number, pos: { x: number; y: number; angle: number }) {
  const u = seg.len > 0 ? clamp(s / seg.len, 0, 1) : 1;
  if (seg.type === 'line') {
    pos.x = seg.x1 + (seg.x2 - seg.x1) * u;
    pos.y = seg.y1 + (seg.y2 - seg.y1) * u;
    pos.angle = seg.ang;
  } else {
    const a = seg.a0 + seg.da * u;
    pos.x = seg.cx + seg.r * Math.cos(a);
    pos.y = seg.cy + seg.r * Math.sin(a);
    pos.angle = a + (seg.da > 0 ? Math.PI / 2 : -Math.PI / 2);
  }
}

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
