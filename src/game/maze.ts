import { BIOMES, CRAWL_COLS, CRAWL_ROWS } from './constants';
import { clamp, randInt } from './items';
import { isMidBossFloor, isSanctumFloor } from './sanctum';
import type {
  DungeonRoom,
  Enemy,
  FloorEnemy,
  FloorLootType,
  MazeCell,
  MazeEvent,
  SpriteKey,
} from './types';

export const crawlKey = (x: number, y: number) => `${x},${y}`;

export function getBiome(stage: number) {
  const idx = Math.floor((stage - 1) / 3) % BIOMES.length;
  return BIOMES[idx];
}

export function createEnemy(stage: number, isBoss: boolean, rareSlimeBonusPct = 0): Enemy {
  const biome = getBiome(stage);
  const isSanctumBoss = isBoss && isSanctumFloor(stage);
  const isGreatDemon = isBoss && stage % 100 === 0;
  const isMidBoss = isBoss && !isSanctumBoss && isMidBossFloor(stage);
  const isRareEscape = !isBoss && Math.random() < (0.12 + Math.max(0, rareSlimeBonusPct) / 100);

  const pre100 = Math.min(stage - 1, 99);
  const post100 = Math.max(0, stage - 100);
  const mult = Math.pow(1.145, pre100) * Math.pow(1.14, post100);
  const atkMult = Math.pow(1.14, stage - 1);

  const uwHpRamp = stage >= 101 ? 1 + 14.0 * (1 - Math.exp(-post100 / 28)) : 1;
  const uwAtkRamp = stage >= 101 ? 1 + 1.6 * (1 - Math.exp(-post100 / 28)) : 1;

  if (isRareEscape) {
    return {
      name: '👑 はぐれ黄金スライム',
      icon: '✨',
      spriteId: 'golden_slime',
      isBoss: false,
      isKeyKeeper: false,
      isMidBoss: false,
      isSanctumBoss: false,
      isGreatDemon: false,
      isRareEscape: true,
      maxHp: Math.round(75 * mult * uwHpRamp),
      hp: Math.round(75 * mult * uwHpRamp),
      atk: Math.max(1, Math.round(4 * atkMult * uwAtkRamp)),
      defRate: 0.1,
    };
  }

  if (isSanctumBoss) {
    const name = isGreatDemon
      ? stage === 100
        ? '【大魔王】深淵の大魔王'
        : `【覇王 ${stage}F】創世の魔王`
      : `【玄室の大ボス ${stage}F】${biome.boss.name}`;
    const sanctumHpMult = stage >= 100 ? (stage === 100 ? 2.6 : 5.8) : 1;
    const sanctumAtkMult = stage >= 100 ? (stage === 100 ? 1.85 : 2.15) : 1;
    const maxHp = Math.round(420 * mult * uwHpRamp * sanctumHpMult);
    return {
      name,
      icon: isGreatDemon ? '😈' : biome.boss.icon,
      spriteId: isGreatDemon ? 'great_demon' : biome.boss.spriteId,
      isBoss: true,
      isKeyKeeper: false,
      isMidBoss: false,
      isSanctumBoss: true,
      isGreatDemon,
      isRareEscape: false,
      maxHp,
      hp: maxHp,
      atk: Math.max(1, Math.round(18 * atkMult * uwAtkRamp * sanctumAtkMult)),
      defRate: Math.min(0.68, 0.44 + stage * 0.001),
    };
  }

  const tpl = isBoss ? biome.boss : biome.mobs[randInt(0, biome.mobs.length - 1)];
  const bossHpScale = isMidBoss ? 165 : isBoss ? 128 : 48;
  const maxHp = Math.round(bossHpScale * mult * uwHpRamp);
  const atk = Math.max(1, Math.round((isMidBoss ? 9.5 : isBoss ? 8.5 : 5.5) * atkMult * uwAtkRamp));
  const defRate = isMidBoss
    ? Math.min(0.55, 0.28 + stage * 0.0018)
    : isBoss
      ? Math.min(0.4, 0.15 + stage * 0.002)
      : Math.min(0.22, Math.max(0, stage - 5) * 0.002);

  return {
    name: isMidBoss ? `【守護者】${tpl.name}` : isBoss ? `【BOSS】${tpl.name}` : tpl.name,
    icon: tpl.icon,
    spriteId: tpl.spriteId,
    isBoss,
    isKeyKeeper: isBoss,
    isMidBoss,
    isSanctumBoss: false,
    isGreatDemon: false,
    isRareEscape: false,
    maxHp,
    hp: maxHp,
    atk,
    defRate,
  };
}

