import { useEffect, useRef, type ReactNode } from 'react';
import {
  CRAWL_COLS,
  CRAWL_ROWS,
  CRAWL_SIZE_KEY,
  CRAWL_STYLE_KEY,
  FLOOR_PALETTES,
  RARITIES,
} from '../game/constants';
import {
  ACCESSORY_COMBOS,
  resolveTurnAttackPlan,
  type ComboSlashStyle,
  type ComboVfxProfile,
  type TurnHitResult,
} from '../game/accessories';
import { playSfx } from '../game/audio';
import {
  advanceFairyCooldown,
  FAIRY_FLOOR_REDUCE_SEC,
  FAIRY_KILL_REDUCE_SEC,
  getActiveFairyBuff,
  getFairyProfile,
  getFairyRank,
} from '../game/fairy';
import { calcHeroStats, clamp, fmt, generateItem, rand } from '../game/items';
import {
  angDiff,
  bfsPath,
  cardinalAngleFromDelta,
  crawlKey,
  createEnemy,
  findChokeRetreatCell,
  findHeroSafePath,
  generateMaze,
  generateSanctumChamber,
  getBiome,
  getEngagedEnemies,
  getTurnSpeedScale,
  pickExplorationTarget,
  placeDungeonEnemies,
  placeMazeEvents,
  revealDungeonTiles,
  shouldEnterRestMode,
  shouldExitRestMode,
  shouldRetreatInRoom,
  snapCardinalAngle,
  stepEnemiesTowardHero,
} from '../game/maze';
import {
  getCompiledSprite,
  getWallTextureCanvas,
} from '../game/pixelArt';
import {
  getUnlockedSanctumTarget,
  isHeldAtGate,
  isSanctumFloor,
  resolveBossVictoryProgression,
  resolveDefeatRetreatStage,
  rollSanctumDropRarity,
  rollSanctumKeyDrop,
} from '../game/sanctum';
import type {
  AccessoryComboId,
  CrawlSizeMode,
  DungeonRoom,
  Enemy,
  FloorEnemy,
  FloorPalette,
  GameState,
  Item,
  MazeCell,
  MazeEvent,
  MoveStyle,
  SpriteKey,
} from '../game/types';

export interface DungeonEngineApi {
  resetToCurrentStage: () => void;
}

interface DungeonViewportProps {
  stateRef: React.MutableRefObject<GameState>;
  engineApiRef: React.MutableRefObject<DungeonEngineApi | null>;
  hudSnapshot: {
    stage: number;
    maxStage: number;
    clearedSanctumMax: number;
    sanctumKeys: number;
    autoProgress: boolean;
    kills: number;
    maxDmg: number;
    cleared100: boolean;
    comboId: AccessoryComboId;
    floorEncounters: number;
    stepsToStairs: number;
    stairsFound: boolean;
    hasFloorKey: boolean;
    explorePct: number;
    bossActive: boolean;
    paused: boolean;
    speed: 1 | 2 | 4;
    moveStyle: MoveStyle;
    sizeMode: CrawlSizeMode;
  };
  onSyncHud: (patch?: Partial<{
    floorEncounters: number;
    stepsToStairs: number;
    stairsFound: boolean;
    hasFloorKey: boolean;
    explorePct: number;
    bossActive: boolean;
    paused: boolean;
    speed: 1 | 2 | 4;
    moveStyle: MoveStyle;
    sizeMode: CrawlSizeMode;
  }>) => void;
  onAddLog: (msg: string, color?: string | null) => void;
  onItemDrop: (item: Item, isQuiet?: boolean) => void;
  onTriggerMilestone100: () => void;
  onOfflineElapsed: (elapsedSec: number) => void;
  onRequestSave: () => void;
  onEnterSanctum: (targetSanctum: number) => void;
  onRetreatSanctum: () => void;
  throttleCanvas?: boolean;
  fairyOverlay?: ReactNode;
}

const CRAWL_SIZES: Array<{ mode: CrawlSizeMode; label: string; w: number; h: number }> = [
  { mode: 'small', label: '小', w: 640, h: 360 },
  { mode: 'large', label: '大', w: 0, h: 0 },
];

