import { useEffect, useRef, type ReactNode } from 'react';
import {
  CRAWL_COLS,
  CRAWL_ROWS,
  CRAWL_SIZE_KEY,
  CRAWL_STYLE_KEY,
  FLOOR_PALETTES,
  RARITIES,
} from '../game/constants';
import { playSfx } from '../game/audio';
import {
  advanceFairyCooldown,
  FAIRY_FLOOR_REDUCE_SEC,
  FAIRY_KILL_REDUCE_SEC,
  getActiveFairyBuff,
  getFairyProfile,
  getFairyRank,
} from '../game/fairy';
import { calcHeroStats, calcHitDamage, clamp, fmt, generateItem, rand } from '../game/items';
import {
  angDiff,
  bfsPath,
  buildSmoothSegments,
  crawlKey,
  createEnemy,
  evalSmoothSeg,
  generateMaze,
  getBiome,
  pickEncounterAheadCell,
  pickExplorationTarget,
  placeMazeEvents,
  shouldTriggerRandomEncounter,
  type SmoothSegment,
} from '../game/maze';
import type {
  CrawlSizeMode,
  Enemy,
  FloorPalette,
  GameState,
  Item,
  MazeCell,
  MazeEvent,
  MoveStyle,
} from '../game/types';

export interface DungeonEngineApi {
  resetToCurrentStage: () => void;
}