/**
 * 歩数ベースのランダムエンカウント判定（レガシー/補助判定用）
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

export function shouldEnterRestMode(hp: number, maxHp: number): boolean {
  if (maxHp <= 0) return false;
  return hp > 0 && hp / maxHp < 0.6;
}

export function shouldExitRestMode(hp: number, maxHp: number): boolean {
  if (maxHp <= 0) return true;
  return hp / maxHp >= 0.85;
}

/**
 * 鍵入手済みの探索優先ルール：
 * - 鍵あり & 階段発見済み -> 即座に階段へ向かう
 * - 鍵なし または 階段未発見 -> アイテム回収・未訪問部屋・未踏破通路を探索
 * - 全探索しても鍵未入手なら生存中の鍵持ちモンスターを探す
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
  roomGrid?: number[][],
  rooms?: DungeonRoom[],
  visitedRooms?: Set<number>,
  options?: { hasFloorKey?: boolean; enemies?: FloorEnemy[] },
): { target: MazeCell; reason: 'stairs' | 'event' | 'explore' } {
  const hasFloorKey = options?.hasFloorKey ?? true;
  if (hasFloorKey && explored.has(crawlKey(stairs.x, stairs.y))) {
    return { target: { x: stairs.x, y: stairs.y }, reason: 'stairs' };
  }

  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;
  const { dist, prev } = bfsGrid(grid, cx, cy, cols, rows);
  const heroRoomId = roomGrid?.[cy]?.[cx] ?? -1;

  // 1. 現在いる部屋、または探索済みの未回収お宝があれば優先回収（近い順）
  const activeEvents = events.filter((ev) => !ev.triggered);
  if (heroRoomId >= 0) {
    const sameRoomLoot = activeEvents
      .filter((ev) => ev.roomId === heroRoomId || (roomGrid?.[ev.y]?.[ev.x] ?? -1) === heroRoomId)
      .sort((a, b) => (dist.get(crawlKey(a.x, a.y)) ?? 999) - (dist.get(crawlKey(b.x, b.y)) ?? 999));
    if (sameRoomLoot.length > 0) {
      return { target: { x: sameRoomLoot[0].x, y: sameRoomLoot[0].y }, reason: 'event' };
    }
  }

  const visibleEvents = activeEvents
    .filter((ev) => explored.has(crawlKey(ev.x, ev.y)))
    .sort((a, b) => (dist.get(crawlKey(a.x, a.y)) ?? 999) - (dist.get(crawlKey(b.x, b.y)) ?? 999));
  if (visibleEvents.length > 0) {
    return { target: { x: visibleEvents[0].x, y: visibleEvents[0].y }, reason: 'event' };
  }

  // 2. 未訪問の部屋があれば最も近い未訪問部屋へ向かう
  if (rooms && rooms.length > 0 && visitedRooms) {
    const unvisitedRooms = rooms
      .filter((r) => !visitedRooms.has(r.id))
      .sort((a, b) => (dist.get(crawlKey(a.cx, a.cy)) ?? 999) - (dist.get(crawlKey(b.cx, b.cy)) ?? 999));
    if (unvisitedRooms.length > 0) {
      const nextRoom = unvisitedRooms[0];
      return { target: { x: nextRoom.cx, y: nextRoom.cy }, reason: 'explore' };
    }
  }

  if (hasFloorKey && explored.has(crawlKey(stairs.x, stairs.y))) {
    return { target: { x: stairs.x, y: stairs.y }, reason: 'stairs' };
  }

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
    if (!hasFloorKey && options?.enemies) {
      const keyKeeper = options.enemies.find((e) => e.enemy.hp > 0 && (e.enemy.isKeyKeeper || e.enemy.isBoss));
      if (keyKeeper) {
        return { target: { x: keyKeeper.x, y: keyKeeper.y }, reason: 'explore' };
      }
    }
    return { target: { x: stairs.x, y: stairs.y }, reason: hasFloorKey ? 'stairs' : 'explore' };
  }

  const forwardPool = candidates.filter((c) => c.isForward);
  const pool = forwardPool.length > 0 ? forwardPool : candidates;
  const unexpPool = pool.filter((c) => c.unexplored);
  const basePool = unexpPool.length > 0 ? unexpPool : pool;
  const mediumPool = basePool.filter((c) => c.d >= 3 && c.d <= 14);
  const finalPool = mediumPool.length > 0 ? mediumPool : basePool;

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
 * 進行中の経路前方に雑魚敵を配置（レガシー互換用）
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

const LOOT_META: Record<FloorLootType, { icon: string; spriteId: SpriteKey }> = {
  chest: { icon: '🎁', spriteId: 'chest_gold' },
  weapon: { icon: '⚔️', spriteId: 'loot_weapon' },
  armor: { icon: '🛡️', spriteId: 'loot_armor' },
  accessory: { icon: '💍', spriteId: 'loot_accessory' },
  stones: { icon: '💎', spriteId: 'loot_stones' },
  heal: { icon: '💚', spriteId: 'loot_heal' },
};

/**
 * 部屋ごとに宝箱・装備・強化石などの床落ちアイテムを配置する
 */