export function DungeonViewport({
  stateRef,
  engineApiRef,
  hudSnapshot,
  onSyncHud,
  onAddLog,
  onItemDrop,
  onTriggerMilestone100,
  onOfflineElapsed,
  onRequestSave,
  onEnterSanctum,
  onRetreatSanctum,
  throttleCanvas = false,
  fairyOverlay,
}: DungeonViewportProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudBarRef = useRef<HTMLDivElement | null>(null);
  const fxLayerRef = useRef<HTMLDivElement | null>(null);
  const heroHpBarRef = useRef<HTMLDivElement | null>(null);
  const heroHpTextRef = useRef<HTMLDivElement | null>(null);
  const lootBannerRef = useRef<HTMLDivElement | null>(null);
  const battleBannerRef = useRef<HTMLDivElement | null>(null);

  const throttleCanvasRef = useRef(throttleCanvas);
  throttleCanvasRef.current = throttleCanvas;

  const callbacksRef = useRef({
    onSyncHud,
    onAddLog,
    onItemDrop,
    onTriggerMilestone100,
    onOfflineElapsed,
    onRequestSave,
  });
  callbacksRef.current = {
    onSyncHud,
    onAddLog,
    onItemDrop,
    onTriggerMilestone100,
    onOfflineElapsed,
    onRequestSave,
  };

  // Mutable simulation state (never drives 60Hz React state)
  const simRef = useRef({
    grid: [] as number[][],
    roomGrid: [] as number[][],
    rooms: [] as DungeonRoom[],
    visitedRooms: new Set<number>(),
    patrolActive: false,
    patrolVisitedRooms: new Set<number>(),
    patrolTargetRoomId: null as number | null,
    monsterHouseRoomId: null as number | null,
    chokeHoldRoomId: null as number | null,
    chokeWaitTurns: 0,
    pendingRoomRetreat: null as {
      roomId: number;
      retreatCell: MazeCell;
      faceAngle: number;
    } | null,
    stairs: { x: CRAWL_COLS - 2, y: CRAWL_ROWS - 2 } as MazeCell,
    hasFloorKey: false,
    turnCount: 0,
    turnAction: null as
      | {
          kind: 'step';
          fromX: number;
          fromY: number;
          toX: number;
          toY: number;
          fromAngle: number;
          targetAngle: number;
          t: number;
          duration: number;
          isRetreat?: boolean;
          retreatRoomId?: number;
        }
      | {
          kind: 'attack';
          fromAngle: number;
          targetAngle: number;
          targetFloorEnemyId?: string;
          t: number;
          duration: number;
          struck: boolean;
        }
      | {
          kind: 'wait' | 'rest';
          t: number;
          duration: number;
        }
      | null,
    explored: new Set<string>(),
    stepped: new Set<string>(),
    depth: new Map<string, number>(),
    exploreTarget: null as MazeCell | null,
    hero: { cx: 1, cy: 1, x: 1.5, y: 1.5, angle: 0 },
    path: null as MazeCell[] | null,
    enemyCell: null as MazeCell | null,
    enemyShake: 0,
    enemyFlashTimer: 0,
    screenShake: 0,
    heroHurtFlash: 0,
    comboFlashTimer: 0,
    comboFlashColor: 'rgba(125, 211, 252, 0.25)',
    hitstopTimer: 0,
    dying: null as { spriteId: SpriteKey; wx: number; wy: number; t: number; scale: number } | null,
    events: [] as MazeEvent[],
    floorEnemies: [] as FloorEnemy[],
    engagedCount: 0,
    floorStage: 0,
    palIdx: 0,
    inSanctumFloor: false,
    bossSpawned: false,
    paused: false,
    speed: 1 as 1 | 2 | 4,
    moveStyle: 'smooth' as MoveStyle,
    sizeIdx: 0,
    colStep: 2,
    palette: FLOOR_PALETTES[0] as FloorPalette,

    battleMode: 'WALKING' as 'WALKING' | 'FIGHTING' | 'RESTING' | 'TRANSITION' | 'RECOVERING',
    heroHp: 110,
    heroMaxHp: 110,
    rareEscapeTimer: 0,
    transTimer: 0,
    recoverTimer: 0,
    needNewFloor: false,
    enemy: null as Enemy | null,
  });

  // Zero-GC pooled particle, canvas slash, and staggered multi-hit VFX queues
  const fxPoolRef = useRef({
    particles: Array.from({ length: 96 }, () => ({
      active: false,
      x: 0.5,
      y: 0.5,
      vx: 0,
      vy: 0,
      size: 4,
      life: 0,
      maxLife: 0.4,
      color: '#fde047',
    })),
    pCursor: 0,
    slashes: Array.from({ length: 16 }, () => ({
      active: false,
      x: 0.5,
      y: 0.52,
      angle: -0.6,
      life: 0,
      maxLife: 0.22,
      color: '#ffffff',
      accent: '#fde047',
      secondary: '#38bdf8',
      thick: 4,
      style: 'flurry' as ComboSlashStyle,
      scale: 1,
      showRing: false,
    })),
    sCursor: 0,
    pendingHits: [] as Array<{
      delay: number;
      hit: TurnHitResult;
      vfx: ComboVfxProfile;
      soundOn: boolean;
    }>,
  });

  const bannerTimersRef = useRef<{
    loot: ReturnType<typeof setTimeout> | null;
    promote: ReturnType<typeof setTimeout> | null;
    battle: ReturnType<typeof setTimeout> | null;
  }>({ loot: null, promote: null, battle: null });

  const spawnCanvasParticles = (
    nx: number,
    ny: number,
    count: number,
    colors: string[],
    speedScale = 1,
  ) => {
    const pool = fxPoolRef.current;
    for (let i = 0; i < count; i++) {
      const p = pool.particles[pool.pCursor];
      pool.pCursor = (pool.pCursor + 1) % pool.particles.length;
      const ang = rand(0, Math.PI * 2);
      const spd = rand(0.14, 0.55) * speedScale;
      p.active = true;
      p.x = nx + rand(-0.04, 0.04);
      p.y = ny + rand(-0.04, 0.04);
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd - 0.14 * speedScale;
      p.size = Math.random() < 0.4 ? 5 : 3;
      p.maxLife = rand(0.28, 0.55);
      p.life = p.maxLife;
      p.color = colors[i % colors.length];
    }
  };

  const spawnCanvasSlash = (
    nx: number,
    ny: number,
    angle: number,
    opts: {
      accent: string;
      secondary: string;
      thick: number;
      style: ComboSlashStyle;
      scale?: number;
      showRing?: boolean;
      maxLife?: number;
    },
  ) => {
    const pool = fxPoolRef.current;
    const s = pool.slashes[pool.sCursor];
    pool.sCursor = (pool.sCursor + 1) % pool.slashes.length;
    s.active = true;
    s.x = nx + rand(-0.035, 0.035);
    s.y = ny + rand(-0.035, 0.035);
    s.angle = angle;
    s.maxLife = opts.maxLife ?? 0.24;
    s.life = s.maxLife;
    s.color = '#ffffff';
    s.accent = opts.accent;
    s.secondary = opts.secondary;
    s.thick = opts.thick;
    s.style = opts.style;
    s.scale = opts.scale ?? 1;
    s.showRing = Boolean(opts.showRing);
  };

  const spawnFloatText = (xPct: number, yPct: number, text: string, cls: string) => {
    const layer = fxLayerRef.current;
    if (!layer) return;
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${xPct + rand(-4, 4)}%`;
    el.style.top = `${yPct}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1250);
  };

  const triggerFrameFlash = (rarityId: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.classList.remove('flash-legend', 'flash-mythic');
    void frame.offsetWidth;
    if (rarityId >= 4) frame.classList.add('flash-mythic');
    else if (rarityId === 3) frame.classList.add('flash-legend');
  };

  const showLootBanner = (text: string, borderColor = '#fbbf24', isMythic = false) => {
    const el = lootBannerRef.current;
    if (!el) return;
    if (bannerTimersRef.current.loot) clearTimeout(bannerTimersRef.current.loot);
    if (bannerTimersRef.current.promote) clearTimeout(bannerTimersRef.current.promote);
    el.classList.remove('banner-shaking', 'mythic-text');
    el.style.borderColor = borderColor;
    el.textContent = text;
    el.style.background = isMythic
      ? 'linear-gradient(90deg, rgba(131,24,67,0.94), rgba(30,58,138,0.94))'
      : 'rgba(15, 23, 42, 0.94)';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    bannerTimersRef.current.loot = setTimeout(() => {
      if (lootBannerRef.current) {
        lootBannerRef.current.style.opacity = '0';
        lootBannerRef.current.style.transform = 'translateX(-50%) translateY(-10px)';
      }
    }, 2600);
  };

  const showPromoteLootBanner = (item: Item) => {
    const el = lootBannerRef.current;
    if (!el) return;
    const rInfo = RARITIES[item.rarity];
    if (bannerTimersRef.current.loot) clearTimeout(bannerTimersRef.current.loot);
    if (bannerTimersRef.current.promote) clearTimeout(bannerTimersRef.current.promote);

    if (Math.random() < 0.38) {
      const fakeR = item.rarity === 4 ? RARITIES[2] : RARITIES[1];
      el.classList.remove('banner-shaking');
      el.style.borderColor = fakeR.color;
      el.style.background = 'rgba(15, 23, 42, 0.94)';
      el.textContent = `${item.icon} [${fakeR.name}] ${item.name}…？`;
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
      el.classList.add('banner-shaking');

      bannerTimersRef.current.promote = setTimeout(() => {
        if (!lootBannerRef.current) return;
        lootBannerRef.current.classList.remove('banner-shaking');
        triggerFrameFlash(item.rarity);
        playSfx(item.rarity >= 4 ? 'mythic' : 'legend', stateRef.current.soundOn);
        lootBannerRef.current.style.borderColor = rInfo.color;
        if (item.rarity >= 4) {
          lootBannerRef.current.style.background = 'linear-gradient(90deg, rgba(131,24,67,0.95), rgba(30,58,138,0.95))';
          lootBannerRef.current.innerHTML = `✨ 昇格覚醒!! <span class="mythic-text">[${rInfo.name}] ${item.name}</span> ✨`;
        } else {
          lootBannerRef.current.innerHTML = `✨ 昇格!! <span style="color:${rInfo.color};">[${rInfo.name}] ${item.name}</span> ✨`;
        }
        bannerTimersRef.current.loot = setTimeout(() => {
          if (lootBannerRef.current) {
            lootBannerRef.current.style.opacity = '0';
            lootBannerRef.current.style.transform = 'translateX(-50%) translateY(-10px)';
          }
        }, 2600);
      }, 480);
    } else {
      triggerFrameFlash(item.rarity);
      playSfx(item.rarity >= 4 ? 'mythic' : 'legend', stateRef.current.soundOn);
      showLootBanner(
        item.rarity >= 4
          ? `🌈 MYTHIC DROP!! ${item.icon} ${item.name}`
          : `👑 LEGENDARY!! ${item.icon} ${item.name}`,
        rInfo.color,
        item.rarity >= 4,
      );
    }
  };

  const showBattleBanner = (text: string) => {
    const b = battleBannerRef.current;
    if (!b) return;
    if (bannerTimersRef.current.battle) clearTimeout(bannerTimersRef.current.battle);
    b.textContent = text;
    b.style.opacity = '1';
    bannerTimersRef.current.battle = setTimeout(() => {
      if (battleBannerRef.current) battleBannerRef.current.style.opacity = '0';
    }, 1300);
  };

  useEffect(() => {
    const sim = simRef.current;

    try {
      const si = parseInt(localStorage.getItem(CRAWL_SIZE_KEY) || '', 10);
      if (si >= 0 && si < CRAWL_SIZES.length) sim.sizeIdx = si;
      const st = localStorage.getItem(CRAWL_STYLE_KEY);
      if (st === 'smooth' || st === 'step') sim.moveStyle = st;
    } catch {
      // ignore storage
    }

    const updateMapPosition = () => {
      if (hudBarRef.current && mapCanvasRef.current) {
        mapCanvasRef.current.style.top = `${hudBarRef.current.offsetHeight + 6}px`;
      }
    };

    const fitCanvas = () => {
      const area = areaRef.current;
      const frame = frameRef.current;
      const cv = viewCanvasRef.current;
      const mapCv = mapCanvasRef.current;
      if (!area || !frame || !cv || !mapCv) return;

      const aw = area.clientWidth || 960;
      const ah = area.clientHeight || 540;
      const sz = CRAWL_SIZES[sim.sizeIdx];
      let w: number;
      let h: number;
      if (sz.w === 0) {
        const sc = Math.min(aw / 16, ah / 9);
        w = Math.floor(16 * sc);
        h = Math.floor(9 * sc);
      } else {
        const sc = Math.min(1, aw / sz.w, ah / sz.h);
        w = Math.floor(sz.w * sc);
        h = Math.floor(sz.h * sc);
      }
      frame.style.width = `${w}px`;
      frame.style.height = `${h}px`;
      cv.width = Math.max(320, w);
      cv.height = Math.max(180, h);
      const mapPx = Math.round(Math.min(150, Math.max(88, w * 0.16)));
      mapCv.style.width = `${mapPx}px`;
      mapCv.style.height = `${mapPx}px`;
      updateMapPosition();
    };

    const crawlReveal = () => {
      const h = sim.hero;
      const grid = sim.grid;
      if (!grid.length) return;
      if (sim.inSanctumFloor || !sim.rooms.length) {
        sim.explored.add(crawlKey(h.cx, h.cy));
        return;
      }

      const { enteredRoomId } = revealDungeonTiles(
        grid,
        sim.roomGrid,
        sim.rooms,
        sim.explored,
        h.cx,
        h.cy,
        h.angle,
      );

      if (enteredRoomId >= 0 && !sim.visitedRooms.has(enteredRoomId)) {
        sim.visitedRooms.add(enteredRoomId);
        sim.exploreTarget = null;
        const room = sim.rooms[enteredRoomId];
        if (room?.isMonsterHouse) {
          const aliveInRoom = sim.floorEnemies.filter(
            (e) => e.enemy.hp > 0 && e.roomId === enteredRoomId && !e.enemy.isBoss,
          ).length;
          if (aliveInRoom >= 2) {
            showBattleBanner('⚠️ モンスターハウスだ！');
            callbacksRef.current.onAddLog('⚠️ モンスターハウスに突入！', '#f472b6');
          }
        }
      }
    };

    const computeExploreHud = () => {
      const stairsFound = sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y));
      const walkableTotal = Math.max(1, sim.depth.size);
      let walkableExplored = 0;
      for (const k of sim.depth.keys()) {
        if (sim.explored.has(k)) walkableExplored++;
      }
      const explorePct =
        walkableExplored >= walkableTotal
          ? 100
          : Math.min(99, Math.round((walkableExplored / walkableTotal) * 100));
      const path = stairsFound ? bfsPath(sim.grid, sim.hero.cx, sim.hero.cy, sim.stairs.x, sim.stairs.y) : null;
      const stepsToStairs = path ? Math.max(0, path.length - 1) : 0;
      return { stairsFound, explorePct, stepsToStairs };
    };

    const syncHeroHp = (healFull = false) => {
      const st = stateRef.current;
      const stats = calcHeroStats(st.equipped, st.cleared100);
      sim.heroMaxHp = Math.max(1, stats.hp);
      if (healFull || sim.heroHp < 0) {
        sim.heroHp = sim.heroMaxHp;
      } else {
        sim.heroHp = clamp(sim.heroHp, 0, sim.heroMaxHp);
      }
      return stats;
    };

    const healHeroByPct = (pct: number): number => {
      syncHeroHp(false);
      if (sim.heroHp <= 0) return 0;
      const add = Math.max(1, Math.round(sim.heroMaxHp * pct));
      const nextHp = Math.min(sim.heroMaxHp, sim.heroHp + add);
      const healed = nextHp - sim.heroHp;
      sim.heroHp = nextHp;
      return healed;
    };

    const triggerMazeEvent = (ev: MazeEvent) => {
      const st = stateRef.current;

      if (ev.type === 'chest') {
        const stoneGain = Math.max(4, Math.round((5 + st.stage * 1.6) * rand(0.9, 1.4)));
        st.stones += stoneGain;
        const r = Math.random();
        let rar: 1 | 2 | 3 | 4 = 1;
        if (st.cleared100 && r < 0.06) rar = 4;
        else if (r < 0.26) rar = 3;
        else if (r < 0.65) rar = 2;

        const it = generateItem({
          stage: st.stage,
          forcedRarity: rar,
          isBoss: true,
          cleared100: st.cleared100,
        });
        playSfx('drop', st.soundOn);
        spawnFloatText(50, 40, `🎁 +${stoneGain}💎`, 'float-loot');
        callbacksRef.current.onAddLog(`部屋の宝箱を開封！ (+${stoneGain}💎)`, '#fbbf24');
        callbacksRef.current.onItemDrop(it, false);
        if (it.rarity >= 3) showPromoteLootBanner(it);
      } else if (ev.type === 'weapon' || ev.type === 'armor' || ev.type === 'accessory') {
        const it = generateItem({
          stage: st.stage,
          forcedSlot: ev.type,
          isBoss: Math.random() < 0.3,
          cleared100: st.cleared100,
        });
        playSfx('drop', st.soundOn);
        spawnFloatText(50, 38, `${it.icon} ${RARITIES[it.rarity].name}`, 'float-loot');
        callbacksRef.current.onItemDrop(it, false);
        if (it.rarity >= 3 && it.rarity > st.autoSalvageRarity) {
          showPromoteLootBanner(it);
        }
      } else if (ev.type === 'stones') {
        const stoneGain = Math.max(6, Math.round((8 + st.stage * 2.2) * rand(0.9, 1.35)));
        st.stones += stoneGain;
        playSfx('drop', st.soundOn);
        spawnFloatText(50, 42, `💎 +${fmt(stoneGain)}`, 'float-loot');
        callbacksRef.current.onAddLog(`強化石の結晶を拾った！ (+${fmt(stoneGain)}💎)`, '#38bdf8');
      } else if (ev.type === 'heal') {
        const healed = healHeroByPct(0.38);
        playSfx('drop', st.soundOn);
        spawnFloatText(34, 72, `💚 HP +${fmt(healed)}`, 'float-loot');
        spawnCanvasParticles(0.5, 0.65, 10, ['#4ade80', '#86efac', '#ffffff'], 0.8);
        callbacksRef.current.onAddLog(`💚 回復薬でHPを ${fmt(healed)} 回復した！`, '#4ade80');
      }
    };

    const checkPathEvents = () => {
      const h = sim.hero;
      for (const ev of sim.events) {
        if (ev.triggered) continue;
        if (
          Math.hypot(ev.x + 0.5 - h.x, ev.y + 0.5 - h.y) < 0.45 ||
          (h.cx === ev.x && h.cy === ev.y)
        ) {
          ev.triggered = true;
          triggerMazeEvent(ev);
        }
      }
    };

    const enterFloor = () => {
      const st = stateRef.current;
      sim.floorStage = st.stage;
      sim.events = [];
      sim.floorEnemies = [];
      sim.engagedCount = 0;
      sim.chokeHoldRoomId = null;
      sim.chokeWaitTurns = 0;
      sim.pendingRoomRetreat = null;
      sim.monsterHouseRoomId = null;
      sim.patrolActive = false;
      sim.patrolVisitedRooms = new Set<number>();
      sim.patrolTargetRoomId = null;
      sim.hasFloorKey = false;
      sim.turnCount = 0;
      sim.turnAction = null;
      sim.needNewFloor = false;
      fxPoolRef.current.pendingHits.length = 0;
      st.floorEncounters = 0;

      const palIdx = Math.floor((st.stage - 1) / 100) % FLOOR_PALETTES.length;
      sim.palIdx = palIdx;
      sim.inSanctumFloor = isSanctumFloor(st.stage);
      sim.palette = FLOOR_PALETTES[palIdx];

      if (isSanctumFloor(st.stage)) {
        const chamber = generateSanctumChamber(CRAWL_COLS, CRAWL_ROWS);
        sim.grid = chamber.grid;
        sim.roomGrid = [];
        sim.rooms = [];
        sim.visitedRooms = new Set();
        sim.stairs = chamber.stairs;
        sim.depth = chamber.depth;
        sim.explored = chamber.explored;
        sim.stepped = new Set([crawlKey(chamber.spawn.x, chamber.spawn.y)]);

        const h = sim.hero;
        h.cx = chamber.spawn.x;
        h.cy = chamber.spawn.y;
        h.x = h.cx + 0.5;
        h.y = h.cy + 0.5;
        h.angle = -Math.PI / 2;

        sim.dying = null;
        sim.bossSpawned = true;
        sim.hasFloorKey = true;
        sim.enemy = createEnemy(st.stage, true);
        sim.enemyCell = { ...chamber.bossCell };
        sim.exploreTarget = { ...chamber.bossCell };
        sim.path = null;
        sim.battleMode = 'FIGHTING';
        sim.engagedCount = 1;

        showBattleBanner(`🏛️ ${st.stage}F 玄室突入！大ボス戦！`);
        callbacksRef.current.onSyncHud({
          floorEncounters: 0,
          stepsToStairs: 2,
          stairsFound: true,
          hasFloorKey: true,
          explorePct: 100,
          bossActive: true,
          moveStyle: sim.moveStyle,
          speed: sim.speed,
          sizeMode: CRAWL_SIZES[sim.sizeIdx].mode,
        });
        return;
      }

      sim.bossSpawned = false;

      const generated = generateMaze(CRAWL_COLS, CRAWL_ROWS, { stage: st.stage });
      sim.grid = generated.grid;
      sim.roomGrid = generated.roomGrid;
      sim.rooms = generated.rooms;
      sim.stairs = generated.stairs;
      sim.depth = generated.depth;
      sim.monsterHouseRoomId = generated.monsterHouseRoomId;

      const h = sim.hero;
      h.cx = generated.spawn.x;
      h.cy = generated.spawn.y;
      h.x = h.cx + 0.5;
      h.y = h.cy + 0.5;
      h.angle = 0;

      sim.dying = null;
      sim.enemyCell = null;
      sim.enemy = null;
      sim.battleMode = 'WALKING';
      sim.explored = new Set();
      sim.visitedRooms = new Set([0]);
      sim.stepped = new Set([crawlKey(h.cx, h.cy)]);
      sim.exploreTarget = null;
      sim.path = null;

      // 初期部屋の廊下出口側を正確な4方向で向く
      const startRoom = sim.rooms[0];
      if (startRoom && startRoom.entrances.length > 0) {
        const ent = startRoom.entrances[0];
        h.angle = cardinalAngleFromDelta(ent.x - h.cx, ent.y - h.cy);
      }

      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      const stairsRoomId = sim.roomGrid[sim.stairs.y]?.[sim.stairs.x] ?? Math.max(0, sim.rooms.length - 1);
      sim.events = placeMazeEvents(sim.depth, sim.stairs, Math.random, sim.rooms, generated.spawn);
      sim.floorEnemies = placeDungeonEnemies({
        stage: st.stage,
        rooms: sim.rooms,
        startRoomId: 0,
        stairsRoomId,
        stairs: sim.stairs,
        spawn: generated.spawn,
        rareSlimeBonusPct: fairyProfile.rareSlimeBonusPct,
      });

      crawlReveal();

      const picked = pickExplorationTarget(
        sim.grid,
        h.cx,
        h.cy,
        h.angle,
        sim.explored,
        sim.stepped,
        sim.stairs,
        sim.events,
        Math.random,
        sim.roomGrid,
        sim.rooms,
        sim.visitedRooms,
        { hasFloorKey: sim.hasFloorKey, enemies: sim.floorEnemies },
      );
      sim.exploreTarget = picked.target;
      const startVisibleEnemies = sim.floorEnemies.filter(
        (e) => e.enemy.hp > 0 && (e.awakened || e.roomId === 0),
      );
      sim.path = findHeroSafePath(sim.grid, h.cx, h.cy, picked.target.x, picked.target.y, startVisibleEnemies);
      if (sim.path && sim.path.length > 1) {
        h.angle = cardinalAngleFromDelta(sim.path[1].x - h.cx, sim.path[1].y - h.cy);
      }

      const hudEx = computeExploreHud();
      callbacksRef.current.onSyncHud({
        floorEncounters: 0,
        stepsToStairs: hudEx.stepsToStairs,
        stairsFound: hudEx.stairsFound,
        hasFloorKey: false,
        explorePct: hudEx.explorePct,
        bossActive: false,
        moveStyle: sim.moveStyle,
        speed: sim.speed,
        sizeMode: CRAWL_SIZES[sim.sizeIdx].mode,
      });
    };

    const syncFloorHud = (bossActive?: boolean) => {
      if (sim.inSanctumFloor) {
        callbacksRef.current.onSyncHud({
          bossActive: bossActive ?? Boolean(sim.enemy?.isBoss),
          hasFloorKey: true,
        });
        return;
      }
      const hudEx = computeExploreHud();
      callbacksRef.current.onSyncHud({
        stepsToStairs: hudEx.stepsToStairs,
        stairsFound: hudEx.stairsFound,
        hasFloorKey: sim.hasFloorKey,
        explorePct: hudEx.explorePct,
        bossActive: bossActive ?? Boolean(sim.enemy?.isBoss),
      });
    };

    const engageAdjacentIfAny = (): boolean => {
      if (sim.inSanctumFloor) return false;
      const h = sim.hero;
      const engaged = getEngagedEnemies({ x: h.cx, y: h.cy }, sim.floorEnemies, h.angle);
      if (engaged.length === 0) return false;

      const lead = engaged[0];
      sim.enemy = lead.enemy;
      sim.enemyCell = { x: lead.x, y: lead.y };
      sim.engagedCount = engaged.length;
      if (lead.enemy.isBoss) sim.bossSpawned = true;
      sim.battleMode = 'FIGHTING';
      return true;
    };

    const descendStairs = () => {
      const st = stateRef.current;
      const prevStage = st.stage;
      const prog = resolveBossVictoryProgression(st);
      st.clearedSanctumMax = prog.nextClearedSanctumMax;
      st.maxStage = prog.nextMaxStage;
      st.stage = prog.nextStage;
      st.floorEncounters = 0;
      sim.needNewFloor = true;

      if (prog.sanctumCleared) {
        callbacksRef.current.onAddLog(
          `🏛️ ${prog.sanctumCleared}F玄室制覇！${st.stage}Fへ進出！`,
          '#4ade80',
        );
      } else if (prog.heldAtGate) {
        callbacksRef.current.onAddLog(
          `⛩️ ${prevStage}F突破！${prevStage + 1}F玄室が開放（大ボス討伐まで${prevStage}Fを周回待機）`,
          '#fbbf24',
        );
      } else {
        callbacksRef.current.onAddLog(`🪜 階段を降りてステージ${st.stage}へ！`, '#fbbf24');
      }

      sim.enemy = null;
      sim.enemyCell = null;
      sim.engagedCount = 0;
      sim.path = null;
      sim.turnAction = null;
      sim.battleMode = 'TRANSITION';
      sim.transTimer = 0.55;
      syncFloorHud(false);
    };

    const getNavTarget = (): MazeCell => {
      const h = sim.hero;
      const heroRoomId = sim.roomGrid[h.cy]?.[h.cx] ?? -1;

      if (!sim.inSanctumFloor) {
        if (sim.hasFloorKey && sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y))) {
          sim.exploreTarget = { x: sim.stairs.x, y: sim.stairs.y };
          return sim.exploreTarget;
        }

        // 同室内にいる敵、または既に覚醒した敵（鍵持ち含む）をアイテムより優先して倒す
        const roomEnemies = sim.floorEnemies
          .filter(
            (e) =>
              e.enemy.hp > 0 &&
              (e.awakened || (heroRoomId >= 0 && e.roomId === heroRoomId)),
          )
          .sort(
            (a, b) =>
              Math.abs(a.x - h.cx) + Math.abs(a.y - h.cy) - (Math.abs(b.x - h.cx) + Math.abs(b.y - h.cy)),
          );
        if (roomEnemies.length > 0) {
          return { x: roomEnemies[0].x, y: roomEnemies[0].y };
        }
      }

      const picked = pickExplorationTarget(
        sim.grid,
        h.cx,
        h.cy,
        h.angle,
        sim.explored,
        sim.stepped,
        sim.stairs,
        sim.events,
        Math.random,
        sim.roomGrid,
        sim.rooms,
        sim.visitedRooms,
        {
          hasFloorKey: sim.hasFloorKey,
          enemies: sim.floorEnemies,
          patrolVisitedRooms: sim.patrolVisitedRooms,
          patrolTargetRoomId: sim.patrolTargetRoomId,
        },
      );
      if (picked.reason === 'patrol') {
        if (!sim.patrolActive) {
          sim.patrolActive = true;
          sim.patrolVisitedRooms = new Set<number>();
          if (heroRoomId >= 0) sim.patrolVisitedRooms.add(heroRoomId);
          callbacksRef.current.onAddLog('🔍 探索100%！鍵持ちを探して全室を巡回中…', '#38bdf8');
        } else if (picked.patrolCycleReset) {
          sim.patrolVisitedRooms = new Set<number>();
          if (heroRoomId >= 0) sim.patrolVisitedRooms.add(heroRoomId);
        } else if (heroRoomId >= 0) {
          sim.patrolVisitedRooms.add(heroRoomId);
        }
        sim.patrolTargetRoomId = picked.patrolRoomId ?? null;
      } else {
        sim.patrolTargetRoomId = null;
      }
      sim.exploreTarget = picked.target;
      return sim.exploreTarget;
    };

    const handleEnemyDefeated = (defeatedFloorEnemy?: FloorEnemy) => {
      const enemy = defeatedFloorEnemy ? defeatedFloorEnemy.enemy : sim.enemy;
      if (!enemy) return;
      const st = stateRef.current;
      const isBoss = enemy.isBoss;
      st.kills += 1;
      if (!isBoss) st.floorEncounters += 1;

      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      const activeBuff = getActiveFairyBuff(st.fairy);
      const stoneBuffMult =
        activeBuff?.kind === 'stones' ? 1 + fairyProfile.buffStonePct / 100 : 1;

      const stoneScale = enemy.isRareEscape
        ? 4.5
        : enemy.isGreatDemon
          ? 8.0
          : enemy.isSanctumBoss
            ? 6.0
            : enemy.isMidBoss
              ? 3.8
              : isBoss
                ? 3.2
                : 1.0;
      const stoneGain = Math.max(
        1,
        Math.round(((3.4 + st.stage * 1.35) * stoneScale + rand(0, 1.8)) * stoneBuffMult),
      );
      st.stones += stoneGain;
      spawnFloatText(50, 42, `+${fmt(stoneGain)} 💎`, 'float-loot');

      if (enemy.isRareEscape) {
        st.chests += 1;
        callbacksRef.current.onAddLog(`👑 はぐれ撃破！ +${fmt(stoneGain)}💎 & 📦宝箱+1`, '#fde047');
        const rar: 2 | 3 | 4 = Math.random() < (st.cleared100 ? 0.08 : 0) ? 4 : Math.random() < 0.35 ? 3 : 2;
        const rareItem = generateItem({
          stage: st.stage,
          forcedRarity: rar,
          isBoss: true,
          cleared100: st.cleared100,
        });
        callbacksRef.current.onItemDrop(rareItem, false);
        if (rareItem.rarity >= 3) showPromoteLootBanner(rareItem);
      } else if (enemy.isSanctumBoss) {
        if (enemy.isGreatDemon) {
          st.chests += 5;
          st.mythicChests += 1;
          callbacksRef.current.onAddLog(`😈 ${st.stage}F覇王撃破！ 📦宝箱+5 & 🌈虹の宝箱+1`, '#f472b6');
          triggerFrameFlash(4);
          playSfx('mythic', st.soundOn);
        } else {
          st.chests += 3;
          callbacksRef.current.onAddLog(`🏛️ ${st.stage}F玄室大ボス撃破！ 高品質装備×2 & 📦宝箱+3`, '#fbbf24');
          triggerFrameFlash(3);
          playSfx('legend', st.soundOn);
        }

        // 玄室の大ボスは高品質装備を2個確定ドロップ
        let bestDrop: Item | null = null;
        for (let dIdx = 0; dIdx < 2; dIdx++) {
          const rar = rollSanctumDropRarity(st.cleared100, enemy.isGreatDemon);
          const dropped = generateItem({
            stage: st.stage,
            forcedRarity: rar,
            isBoss: true,
            cleared100: st.cleared100,
          });
          callbacksRef.current.onItemDrop(dropped, false);
          if (!bestDrop || dropped.rarity > bestDrop.rarity) {
            bestDrop = dropped;
          }
        }

        if (st.stage >= 100 && !st.cleared100) {
          st.cleared100 = true;
          showLootBanner('👑 100階「大魔王」討伐！裏世界＆虹装備解禁！', '#f472b6', true);
          callbacksRef.current.onTriggerMilestone100();
        } else if (enemy.isGreatDemon) {
          showLootBanner(`🌈 ${st.stage}F大魔王撃破！高品質装備×2＆虹箱×1 獲得！`, '#f472b6', true);
        } else if (bestDrop && bestDrop.rarity >= 3 && bestDrop.rarity > st.autoSalvageRarity) {
          showPromoteLootBanner(bestDrop);
        } else {
          showLootBanner(`🏛️ ${st.stage}F玄室踏破！高品質装備×2＆宝箱×3 獲得！`, '#fbbf24', false);
        }
      }

      let droppedSanctumKey = false;
      if (!enemy.isRareEscape && !enemy.isSanctumBoss && isBoss) {
        const chestGain = enemy.isMidBoss ? 2 : 1;
        st.chests += chestGain;
        droppedSanctumKey = rollSanctumKeyDrop(true);
        if (droppedSanctumKey) {
          st.sanctumKeys += 1;
          spawnFloatText(50, 18, '🗝️ 玄室の鍵 +1!', 'float-loot');
        }
      }

      if (!enemy.isRareEscape && !enemy.isSanctumBoss) {
        const dropChance = isBoss ? 0.85 : 0.32;
        if (Math.random() < dropChance) {
          const dropped = generateItem({ stage: st.stage, isBoss, cleared100: st.cleared100 });
          callbacksRef.current.onItemDrop(dropped, false);
          if (dropped.rarity >= 3 && dropped.rarity > st.autoSalvageRarity) {
            showPromoteLootBanner(dropped);
          } else if (dropped.rarity > st.autoSalvageRarity) {
            playSfx('drop', st.soundOn);
            spawnFloatText(50, 26, `${dropped.icon} ${RARITIES[dropped.rarity].name}!`, 'float-loot');
          }
        }
      }

      // 勝利後HP回復（18%）
      healHeroByPct(0.18);

      const deathWx = defeatedFloorEnemy ? defeatedFloorEnemy.x + 0.5 : sim.enemyCell ? sim.enemyCell.x + 0.5 : null;
      const deathWy = defeatedFloorEnemy ? defeatedFloorEnemy.y + 0.5 : sim.enemyCell ? sim.enemyCell.y + 0.5 : null;
      if (deathWx !== null && deathWy !== null) {
        sim.dying = {
          spriteId: enemy.spriteId,
          wx: deathWx,
          wy: deathWy,
          t: 0.48,
          scale: enemy.isSanctumBoss ? 1.45 : enemy.isBoss ? 1.25 : 0.95,
        };
      }
      spawnCanvasParticles(
        0.5,
        0.5,
        enemy.isBoss ? 26 : 16,
        enemy.isGreatDemon
          ? ['#f472b6', '#fde047', '#38bdf8', '#ffffff']
          : enemy.isBoss
            ? ['#fbbf24', '#f97316', '#ffffff']
            : ['#94a3b8', '#fde047', '#ffffff'],
        enemy.isBoss ? 1.45 : 1.1,
      );
      if (enemy.isBoss) {
        sim.screenShake = Math.max(sim.screenShake, 0.28);
        sim.hitstopTimer = Math.max(sim.hitstopTimer, 0.05);
      }

      const reduceSec = FAIRY_KILL_REDUCE_SEC + (isBoss ? FAIRY_FLOOR_REDUCE_SEC : 0);
      advanceFairyCooldown(st.fairy, reduceSec, fairyProfile.maxGifts);

      if (isBoss) {
        if (sim.inSanctumFloor || enemy.isSanctumBoss) {
          const prog = resolveBossVictoryProgression(st);
          st.clearedSanctumMax = prog.nextClearedSanctumMax;
          st.maxStage = prog.nextMaxStage;
          st.stage = prog.nextStage;
          st.floorEncounters = 0;
          sim.needNewFloor = true;

          if (prog.sanctumCleared) {
            callbacksRef.current.onAddLog(
              `🏛️ ${prog.sanctumCleared}F玄室制覇！${st.stage}Fへ進出！`,
              '#4ade80',
            );
          }

          sim.enemy = null;
          sim.enemyCell = null;
          sim.engagedCount = 0;
          sim.path = null;
          sim.turnAction = null;
          sim.battleMode = 'TRANSITION';
          sim.transTimer = 0.55;
          syncFloorHud(false);
          return;
        }

        // 通常階層：鍵持ちボス撃破で階層の鍵を獲得し、階段の封印を解く（この場では次階へワープしない）
        sim.hasFloorKey = true;
        sim.patrolActive = false;
        sim.patrolVisitedRooms.clear();
        sim.patrolTargetRoomId = null;
        sim.exploreTarget = null;
        sim.path = null;
        const chestGain = enemy.isMidBoss ? 2 : 1;
        if (droppedSanctumKey) {
          callbacksRef.current.onAddLog(
            `🗝️ ${enemy.name}を撃破！階層の鍵＆玄室の鍵+1を入手！(📦+${chestGain})`,
            '#c084fc',
          );
          showLootBanner('🗝️ 玄室の鍵を入手！階段の封印も解かれた！', '#c084fc', false);
        } else {
          callbacksRef.current.onAddLog(
            `🔑 ${enemy.name}を撃破！階層の鍵を入手！(📦+${chestGain})`,
            '#fbbf24',
          );
          showLootBanner('🔑 階層の鍵を入手！階段の封印が解かれた！', '#fbbf24', false);
        }
      }

      // 撃破時：他にも隣接している敵がいれば交戦対象を引き継ぐ
      if (!sim.inSanctumFloor) {
        const nextEngaged = getEngagedEnemies({ x: sim.hero.cx, y: sim.hero.cy }, sim.floorEnemies, sim.hero.angle);
        if (nextEngaged.length > 0) {
          const lead = nextEngaged[0];
          sim.enemy = lead.enemy;
          sim.enemyCell = { x: lead.x, y: lead.y };
          sim.engagedCount = nextEngaged.length;
          sim.battleMode = 'FIGHTING';
          syncFloorHud(Boolean(lead.enemy.isBoss));
          return;
        }
      }

      sim.enemy = null;
      sim.enemyCell = null;
      sim.engagedCount = 0;
      sim.path = null;
      sim.exploreTarget = null;

      syncHeroHp(false);
      if (!sim.inSanctumFloor && sim.chokeHoldRoomId === null && shouldEnterRestMode(sim.heroHp, sim.heroMaxHp)) {
        sim.battleMode = 'RESTING';
      } else {
        sim.battleMode = 'WALKING';
      }

      syncFloorHud(false);
    };

    const updateHeroHpBar = () => {
      syncHeroHp(false);
      const hpPct = clamp((sim.heroHp / Math.max(1, sim.heroMaxHp)) * 100, 0, 100);
      if (heroHpBarRef.current) {
        heroHpBarRef.current.style.width = `${hpPct}%`;
        heroHpBarRef.current.style.background =
          hpPct < 35
            ? 'linear-gradient(90deg, #dc2626, #f87171)'
            : 'linear-gradient(90deg, #16a34a, #4ade80)';
      }
      if (heroHpTextRef.current) {
        heroHpTextRef.current.textContent =
          sim.battleMode === 'RESTING'
            ? `💚 回復中 ${fmt(sim.heroHp)}/${fmt(sim.heroMaxHp)}`
            : `HP ${fmt(sim.heroHp)}/${fmt(sim.heroMaxHp)}`;
      }
    };

    const triggerHeroDefeat = () => {
      const st = stateRef.current;
      sim.heroHp = 0;
      sim.battleMode = 'RECOVERING';
      sim.recoverTimer = 1.1;
      sim.chokeHoldRoomId = null;
      sim.pendingRoomRetreat = null;
      sim.turnAction = null;
      const wasSanctum = isSanctumFloor(st.stage);
      const failedStage = st.stage;
      const retreatStage = resolveDefeatRetreatStage(st.stage);
      st.stage = retreatStage;
      if (wasSanctum) {
        showBattleBanner(`💀 ${failedStage}F玄室で敗北… ${retreatStage}Fへ撤退`);
        callbacksRef.current.onAddLog(
          `💀 ${failedStage}F玄室の大ボスに敗北！${retreatStage}Fで装備を整えよう`,
          '#f87171',
        );
      } else if (retreatStage < failedStage) {
        showBattleBanner(`撤退！ステージ${st.stage}で態勢を立て直す`);
        callbacksRef.current.onAddLog(`敗北によりステージ${st.stage}へ撤退しました`, '#f87171');
      } else {
        showBattleBanner('体勢を立て直した！');
      }
      sim.needNewFloor = true;
      callbacksRef.current.onSyncHud({ bossActive: false });
    };

    const emitHitVfx = (hit: TurnHitResult, vfx: ComboVfxProfile, soundOn: boolean) => {
      const tier = hit.critTier;
      const isFinisher = hit.isFinalHit && hit.totalHits > 1;
      const hitTag = hit.isFollowUp ? `×${hit.hitIndex + 1} ` : '';
      const label =
        tier === 3
          ? `🌈極${hitTag}${fmt(hit.dmg)}!!!`
          : tier === 2
            ? `🔥超${hitTag}${fmt(hit.dmg)}!!`
            : tier === 1
              ? `⚡${hitTag}${fmt(hit.dmg)}!`
              : hit.isFollowUp
                ? `❄️${hitTag}${fmt(hit.dmg)}`
                : `${fmt(hit.dmg)}`;
      const cls =
        tier === 3
          ? 'float-hyper-crit'
          : tier === 2
            ? 'float-super-crit'
            : tier === 1
              ? 'float-crit'
              : 'float-dmg';

      const xOffset = hit.isFollowUp ? (hit.hitIndex % 2 === 1 ? -9 : 9) : 0;
      const yPos = Math.max(18, 34 - hit.hitIndex * 4.5);
      spawnFloatText(50 + xOffset, yPos, label, cls);

      const style = vfx.slashStyle;
      const useSecondary =
        (style === 'frostfire' && (isFinisher || hit.hitIndex % 2 === 1)) ||
        (style === 'twin_spark' && hit.hitIndex % 2 === 1) ||
        (style === 'pierce' && hit.isFollowUp) ||
        (style === 'judgment' && hit.critTier >= 1);
      const accent =
        tier >= 3
          ? '#f472b6'
          : useSecondary
            ? vfx.secondaryColor
            : vfx.primaryColor;
      const secondary = useSecondary ? vfx.primaryColor : vfx.secondaryColor;
      const thick = vfx.slashThickness + (tier >= 2 ? 1.8 : tier === 1 ? 0.8 : 0);

      const baseAngles: number[] =
        style === 'flurry'
          ? [hit.hitIndex % 2 === 0 ? -0.78 : 0.78]
          : style === 'shatter' || style === 'flare_bolt' || style === 'molten_crush'
            ? [-0.66, 0.66]
            : style === 'bolt' || style === 'judgment'
              ? [-0.42, 0.52]
              : tier >= 2 || isFinisher
                ? [-0.62, 0.62]
                : [hit.hitIndex % 2 === 0 ? -0.62 : 0.62];

      const showRing =
        style === 'shatter' ||
        style === 'cleave' ||
        style === 'pierce' ||
        style === 'molten_crush' ||
        (style === 'frostfire' && isFinisher);

      for (const ang of baseAngles) {
        spawnCanvasSlash(
          0.5 + (hit.isFollowUp ? rand(-0.07, 0.07) : 0),
          0.5 + (hit.isFollowUp ? rand(-0.05, 0.05) : 0),
          ang + rand(-0.08, 0.08),
          {
            accent,
            secondary,
            thick,
            style,
            scale: style === 'cleave' || style === 'shatter' ? 1.22 : isFinisher ? 1.15 : 1.0,
            showRing,
            maxLife: tier >= 2 || style === 'shatter' || style === 'cleave' ? 0.28 : 0.21,
          },
        );
      }

      const pColors =
        tier >= 3
          ? ['#f472b6', '#fde047', '#38bdf8', '#4ade80']
          : vfx.particleColors;
      const pCount = Math.max(
        5,
        Math.round((vfx.particleCount * (hit.isFollowUp ? 0.65 : 1)) + (tier >= 2 ? 8 : tier === 1 ? 4 : 0)),
      );
      spawnCanvasParticles(
        0.5 + (hit.isFollowUp ? rand(-0.06, 0.06) : 0),
        0.5,
        pCount,
        pColors,
        (tier >= 1 ? 1.2 : 0.92) * (style === 'cleave' || style === 'bolt' ? 1.15 : 1),
      );

      if (hit.hitIndex === 0 || tier >= 1 || isFinisher) {
        const baseShake = tier >= 2 ? 0.2 : tier === 1 ? 0.12 : 0.075;
        sim.screenShake = Math.max(sim.screenShake, baseShake * vfx.shakeScale);
      }
      if (hit.hitIndex === 0 || isFinisher) {
        sim.comboFlashColor = vfx.flashColor;
        sim.comboFlashTimer = Math.max(sim.comboFlashTimer, 0.13);
      }
      playSfx(tier >= 1 ? 'crit' : 'hit', soundOn);
    };

    const executeHeroAttack = (targetFloorEnemy?: FloorEnemy | null): boolean => {
      const st = stateRef.current;
      const stats = syncHeroHp(false);

      const curFe: FloorEnemy | null = targetFloorEnemy ?? null;
      const curEnemy: Enemy | null = curFe ? curFe.enemy : sim.enemy;
      if (!curEnemy || curEnemy.hp <= 0) return false;

      const plan = resolveTurnAttackPlan(stats, curEnemy, st.cleared100);
      if (plan.maxHitDmg > st.maxDmg) {
        st.maxDmg = plan.maxHitDmg;
        callbacksRef.current.onSyncHud({});
      }

      curEnemy.hp -= plan.totalDmg;
      if (curFe) {
        curFe.shake = 0.18 + Math.min(0.16, (plan.hits.length - 1) * 0.05);
        curFe.flashTimer = 0.07;
      }
      sim.enemyShake = 0.18 + Math.min(0.16, (plan.hits.length - 1) * 0.05);
      sim.enemyFlashTimer = 0.07;

      const vfx = plan.combo.vfx;
      const speedDiv = Math.max(1, Math.min(2.2, sim.speed * 0.65));
      for (const hit of plan.hits) {
        if (hit.hitIndex === 0) {
          emitHitVfx(hit, vfx, st.soundOn);
        } else {
          fxPoolRef.current.pendingHits.push({
            delay: (hit.hitIndex * vfx.staggerSec) / speedDiv,
            hit,
            vfx,
            soundOn: st.soundOn,
          });
        }
      }

      const hitstopBase = plan.highestCritTier >= 2 ? 0.035 : 0;
      const totalHitstop = hitstopBase + vfx.extraHitstopSec;
      if (totalHitstop > 0) {
        sim.hitstopTimer = Math.max(sim.hitstopTimer, totalHitstop);
      }

      if (curEnemy.hp <= 0) {
        curEnemy.hp = 0;
        handleEnemyDefeated(curFe ?? undefined);
      }

      return sim.battleMode === 'TRANSITION';
    };

    const runEnemyTurn = () => {
      if (sim.battleMode === 'TRANSITION' || sim.battleMode === 'RECOVERING') return;
      sim.turnCount += 1;
      syncHeroHp(false);

      const applyEnemyStrike = (attackerEnemy: Enemy): boolean => {
        const eDmg = Math.max(1, Math.round(attackerEnemy.atk * rand(0.9, 1.1)));
        sim.heroHp = Math.max(0, sim.heroHp - eDmg);
        sim.heroHurtFlash = 0.22;
        if (attackerEnemy.isBoss) {
          sim.screenShake = Math.max(sim.screenShake, 0.16);
        }
        spawnFloatText(20, 76, `-${fmt(eDmg)}`, 'float-hero-dmg');
        if (sim.heroHp <= 0) {
          triggerHeroDefeat();
          return true;
        }
        return false;
      };

      if (sim.inSanctumFloor) {
        if (!sim.enemy || sim.enemy.hp <= 0) return;
        applyEnemyStrike(sim.enemy);
        return;
      }

      const h = sim.hero;
      const adjacentNow = getEngagedEnemies({ x: h.cx, y: h.cy }, sim.floorEnemies, h.angle);
      const adjacentSet = new Set(adjacentNow);

      // 1) 隣接中の敵が1回ずつ攻撃（鍵持ちボスは2ターンに1回行動）
      for (const fe of adjacentNow) {
        if (fe.enemy.hp <= 0) continue;
        if ((fe.enemy.isKeyKeeper || fe.enemy.isBoss) && sim.turnCount % 2 !== 0) {
          continue;
        }
        if (applyEnemyStrike(fe.enemy)) return;
        if ((sim.battleMode as string) === 'TRANSITION') return;
      }

      // 2) 非隣接の覚醒敵（毎ターン）および鍵持ちボス（2ターンに1回）が1歩移動
      stepEnemiesTowardHero(
        sim.grid,
        sim.roomGrid,
        { x: h.cx, y: h.cy },
        sim.stairs,
        sim.floorEnemies,
        sim.turnCount,
      );

      // 3) はぐれ黄金スライムのターン経過逃走
      for (const fe of sim.floorEnemies) {
        if (fe.enemy.hp <= 0 || !fe.enemy.isRareEscape) continue;
        if (!fe.awakened && !adjacentSet.has(fe)) continue;
        fe.rareEscapeTimer -= 1;
        if (fe.rareEscapeTimer <= 0) {
          fe.enemy.hp = 0;
          callbacksRef.current.onAddLog('💨 はぐれ黄金スライムは逃げ出した…', '#94a3b8');
          showBattleBanner('💨 逃げられた！（ペナルティなし）');
          if (sim.enemy === fe.enemy) {
            sim.enemy = null;
            sim.enemyCell = null;
          }
        }
      }

      // 4) 敵ターン後に隣接した敵がいれば戦闘態勢へ
      if (!engageAdjacentIfAny()) {
        sim.enemy = null;
        sim.enemyCell = null;
        sim.engagedCount = 0;
      }
      syncFloorHud();
    };

    const beginNextTurn = () => {
      const st = stateRef.current;
      const h = sim.hero;
      h.x = h.cx + 0.5;
      h.y = h.cy + 0.5;
      h.angle = snapCardinalAngle(h.angle);

      const speedScale = getTurnSpeedScale(sim.speed);
      const activeBuff = getActiveFairyBuff(st.fairy);
      const exploreMult =
        activeBuff?.kind === 'explore'
          ? 1 + getFairyProfile(getFairyRank(st.maxStage, st.cleared100)).buffExplorePct / 100
          : 1;

      if (sim.inSanctumFloor) {
        if (sim.enemy && sim.enemy.hp > 0 && sim.enemyCell) {
          sim.battleMode = 'FIGHTING';
          const targetAngle = cardinalAngleFromDelta(sim.enemyCell.x - h.cx, sim.enemyCell.y - h.cy);
          sim.turnAction = {
            kind: 'attack',
            fromAngle: h.angle,
            targetAngle,
            t: 0,
            duration: 0.28 / speedScale,
            struck: false,
          };
        }
        return;
      }

      if (sim.battleMode === 'RESTING') {
        syncHeroHp(false);
        if (engageAdjacentIfAny()) {
          // 回復中に敵が隣接したら即反撃へ
        } else if (!shouldExitRestMode(sim.heroHp, sim.heroMaxHp)) {
          sim.turnAction = {
            kind: 'rest',
            t: 0,
            duration: 0.34 / (speedScale * exploreMult),
          };
          return;
        } else {
          sim.battleMode = 'WALKING';
        }
      }

      // 前ターンで複数敵の部屋に入ったばかりなら、1歩後ろの通路入口へ退避して1対1を作る
      if (sim.pendingRoomRetreat) {
        const ret = sim.pendingRoomRetreat;
        sim.pendingRoomRetreat = null;
        const cellOccupied = sim.floorEnemies.some(
          (e) => e.enemy.hp > 0 && e.x === ret.retreatCell.x && e.y === ret.retreatCell.y,
        );
        if (!cellOccupied && shouldRetreatInRoom(sim.floorEnemies, ret.roomId)) {
          sim.battleMode = 'WALKING';
          sim.turnAction = {
            kind: 'step',
            fromX: h.cx,
            fromY: h.cy,
            toX: ret.retreatCell.x,
            toY: ret.retreatCell.y,
            fromAngle: h.angle,
            targetAngle: snapCardinalAngle(ret.faceAngle),
            t: 0,
            duration: (sim.moveStyle === 'step' ? 0.2 : 0.24) / (speedScale * exploreMult),
            isRetreat: true,
            retreatRoomId: ret.roomId,
          };
          return;
        }
      }

      // 隣接敵がいれば正面を正確な4方向に合わせて1回攻撃
      const engaged = getEngagedEnemies({ x: h.cx, y: h.cy }, sim.floorEnemies, h.angle);
      if (engaged.length > 0) {
        const lead = engaged[0];
        sim.enemy = lead.enemy;
        sim.enemyCell = { x: lead.x, y: lead.y };
        sim.engagedCount = engaged.length;
        if (lead.enemy.isBoss) sim.bossSpawned = true;
        sim.battleMode = 'FIGHTING';
        const targetAngle = cardinalAngleFromDelta(lead.x - h.cx, lead.y - h.cy);
        syncFloorHud(Boolean(lead.enemy.isBoss));
        sim.turnAction = {
          kind: 'attack',
          fromAngle: h.angle,
          targetAngle,
          targetFloorEnemyId: lead.id,
          t: 0,
          duration: 0.26 / speedScale,
          struck: false,
        };
        return;
      }

      sim.enemy = null;
      sim.enemyCell = null;
      sim.engagedCount = 0;
      sim.battleMode = 'WALKING';

      // 通路引き待機中：同室の非ボス敵が入口へ来るのを1ターンずつ待機
      if (sim.chokeHoldRoomId !== null) {
        const holdAlive = sim.floorEnemies.some(
          (e) => e.enemy.hp > 0 && !e.enemy.isBoss && e.roomId === sim.chokeHoldRoomId,
        );
        if (holdAlive && sim.chokeWaitTurns < 8) {
          sim.chokeWaitTurns += 1;
          sim.turnAction = {
            kind: 'wait',
            t: 0,
            duration: 0.26 / (speedScale * exploreMult),
          };
          return;
        }
        sim.chokeHoldRoomId = null;
        sim.chokeWaitTurns = 0;
        sim.exploreTarget = null;
        sim.path = null;
      }

      // 次の移動先を決定して1マス歩行ターンを開始
      if (sim.hasFloorKey && h.cx === sim.stairs.x && h.cy === sim.stairs.y) {
        descendStairs();
        return;
      }
      const target = getNavTarget();
      if (sim.path && sim.path.length > 0) {
        const end = sim.path[sim.path.length - 1];
        if (end.x !== target.x || end.y !== target.y || sim.path[0].x !== h.cx || sim.path[0].y !== h.cy) {
          sim.path = null;
        }
      }
      if (!sim.path || sim.path.length < 2) {
        const curHeroRoom = sim.roomGrid[h.cy]?.[h.cx] ?? -1;
        const visibleThreats = sim.floorEnemies.filter(
          (e) => e.enemy.hp > 0 && (e.awakened || (curHeroRoom >= 0 && e.roomId === curHeroRoom)),
        );
        sim.path = findHeroSafePath(sim.grid, h.cx, h.cy, target.x, target.y, visibleThreats);
      }
      if (!sim.path || sim.path.length < 2) {
        sim.exploreTarget = null;
        sim.path = null;
        sim.turnAction = {
          kind: 'wait',
          t: 0,
          duration: 0.22 / (speedScale * exploreMult),
        };
        return;
      }

      const nextCell = sim.path[1];
      sim.path = sim.path.slice(1);

      // 敵が移動先を塞いでいる場合は再計算/待機
      const blocker = sim.floorEnemies.find(
        (e) => e.enemy.hp > 0 && e.x === nextCell.x && e.y === nextCell.y,
      );
      if (blocker) {
        sim.path = null;
        sim.turnAction = {
          kind: 'wait',
          t: 0,
          duration: 0.2 / (speedScale * exploreMult),
        };
        return;
      }

      // 未訪問部屋の入口前でHPが60%未満なら入室前に回復待機へ移行
      const curRoom = sim.roomGrid[h.cy]?.[h.cx] ?? -1;
      const nextRoom = sim.roomGrid[nextCell.y]?.[nextCell.x] ?? -1;
      syncHeroHp(false);
      if (
        curRoom === -1 &&
        nextRoom >= 0 &&
        !sim.visitedRooms.has(nextRoom) &&
        shouldEnterRestMode(sim.heroHp, sim.heroMaxHp)
      ) {
        sim.battleMode = 'RESTING';
        sim.path = null;
        sim.turnAction = {
          kind: 'rest',
          t: 0,
          duration: 0.34 / (speedScale * exploreMult),
        };
        return;
      }

      const stepAngle = cardinalAngleFromDelta(nextCell.x - h.cx, nextCell.y - h.cy);
      sim.turnAction = {
        kind: 'step',
        fromX: h.cx,
        fromY: h.cy,
        toX: nextCell.x,
        toY: nextCell.y,
        fromAngle: h.angle,
        targetAngle: stepAngle,
        t: 0,
        duration: (sim.moveStyle === 'step' ? 0.2 : 0.24) / (speedScale * exploreMult),
      };
    };

    const stepBattle = (rawDt: number) => {
      const st = stateRef.current;
      const speedDt = rawDt * sim.speed;

      if (sim.battleMode === 'TRANSITION') {
        sim.transTimer -= speedDt;
        if (sim.transTimer <= 0) {
          if (st.stage !== sim.floorStage || sim.needNewFloor) {
            sim.needNewFloor = false;
            enterFloor();
          } else {
            sim.battleMode = 'WALKING';
          }
        }
        updateHeroHpBar();
        return;
      }

      if (sim.battleMode === 'RECOVERING') {
        sim.recoverTimer -= speedDt;
        if (sim.recoverTimer <= 0) {
          syncHeroHp(true);
          enterFloor();
        }
        updateHeroHpBar();
        return;
      }

      if (!sim.turnAction) {
        beginNextTurn();
      }

      const action = sim.turnAction;
      if (!action) {
        updateHeroHpBar();
        return;
      }

      action.t += rawDt;
      const p = clamp(action.t / Math.max(0.001, action.duration), 0, 1);
      const h = sim.hero;

      if (action.kind === 'step') {
        if (sim.moveStyle === 'step') {
          if (p >= 0.28) {
            h.angle = action.targetAngle;
          }
          if (p >= 0.85) {
            h.x = action.toX + 0.5;
            h.y = action.toY + 0.5;
          }
        } else {
          const ad = angDiff(action.targetAngle, action.fromAngle);
          if (Math.abs(ad) > 0.001) {
            const turnP = clamp(p / 0.36, 0, 1);
            const easeTurn = turnP * (2 - turnP);
            h.angle = turnP >= 1 ? action.targetAngle : action.fromAngle + ad * easeTurn;
          } else {
            h.angle = action.targetAngle;
          }
          const posP = Math.abs(ad) > 0.001 ? clamp((p - 0.14) / 0.86, 0, 1) : p;
          h.x = action.fromX + 0.5 + (action.toX - action.fromX) * posP;
          h.y = action.fromY + 0.5 + (action.toY - action.fromY) * posP;
        }

        if (p >= 1) {
          h.cx = action.toX;
          h.cy = action.toY;
          h.x = h.cx + 0.5;
          h.y = h.cy + 0.5;
          h.angle = action.targetAngle;
          sim.turnAction = null;

          healHeroByPct(0.03);
          sim.stepped.add(crawlKey(h.cx, h.cy));
          crawlReveal();
          checkPathEvents();

          if (action.isRetreat && action.retreatRoomId !== undefined) {
            sim.chokeHoldRoomId = action.retreatRoomId;
            sim.chokeWaitTurns = 0;
            sim.exploreTarget = null;
            sim.path = null;
            runEnemyTurn();
            updateHeroHpBar();
            return;
          }

          if (!sim.inSanctumFloor && sim.hasFloorKey && h.cx === sim.stairs.x && h.cy === sim.stairs.y) {
            descendStairs();
            updateHeroHpBar();
            return;
          }

          const roomId = sim.roomGrid[h.cy]?.[h.cx] ?? -1;
          const prevRoomId = sim.roomGrid[action.fromY]?.[action.fromX] ?? -1;
          if (sim.patrolActive && roomId >= 0) {
            sim.patrolVisitedRooms.add(roomId);
            if (sim.patrolTargetRoomId === roomId) {
              sim.patrolTargetRoomId = null;
              sim.exploreTarget = null;
              sim.path = null;
            }
          }
          if (prevRoomId === -1 && roomId >= 0 && sim.chokeHoldRoomId !== roomId) {
            for (const e of sim.floorEnemies) {
              if (e.enemy.hp > 0 && e.roomId === roomId) {
                e.awakened = true;
              }
            }
            if (shouldRetreatInRoom(sim.floorEnemies, roomId)) {
              const retreat = findChokeRetreatCell(
                sim.grid,
                sim.roomGrid,
                { x: h.cx, y: h.cy },
                roomId,
                sim.floorEnemies,
                sim.stairs,
                { x: action.fromX, y: action.fromY },
              );
              if (retreat) {
                sim.pendingRoomRetreat = {
                  roomId,
                  retreatCell: retreat.cell,
                  faceAngle: snapCardinalAngle(retreat.faceAngle),
                };
              }
            }
            sim.path = null;
            sim.exploreTarget = null;
          } else if (roomId >= 0) {
            for (const e of sim.floorEnemies) {
              if (e.enemy.hp > 0 && e.roomId === roomId && !e.awakened) {
                e.awakened = true;
              }
            }
          }

          runEnemyTurn();
        }
      } else if (action.kind === 'attack') {
        const turnP = clamp(p / 0.34, 0, 1);
        const ad = angDiff(action.targetAngle, action.fromAngle);
        if (sim.moveStyle === 'step' || turnP >= 1 || Math.abs(ad) < 0.001) {
          h.angle = action.targetAngle;
        } else {
          const easeTurn = turnP * (2 - turnP);
          h.angle = action.fromAngle + ad * easeTurn;
        }

        if (p >= 0.38 && !action.struck) {
          action.struck = true;
          h.x = h.cx + 0.5;
          h.y = h.cy + 0.5;
          h.angle = action.targetAngle;
          const targetFe = action.targetFloorEnemyId
            ? sim.floorEnemies.find((fe) => fe.id === action.targetFloorEnemyId && fe.enemy.hp > 0) ?? null
            : null;
          const transitioned = executeHeroAttack(targetFe);
          if (transitioned) {
            sim.turnAction = null;
            updateHeroHpBar();
            return;
          }
        }

        if (p >= 1) {
          h.angle = action.targetAngle;
          sim.turnAction = null;
          runEnemyTurn();
        }
      } else if (action.kind === 'rest') {
        if (p >= 1) {
          healHeroByPct(0.14);
          spawnCanvasParticles(0.5, 0.72, 4, ['#4ade80', '#86efac'], 0.55);
          sim.turnAction = null;
          runEnemyTurn();
          syncHeroHp(false);
          if (sim.battleMode === 'RESTING' && shouldExitRestMode(sim.heroHp, sim.heroMaxHp)) {
            sim.battleMode = 'WALKING';
          }
        }
      } else if (action.kind === 'wait') {
        if (p >= 1) {
          sim.turnAction = null;
          runEnemyTurn();
        }
      }

      updateHeroHpBar();
    };

    const drawSprite = (
      ctx: CanvasRenderingContext2D,
      W: number,
      H: number,
      wx: number,
      wy: number,
      spriteId: SpriteKey,
      fallbackIcon: string,
      zbuf: Float32Array,
      scale: number,
      alpha: number,
      shakeX: number,
      glowColor: string | null,
      nowMs: number,
      flashWhite = false,
      auraColor: string | null = null,
      telegraph = false,
    ) => {
      const h = sim.hero;
      const relX = wx - h.x;
      const relY = wy - h.y;
      const dirX = Math.cos(h.angle);
      const dirY = Math.sin(h.angle);
      const planeX = -dirY * 0.66;
      const planeY = dirX * 0.66;
      const invDet = 1 / (planeX * dirY - dirX * planeY);
      const tx = invDet * (dirY * relX - dirX * relY);
      const ty = invDet * (-planeY * relX + planeX * relY);
      if (ty <= 0.15) return;
      const screenX = (W / 2) * (1 + tx / ty);
      const size = Math.min(H * 1.45, (H / ty) * scale * 0.88);
      const colStep = sim.colStep || 2;
      const col = Math.max(0, Math.min(zbuf.length - 1, Math.floor(screenX / colStep)));
      if (ty > zbuf[col] + 0.05) return;

      const bob = Math.sin(nowMs * 0.0055 + wx) * Math.min(5, size * 0.025);
      const cx = screenX + shakeX;
      const cy = H / 2 + size * 0.06 + bob;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Grounded drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(screenX, H / 2 + size * 0.44, size * 0.38, Math.max(3, size * 0.1), 0, 0, Math.PI * 2);
      ctx.fill();

      // Boss / Sanctum pulsing magic aura ring
      if (auraColor) {
        const pulse = 0.88 + Math.sin(nowMs * 0.008) * 0.12;
        ctx.strokeStyle = auraColor;
        ctx.lineWidth = Math.max(1.5, size * 0.025);
        ctx.beginPath();
        ctx.ellipse(cx, cy, size * 0.56 * pulse, size * 0.56 * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      const compiled = getCompiledSprite(spriteId);
      if (compiled) {
        const frameIdx: 0 | 1 = Math.floor(nowMs / 360) % 2 === 0 ? 0 : 1;
        const src = flashWhite ? compiled.flashFrames[frameIdx] : compiled.frames[frameIdx];
        ctx.imageSmoothingEnabled = false;
        if (glowColor) {
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 14;
        }
        ctx.drawImage(src, Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size));
      } else {
        if (glowColor) {
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = 14;
        }
        ctx.font = `${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fallbackIcon, cx, cy);
      }

      // Boss attack windup telegraph glint
      if (telegraph) {
        const gSize = Math.max(6, size * 0.14);
        const gx = cx;
        const gy = cy - size * 0.38;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fde047';
        ctx.fillRect(gx - gSize, gy - 1.5, gSize * 2, 3);
        ctx.fillRect(gx - 1.5, gy - gSize, 3, gSize * 2);
      }

      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    };

    const renderMap = () => {
      const mapCv = mapCanvasRef.current;
      if (!mapCv) return;
      const mctx = mapCv.getContext('2d');
      if (!mctx) return;
      const grid = sim.grid;
      if (!grid.length) return;
      const S = mapCv.width / CRAWL_COLS;
      mctx.fillStyle = 'rgba(2,6,16,1)';
      mctx.fillRect(0, 0, mapCv.width, mapCv.height);

      const h = sim.hero;
      const heroRoomId = sim.inSanctumFloor ? 0 : (sim.roomGrid[h.cy]?.[h.cx] ?? -1);

      for (const k of sim.explored) {
        const [x, y] = k.split(',').map(Number);
        if (grid[y][x] === 1) {
          mctx.fillStyle = '#526d96';
        } else {
          const rId = sim.roomGrid[y]?.[x] ?? -1;
          if (rId >= 0) {
            mctx.fillStyle = rId === sim.monsterHouseRoomId ? '#581c87' : '#264b82';
          } else {
            // 通った通路を明るく見分けやすく描画
            mctx.fillStyle = sim.stepped.has(k) ? '#3b69ad' : '#254372';
          }
        }
        mctx.fillRect(x * S, y * S, S, S);
      }

      for (const ev of sim.events) {
        if (ev.triggered) continue;
        if (sim.explored.has(crawlKey(ev.x, ev.y))) {
          mctx.fillStyle =
            ev.type === 'stones'
              ? '#38bdf8'
              : ev.type === 'heal'
                ? '#4ade80'
                : '#fde047';
          mctx.beginPath();
          mctx.arc((ev.x + 0.5) * S, (ev.y + 0.5) * S, Math.max(2.0, S * 0.34), 0, Math.PI * 2);
          mctx.fill();
        }
      }

      if (sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y))) {
        if (sim.hasFloorKey) {
          mctx.fillStyle = '#fbbf24';
          mctx.fillRect(sim.stairs.x * S + 1, sim.stairs.y * S + 1, S - 2, S - 2);
        } else {
          mctx.strokeStyle = '#fbbf24';
          mctx.lineWidth = 1.5;
          mctx.strokeRect(sim.stairs.x * S + 1, sim.stairs.y * S + 1, Math.max(2, S - 2), Math.max(2, S - 2));
        }
      }

      if (sim.inSanctumFloor) {
        if (sim.enemy && sim.enemyCell && sim.explored.has(crawlKey(sim.enemyCell.x, sim.enemyCell.y))) {
          mctx.fillStyle = '#c084fc';
          mctx.fillRect(sim.enemyCell.x * S + 1, sim.enemyCell.y * S + 1, S - 2, S - 2);
        }
      } else {
        for (const fe of sim.floorEnemies) {
          if (fe.enemy.hp <= 0) continue;
          if (!sim.explored.has(crawlKey(fe.x, fe.y))) continue;
          const inSight =
            (heroRoomId >= 0 && fe.roomId === heroRoomId) ||
            Math.abs(fe.x - h.cx) + Math.abs(fe.y - h.cy) <= 1;
          if (!inSight) continue;
          mctx.fillStyle = fe.enemy.isRareEscape
            ? Date.now() % 400 < 200
              ? '#fde047'
              : '#38bdf8'
            : fe.enemy.isBoss
              ? '#f59e0b'
              : '#f87171';
          mctx.fillRect(fe.x * S + 1, fe.y * S + 1, Math.max(2, S - 2), Math.max(2, S - 2));
        }
      }
      const cx = h.x * S;
      const cy = h.y * S;
      mctx.save();
      mctx.translate(cx, cy);
      mctx.rotate(h.angle);
      mctx.fillStyle = '#4ade80';
      mctx.beginPath();
      mctx.moveTo(6, 0);
      mctx.lineTo(-4, -4);
      mctx.lineTo(-4, 4);
      mctx.closePath();
      mctx.fill();
      mctx.restore();
    };

    let lastRender = performance.now();
    const renderCrawler = () => {
      const now = performance.now();
      const rdt = Math.min(0.05, (now - lastRender) / 1000);
      lastRender = now;
      if (sim.enemyShake > 0) sim.enemyShake = Math.max(0, sim.enemyShake - rdt);
      if (sim.enemyFlashTimer > 0) sim.enemyFlashTimer = Math.max(0, sim.enemyFlashTimer - rdt);
      for (const fe of sim.floorEnemies) {
        if (fe.shake > 0) fe.shake = Math.max(0, fe.shake - rdt);
        if (fe.flashTimer > 0) fe.flashTimer = Math.max(0, fe.flashTimer - rdt);
      }
      if (sim.screenShake > 0) sim.screenShake = Math.max(0, sim.screenShake - rdt);
      if (sim.heroHurtFlash > 0) sim.heroHurtFlash = Math.max(0, sim.heroHurtFlash - rdt);
      if (sim.comboFlashTimer > 0) sim.comboFlashTimer = Math.max(0, sim.comboFlashTimer - rdt);
      if (sim.dying) {
        sim.dying.t -= rdt;
        if (sim.dying.t <= 0) sim.dying = null;
      }

      // Advance zero-GC pooled particles, canvas slashes, and staggered multi-hit VFX
      const pool = fxPoolRef.current;
      if (pool.pendingHits.length > 0 && !sim.paused) {
        for (let i = pool.pendingHits.length - 1; i >= 0; i--) {
          const entry = pool.pendingHits[i];
          entry.delay -= rdt;
          if (entry.delay <= 0) {
            pool.pendingHits.splice(i, 1);
            emitHitVfx(entry.hit, entry.vfx, entry.soundOn);
          }
        }
      }
      for (const p of pool.particles) {
        if (!p.active) continue;
        p.life -= rdt;
        if (p.life <= 0) {
          p.active = false;
          continue;
        }
        p.x += p.vx * rdt;
        p.y += p.vy * rdt;
        p.vy += 0.72 * rdt;
      }
      for (const sl of pool.slashes) {
        if (!sl.active) continue;
        sl.life -= rdt;
        if (sl.life <= 0) sl.active = false;
      }

      const cv = viewCanvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const W = cv.width;
      const H = cv.height;
      if (!W || !H || !sim.grid.length) return;

      const h = sim.hero;
      const grid = sim.grid;
      const pal = sim.palette;
      const horizon = H / 2;
      const wallTex = getWallTextureCanvas(pal, sim.palIdx, sim.inSanctumFloor);
      const heroRoomId = sim.inSanctumFloor ? 0 : (sim.roomGrid[h.cy]?.[h.cx] ?? -1);
      const inCorridor = !sim.inSanctumFloor && heroRoomId === -1;

      ctx.save();
      if (sim.screenShake > 0) {
        const mag = sim.screenShake * 18;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }

      const ceil = ctx.createLinearGradient(0, 0, 0, horizon);
      ceil.addColorStop(0, sim.inSanctumFloor ? '#0b0316' : pal.ceil0);
      ceil.addColorStop(1, sim.inSanctumFloor ? '#220e3d' : inCorridor ? '#02050e' : pal.ceil1);
      ctx.fillStyle = ceil;
      ctx.fillRect(0, 0, W, horizon);

      const fl = ctx.createLinearGradient(0, horizon, 0, H);
      fl.addColorStop(0, sim.inSanctumFloor ? '#1e0b36' : inCorridor ? '#02050e' : pal.floor0);
      fl.addColorStop(1, sim.inSanctumFloor ? '#07020e' : pal.floor1);
      ctx.fillStyle = fl;
      ctx.fillRect(0, horizon, W, H - horizon);

      // Subtle retro perspective floor depth lines
      ctx.fillStyle = sim.inSanctumFloor
        ? 'rgba(192,132,252,0.08)'
        : inCorridor
          ? 'rgba(255,255,255,0.02)'
          : 'rgba(255,255,255,0.045)';
      for (let step = 1; step <= 5; step++) {
        const fy = horizon + ((step * step) / 25) * (H - horizon);
        ctx.fillRect(0, Math.round(fy), W, 1);
      }

      if (inCorridor) {
        // 通路では奥の床・天井も暗く落とし、1マス先までしか見えない松明視界にする
        const corrDark = ctx.createLinearGradient(0, horizon - H * 0.24, 0, horizon + H * 0.24);
        corrDark.addColorStop(0, 'rgba(2,5,14,0)');
        corrDark.addColorStop(0.5, 'rgba(2,5,14,0.96)');
        corrDark.addColorStop(1, 'rgba(2,5,14,0)');
        ctx.fillStyle = corrDark;
        ctx.fillRect(0, horizon - H * 0.24, W, H * 0.48);
      }

      const dirX = Math.cos(h.angle);
      const dirY = Math.sin(h.angle);
      const planeX = -dirY * 0.66;
      const planeY = dirX * 0.66;

      const colStep = W > 800 ? 3 : 2;
      sim.colStep = colStep;
      const zbuf = new Float32Array(Math.ceil(W / colStep));
      const base = sim.inSanctumFloor ? [88, 56, 138] : pal.wall;
      const fogCol = sim.inSanctumFloor ? [16, 6, 30] : inCorridor ? [2, 5, 14] : pal.fogWall;
      ctx.imageSmoothingEnabled = false;

      for (let sx = 0; sx < W; sx += colStep) {
        const camX = (2 * (sx + colStep * 0.5)) / W - 1;
        const rdx = dirX + planeX * camX;
        const rdy = dirY + planeY * camX;
        let mx = Math.floor(h.x);
        let my = Math.floor(h.y);
        const ddx = Math.abs(1 / (rdx || 1e-9));
        const ddy = Math.abs(1 / (rdy || 1e-9));
        let stepX: number;
        let stepY: number;
        let sdx: number;
        let sdy: number;
        if (rdx < 0) {
          stepX = -1;
          sdx = (h.x - mx) * ddx;
        } else {
          stepX = 1;
          sdx = (mx + 1 - h.x) * ddx;
        }
        if (rdy < 0) {
          stepY = -1;
          sdy = (h.y - my) * ddy;
        } else {
          stepY = 1;
          sdy = (my + 1 - h.y) * ddy;
        }

        let side = 0;
        let hit = 0;
        let exitedRoomDist: number | null = null;
        for (let i = 0; i < 64 && !hit; i++) {
          let stepDist: number;
          if (sdx < sdy) {
            stepDist = sdx;
            sdx += ddx;
            mx += stepX;
            side = 0;
          } else {
            stepDist = sdy;
            sdy += ddy;
            my += stepY;
            side = 1;
          }
          if (mx < 0 || my < 0 || mx >= CRAWL_COLS || my >= CRAWL_ROWS || grid[my][mx] === 1) {
            hit = 1;
          } else if (
            !sim.inSanctumFloor &&
            heroRoomId >= 0 &&
            exitedRoomDist === null &&
            (sim.roomGrid[my]?.[mx] ?? -1) !== heroRoomId
          ) {
            // 部屋から通路へ出た境界距離を記録し、通路奥や次の部屋を見通せないようにする
            exitedRoomDist = stepDist;
          }
        }
        const dist = side === 0 ? sdx - ddx : sdy - ddy;
        zbuf[(sx / colStep) | 0] = dist;
        const lh = H / Math.max(dist, 0.0001);
        const y0 = horizon - lh / 2;
        const y1 = horizon + lh / 2;
        const wallH = y1 - y0;
        const wallX = side === 0 ? h.y + dist * rdy : h.x + dist * rdx;
        const frac = wallX - Math.floor(wallX);

        const outsideDist = exitedRoomDist !== null ? Math.max(0, dist - exitedRoomDist) : 0;
        const inOutsideDark = exitedRoomDist !== null;

        if (inOutsideDark && exitedRoomDist !== null) {
          const portalH = H / Math.max(exitedRoomDist, 0.15);
          const py0 = horizon - portalH / 2;
          const py1 = horizon + portalH / 2;
          const darkDist = exitedRoomDist + 1.35;
          const darkH = H / Math.max(darkDist, 0.15);
          const dy0 = horizon - darkH / 2;
          const dy1 = horizon + darkH / 2;
          const clampPy0 = Math.max(0, py0);
          const clampPy1 = Math.min(H, py1);
          const ceilEnd = Math.min(dy0, y0);
          if (ceilEnd > clampPy0 && dy0 > py0) {
            const cg = ctx.createLinearGradient(0, py0, 0, dy0);
            cg.addColorStop(0, 'rgba(2,5,14,0.08)');
            cg.addColorStop(1, 'rgba(2,5,14,1)');
            ctx.fillStyle = cg;
            ctx.fillRect(sx, clampPy0, colStep, ceilEnd - clampPy0);
          }
          const floorStart = Math.max(dy1, y1);
          if (clampPy1 > floorStart && py1 > dy1) {
            const fg = ctx.createLinearGradient(0, dy1, 0, py1);
            fg.addColorStop(0, 'rgba(2,5,14,1)');
            fg.addColorStop(1, 'rgba(2,5,14,0.08)');
            ctx.fillStyle = fg;
            ctx.fillRect(sx, floorStart, colStep, clampPy1 - floorStart);
          }
          if (outsideDist >= 1.35) {
            const dStart = Math.max(0, dy0);
            const dEnd = Math.min(H, dy1);
            if (dEnd > dStart) {
              ctx.fillStyle = 'rgb(2,5,14)';
              ctx.fillRect(sx, dStart, colStep, dEnd - dStart);
            }
            continue;
          }
        }

        if (inCorridor && dist >= 2.05) {
          ctx.fillStyle = 'rgb(2,5,14)';
          ctx.fillRect(sx, Math.max(0, y0), colStep, Math.min(H, y1) - Math.max(0, y0));
          continue;
        }

        const effectiveFogCol = inCorridor || inOutsideDark ? [2, 5, 14] : fogCol;
        const fog = inCorridor
          ? Math.max(0, 1 - Math.pow(dist / 2.05, 1.45))
          : inOutsideDark
            ? Math.max(0, 1 - Math.pow(outsideDist / 1.35, 1.35))
            : Math.max(0.16, 1 - dist / 11.5);
        const sideDark = side === 1 ? (inCorridor || inOutsideDark ? 0.14 : 0.24) : 0;
        const shadeAlpha = Math.min(inCorridor || inOutsideDark ? 1.0 : 0.92, 1 - fog + sideDark);

        if (wallTex) {
          const texX = clamp(Math.floor(frac * 16), 0, 15);
          ctx.drawImage(wallTex, texX, 0, 1, 16, sx, y0, colStep, wallH);
          if (shadeAlpha > 0.02) {
            ctx.fillStyle = `rgba(${effectiveFogCol[0]},${effectiveFogCol[1]},${effectiveFogCol[2]},${shadeAlpha.toFixed(2)})`;
            ctx.fillRect(sx, y0, colStep, wallH);
          }
          // Flickering pixel wall sconce (hidden in dark corridors & beyond doorways)
          const sconceVisible = inCorridor
            ? dist < 1.55
            : inOutsideDark
              ? outsideDist < 0.75
              : dist < 7.5;
          if (sconceVisible && ((mx * 7 + my * 13) & 3) === 0 && frac > 0.44 && frac < 0.56) {
            const flicker = 0.72 + Math.sin(now * 0.015 + mx + my) * 0.28;
            const flameY = y0 + wallH * 0.32;
            const flameH = Math.max(2, wallH * 0.065);
            const bracketH = Math.max(2, wallH * 0.055);
            ctx.fillStyle = sim.inSanctumFloor
              ? `rgba(192,132,252,${(0.16 * flicker).toFixed(2)})`
              : `rgba(251,191,36,${(0.18 * flicker).toFixed(2)})`;
            ctx.fillRect(sx, flameY - flameH * 0.8, colStep, flameH * 2.6);
            ctx.fillStyle = 'rgba(30,41,59,0.92)';
            ctx.fillRect(sx, flameY + flameH, colStep, bracketH);
            ctx.fillStyle = sim.inSanctumFloor
              ? `rgba(168,85,247,${(0.88 * flicker).toFixed(2)})`
              : `rgba(249,115,22,${(0.9 * flicker).toFixed(2)})`;
            ctx.fillRect(sx, flameY, colStep, flameH);
            if (frac > 0.47 && frac < 0.53) {
              ctx.fillStyle = sim.inSanctumFloor
                ? `rgba(244,114,182,${(0.95 * flicker).toFixed(2)})`
                : `rgba(254,240,138,${(0.95 * flicker).toFixed(2)})`;
              ctx.fillRect(sx, flameY + flameH * 0.15, colStep, Math.max(1.5, flameH * 0.55));
            }
          }
        } else {
          const sideShade = side === 1 ? 0.76 : 1.0;
          const rCol = Math.round((base[0] * fog + effectiveFogCol[0] * (1 - fog)) * sideShade);
          const gCol = Math.round((base[1] * fog + effectiveFogCol[1] * (1 - fog)) * sideShade);
          const bCol = Math.round((base[2] * fog + effectiveFogCol[2] * (1 - fog)) * sideShade);
          ctx.fillStyle = `rgb(${rCol},${gCol},${bCol})`;
          ctx.fillRect(sx, y0, colStep, wallH);
        }
      }

      // 視界制限ヘルパー：通路では約1マス先(<=1.85)、部屋では同室内と入口直前の通路マスのみ表示
      const getSpriteVisibility = (wx: number, wy: number): { visible: boolean; alpha: number; dimGlow: boolean } => {
        if (sim.inSanctumFloor) return { visible: true, alpha: 1, dimGlow: false };
        const sDist = Math.hypot(wx - h.x, wy - h.y);
        if (inCorridor) {
          if (sDist > 1.85) return { visible: false, alpha: 0, dimGlow: true };
          const fade = sDist > 1.15 ? clamp((1.85 - sDist) / 0.7, 0.12, 1) : 1;
          return { visible: true, alpha: fade, dimGlow: sDist > 1.35 };
        }
        const sx = Math.floor(wx);
        const sy = Math.floor(wy);
        const spRoomId = sim.roomGrid[sy]?.[sx] ?? -1;
        if (spRoomId === heroRoomId) {
          return { visible: true, alpha: 1, dimGlow: false };
        }
        if (spRoomId === -1 && sDist <= 1.35) {
          return { visible: true, alpha: clamp((1.35 - sDist) / 0.5, 0.18, 0.9), dimGlow: true };
        }
        return { visible: false, alpha: 0, dimGlow: true };
      };

      const sprites: Array<{
        wx: number;
        wy: number;
        spriteId: SpriteKey;
        icon: string;
        scale: number;
        alpha: number;
        shake: number;
        glow: string | null;
        flash: boolean;
        aura: string | null;
        telegraph: boolean;
      }> = [];

      if (!sim.inSanctumFloor) {
        const stVis = getSpriteVisibility(sim.stairs.x + 0.5, sim.stairs.y + 0.5);
        if (stVis.visible) {
          sprites.push({
            wx: sim.stairs.x + 0.5,
            wy: sim.stairs.y + 0.5,
            spriteId: 'stairs',
            icon: '🪜',
            scale: 0.65,
            alpha: sim.hasFloorKey ? stVis.alpha : stVis.alpha * 0.72,
            shake: 0,
            glow: stVis.dimGlow
              ? null
              : sim.hasFloorKey
                ? 'rgba(251, 191, 36, 0.7)'
                : 'rgba(148, 163, 184, 0.3)',
            flash: false,
            aura: stVis.dimGlow
              ? null
              : sim.hasFloorKey
                ? 'rgba(251, 191, 36, 0.35)'
                : null,
            telegraph: false,
          });
        }
      }

      for (const ev of sim.events) {
        if (!ev.triggered) {
          const evVis = getSpriteVisibility(ev.x + 0.5, ev.y + 0.5);
          if (!evVis.visible) continue;
          const isStones = ev.type === 'stones';
          const isHeal = ev.type === 'heal';
          const isChest = ev.type === 'chest';
          sprites.push({
            wx: ev.x + 0.5,
            wy: ev.y + 0.5,
            spriteId: ev.spriteId ?? 'chest_gold',
            icon: ev.icon,
            scale: isChest ? 0.68 : 0.54,
            alpha: evVis.alpha,
            shake: 0,
            glow: evVis.dimGlow
              ? null
              : isStones
                ? 'rgba(56, 189, 248, 0.75)'
                : isHeal
                  ? 'rgba(74, 222, 128, 0.75)'
                  : 'rgba(251, 191, 36, 0.75)',
            flash: false,
            aura: evVis.dimGlow
              ? null
              : isStones
                ? 'rgba(56, 189, 248, 0.25)'
                : isHeal
                  ? 'rgba(74, 222, 128, 0.25)'
                  : 'rgba(251, 191, 36, 0.28)',
            telegraph: false,
          });
        }
      }

      if (sim.dying) {
        const dVis = getSpriteVisibility(sim.dying.wx, sim.dying.wy);
        if (dVis.visible) {
          sprites.push({
            wx: sim.dying.wx,
            wy: sim.dying.wy,
            spriteId: sim.dying.spriteId,
            icon: '💥',
            scale: sim.dying.scale * (1 + (0.48 - sim.dying.t) * 0.45),
            alpha: Math.max(0, sim.dying.t / 0.48) * dVis.alpha,
            shake: (Math.random() - 0.5) * 6,
            glow: null,
            flash: true,
            aura: null,
            telegraph: false,
          });
        }
      }

      if (sim.inSanctumFloor) {
        if (sim.enemy && sim.enemyCell && sim.battleMode !== 'TRANSITION') {
          const shake = sim.enemyShake > 0 ? (Math.random() - 0.5) * 10 : 0;
          const glow = sim.enemy.isGreatDemon
            ? 'rgba(244, 114, 182, 0.95)'
            : 'rgba(192, 132, 252, 0.95)';
          const aura = sim.enemy.isGreatDemon
            ? 'rgba(244, 114, 182, 0.65)'
            : 'rgba(192, 132, 252, 0.6)';
          const telegraph =
            sim.battleMode === 'FIGHTING' &&
            sim.turnAction?.kind === 'attack' &&
            sim.turnAction.struck;
          sprites.push({
            wx: sim.enemyCell.x + 0.5,
            wy: sim.enemyCell.y + 0.5,
            spriteId: sim.enemy.spriteId,
            icon: sim.enemy.icon,
            scale: 1.45,
            alpha: 1,
            shake,
            glow,
            flash: sim.enemyFlashTimer > 0,
            aura,
            telegraph,
          });
        }
      } else if (sim.battleMode !== 'TRANSITION') {
        for (const fe of sim.floorEnemies) {
          if (fe.enemy.hp <= 0) continue;
          const feVis = getSpriteVisibility(fe.x + 0.5, fe.y + 0.5);
          if (!feVis.visible) continue;
          const shake = fe.shake > 0 ? (Math.random() - 0.5) * 10 : 0;
          const glow = feVis.dimGlow
            ? null
            : fe.enemy.isRareEscape
              ? 'rgba(250, 204, 21, 0.95)'
              : fe.enemy.isMidBoss
                ? 'rgba(192, 132, 252, 0.8)'
                : fe.enemy.isBoss
                  ? 'rgba(251, 191, 36, 0.85)'
                  : null;
          const aura = feVis.dimGlow
            ? null
            : fe.enemy.isBoss
              ? 'rgba(251, 191, 36, 0.45)'
              : fe.enemy.isRareEscape
                ? 'rgba(250, 204, 21, 0.55)'
                : null;
          const telegraph =
            sim.battleMode === 'FIGHTING' &&
            fe.enemy.isBoss &&
            sim.turnAction?.kind === 'attack' &&
            sim.turnAction.struck &&
            (sim.turnCount + 1) % 2 === 0;
          sprites.push({
            wx: fe.x + 0.5,
            wy: fe.y + 0.5,
            spriteId: fe.enemy.spriteId,
            icon: fe.enemy.icon,
            scale: fe.enemy.isBoss ? 1.25 : 0.88,
            alpha: feVis.alpha,
            shake,
            glow,
            flash: fe.flashTimer > 0,
            aura,
            telegraph,
          });
        }
      }

      sprites.sort((a, b) => {
        const da = (a.wx - h.x) ** 2 + (a.wy - h.y) ** 2;
        const db = (b.wx - h.x) ** 2 + (b.wy - h.y) ** 2;
        return db - da;
      });
      for (const sp of sprites) {
        drawSprite(
          ctx,
          W,
          H,
          sp.wx,
          sp.wy,
          sp.spriteId,
          sp.icon,
          zbuf,
          sp.scale,
          sp.alpha,
          sp.shake,
          sp.glow,
          now,
          sp.flash,
          sp.aura,
          sp.telegraph,
        );
      }

      // Draw pooled combo-styled canvas slashes & shockwave rings
      for (const sl of pool.slashes) {
        if (!sl.active) continue;
        const prog = 1 - sl.life / sl.maxLife;
        const alpha = Math.max(0, 1 - prog * prog);
        const len = Math.min(W, H) * (0.22 + prog * 0.09) * sl.scale;
        ctx.save();
        ctx.translate(sl.x * W, sl.y * H);
        ctx.globalAlpha = alpha;

        if (sl.showRing) {
          const ringR = len * (0.32 + prog * 0.48);
          ctx.strokeStyle = sl.secondary;
          ctx.lineWidth = Math.max(1.5, 3.5 * (1 - prog));
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.rotate(sl.angle);
        ctx.shadowColor = sl.accent;
        ctx.shadowBlur = 14;

        if (sl.style === 'bolt' || sl.style === 'flare_bolt' || sl.style === 'judgment') {
          // Jagged electric lightning slash
          const half = len * 0.58;
          ctx.strokeStyle = sl.accent;
          ctx.lineWidth = sl.thick + 2;
          ctx.beginPath();
          ctx.moveTo(-half, -half * 0.25);
          ctx.lineTo(-half * 0.35, half * 0.12);
          ctx.lineTo(0, -half * 0.16);
          ctx.lineTo(half * 0.35, half * 0.16);
          ctx.lineTo(half, -half * 0.12);
          ctx.stroke();

          ctx.strokeStyle = sl.color;
          ctx.lineWidth = Math.max(1.5, sl.thick * 0.45);
          ctx.stroke();
        } else if (sl.style === 'shatter' || sl.style === 'molten_crush') {
          // Heavy armor-shatter diagonal cleave with secondary shard line
          const half = len * 0.62;
          ctx.strokeStyle = sl.accent;
          ctx.lineWidth = sl.thick + 3;
          ctx.beginPath();
          ctx.moveTo(-half, 0);
          ctx.lineTo(half, 0);
          ctx.stroke();

          ctx.strokeStyle = sl.secondary;
          ctx.lineWidth = Math.max(2, sl.thick * 0.7);
          ctx.beginPath();
          ctx.moveTo(-half * 0.75, -6);
          ctx.lineTo(half * 0.75, 6);
          ctx.stroke();

          ctx.strokeStyle = sl.color;
          ctx.lineWidth = Math.max(1.5, sl.thick * 0.4);
          ctx.beginPath();
          ctx.moveTo(-half * 0.85, 0);
          ctx.lineTo(half * 0.85, 0);
          ctx.stroke();
        } else {
          // Crisp sweeping arc (flurry, cleave, frostfire, twin_spark, pierce)
          ctx.strokeStyle = sl.accent;
          ctx.lineWidth = sl.thick + 2;
          ctx.beginPath();
          ctx.arc(0, 0, len * 0.55, -0.78, 0.78);
          ctx.stroke();
          ctx.strokeStyle = sl.color;
          ctx.lineWidth = Math.max(1.5, sl.thick * 0.5);
          ctx.beginPath();
          ctx.arc(0, 0, len * 0.55, -0.66, 0.66);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw pooled pixel impact/loot particles
      for (const p of pool.particles) {
        if (!p.active) continue;
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x * W), Math.round(p.y * H), p.size, p.size);
        ctx.restore();
      }

      if (sim.battleMode === 'RESTING') {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
        ctx.fillRect(W / 2 - 72, 40, 144, 26);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(W / 2 - 72, 40, 144, 26);
        ctx.fillStyle = '#86efac';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💚 回復中…', W / 2, 57);
      } else if (
        sim.enemy &&
        sim.enemyCell &&
        sim.battleMode === 'FIGHTING'
      ) {
        const bw = 200;
        const bx = (W - bw) / 2;
        const by = 56;
        ctx.fillStyle = 'rgba(0,0,0,.68)';
        ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
        ctx.fillStyle = sim.enemy.isRareEscape
          ? '#eab308'
          : sim.enemy.isGreatDemon
            ? '#ec4899'
            : sim.enemy.isSanctumBoss
              ? '#a855f7'
              : !sim.enemy.isBoss && sim.enemy.archetype === 'armored'
                ? '#d97706'
                : !sim.enemy.isBoss && sim.enemy.archetype === 'striker'
                  ? '#e11d48'
                  : '#dc2626';
        ctx.fillRect(bx, by, bw * Math.max(0, sim.enemy.hp / sim.enemy.maxHp), 8);
        ctx.fillStyle = sim.enemy.isRareEscape
          ? '#fde047'
          : !sim.enemy.isBoss && sim.enemy.archetype === 'armored'
            ? '#fcd34d'
            : !sim.enemy.isBoss && sim.enemy.archetype === 'striker'
              ? '#fda4af'
              : '#fff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${sim.enemy.name}  HP ${fmt(Math.max(0, sim.enemy.hp))}/${fmt(sim.enemy.maxHp)}`,
          W / 2,
          by - 8,
        );

        if (sim.enemy.isRareEscape) {
          const activeRare = sim.floorEnemies.find((e) => e.enemy === sim.enemy) ?? null;
          const escTurns = Math.max(0, activeRare ? activeRare.rareEscapeTimer : 0);
          const tw = 150;
          const tx = (W - tw) / 2;
          const ty = by + 16;
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(tx - 1, ty - 1, tw + 2, 7);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(tx, ty, tw * clamp(escTurns / 6, 0, 1), 5);
          ctx.fillStyle = '#bae6fd';
          ctx.font = '11px sans-serif';
          ctx.fillText(`逃走まで ${escTurns}ターン`, W / 2, ty + 16);
        }
      }

      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.52)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // Subtle elemental combo accent flash on impact
      if (sim.comboFlashTimer > 0) {
        const ca = Math.min(1, sim.comboFlashTimer / 0.13);
        ctx.save();
        ctx.globalAlpha = ca * 0.65;
        const cvg = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H * 0.75);
        cvg.addColorStop(0, sim.comboFlashColor);
        cvg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cvg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // Red damage vignette when hero is struck
      if (sim.heroHurtFlash > 0) {
        const ha = Math.min(0.35, (sim.heroHurtFlash / 0.22) * 0.32);
        const hvg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
        hvg.addColorStop(0, 'rgba(220,38,38,0)');
        hvg.addColorStop(1, `rgba(220,38,38,${ha.toFixed(2)})`);
        ctx.fillStyle = hvg;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
      renderMap();
    };

    engineApiRef.current = {
      resetToCurrentStage: () => {
        syncHeroHp(true);
        sim.battleMode = 'WALKING';
        enterFloor();
        updateHeroHpBar();
      },
    };

    syncHeroHp(true);
    fitCanvas();
    enterFloor();
    updateHeroHpBar();

    window.addEventListener('resize', fitCanvas);

    let lastFrameTime = performance.now();
    let lastCanvasDraw = 0;
    let autoSaveTimer = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const rawDt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      if (rawDt > 8.0) {
        if (!sim.paused) callbacksRef.current.onOfflineElapsed(rawDt);
      } else {
        const dt = Math.min(rawDt, 0.05);
        if (!sim.paused) {
          if (sim.hitstopTimer > 0) {
            sim.hitstopTimer = Math.max(0, sim.hitstopTimer - dt);
          } else {
            stepBattle(dt);
          }
        }
      }

      const drawIntervalMs = throttleCanvasRef.current || sim.paused ? 250 : 0;
      if (drawIntervalMs === 0 || now - lastCanvasDraw >= drawIntervalMs) {
        lastCanvasDraw = now;
        renderCrawler();
      }

      autoSaveTimer += Math.min(rawDt, 1.0);
      if (autoSaveTimer >= 5.0) {
        autoSaveTimer = 0;
        callbacksRef.current.onRequestSave();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', fitCanvas);
    };
  }, [engineApiRef, stateRef]);

  // Helper to update fitCanvas when sizeMode toggles
  const handleToggleSize = () => {
    const sim = simRef.current;
    sim.sizeIdx = (sim.sizeIdx + 1) % CRAWL_SIZES.length;
    try {
      localStorage.setItem(CRAWL_SIZE_KEY, String(sim.sizeIdx));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event('resize'));
    onSyncHud({ sizeMode: CRAWL_SIZES[sim.sizeIdx].mode });
  };

  const handleTogglePause = () => {
    const sim = simRef.current;
    sim.paused = !sim.paused;
    onSyncHud({ paused: sim.paused });
  };

  const handleCycleSpeed = () => {
    const sim = simRef.current;
    sim.speed = sim.speed === 1 ? 2 : sim.speed === 2 ? 4 : 1;
    onSyncHud({ speed: sim.speed });
  };

  const handleToggleMoveStyle = () => {
    const sim = simRef.current;
    sim.moveStyle = sim.moveStyle === 'smooth' ? 'step' : 'smooth';
    const h = sim.hero;
    h.cx = clamp(Math.floor(h.x), 1, CRAWL_COLS - 2);
    h.cy = clamp(Math.floor(h.y), 1, CRAWL_ROWS - 2);
    if (sim.moveStyle === 'step' && !sim.turnAction) {
      h.x = h.cx + 0.5;
      h.y = h.cy + 0.5;
      h.angle = snapCardinalAngle(h.angle);
    }
    try {
      localStorage.setItem(CRAWL_STYLE_KEY, sim.moveStyle);
    } catch {
      // ignore
    }
    onSyncHud({ moveStyle: sim.moveStyle });
  };

  const biome = getBiome(hudSnapshot.stage);
  const palIdx = Math.floor((hudSnapshot.stage - 1) / 100) % FLOOR_PALETTES.length;
  const biomeLabel = biome.name + (hudSnapshot.stage >= 101 ? ` [${FLOOR_PALETTES[palIdx].name}]` : '');
  const inSanctum = isSanctumFloor(hudSnapshot.stage);
  const heldAtGate = isHeldAtGate(hudSnapshot.stage, hudSnapshot.clearedSanctumMax);
  const sanctumTarget = getUnlockedSanctumTarget(
    hudSnapshot.stage,
    hudSnapshot.maxStage,
    hudSnapshot.clearedSanctumMax,
  );

  return (
    <div id="crawler-area" ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <div
        id="view-frame"
        ref={frameRef}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-shadow"
      >
        <canvas
          id="view"
          ref={viewCanvasRef}
          data-testid="crawler-canvas"
          className="absolute inset-0 block h-full w-full"
        />
        <canvas
          id="map"
          ref={mapCanvasRef}
          width={150}
          height={150}
          data-testid="minimap-canvas"
          className="absolute right-2.5 top-10 z-10 rounded-lg border border-slate-400/45 bg-[#020610]/85"
        />

        {/* Top HUD (No title badge, clean random-encounter status instead of 5-wave dots) */}
        <div
          ref={hudBarRef}
          className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-[#090d16]/90 to-[#090d16]/25 px-3 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold drop-shadow">
            <span>{inSanctum ? `🏛️ ${hudSnapshot.stage}F 玄室` : biomeLabel}</span>
            <span className={inSanctum ? 'text-purple-300' : 'text-sky-400'}>
              St.{hudSnapshot.stage}
            </span>
            <span
              data-testid="floor-explore-status"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300"
            >
              {inSanctum ? (
                <span className="font-bold text-purple-300">大ボス決戦（雑魚・迷宮なし）</span>
              ) : (
                <>
                  <span>遭遇 {hudSnapshot.floorEncounters}体</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      hudSnapshot.bossActive
                        ? 'font-bold text-red-400'
                        : hudSnapshot.hasFloorKey
                          ? 'font-bold text-amber-300'
                          : 'text-sky-300'
                    }
                  >
                    {hudSnapshot.bossActive
                      ? '鍵持ちボス戦'
                      : hudSnapshot.hasFloorKey
                        ? hudSnapshot.stairsFound
                          ? `🔑 階段まで ${hudSnapshot.stepsToStairs}歩`
                          : `🔑 探索 ${hudSnapshot.explorePct}%`
                        : hudSnapshot.stairsFound
                          ? `🔒 探索 ${hudSnapshot.explorePct}%`
                          : `探索 ${hudSnapshot.explorePct}%`}
                  </span>
                  {heldAtGate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        data-testid="gate-stall-badge"
                        className="rounded border border-amber-400/50 bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-200"
                      >
                        ⛩️ {hudSnapshot.autoProgress ? '関門周回中' : '関門階'}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-300">
            <span className="font-semibold text-red-300" title="これまでの最大単発ダメージ">
              最大: {fmt(hudSnapshot.maxDmg)}
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span data-testid="kill-counter">討伐: {fmt(hudSnapshot.kills)}</span>
          </div>
        </div>

        {/* Player-Only Sanctum Entry / Retreat Button */}
        {inSanctum ? (
          <div className="absolute bottom-[56px] left-3 z-20 flex flex-col items-start gap-1">
            <button
              type="button"
              data-testid="btn-retreat-sanctum"
              onClick={onRetreatSanctum}
              className="rounded-md border border-rose-400/60 bg-slate-900/90 px-2.5 py-1 text-[11px] font-bold text-rose-200 shadow-lg transition hover:bg-rose-950/80"
            >
              🚪 玄室から撤退 ({hudSnapshot.stage - 1}Fへ)
            </button>
          </div>
        ) : sanctumTarget !== null ? (
          <div className="absolute bottom-[56px] left-3 z-20 flex flex-col items-start gap-1">
            <button
              type="button"
              data-testid="btn-enter-sanctum"
              disabled={hudSnapshot.sanctumKeys < 1}
              onClick={() => onEnterSanctum(sanctumTarget)}
              title={
                hudSnapshot.sanctumKeys >= 1
                  ? `${sanctumTarget}Fの玄室へ入場します（🗝️玄室の鍵を1本消費・即大ボス戦）`
                  : '玄室の鍵が不足しています（各階の鍵持ちボス撃破時に確率で入手）'
              }
              className={`rounded-md border px-2.5 py-1 text-[11px] font-extrabold shadow-lg transition ${
                hudSnapshot.sanctumKeys >= 1
                  ? 'border-purple-300 bg-gradient-to-r from-purple-700/95 to-fuchsia-700/95 text-white shadow-[0_0_16px_rgba(192,132,252,0.45)] hover:brightness-110'
                  : 'cursor-not-allowed border-slate-500/40 bg-slate-900/85 text-slate-400'
              }`}
            >
              {hudSnapshot.sanctumKeys >= 1
                ? `🏛️ ${sanctumTarget}F 玄室へ挑む (🗝️×1)`
                : `🔒 ${sanctumTarget}F 玄室 (鍵不足)`}
            </button>
            {hudSnapshot.sanctumKeys < 1 && (
              <span className="rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] text-amber-200/90">
                各階の鍵持ちボス周回で🗝️鍵を入手
              </span>
            )}
          </div>
        ) : null}

        {/* Non-blocking loot banner */}
        <div
          id="loot-banner"
          ref={lootBannerRef}
          className="pointer-events-none absolute left-1/2 top-11 z-20 -translate-x-1/2 -translate-y-2.5 whitespace-nowrap rounded-full border-2 border-amber-400 bg-slate-900/95 px-3.5 py-1.5 text-xs font-extrabold text-white opacity-0 shadow-2xl transition duration-200"
        />

        {/* Single-Hero HP & Active Resonance HUD */}
        {(() => {
          const activeCombo = ACCESSORY_COMBOS[hudSnapshot.comboId];
          return (
            <div
              id="hero-hp-wrap"
              data-testid="hero-hp-hud"
              className="absolute bottom-2.5 left-2.5 z-10 flex w-[196px] flex-col gap-1 rounded-lg border border-slate-400/35 bg-[#020610]/85 px-2.5 py-1.5 max-sm:w-[162px]"
            >
              <div className="flex items-center justify-between gap-1 text-[11px] font-extrabold leading-none text-slate-100">
                <span ref={heroHpTextRef}>HP --/--</span>
                <span
                  data-testid="hud-combo-tag"
                  title={`${activeCombo.name}: ${activeCombo.effectText}`}
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] font-extrabold"
                  style={{
                    color: activeCombo.accentColor,
                    background: activeCombo.badgeBg,
                    border: `1px solid ${activeCombo.badgeBorder}`,
                  }}
                >
                  {activeCombo.icons} {activeCombo.name}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded border border-white/25 bg-black/80">
                <div
                  ref={heroHpBarRef}
                  className="h-full w-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-100"
                />
              </div>
            </div>
          );
        })()}

        {/* Floating FX layer */}
        <div ref={fxLayerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />

        {/* Battle Banner */}
        <div
          ref={battleBannerRef}
          className="pointer-events-none absolute left-1/2 top-[46%] z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-red-400/50 bg-slate-900/90 px-3.5 py-1.5 text-center text-xs font-bold text-red-200 opacity-0 transition-opacity duration-200"
        />
      </div>

      {/* Always-visible Fairy mini-window anchored above bottom-right controls */}
      {fairyOverlay && (
        <div className="pointer-events-auto absolute bottom-12 right-2.5 z-10 max-sm:bottom-11">
          {fairyOverlay}
        </div>
      )}

      {/* Bottom-right crawler controls */}
      <div className="absolute bottom-2.5 right-2.5 z-10 flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          onClick={handleTogglePause}
          className="rounded-md border border-slate-400/25 bg-slate-800/90 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 max-sm:px-1.5 max-sm:text-[11px]"
        >
          {hudSnapshot.paused ? '▶ 再開' : '⏸ 一時停止'}
        </button>
        <button
          type="button"
          onClick={handleCycleSpeed}
          className="rounded-md border border-slate-400/25 bg-slate-800/90 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 max-sm:px-1.5 max-sm:text-[11px]"
        >
          速度 ×{hudSnapshot.speed}
        </button>
        <button
          type="button"
          onClick={handleToggleMoveStyle}
          title="移動の描画方式を切り替えます（滑らか＝円弧コーナリング／ステップ＝コマ送り）"
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition max-sm:px-1.5 max-sm:text-[11px] ${
            hudSnapshot.moveStyle === 'step'
              ? 'border-green-400 bg-green-600/25 text-green-400'
              : 'border-slate-400/25 bg-slate-800/90 text-slate-100 hover:bg-slate-700'
          }`}
        >
          {hudSnapshot.moveStyle === 'step' ? '🧱 ステップ' : '🚶 滑らか'}
        </button>
        <button
          type="button"
          onClick={handleToggleSize}
          className="rounded-md border border-slate-400/25 bg-slate-800/90 px-2.5 py-1 text-xs font-semibold text-slate-100 transition hover:bg-slate-700 max-sm:px-1.5 max-sm:text-[11px]"
        >
          サイズ {hudSnapshot.sizeMode === 'large' ? '大' : '小'}
        </button>
      </div>
    </div>
  );
}