interface DungeonViewportProps {
  stateRef: React.MutableRefObject<GameState>;
  engineApiRef: React.MutableRefObject<DungeonEngineApi | null>;
  hudSnapshot: {
    stage: number;
    kills: number;
    maxDmg: number;
    cleared100: boolean;
    floorEncounters: number;
    stepsToStairs: number;
    stairsFound: boolean;
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
    stairs: { x: CRAWL_COLS - 2, y: CRAWL_ROWS - 2 } as MazeCell,
    explored: new Set<string>(),
    stepped: new Set<string>(),
    depth: new Map<string, number>(),
    exploreTarget: null as MazeCell | null,
    hero: { cx: 1, cy: 1, x: 1.5, y: 1.5, angle: 0 },
    phase: 'decide' as 'decide' | 'turn' | 'step' | 'face',
    moveFrom: null as MazeCell | null,
    moveTo: null as MazeCell | null,
    moveT: 0,
    turnT: 0,
    fromAngle: 0,
    targetAngle: 0,
    path: null as MazeCell[] | null,
    segs: null as SmoothSegment[] | null,
    segIdx: 0,
    segS: 0,
    enemyCell: null as MazeCell | null,
    enemyShake: 0,
    dying: null as { icon: string; wx: number; wy: number; t: number } | null,
    events: [] as MazeEvent[],
    floorStage: 0,
    stepsSinceLastEncounter: 0,
    bossSpawned: false,
    paused: false,
    speed: 1 as 1 | 2 | 4,
    moveStyle: 'smooth' as MoveStyle,
    sizeIdx: 0,
    colStep: 1,
    palette: FLOOR_PALETTES[0] as FloorPalette,

    battleMode: 'WALKING' as 'WALKING' | 'FIGHTING' | 'TRANSITION' | 'RECOVERING',
    heroHp: 110,
    heroAtkTimer: 0,
    enemyAtkTimer: 0,
    rareEscapeTimer: 0,
    transTimer: 0,
    recoverTimer: 0,
    needNewFloor: false,
    enemy: null as Enemy | null,
  });

  const bannerTimersRef = useRef<{
    loot: ReturnType<typeof setTimeout> | null;
    promote: ReturnType<typeof setTimeout> | null;
    battle: ReturnType<typeof setTimeout> | null;
  }>({ loot: null, promote: null, battle: null });

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

  const spawnSlashFx = (xPct: number, yPct: number) => {
    const layer = fxLayerRef.current;
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'slash-fx';
    el.style.left = `${xPct}%`;
    el.style.top = `${yPct}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 220);
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
      sim.explored.add(crawlKey(h.cx, h.cy));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = h.cx + dx;
        const ny = h.cy + dy;
        if (nx >= 0 && ny >= 0 && nx < CRAWL_COLS && ny < CRAWL_ROWS) {
          sim.explored.add(crawlKey(nx, ny));
        }
      }
      const ca = Math.cos(h.angle);
      const sa = Math.sin(h.angle);
      const fx = Math.abs(ca) >= Math.abs(sa) ? (ca >= 0 ? 1 : -1) : 0;
      const fy = Math.abs(ca) >= Math.abs(sa) ? 0 : (sa >= 0 ? 1 : -1);
      const px = -fy;
      const py = fx;
      for (const sd of [1, -1]) {
        const tx = h.cx + fx + px * sd;
        const ty = h.cy + fy + py * sd;
        if (tx < 0 || ty < 0 || tx >= CRAWL_COLS || ty >= CRAWL_ROWS) continue;
        const frontWall = grid[h.cy + fy]?.[h.cx + fx] === 1;
        const sideWall = grid[h.cy + py * sd]?.[h.cx + px * sd] === 1;
        if (frontWall && sideWall) continue;
        sim.explored.add(crawlKey(tx, ty));
      }
    };

    const computeExploreHud = () => {
      const stairsFound = sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y));
      let walkableTotal = Math.max(1, sim.depth.size);
      let walkableExplored = 0;
      for (const k of sim.depth.keys()) {
        if (sim.explored.has(k)) walkableExplored++;
      }
      const explorePct = Math.min(100, Math.round((walkableExplored / walkableTotal) * 100));
      const path = stairsFound ? bfsPath(sim.grid, sim.hero.cx, sim.hero.cy, sim.stairs.x, sim.stairs.y) : null;
      const stepsToStairs = path ? Math.max(0, path.length - 1) : 0;
      return { stairsFound, explorePct, stepsToStairs };
    };

    const triggerMazeEvent = (ev: MazeEvent) => {
      const st = stateRef.current;
      if (ev.type === 'chest') {
        const stoneGain = Math.max(3, Math.round((4 + st.stage * 1.5) * rand(0.9, 1.4)));
        st.stones += stoneGain;
        const r = Math.random();
        let rar: 1 | 2 | 3 | 4 = 1;
        if (st.cleared100 && r < 0.05) rar = 4;
        else if (r < 0.24) rar = 3;
        else if (r < 0.62) rar = 2;

        const it = generateItem({
          stage: st.stage,
          forcedRarity: rar,
          isBoss: true,
          cleared100: st.cleared100,
        });
        spawnFloatText(50, 42, `🎁 +${stoneGain}💎`, 'float-loot');
        callbacksRef.current.onAddLog(`迷宮の黄金宝箱を開封！ (+${stoneGain}💎)`, '#fbbf24');
        callbacksRef.current.onItemDrop(it, false);
        if (it.rarity >= 3) showPromoteLootBanner(it);
      }
    };

    const checkPathEvents = () => {
      const h = sim.hero;
      for (const ev of sim.events) {
        if (ev.triggered) continue;
        if (
          Math.hypot(ev.x + 0.5 - h.x, ev.y + 0.5 - h.y) < 0.65 ||
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
      sim.needNewFloor = false;
      sim.bossSpawned = false;
      sim.stepsSinceLastEncounter = 0;
      st.floorEncounters = 0;

      const { grid, stairs, depth } = generateMaze(CRAWL_COLS, CRAWL_ROWS);
      sim.grid = grid;
      sim.stairs = stairs;
      sim.depth = depth;

      const h = sim.hero;
      h.cx = 1;
      h.cy = 1;
      h.x = 1.5;
      h.y = 1.5;
      h.angle = 0;

      sim.phase = 'decide';
      sim.dying = null;
      sim.enemyCell = null;
      sim.enemy = null;
      sim.explored = new Set();
      sim.stepped = new Set([crawlKey(1, 1)]);
      sim.exploreTarget = null;
      sim.path = null;
      sim.segs = null;
      sim.segIdx = 0;
      sim.segS = 0;

      // 入口から進める最初の通路向きを初期角度に設定
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        if (grid[1 + dy]?.[1 + dx] === 0) {
          h.angle = Math.atan2(dy, dx);
          break;
        }
      }

      const palIdx = Math.floor((st.stage - 1) / 100) % FLOOR_PALETTES.length;
      sim.palette = FLOOR_PALETTES[palIdx];

      crawlReveal();
      sim.events = placeMazeEvents(sim.depth, sim.stairs);
      const picked = pickExplorationTarget(
        sim.grid,
        h.cx,
        h.cy,
        h.angle,
        sim.explored,
        sim.stepped,
        sim.stairs,
        sim.events,
      );
      sim.exploreTarget = picked.target;
      sim.path = bfsPath(grid, h.cx, h.cy, picked.target.x, picked.target.y);
      if (sim.path && sim.path.length > 1) {
        h.angle = Math.atan2(sim.path[1].y - h.cy, sim.path[1].x - h.cx);
      }

      const hudEx = computeExploreHud();
      callbacksRef.current.onSyncHud({
        floorEncounters: 0,
        stepsToStairs: hudEx.stepsToStairs,
        stairsFound: hudEx.stairsFound,
        explorePct: hudEx.explorePct,
        bossActive: false,
        moveStyle: sim.moveStyle,
        speed: sim.speed,
        sizeMode: CRAWL_SIZES[sim.sizeIdx].mode,
      });
    };

    const startFight = () => {
      sim.battleMode = 'FIGHTING';
      const stats = calcHeroStats(stateRef.current.equipped, stateRef.current.cleared100);
      sim.heroAtkTimer = (1 / stats.aspd) * 0.65;
      sim.enemyAtkTimer = 0.4;
      if (sim.enemy && sim.enemy.isRareEscape) {
        sim.rareEscapeTimer = 10.0;
      }
      callbacksRef.current.onSyncHud({
        bossActive: Boolean(sim.enemy?.isBoss),
      });
    };

    /**
     * タイル進入ごとに呼ばれる探索記録・階段発見切替・ランダムエンカウント＆階段ボス判定
     */
    const onEnterTile = (cx: number, cy: number): boolean => {
      const st = stateRef.current;
      sim.stepped.add(crawlKey(cx, cy));

      // 既に敵が出現中なら何もしない
      if (sim.enemy && sim.enemyCell) return false;

      const distToStairs = Math.abs(sim.stairs.x - cx) + Math.abs(sim.stairs.y - cy);
      if (distToStairs <= 1 && !sim.bossSpawned) {
        // 階段到達でフロアボス出現
        sim.bossSpawned = true;
        sim.enemy = createEnemy(st.stage, true);
        sim.enemyCell = { x: sim.stairs.x, y: sim.stairs.y };
        sim.exploreTarget = { x: sim.stairs.x, y: sim.stairs.y };
        sim.path = null;
        sim.segs = null;
        sim.segIdx = 0;
        sim.segS = 0;
        sim.phase = 'face';
        const hudEx = computeExploreHud();
        callbacksRef.current.onSyncHud({
          stepsToStairs: distToStairs,
          stairsFound: true,
          explorePct: hudEx.explorePct,
          bossActive: true,
        });
        return true;
      }

      // 視界に階段や未回収イベントが入ったら探索ターゲットを切り替える
      let redirected = false;
      const stairsVisible = sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y));
      if (stairsVisible && (!sim.exploreTarget || sim.exploreTarget.x !== sim.stairs.x || sim.exploreTarget.y !== sim.stairs.y)) {
        sim.exploreTarget = { x: sim.stairs.x, y: sim.stairs.y };
        sim.path = null;
        sim.segs = null;
        sim.segIdx = 0;
        sim.segS = 0;
        redirected = true;
      } else if (!stairsVisible) {
        const visibleEv = sim.events.find((ev) => !ev.triggered && sim.explored.has(crawlKey(ev.x, ev.y)));
        if (visibleEv && (!sim.exploreTarget || sim.exploreTarget.x !== visibleEv.x || sim.exploreTarget.y !== visibleEv.y)) {
          sim.exploreTarget = { x: visibleEv.x, y: visibleEv.y };
          sim.path = null;
          sim.segs = null;
          sim.segIdx = 0;
          sim.segS = 0;
          redirected = true;
        }
      }

      sim.stepsSinceLastEncounter += 1;
      const pathToStairs = bfsPath(sim.grid, cx, cy, sim.stairs.x, sim.stairs.y);
      const remainingToStairs = pathToStairs ? Math.max(0, pathToStairs.length - 1) : 0;

      if (shouldTriggerRandomEncounter(sim.stepsSinceLastEncounter, remainingToStairs)) {
        const navTarget = sim.exploreTarget ?? sim.stairs;
        const forwardPath = bfsPath(sim.grid, cx, cy, navTarget.x, navTarget.y);
        const enemyCell = pickEncounterAheadCell(
          sim.grid,
          cx,
          cy,
          sim.hero.angle,
          forwardPath,
          sim.stairs,
          sim.speed >= 4,
        );
        if (enemyCell) {
          sim.stepsSinceLastEncounter = 0;
          const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
          sim.enemy = createEnemy(st.stage, false, fairyProfile.rareSlimeBonusPct);
          sim.enemyCell = enemyCell;
          sim.path = null;
          sim.segs = null;
          sim.segIdx = 0;
          sim.segS = 0;
          sim.phase = 'decide';
          st.floorEncounters += 1;
          const hudEx = computeExploreHud();
          callbacksRef.current.onSyncHud({
            floorEncounters: st.floorEncounters,
            stepsToStairs: hudEx.stepsToStairs,
            stairsFound: hudEx.stairsFound,
            explorePct: hudEx.explorePct,
            bossActive: false,
          });
          return true;
        }
      }

      const hudEx = computeExploreHud();
      callbacksRef.current.onSyncHud({
        stepsToStairs: hudEx.stepsToStairs,
        stairsFound: hudEx.stairsFound,
        explorePct: hudEx.explorePct,
      });
      return redirected;
    };

    const getNavTarget = (): MazeCell => {
      if (sim.enemy && sim.enemyCell) return sim.enemyCell;
      const h = sim.hero;
      if (!sim.exploreTarget || (sim.exploreTarget.x === h.cx && sim.exploreTarget.y === h.cy)) {
        const picked = pickExplorationTarget(
          sim.grid,
          h.cx,
          h.cy,
          h.angle,
          sim.explored,
          sim.stepped,
          sim.stairs,
          sim.events,
        );
        sim.exploreTarget = picked.target;
      }
      return sim.exploreTarget;
    };

    const decideStep = () => {
      const h = sim.hero;
      const target = getNavTarget();
      const dx = target.x - h.cx;
      const dy = target.y - h.cy;

      if (sim.enemy && sim.enemyCell && dx === 0 && dy === 0) {
        startFight();
        return;
      }

      if (Math.abs(dx) + Math.abs(dy) === 1) {
        if (sim.enemy && sim.enemyCell) {
          sim.targetAngle = Math.atan2(dy, dx);
          sim.fromAngle = h.angle;
          sim.turnT = 0;
          if (Math.abs(angDiff(sim.targetAngle, sim.fromAngle)) < 0.001) {
            startFight();
          } else {
            sim.phase = 'face';
          }
          return;
        }
        if (target.x === sim.stairs.x && target.y === sim.stairs.y && !sim.bossSpawned) {
          onEnterTile(h.cx, h.cy);
          return;
        }
      }

      if (!sim.path || sim.path.length < 2) {
        sim.path = bfsPath(sim.grid, h.cx, h.cy, target.x, target.y);
      }
      if (!sim.path || sim.path.length < 2) {
        sim.exploreTarget = null;
        return;
      }

      sim.moveFrom = { x: h.cx, y: h.cy };
      sim.moveTo = sim.path[1];
      sim.path = sim.path.slice(1);
      sim.targetAngle = Math.atan2(sim.moveTo.y - h.cy, sim.moveTo.x - h.cx);
      sim.fromAngle = h.angle;
      sim.turnT = 0;
      if (Math.abs(angDiff(sim.targetAngle, sim.fromAngle)) < 0.001) {
        sim.phase = 'step';
        sim.moveT = 0;
      } else {
        sim.phase = 'turn';
      }
    };

    const crawlWalk = (dt: number) => {
      const h = sim.hero;

      if (sim.moveStyle === 'step') {
        const snapRate = sim.speed === 1 ? 1.15 : sim.speed === 2 ? 2.0 : 3.0;
        const mdt = dt * snapRate;
        if (sim.phase === 'turn' || sim.phase === 'face') {
          sim.turnT += mdt;
          if (sim.turnT >= 0.17) {
            h.angle = sim.targetAngle;
            if (sim.phase === 'turn') {
              sim.phase = 'step';
              sim.moveT = 0;
              crawlReveal();
            } else if (sim.enemy && sim.enemyCell) {
              startFight();
            } else {
              sim.phase = 'decide';
            }
          }
          return;
        }
        if (sim.phase === 'step' && sim.moveTo) {
          sim.moveT += mdt;
          if (sim.moveT >= 0.24) {
            h.cx = sim.moveTo.x;
            h.cy = sim.moveTo.y;
            h.x = h.cx + 0.5;
            h.y = h.cy + 0.5;
            sim.phase = 'decide';
            crawlReveal();
            checkPathEvents();
            onEnterTile(h.cx, h.cy);
            decideStep();
          }
          return;
        }
        decideStep();
        return;
      }

      // Smooth arc cornering movement
      const target = getNavTarget();
      const isCombatTarget = Boolean(sim.enemy && sim.enemyCell);
      const moveSpeed = sim.speed === 1 ? 2.6 : sim.speed === 2 ? 3.8 : 5.0;
      const maxTurnRate = sim.speed === 1 ? 5.6 : sim.speed === 2 ? 7.8 : 9.6;

      if (sim.phase === 'face') {
        if (!isCombatTarget) {
          sim.phase = 'decide';
          return;
        }
        const targetAngle = Math.atan2(target.y + 0.5 - h.y, target.x + 0.5 - h.x);
        const diff = angDiff(targetAngle, h.angle);
        const stepAng = maxTurnRate * dt;
        if (Math.abs(diff) <= stepAng) {
          h.angle = targetAngle;
          startFight();
        } else {
          h.angle += Math.sign(diff) * stepAng;
        }
        return;
      }

      if (!sim.path) {
        sim.path = bfsPath(sim.grid, h.cx, h.cy, target.x, target.y);
        sim.segs = null;
        sim.segIdx = 0;
        sim.segS = 0;
      }
      if (!sim.path || sim.path.length < 2) {
        if (isCombatTarget) {
          sim.phase = 'face';
        } else {
          sim.exploreTarget = null;
          sim.path = null;
          sim.segs = null;
          sim.phase = 'decide';
        }
        return;
      }

      const goalIdx = isCombatTarget ? sim.path.length - 2 : sim.path.length - 1;
      if (goalIdx < 1) {
        const goalTile = sim.path[0];
        h.cx = goalTile.x;
        h.cy = goalTile.y;
        h.x = goalTile.x + 0.5;
        h.y = goalTile.y + 0.5;
        crawlReveal();
        checkPathEvents();
        onEnterTile(h.cx, h.cy);
        if (sim.enemy && sim.enemyCell) {
          sim.phase = 'face';
        } else {
          sim.exploreTarget = null;
          sim.path = null;
          sim.segs = null;
          sim.phase = 'decide';
        }
        return;
      }

      if (!sim.segs) {
        sim.segs = buildSmoothSegments(sim.path, goalIdx, h.x, h.y, 0.42);
        sim.segIdx = 0;
        sim.segS = 0;
        if (!sim.segs.length) {
          if (isCombatTarget) {
            sim.phase = 'face';
          } else {
            sim.exploreTarget = null;
            sim.path = null;
            sim.phase = 'decide';
          }
          return;
        }
      }

      if (sim.segIdx === 0 && sim.segS === 0) {
        const firstSeg = sim.segs[0];
        const startAng =
          firstSeg.type === 'line'
            ? firstSeg.ang
            : firstSeg.a0 + (firstSeg.da > 0 ? Math.PI / 2 : -Math.PI / 2);
        const diff = angDiff(startAng, h.angle);
        if (Math.abs(diff) > 0.03) {
          const stepAng = maxTurnRate * 1.15 * dt;
          if (Math.abs(diff) <= stepAng) {
            h.angle = startAng;
          } else {
            h.angle += Math.sign(diff) * stepAng;
            return;
          }
        } else {
          h.angle = startAng;
        }
      }

      let remDt = dt;
      while (remDt > 1e-6 && sim.segs && sim.segIdx < sim.segs.length) {
        const seg = sim.segs[sim.segIdx];
        const spd = seg.type === 'line' ? moveSpeed : Math.min(moveSpeed, maxTurnRate * seg.r);
        const remLen = seg.len - sim.segS;
        const needDt = remLen / spd;
        if (remDt >= needDt) {
          remDt -= needDt;
          sim.segS = seg.len;
          evalSmoothSeg(seg, seg.len, h);
          sim.segIdx += 1;
          sim.segS = 0;
        } else {
          sim.segS += spd * remDt;
          remDt = 0;
          evalSmoothSeg(seg, sim.segS, h);
        }

        const ncx = clamp(Math.floor(h.x), 1, CRAWL_COLS - 2);
        const ncy = clamp(Math.floor(h.y), 1, CRAWL_ROWS - 2);
        if (ncx !== h.cx || ncy !== h.cy) {
          h.cx = ncx;
          h.cy = ncy;
          crawlReveal();
          checkPathEvents();
          const interrupted = onEnterTile(ncx, ncy);
          if (interrupted) {
            break;
          }
        }
      }

      if (sim.segs && sim.segIdx >= sim.segs.length && sim.path) {
        const goalTile = sim.path[goalIdx];
        h.cx = goalTile.x;
        h.cy = goalTile.y;
        h.x = goalTile.x + 0.5;
        h.y = goalTile.y + 0.5;
        crawlReveal();
        checkPathEvents();
        onEnterTile(h.cx, h.cy);
        if (sim.enemy && sim.enemyCell) {
          sim.phase = 'face';
        } else {
          sim.exploreTarget = null;
          sim.path = null;
          sim.segs = null;
          sim.segIdx = 0;
          sim.segS = 0;
          sim.phase = 'decide';
        }
      }
    };

    const handleEnemyDefeated = () => {
      const enemy = sim.enemy;
      if (!enemy) return;
      const st = stateRef.current;
      const isBoss = enemy.isBoss;
      st.kills += 1;

      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      const activeBuff = getActiveFairyBuff(st.fairy);
      const stoneBuffMult =
        activeBuff?.kind === 'stones' ? 1 + fairyProfile.buffStonePct / 100 : 1;

      const stoneScale = enemy.isRareEscape
        ? 5.0
        : enemy.isGreatDemon
          ? 8.0
          : enemy.isMidBoss
            ? 2.5
            : isBoss
              ? 2.0
              : 1.0;
      const stoneGain = Math.max(
        1,
        Math.round(((1.4 + st.stage * 0.58) * stoneScale + rand(0, 1.5)) * stoneBuffMult),
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
      } else if (enemy.isGreatDemon) {
        st.chests += 5;
        st.mythicChests += 1;
        callbacksRef.current.onAddLog(`😈 覇王撃破！ 📦宝箱+5 & 🌈虹の宝箱+1`, '#f472b6');
        triggerFrameFlash(4);
        playSfx('mythic', st.soundOn);
        if (st.stage >= 100 && !st.cleared100) {
          st.cleared100 = true;
          showLootBanner('👑 100階「大魔王」討伐！裏世界＆虹装備解禁！', '#f472b6', true);
          callbacksRef.current.onTriggerMilestone100();
        } else {
          showLootBanner(`🌈 ${st.stage}F大魔王撃破！虹の宝箱×1 獲得！`, '#f472b6', true);
        }
      } else if (enemy.isMidBoss) {
        st.chests += 2;
        callbacksRef.current.onAddLog('守護者撃破！ 📦封印の宝箱+2', '#c084fc');
      } else if (isBoss) {
        st.chests += 1;
      }

      if (!enemy.isRareEscape) {
        const dropChance = isBoss ? 0.78 : 0.28;
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

      const heroStats = calcHeroStats(st.equipped, st.cleared100);
      sim.heroHp = Math.min(heroStats.hp, sim.heroHp + heroStats.hp * 0.2);

      if (sim.enemyCell) {
        sim.dying = {
          icon: enemy.icon,
          wx: sim.enemyCell.x + 0.5,
          wy: sim.enemyCell.y + 0.5,
          t: 0.45,
        };
      }

      sim.enemy = null;
      sim.enemyCell = null;
      sim.path = null;
      sim.segs = null;
      sim.phase = 'decide';

      if (isBoss) {
        if (!enemy.isGreatDemon) {
          callbacksRef.current.onAddLog(`ステージ${st.stage} ボス撃破！ (📦+1)`, '#fbbf24');
        }
        if (st.stage >= st.maxStage) {
          st.maxStage = st.stage + 1;
        }
        if (st.autoProgress) {
          st.stage += 1;
        }
        st.floorEncounters = 0;
        sim.needNewFloor = true;
      }

      const reduceSec = FAIRY_KILL_REDUCE_SEC + (isBoss ? FAIRY_FLOOR_REDUCE_SEC : 0);
      advanceFairyCooldown(st.fairy, reduceSec, fairyProfile.maxGifts);

      sim.battleMode = 'TRANSITION';
      sim.transTimer = isBoss ? 0.55 : 0.35;
      const hudEx = computeExploreHud();
      callbacksRef.current.onSyncHud({
        bossActive: false,
        floorEncounters: st.floorEncounters,
        stepsToStairs: hudEx.stepsToStairs,
        stairsFound: hudEx.stairsFound,
        explorePct: hudEx.explorePct,
      });
    };

    const rollSingleHitDamage = (
      stats: ReturnType<typeof calcHeroStats>,
      multFactor: number,
      isBoss: boolean,
      enemyDefRate: number,
    ) => {
      let tier: 0 | 1 | 2 | 3 = 0;

      if (stats.critRate <= 100) {
        if (Math.random() * 100 < stats.critRate) tier = 1;
      } else if (stats.critRate <= 200) {
        tier = Math.random() * 100 < stats.critRate - 100 ? 2 : 1;
      } else {
        tier = Math.random() * 100 < Math.min(100, stats.critRate - 200) ? 3 : 2;
      }

      const dmg = calcHitDamage(stats, enemyDefRate, isBoss, tier, multFactor, rand(0.95, 1.05));
      return { dmg, tier };
    };

    const updateHeroHpBar = () => {
      const st = stateRef.current;
      const stats = calcHeroStats(st.equipped, st.cleared100);
      const pct = clamp((sim.heroHp / stats.hp) * 100, 0, 100);
      if (heroHpBarRef.current) {
        heroHpBarRef.current.style.width = `${pct}%`;
      }
      if (heroHpTextRef.current) {
        heroHpTextRef.current.textContent = `HP ${fmt(sim.heroHp)} / ${fmt(stats.hp)}`;
      }
    };

    const stepBattle = (rawDt: number) => {
      const st = stateRef.current;
      const stats = calcHeroStats(st.equipped, st.cleared100);
      const combatDt = rawDt * sim.speed;

      if (sim.battleMode === 'WALKING') {
        if (sim.heroHp < stats.hp) {
          sim.heroHp = Math.min(stats.hp, sim.heroHp + stats.hp * 0.12 * combatDt);
        }
        const activeBuff = getActiveFairyBuff(st.fairy);
        const exploreMult =
          activeBuff?.kind === 'explore'
            ? 1 + getFairyProfile(getFairyRank(st.maxStage, st.cleared100)).buffExplorePct / 100
            : 1;
        crawlWalk(rawDt * exploreMult);
      } else if (sim.battleMode === 'FIGHTING' && sim.enemy) {
        if (sim.heroHp < stats.hp) {
          sim.heroHp = Math.min(stats.hp, sim.heroHp + stats.hp * 0.02 * combatDt);
        }

        if (sim.enemy.isRareEscape) {
          sim.rareEscapeTimer -= combatDt;
          if (sim.rareEscapeTimer <= 0) {
            callbacksRef.current.onAddLog('💨 はぐれ黄金スライムは逃げ出した…', '#94a3b8');
            showBattleBanner('💨 逃げられた！（ペナルティなし）');
            sim.enemy = null;
            sim.enemyCell = null;
            sim.path = null;
            sim.segs = null;
            sim.phase = 'decide';
            sim.battleMode = 'TRANSITION';
            sim.transTimer = 0.35;
            callbacksRef.current.onSyncHud({ bossActive: false });
            return;
          }
        }

        sim.heroAtkTimer += combatDt;
        const atkInterval = 1 / stats.aspd;
        let swings = 0;
        while (sim.heroAtkTimer >= atkInterval && swings < 10) {
          sim.heroAtkTimer -= atkInterval;
          swings++;

          const totalHits = 1 + stats.mythicCount;
          let totalDmgThisSwing = 0;
          let maxTier = 0;

          for (let hIdx = 0; hIdx < totalHits; hIdx++) {
            const factor = hIdx === 0 ? 1.0 : 0.5;
            const res = rollSingleHitDamage(stats, factor, sim.enemy.isBoss, sim.enemy.defRate);
            totalDmgThisSwing += res.dmg;
            if (res.tier > maxTier) maxTier = res.tier;

            if (res.dmg > st.maxDmg) {
              st.maxDmg = res.dmg;
              callbacksRef.current.onSyncHud({});
            }

            const delayMs = hIdx * 65;
            const yPos = 34 - hIdx * 5;
            const label =
              res.tier === 3
                ? `🌈極${fmt(res.dmg)}!!!`
                : res.tier === 2
                  ? `🔥超${fmt(res.dmg)}!!`
                  : res.tier === 1
                    ? `⚡${fmt(res.dmg)}!`
                    : fmt(res.dmg);
            const cls =
              res.tier === 3
                ? 'float-hyper-crit'
                : res.tier === 2
                  ? 'float-super-crit'
                  : res.tier === 1
                    ? 'float-crit'
                    : 'float-dmg';

            if (delayMs === 0) {
              spawnFloatText(50, yPos, label, cls);
            } else {
              setTimeout(() => spawnFloatText(50, yPos, label, cls), delayMs);
            }
          }

          sim.enemy.hp -= totalDmgThisSwing;
          sim.enemyShake = 0.18;
          spawnSlashFx(50, 52);
          playSfx(maxTier >= 1 ? 'crit' : 'hit', st.soundOn);

          if (sim.enemy.hp <= 0) {
            sim.enemy.hp = 0;
            handleEnemyDefeated();
            return;
          }
        }
        if (swings >= 10) sim.heroAtkTimer = Math.min(sim.heroAtkTimer, atkInterval);

        sim.enemyAtkTimer += combatDt;
        let eSwings = 0;
        while (sim.enemyAtkTimer >= sim.enemy.atkInterval && eSwings < 5) {
          sim.enemyAtkTimer -= sim.enemy.atkInterval;
          eSwings++;
          const eDmg = Math.max(1, Math.round(sim.enemy.atk * rand(0.9, 1.1)));
          sim.heroHp -= eDmg;

          spawnFloatText(15, 78, `-${fmt(eDmg)}`, 'float-hero-dmg');

          if (sim.heroHp <= 0) {
            sim.heroHp = 0;
            sim.battleMode = 'RECOVERING';
            sim.recoverTimer = 1.1;
            if (st.stage > 1) {
              st.stage -= 1;
              showBattleBanner(`撤退！ステージ${st.stage}で態勢を立て直す`);
              callbacksRef.current.onAddLog(`敗北によりステージ${st.stage}へ撤退しました`, '#f87171');
            } else {
              showBattleBanner('体勢を立て直した！');
            }
            sim.needNewFloor = true;
            callbacksRef.current.onSyncHud({ bossActive: false });
            break;
          }
        }
      } else if (sim.battleMode === 'TRANSITION') {
        sim.transTimer -= combatDt;
        if (sim.transTimer <= 0) {
          if (st.stage !== sim.floorStage || sim.needNewFloor) {
            sim.needNewFloor = false;
            enterFloor();
          }
          sim.battleMode = 'WALKING';
        }
      } else if (sim.battleMode === 'RECOVERING') {
        sim.recoverTimer -= combatDt;
        if (sim.recoverTimer <= 0) {
          sim.heroHp = stats.hp;
          enterFloor();
          sim.battleMode = 'WALKING';
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
      icon: string,
      zbuf: Float32Array,
      scale: number,
      alpha: number,
      shakeX: number,
      glowColor: string | null,
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
      const size = Math.min(H * 1.8, (H / ty) * scale);
      const colStep = sim.colStep || 2;
      const col = Math.max(0, Math.min(zbuf.length - 1, Math.floor(screenX / colStep)));
      if (ty > zbuf[col] + 0.05) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (glowColor) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 16;
      }
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, screenX + shakeX, H / 2 + size * 0.08);
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

      for (const k of sim.explored) {
        const [x, y] = k.split(',').map(Number);
        mctx.fillStyle = grid[y][x] === 1 ? '#3d5478' : '#131f36';
        mctx.fillRect(x * S, y * S, S, S);
      }

      for (const ev of sim.events) {
        if (ev.triggered) continue;
        if (sim.explored.has(crawlKey(ev.x, ev.y))) {
          mctx.fillStyle = '#fde047';
          mctx.beginPath();
          mctx.arc((ev.x + 0.5) * S, (ev.y + 0.5) * S, Math.max(2.2, S * 0.35), 0, Math.PI * 2);
          mctx.fill();
        }
      }

      if (sim.explored.has(crawlKey(sim.stairs.x, sim.stairs.y))) {
        mctx.fillStyle = '#fbbf24';
        mctx.fillRect(sim.stairs.x * S + 1, sim.stairs.y * S + 1, S - 2, S - 2);
      }

      if (sim.enemy && sim.enemyCell && sim.explored.has(crawlKey(sim.enemyCell.x, sim.enemyCell.y))) {
        mctx.fillStyle = sim.enemy.isRareEscape
          ? (Date.now() % 400 < 200 ? '#fde047' : '#38bdf8')
          : '#f87171';
        mctx.fillRect(sim.enemyCell.x * S + 1, sim.enemyCell.y * S + 1, S - 2, S - 2);
      }

      const h = sim.hero;
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
      if (sim.enemyShake > 0) sim.enemyShake -= rdt;
      if (sim.dying) {
        sim.dying.t -= rdt;
        if (sim.dying.t <= 0) sim.dying = null;
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

      const ceil = ctx.createLinearGradient(0, 0, 0, horizon);
      ceil.addColorStop(0, pal.ceil0);
      ceil.addColorStop(1, pal.ceil1);
      ctx.fillStyle = ceil;
      ctx.fillRect(0, 0, W, horizon);

      const fl = ctx.createLinearGradient(0, horizon, 0, H);
      fl.addColorStop(0, pal.floor0);
      fl.addColorStop(1, pal.floor1);
      ctx.fillStyle = fl;
      ctx.fillRect(0, horizon, W, H - horizon);

      const dirX = Math.cos(h.angle);
      const dirY = Math.sin(h.angle);
      const planeX = -dirY * 0.66;
      const planeY = dirX * 0.66;

      const colStep = W > 800 ? 2 : 1;
      sim.colStep = colStep;
      const zbuf = new Float32Array(Math.ceil(W / colStep));
      const base = pal.wall;
      const fogCol = pal.fogWall;

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
        for (let i = 0; i < 64 && !hit; i++) {
          if (sdx < sdy) {
            sdx += ddx;
            mx += stepX;
            side = 0;
          } else {
            sdy += ddy;
            my += stepY;
            side = 1;
          }
          if (mx < 0 || my < 0 || mx >= CRAWL_COLS || my >= CRAWL_ROWS || grid[my][mx] === 1) {
            hit = 1;
          }
        }
        const dist = side === 0 ? sdx - ddx : sdy - ddy;
        zbuf[(sx / colStep) | 0] = dist;
        const lh = H / Math.max(dist, 0.0001);
        const y0 = horizon - lh / 2;
        const y1 = horizon + lh / 2;
        const wallX = side === 0 ? h.y + dist * rdy : h.x + dist * rdx;
        const frac = wallX - Math.floor(wallX);

        const fog = Math.max(0.14, 1 - dist / 12.5);
        const sideShade = side === 1 ? 0.76 : 1.0;
        const seamAlpha = Math.max(0, 1 - dist / 6.5);
        const seamShade = seamAlpha > 0 && (frac < 0.04 || frac > 0.96) ? 1 - 0.36 * seamAlpha : 1.0;

        const rCol = Math.round((base[0] * fog + fogCol[0] * (1 - fog)) * sideShade * seamShade);
        const gCol = Math.round((base[1] * fog + fogCol[1] * (1 - fog)) * sideShade * seamShade);
        const bCol = Math.round((base[2] * fog + fogCol[2] * (1 - fog)) * sideShade * seamShade);

        ctx.fillStyle = `rgb(${rCol},${gCol},${bCol})`;
        ctx.fillRect(sx, y0, colStep, y1 - y0);

        const hAlpha = 0.22 * Math.max(0, 1 - dist / 6.0);
        if (hAlpha > 0.02) {
          ctx.fillStyle = `rgba(0,0,0,${hAlpha.toFixed(2)})`;
          const hWall = y1 - y0;
          for (let r = 1; r <= 3; r++) {
            ctx.fillRect(sx, y0 + hWall * (r * 0.25), colStep, 1.5);
          }
        }
      }

      const sprites: Array<{
        wx: number;
        wy: number;
        icon: string;
        scale: number;
        alpha: number;
        shake: number;
        glow: string | null;
      }> = [
        {
          wx: sim.stairs.x + 0.5,
          wy: sim.stairs.y + 0.5,
          icon: '🪜',
          scale: 0.55,
          alpha: 1,
          shake: 0,
          glow: null,
        },
      ];

      for (const ev of sim.events) {
        if (!ev.triggered) {
          sprites.push({
            wx: ev.x + 0.5,
            wy: ev.y + 0.5,
            icon: ev.icon,
            scale: 0.65,
            alpha: 1,
            shake: 0,
            glow: 'rgba(251, 191, 36, 0.8)',
          });
        }
      }

      if (sim.dying) {
        sprites.push({
          wx: sim.dying.wx,
          wy: sim.dying.wy,
          icon: sim.dying.icon,
          scale: 0.95,
          alpha: Math.max(0, sim.dying.t / 0.45),
          shake: 0,
          glow: null,
        });
      }

      if (sim.enemy && sim.enemyCell && sim.battleMode !== 'TRANSITION') {
        const shake = sim.enemyShake > 0 ? (Math.random() - 0.5) * 10 : 0;
        const glow = sim.enemy.isRareEscape
          ? 'rgba(250, 204, 21, 0.95)'
          : sim.enemy.isGreatDemon
            ? 'rgba(244, 114, 182, 0.95)'
            : sim.enemy.isMidBoss
              ? 'rgba(192, 132, 252, 0.8)'
              : null;
        sprites.push({
          wx: sim.enemyCell.x + 0.5,
          wy: sim.enemyCell.y + 0.5,
          icon: sim.enemy.icon,
          scale: sim.enemy.isGreatDemon ? 1.45 : sim.enemy.isBoss ? 1.25 : 0.95,
          alpha: 1,
          shake,
          glow,
        });
      }

      sprites.sort((a, b) => {
        const da = (a.wx - h.x) ** 2 + (a.wy - h.y) ** 2;
        const db = (b.wx - h.x) ** 2 + (b.wy - h.y) ** 2;
        return db - da;
      });
      for (const sp of sprites) {
        drawSprite(ctx, W, H, sp.wx, sp.wy, sp.icon, zbuf, sp.scale, sp.alpha, sp.shake, sp.glow);
      }

      if (
        sim.enemy &&
        sim.enemyCell &&
        sim.battleMode !== 'TRANSITION' &&
        (sim.battleMode === 'FIGHTING' || sim.phase === 'face')
      ) {
        const bw = 200;
        const bx = (W - bw) / 2;
        const by = 56;
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
        ctx.fillStyle = sim.enemy.isRareEscape
          ? '#eab308'
          : sim.enemy.isGreatDemon
            ? '#ec4899'
            : '#dc2626';
        ctx.fillRect(bx, by, bw * Math.max(0, sim.enemy.hp / sim.enemy.maxHp), 8);
        ctx.fillStyle = sim.enemy.isRareEscape ? '#fde047' : '#fff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${sim.enemy.name}  HP ${fmt(Math.max(0, sim.enemy.hp))}/${fmt(sim.enemy.maxHp)}`,
          W / 2,
          by - 8,
        );

        if (sim.enemy.isRareEscape && sim.battleMode === 'FIGHTING') {
          const tw = 150;
          const tx = (W - tw) / 2;
          const ty = by + 16;
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(tx - 1, ty - 1, tw + 2, 7);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(tx, ty, tw * clamp(sim.rareEscapeTimer / 10.0, 0, 1), 5);
          ctx.fillStyle = '#bae6fd';
          ctx.font = '11px sans-serif';
          ctx.fillText(`逃走まで ${Math.max(0, sim.rareEscapeTimer).toFixed(1)}秒`, W / 2, ty + 16);
        }
      }

      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      renderMap();
    };

    engineApiRef.current = {
      resetToCurrentStage: () => {
        const stats = calcHeroStats(stateRef.current.equipped, stateRef.current.cleared100);
        sim.heroHp = stats.hp;
        sim.battleMode = 'WALKING';
        enterFloor();
        updateHeroHpBar();
      },
    };

    const initStats = calcHeroStats(stateRef.current.equipped, stateRef.current.cleared100);
    sim.heroHp = initStats.hp;
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
        const dt = Math.min(rawDt, 0.15);
        if (!sim.paused) stepBattle(dt);
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
    if (sim.moveStyle === 'step') {
      h.x = h.cx + 0.5;
      h.y = h.cy + 0.5;
      h.angle = Math.round(h.angle / (Math.PI / 2)) * (Math.PI / 2);
    }
    if (sim.phase !== 'face') {
      sim.phase = 'decide';
      sim.path = null;
      sim.segs = null;
      sim.segIdx = 0;
      sim.segS = 0;
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
          width={152}
          height={152}
          data-testid="minimap-canvas"
          className="absolute right-2.5 top-10 z-10 rounded-lg border border-slate-400/45 bg-[#020610]/85"
        />

        {/* Top HUD (No title badge, clean random-encounter status instead of 5-wave dots) */}
        <div
          ref={hudBarRef}
          className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-[#090d16]/90 to-[#090d16]/25 px-3 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold drop-shadow">
            <span>{biomeLabel}</span>
            <span className="text-sky-400">St.{hudSnapshot.stage}</span>
            <span
              data-testid="floor-explore-status"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300"
            >
              <span>遭遇 {hudSnapshot.floorEncounters}体</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  hudSnapshot.bossActive
                    ? 'font-bold text-red-400'
                    : hudSnapshot.stairsFound
                      ? 'text-amber-300'
                      : 'text-sky-300'
                }
              >
                {hudSnapshot.bossActive
                  ? '階段ボス戦'
                  : hudSnapshot.stairsFound
                    ? `階段まで ${hudSnapshot.stepsToStairs}歩`
                    : `探索 ${hudSnapshot.explorePct}%`}
              </span>
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

        {/* Non-blocking loot banner */}
        <div
          id="loot-banner"
          ref={lootBannerRef}
          className="pointer-events-none absolute left-1/2 top-11 z-20 -translate-x-1/2 -translate-y-2.5 whitespace-nowrap rounded-full border-2 border-amber-400 bg-slate-900/95 px-3.5 py-1.5 text-xs font-extrabold text-white opacity-0 shadow-2xl transition duration-200"
        />

        {/* Hero HP HUD */}
        <div
          id="hero-hud"
          className="absolute bottom-2.5 left-3 z-10 rounded-lg border border-slate-400/30 bg-[#020610]/65 px-2.5 py-1.5"
        >
          <div ref={heroHpTextRef} className="mb-1 text-[10px] font-bold text-white drop-shadow">
            HP 110 / 110
          </div>
          <div className="h-2.5 w-[170px] overflow-hidden rounded border border-white/25 bg-black/75 max-sm:w-[112px]">
            <div
              ref={heroHpBarRef}
              className="h-full w-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-100"
            />
          </div>
        </div>

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