export function placeMazeEvents(
  depth: Map<string, number>,
  stairs: MazeCell,
  rng: () => number = Math.random,
  rooms?: DungeonRoom[],
  spawn?: MazeCell,
): MazeEvent[] {
  if (rooms && rooms.length > 0) {
    const events: MazeEvent[] = [];
    const used = new Set<string>([crawlKey(stairs.x, stairs.y)]);
    if (spawn) used.add(crawlKey(spawn.x, spawn.y));
    let evIdx = 0;

    for (const room of rooms) {
      const isStart = spawn ? room.id === 0 || (spawn.x >= room.x && spawn.x < room.x + room.w && spawn.y >= room.y && spawn.y < room.y + room.h) : false;
      if (isStart) continue;

      const roomCells: MazeCell[] = [];
      for (let ry = room.y; ry < room.y + room.h; ry++) {
        for (let rx = room.x; rx < room.x + room.w; rx++) {
          if (!used.has(crawlKey(rx, ry))) {
            roomCells.push({ x: rx, y: ry });
          }
        }
      }
      if (!roomCells.length) continue;

      const targetCount = room.isMonsterHouse
        ? Math.min(roomCells.length, 3 + Math.floor(rng() * 3))
        : Math.min(roomCells.length, 1 + Math.floor(rng() * 3));

      for (let i = 0; i < targetCount && roomCells.length > 0; i++) {
        const pickIdx = Math.floor(rng() * roomCells.length);
        const cell = roomCells.splice(pickIdx, 1)[0];
        used.add(crawlKey(cell.x, cell.y));

        let type: FloorLootType;
        if (room.isMonsterHouse && i === 0) {
          type = 'chest';
        } else {
          const r = rng();
          if (r < 0.30) type = 'chest';
          else if (r < 0.48) type = 'weapon';
          else if (r < 0.66) type = 'armor';
          else if (r < 0.83) type = 'accessory';
          else type = 'stones';
        }

        const meta = LOOT_META[type];
        events.push({
          id: `ev_${evIdx++}`,
          type,
          icon: meta.icon,
          spriteId: meta.spriteId,
          x: cell.x,
          y: cell.y,
          triggered: false,
          roomId: room.id,
        });
      }
    }

    if (events.length > 0) return events;
  }

  // Fallback for depth-only legacy callers
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
    events.push({
      id: `ev_${i}`,
      type: 'chest',
      icon: '🎁',
      spriteId: 'chest_gold',
      x: cell.x,
      y: cell.y,
      triggered: false,
    });
  }
  return events;
}

/**
 * 各部屋に可視の敵シンボル（雑魚／はぐれ黄金スライム／モンスターハウス／徘徊する鍵持ちボス）を配置
 */
export function placeDungeonEnemies(opts: {
  stage: number;
  rooms: DungeonRoom[];
  startRoomId: number;
  stairsRoomId: number;
  stairs: MazeCell;
  spawn: MazeCell;
  rareSlimeBonusPct?: number;
  rng?: () => number;
}): FloorEnemy[] {
  const {
    stage,
    rooms,
    startRoomId,
    stairsRoomId,
    stairs,
    spawn,
    rareSlimeBonusPct = 0,
    rng = Math.random,
  } = opts;
  const result: FloorEnemy[] = [];
  const used = new Set<string>([crawlKey(spawn.x, spawn.y), crawlKey(stairs.x, stairs.y)]);
  let idx = 0;

  // 鍵持ちボスをスタート部屋以外の部屋から1体選んで配置（階段上には固定配置しない）
  const keeperRooms = rooms.filter((r) => r.id !== startRoomId && !r.isMonsterHouse);
  const keeperRoomPool = keeperRooms.length > 0 ? keeperRooms : rooms.filter((r) => r.id !== startRoomId);
  const chosenKeeperRoom =
    keeperRoomPool.length > 0
      ? keeperRoomPool[Math.floor(rng() * keeperRoomPool.length)]
      : null;

  for (const room of rooms) {
    if (room.id === startRoomId) continue;

    const freeCells: MazeCell[] = [];
    for (let ry = room.y; ry < room.y + room.h; ry++) {
      for (let rx = room.x; rx < room.x + room.w; rx++) {
        if (!used.has(crawlKey(rx, ry))) {
          freeCells.push({ x: rx, y: ry });
        }
      }
    }

    if (chosenKeeperRoom && room.id === chosenKeeperRoom.id && freeCells.length > 0) {
      const kPick = Math.floor(rng() * freeCells.length);
      const kCell = freeCells.splice(kPick, 1)[0];
      used.add(crawlKey(kCell.x, kCell.y));
      result.push({
        id: 'boss_keykeeper',
        x: kCell.x,
        y: kCell.y,
        roomId: room.id,
        awakened: false,
        prevCell: null,
        atkTimer: 0,
        shake: 0,
        flashTimer: 0,
        rareEscapeTimer: 6,
        enemy: createEnemy(stage, true, rareSlimeBonusPct),
      });
    }

    const mobCount = room.isMonsterHouse
      ? Math.min(freeCells.length, 4 + Math.floor(rng() * 3))
      : room.id === stairsRoomId
        ? Math.min(freeCells.length, rng() < 0.55 ? 1 : 0)
        : Math.min(freeCells.length, rng() < 0.45 ? 2 : 1);

    for (let i = 0; i < mobCount && freeCells.length > 0; i++) {
      const pick = Math.floor(rng() * freeCells.length);
      const cell = freeCells.splice(pick, 1)[0];
      used.add(crawlKey(cell.x, cell.y));
      result.push({
        id: `mob_${idx++}`,
        x: cell.x,
        y: cell.y,
        roomId: room.id,
        awakened: false,
        prevCell: null,
        atkTimer: 0,
        shake: 0,
        flashTimer: 0,
        rareEscapeTimer: 6,
        enemy: createEnemy(stage, false, rareSlimeBonusPct),
      });
    }
  }

  return result;
}

/**
 * 部屋入室時にその部屋全体＋周囲壁・出入口を一気に可視化する（通路では現在地＋上下左右1マスのみ）
 */
export function revealDungeonTiles(
  grid: number[][],
  roomGrid: number[][],
  rooms: DungeonRoom[],
  explored: Set<string>,
  cx: number,
  cy: number,
  _angle: number,
): { enteredRoomId: number } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;
  explored.add(crawlKey(cx, cy));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) {
      explored.add(crawlKey(nx, ny));
    }
  }

  const roomId = roomGrid[cy]?.[cx] ?? -1;
  if (roomId >= 0 && rooms[roomId]) {
    const r = rooms[roomId];
    for (let y = Math.max(0, r.y - 1); y <= Math.min(rows - 1, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x - 1); x <= Math.min(cols - 1, r.x + r.w); x++) {
        explored.add(crawlKey(x, y));
      }
    }
    return { enteredRoomId: roomId };
  }

  return { enteredRoomId: -1 };
}

/**
 * 部屋に入ったあと、同室内に2体以上の敵がいる場合は通路マスへ1歩下がって1対1を作る
 */
export function findChokeRetreatCell(
  grid: number[][],
  roomGrid: number[][],
  heroCell: MazeCell,
  roomId: number,
  enemies: FloorEnemy[],
  stairs: MazeCell,
  preferredCell?: MazeCell | null,
): { cell: MazeCell; faceAngle: number } | null {
  if (roomId < 0) return null;
  const roomEnemies = enemies.filter((e) => e.enemy.hp > 0 && e.roomId === roomId);
  if (roomEnemies.length < 2) return null;

  const rows = grid.length;
  const cols = grid[0]?.[0] !== undefined ? grid[0].length : CRAWL_COLS;

  const isValidRetreat = (nx: number, ny: number) => {
    if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) return false;
    if (grid[ny][nx] !== 0) return false;
    if ((roomGrid[ny]?.[nx] ?? -1) !== -1) return false; // 通路マス限定
    if (nx === stairs.x && ny === stairs.y) return false;
    if (enemies.some((e) => e.enemy.hp > 0 && e.x === nx && e.y === ny)) return false;
    return true;
  };

  if (
    preferredCell &&
    Math.abs(preferredCell.x - heroCell.x) + Math.abs(preferredCell.y - heroCell.y) === 1 &&
    isValidRetreat(preferredCell.x, preferredCell.y)
  ) {
    return {
      cell: { x: preferredCell.x, y: preferredCell.y },
      faceAngle: Math.atan2(heroCell.y - preferredCell.y, heroCell.x - preferredCell.x),
    };
  }

  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = heroCell.x + dx;
    const ny = heroCell.y + dy;
    if (!isValidRetreat(nx, ny)) continue;

    return {
      cell: { x: nx, y: ny },
      faceAngle: Math.atan2(heroCell.y - ny, heroCell.x - nx),
    };
  }
  return null;
}

/**
 * 入室時（またはボス＋雑魚同室時）に通路へ1歩引いて1対1を作るべきか判定する
 */
export function shouldRetreatInRoom(enemies: FloorEnemy[], roomId: number): boolean {
  if (roomId < 0) return false;
  const inRoom = enemies.filter((e) => e.enemy.hp > 0 && e.roomId === roomId);
  const mobileCount = inRoom.filter((e) => !e.enemy.isBoss).length;
  return mobileCount >= 1 && inRoom.length >= 2;
}

function findEnemyNextStep(
  grid: number[][],
  ex: number,
  ey: number,
  heroCell: MazeCell,
  occupied: Set<string>,
  avoidOccupied: boolean,
): MazeCell | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;
  const startK = crawlKey(ex, ey);
  const goalK = crawlKey(heroCell.x, heroCell.y);
  const visited = new Set<string>([startK]);
  const firstStep = new Map<string, MazeCell>();
  const q: Array<[number, number]> = [[ex, ey]];

  while (q.length > 0) {
    const [cx, cy] = q.shift()!;
    const ck = crawlKey(cx, cy);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (grid[ny][nx] !== 0) continue;
      const nk = crawlKey(nx, ny);
      if (visited.has(nk)) continue;

      const isGoal = nk === goalK;
      if (!isGoal && avoidOccupied && occupied.has(nk)) continue;
      // 初手は必ず空きマスでなければならない
      if (cx === ex && cy === ey && !isGoal && occupied.has(nk)) continue;

      visited.add(nk);
      const step = cx === ex && cy === ey ? { x: nx, y: ny } : firstStep.get(ck)!;
      if (isGoal) {
        return step;
      }
      firstStep.set(nk, step);
      q.push([nx, ny]);
    }
  }
  return null;
}

/**
 * ターン進行時の敵移動：
 * - 覚醒済み通常敵は毎ターン1歩主人公へ接近
 * - 鍵持ちボスは2ターンに1回（turnNumber % 2 === 0）行動：覚醒済みなら接近、未覚醒ならシンプルに徘徊
 */
export function stepEnemiesTowardHero(
  grid: number[][],
  roomGrid: number[][],
  heroCell: MazeCell,
  _stairs: MazeCell,
  enemies: FloorEnemy[],
  turnNumber = 0,
  rng: () => number = Math.random,
): void {
  const heroRoomId = roomGrid[heroCell.y]?.[heroCell.x] ?? -1;
  const rows = grid.length;
  const cols = grid[0]?.length ?? CRAWL_COLS;

  for (const e of enemies) {
    if (e.enemy.hp <= 0) continue;
    const dHero = Math.abs(e.x - heroCell.x) + Math.abs(e.y - heroCell.y);
    if ((heroRoomId >= 0 && heroRoomId === e.roomId) || dHero <= 1) {
      e.awakened = true;
    }
  }

  // 主人公に近い敵から移動判定することで通路入口の渋滞（1列縦隊）や包囲が自然に組まれる
  const movers = enemies
    .filter((e) => {
      if (e.enemy.hp <= 0) return false;
      if (e.enemy.isKeyKeeper || e.enemy.isBoss) {
        return turnNumber % 2 === 0;
      }
      return e.awakened;
    })
    .sort(
      (a, b) =>
        Math.abs(a.x - heroCell.x) +
        Math.abs(a.y - heroCell.y) -
        (Math.abs(b.x - heroCell.x) + Math.abs(b.y - heroCell.y)),
    );

  for (const e of movers) {
    const curD = Math.abs(e.x - heroCell.x) + Math.abs(e.y - heroCell.y);
    if (curD <= 1) continue; // 既に隣接している

    const occupied = new Set<string>();
    for (const other of enemies) {
      if (other !== e && other.enemy.hp > 0) {
        occupied.add(crawlKey(other.x, other.y));
      }
    }

    let nextStep: MazeCell | null = null;
    if ((e.enemy.isKeyKeeper || e.enemy.isBoss) && !e.awakened) {
      // 未覚醒の鍵持ちは2ターンに1回、単純な隣接空きマスへ徘徊（直前マスの即戻りだけ回避）
      const validNeighbors: MazeCell[] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = e.x + dx;
        const ny = e.y + dy;
        if (nx <= 0 || ny <= 0 || nx >= cols - 1 || ny >= rows - 1) continue;
        if (grid[ny][nx] !== 0) continue;
        if (nx === heroCell.x && ny === heroCell.y) continue;
        if (occupied.has(crawlKey(nx, ny))) continue;
        validNeighbors.push({ x: nx, y: ny });
      }
      if (validNeighbors.length > 0) {
        const nonBacktrack = e.prevCell
          ? validNeighbors.filter((c) => c.x !== e.prevCell!.x || c.y !== e.prevCell!.y)
          : validNeighbors;
        const pool = nonBacktrack.length > 0 ? nonBacktrack : validNeighbors;
        nextStep = pool[Math.floor(rng() * pool.length)];
      }
    } else {
      // 1) 他敵を迂回して主人公の空き隣接マスへ回り込む経路を優先
      // 2) 通路入口などで全方向が仲間で詰まっている場合は最後尾へ詰める
      nextStep =
        findEnemyNextStep(grid, e.x, e.y, heroCell, occupied, true) ??
        findEnemyNextStep(grid, e.x, e.y, heroCell, occupied, false);
    }

    if (nextStep && !(nextStep.x === heroCell.x && nextStep.y === heroCell.y)) {
      e.prevCell = { x: e.x, y: e.y };
      e.x = nextStep.x;
      e.y = nextStep.y;
      e.roomId = roomGrid[nextStep.y]?.[nextStep.x] ?? -1;
    }
  }
}

/**
 * 主人公に上下左右で隣接している敵をすべて取得する（正面を向いている敵を先頭に並べる）
 */
export function getEngagedEnemies(
  heroCell: MazeCell,
  enemies: FloorEnemy[],
  heroAngle: number,
): FloorEnemy[] {
  const adj = enemies.filter(
    (e) => e.enemy.hp > 0 && Math.abs(e.x - heroCell.x) + Math.abs(e.y - heroCell.y) === 1,
  );
  if (adj.length <= 1) return adj;
  return adj.sort((a, b) => {
    const angA = Math.abs(angDiff(Math.atan2(a.y - heroCell.y, a.x - heroCell.x), heroAngle));
    const angB = Math.abs(angDiff(Math.atan2(b.y - heroCell.y, b.x - heroCell.x), heroAngle));
    return angA - angB;
  });
}

/**
 * 不思議のダンジョン形式（複数の部屋＋1マス幅の連絡通路）のフロアを生成する
 */
export function generateMaze(
  cols = CRAWL_COLS,
  rows = CRAWL_ROWS,
  opts?: { stage?: number; monsterHouseChance?: number; rng?: () => number },
): {
  grid: number[][];
  stairs: MazeCell;
  depth: Map<string, number>;
  rooms: DungeonRoom[];
  roomGrid: number[][];
  spawn: MazeCell;
  monsterHouseRoomId: number | null;
} {
  const rng = opts?.rng ?? Math.random;
  const stage = opts?.stage ?? 1;
  const mhChance = opts?.monsterHouseChance ?? (stage >= 3 ? 0.22 : 0);

  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const roomGrid = Array.from({ length: rows }, () => Array(cols).fill(-1));

  // 3x3 セクター分割（各セクター内の部屋の壁間に必ず1マス以上の通路専用帯を確保）
  const secCols = 3;
  const secRows = 3;
  const usableW = cols - 2;
  const usableH = rows - 2;
  const cellW = Math.floor((usableW - (secCols - 1)) / secCols);
  const cellH = Math.floor((usableH - (secRows - 1)) / secRows);

  const sectorCoords = (sx: number, sy: number) => {
    const x0 = 1 + sx * (cellW + 1);
    const y0 = 1 + sy * (cellH + 1);
    return { x0, y0, w: cellW, h: cellH };
  };

  // 5〜6セクターを連結するようにランダム選択
  const targetRoomCount = 5 + (rng() < 0.55 ? 1 : 0);
  const startSx = Math.floor(rng() * secCols);
  const startSy = Math.floor(rng() * secRows);
  const pickedSectors: Array<{ sx: number; sy: number }> = [{ sx: startSx, sy: startSy }];
  const pickedSet = new Set<string>([`${startSx},${startSy}`]);
  const sectorEdges: Array<[number, number]> = [];

  while (pickedSectors.length < targetRoomCount) {
    const frontier: Array<{ fromIdx: number; sx: number; sy: number }> = [];
    for (let i = 0; i < pickedSectors.length; i++) {
      const s = pickedSectors[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = s.sx + dx;
        const ny = s.sy + dy;
        if (nx >= 0 && ny >= 0 && nx < secCols && ny < secRows && !pickedSet.has(`${nx},${ny}`)) {
          frontier.push({ fromIdx: i, sx: nx, sy: ny });
        }
      }
    }
    if (!frontier.length) break;
    const chosen = frontier[Math.floor(rng() * frontier.length)];
    const newIdx = pickedSectors.length;
    pickedSectors.push({ sx: chosen.sx, sy: chosen.sy });
    pickedSet.add(`${chosen.sx},${chosen.sy}`);
    sectorEdges.push([chosen.fromIdx, newIdx]);
  }

  // ループ通路を1本追加して「不思議のダンジョン」らしい回遊性を作る
  const extraEdges: Array<[number, number]> = [];
  for (let i = 0; i < pickedSectors.length; i++) {
    for (let j = i + 1; j < pickedSectors.length; j++) {
      const a = pickedSectors[i];
      const b = pickedSectors[j];
      if (Math.abs(a.sx - b.sx) + Math.abs(a.sy - b.sy) !== 1) continue;
      const already = sectorEdges.some(([u, v]) => (u === i && v === j) || (u === j && v === i));
      if (!already) extraEdges.push([i, j]);
    }
  }
  if (extraEdges.length > 0) {
    sectorEdges.push(extraEdges[Math.floor(rng() * extraEdges.length)]);
  }

  const rooms: DungeonRoom[] = pickedSectors.map((sec, idx) => {
    const band = sectorCoords(sec.sx, sec.sy);
    const maxRw = Math.max(3, Math.min(5, band.w - 2));
    const maxRh = Math.max(3, Math.min(5, band.h - 2));
    const rw = 3 + Math.floor(rng() * (maxRw - 2));
    const rh = 3 + Math.floor(rng() * (maxRh - 2));
    const oxMax = Math.max(0, band.w - 2 - rw);
    const oyMax = Math.max(0, band.h - 2 - rh);
    const rx = band.x0 + 1 + Math.floor(rng() * (oxMax + 1));
    const ry = band.y0 + 1 + Math.floor(rng() * (oyMax + 1));
    const cx = rx + Math.floor(rw / 2);
    const cy = ry + Math.floor(rh / 2);

    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        grid[y][x] = 0;
        roomGrid[y][x] = idx;
      }
    }

    return {
      id: idx,
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      cx,
      cy,
      isMonsterHouse: false,
      entrances: [],
    };
  });

  const carveCorridorCell = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < cols - 1 && y < rows - 1) {
      grid[y][x] = 0;
    }
  };

  for (const [ia, ib] of sectorEdges) {
    const a = rooms[ia];
    const b = rooms[ib];
    const sa = pickedSectors[ia];
    const sb = pickedSectors[ib];

    if (sa.sy === sb.sy) {
      // 横方向接続
      const left = sa.sx < sb.sx ? a : b;
      const right = sa.sx < sb.sx ? b : a;
      const leftSec = sa.sx < sb.sx ? sa : sb;
      const dividerX = 1 + (leftSec.sx + 1) * (cellW + 1) - 1;
      const y1 = left.y + Math.floor(rng() * left.h);
      const y2 = right.y + Math.floor(rng() * right.h);
      for (let x = left.x + left.w; x <= dividerX; x++) carveCorridorCell(x, y1);
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) carveCorridorCell(dividerX, y);
      for (let x = dividerX; x < right.x; x++) carveCorridorCell(x, y2);
    } else {
      // 縦方向接続
      const top = sa.sy < sb.sy ? a : b;
      const bottom = sa.sy < sb.sy ? b : a;
      const topSec = sa.sy < sb.sy ? sa : sb;
      const dividerY = 1 + (topSec.sy + 1) * (cellH + 1) - 1;
      const x1 = top.x + Math.floor(rng() * top.w);
      const x2 = bottom.x + Math.floor(rng() * bottom.w);
      for (let y = top.y + top.h; y <= dividerY; y++) carveCorridorCell(x1, y);
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) carveCorridorCell(x, dividerY);
      for (let y = dividerY; y < bottom.y; y++) carveCorridorCell(x2, y);
    }
  }

  // 各部屋の出入口（廊下側の1マス目）を収集
  for (const r of rooms) {
    const seen = new Set<string>();
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (grid[ny]?.[nx] === 0 && (roomGrid[ny]?.[nx] ?? -1) === -1) {
            const k = crawlKey(nx, ny);
            if (!seen.has(k)) {
              seen.add(k);
              r.entrances.push({ x: nx, y: ny });
            }
          }
        }
      }
    }
  }

  const spawn: MazeCell = { x: rooms[0].cx, y: rooms[0].cy };
  const { dist } = bfsGrid(grid, spawn.x, spawn.y, cols, rows);

  // スタート部屋から最も遠い部屋に階段を配置
  let stairsRoom = rooms[rooms.length - 1];
  let bestRoomDist = -1;
  for (const r of rooms) {
    if (r.id === 0) continue;
    const d = dist.get(crawlKey(r.cx, r.cy)) ?? -1;
    if (d > bestRoomDist) {
      bestRoomDist = d;
      stairsRoom = r;
    }
  }
  const stairs: MazeCell = { x: stairsRoom.cx, y: stairsRoom.cy };

  // 一定確率でスタート部屋・階段部屋以外の1部屋をモンスターハウスに設定
  let monsterHouseRoomId: number | null = null;
  if (rng() < mhChance) {
    const candidates = rooms.filter((r) => r.id !== 0 && r.id !== stairsRoom.id);
    if (candidates.length > 0) {
      const mh = candidates[Math.floor(rng() * candidates.length)];
      mh.isMonsterHouse = true;
      monsterHouseRoomId = mh.id;
    }
  }

  return { grid, stairs, depth: dist, rooms, roomGrid, spawn, monsterHouseRoomId };
}

/**
 * 50層ごとの「玄室」（迷宮・雑魚なし、中央大広間で入場即大ボス戦）を生成する
 */
export function generateSanctumChamber(cols = CRAWL_COLS, rows = CRAWL_ROWS): {
  grid: number[][];
  spawn: MazeCell;
  bossCell: MazeCell;
  stairs: MazeCell;
  depth: Map<string, number>;
  explored: Set<string>;
} {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(1));
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const minX = Math.max(1, cx - 2);
  const maxX = Math.min(cols - 2, cx + 2);
  const minY = Math.max(1, cy - 3);
  const maxY = Math.min(rows - 2, cy + 3);

  const depth = new Map<string, number>();
  const explored = new Set<string>();
  const spawn: MazeCell = { x: cx, y: maxY - 1 };
  const bossCell: MazeCell = { x: cx, y: cy };
  const stairs: MazeCell = { x: cx, y: minY + 1 };

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      grid[y][x] = 0;
      depth.set(crawlKey(x, y), Math.abs(x - spawn.x) + Math.abs(y - spawn.y));
    }
  }
  for (let y = minY - 1; y <= maxY + 1; y++) {
    for (let x = minX - 1; x <= maxX + 1; x++) {
      if (x >= 0 && y >= 0 && x < cols && y < rows) {
        explored.add(crawlKey(x, y));
      }
    }
  }

  return { grid, spawn, bossCell, stairs, depth, explored };
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

/**
 * ボス（階段マス）やその隣接警戒マスを可能な限り迂回してターゲットへの経路を求める
 */
export function findHeroSafePath(
  grid: number[][],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  enemies: FloorEnemy[],
): MazeCell[] | null {
  const boss = enemies.find((e) => e.enemy.hp > 0 && e.enemy.isBoss);
  if (!boss || (tx === boss.x && ty === boss.y)) {
    return bfsPath(grid, sx, sy, tx, ty);
  }

  const runFilteredBfs = (blocked: Set<string>): MazeCell[] | null => {
    const rows = grid.length;
    const cols = grid[0]?.length ?? CRAWL_COLS;
    const startK = crawlKey(sx, sy);
    const goalK = crawlKey(tx, ty);
    if (startK === goalK) return [{ x: sx, y: sy }];

    const prev = new Map<string, [number, number]>();
    const visited = new Set<string>([startK]);
    const q: Array<[number, number]> = [[sx, sy]];

    while (q.length > 0) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (grid[ny][nx] !== 0) continue;
        const nk = crawlKey(nx, ny);
        if (visited.has(nk)) continue;
        if (nk !== goalK && blocked.has(nk)) continue;

        visited.add(nk);
        prev.set(nk, [x, y]);
        if (nk === goalK) {
          const path: MazeCell[] = [];
          let cur: [number, number] | undefined = [tx, ty];
          while (cur) {
            path.unshift({ x: cur[0], y: cur[1] });
            cur = prev.get(crawlKey(cur[0], cur[1]));
          }
          return path;
        }
        q.push([nx, ny]);
      }
    }
    return null;
  };

  // 1) ボス本体＋ボス隣接4マスを回避（目標マス自体は許可）
  const strictBlocked = new Set<string>([crawlKey(boss.x, boss.y)]);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    strictBlocked.add(crawlKey(boss.x + dx, boss.y + dy));
  }
  const strictPath = runFilteredBfs(strictBlocked);
  if (strictPath) return strictPath;

  // 2) ボス本体マスのみ回避
  const bossOnlyPath = runFilteredBfs(new Set<string>([crawlKey(boss.x, boss.y)]));
  if (bossOnlyPath) return bossOnlyPath;

  return bfsPath(grid, sx, sy, tx, ty);
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

const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2] as const;

export function snapCardinalAngle(angle: number): number {
  const q = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
  return CARDINAL_ANGLES[q];
}

export function cardinalAngleFromDelta(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 0 : Math.PI;
  }
  return dy >= 0 ? Math.PI / 2 : -Math.PI / 2;
}

export const BASE_TURN_SPEED_FACTOR = 1 / 3;

export function getTurnSpeedScale(speed: 1 | 2 | 4): number {
  return speed * BASE_TURN_SPEED_FACTOR;
}

