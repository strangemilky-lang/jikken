import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomStrip } from './components/BottomStrip';
import { ChestModal } from './components/ChestModal';
import { DungeonViewport, type DungeonEngineApi } from './components/DungeonViewport';
import { EquippedWindow } from './components/EquippedWindow';
import { FairyWidget } from './components/FairyWidget';
import type { WindowPos, WindowSize } from './components/FloatingWindow';
import { MilestoneModal } from './components/MilestoneModal';
import { OfflineModal } from './components/OfflineModal';
import { StorageWindow } from './components/StorageWindow';
import { playSfx } from './game/audio';
import {
  CHEST_BATCH_MAX,
  MAX_BAG_SIZE,
  MAX_OFFLINE_SEC,
  MAX_STASH_SIZE,
  RARITIES,
  SAVE_KEY,
  SLOT_ORDER,
  SUBSTAT_STEP_INTERVAL,
} from './game/constants';
import {
  advanceFairyCooldown,
  claimFairyGift,
  getFairyProfile,
  getFairyRank,
} from './game/fairy';
import {
  commitChestItemToState,
  filterAndSortStorageItems,
  fmt,
  formatUpgradeMessage,
  generateItem,
  getMaxEquipLevel,
  getNextSelectedStorageId,
  getSalvageValue,
  getUpgradeCost,
  partitionBulkSalvage,
  rollSubstatMilestone,
  uid,
} from './game/items';
import {
  enterSanctumState,
  getNextManualStage,
  getPrevManualStage,
  resolveDefeatRetreatStage,
} from './game/sanctum';
import { computeOfflineRewards, createDefaultState, loadSavedGame, persistGame } from './game/save';
import type {
  CrawlSizeMode,
  DragItemPayload,
  GachaPullResult,
  GameState,
  Item,
  MoveStyle,
  OfflineSummary,
  SalvageBulkMode,
  SlotKey,
  SortMode,
  WindowKey,
} from './game/types';

const WINDOW_LAYOUT_KEY = 'strip_hero_window_layout_v3';

const DEFAULT_WINDOW_SIZES: Record<WindowKey, WindowSize> = {
  equipped: { width: 600, height: 640 },
  bag: { width: 720, height: 640 },
  stash: { width: 720, height: 640 },
};

function getDefaultWindowPositions(): Record<WindowKey, WindowPos> {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  return {
    equipped: { x: 12, y: 12 },
    bag: { x: Math.max(16, Math.min(vw - 732, 340)), y: 16 },
    stash: { x: Math.max(20, vw - 732), y: 20 },
  };
}

function loadWindowLayout(): {
  positions: Record<WindowKey, WindowPos>;
  sizes: Record<WindowKey, WindowSize>;
} {
  const defaultPositions = getDefaultWindowPositions();
  const defaultSizes: Record<WindowKey, WindowSize> = {
    equipped: { ...DEFAULT_WINDOW_SIZES.equipped },
    bag: { ...DEFAULT_WINDOW_SIZES.bag },
    stash: { ...DEFAULT_WINDOW_SIZES.stash },
  };
  if (typeof window === 'undefined') {
    return { positions: defaultPositions, sizes: defaultSizes };
  }
  const maxX = Math.max(8, window.innerWidth - 220);
  const maxY = Math.max(8, window.innerHeight - 64);
  try {
    const raw = localStorage.getItem(WINDOW_LAYOUT_KEY);
    if (!raw) return { positions: defaultPositions, sizes: defaultSizes };
    const parsed = JSON.parse(raw) as {
      positions?: Partial<Record<WindowKey, WindowPos>>;
      sizes?: Partial<Record<WindowKey, WindowSize>>;
    };
    const clampPos = (p: WindowPos | undefined, fallback: WindowPos): WindowPos => {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return fallback;
      return {
        x: Math.max(8, Math.min(maxX, p.x)),
        y: Math.max(8, Math.min(maxY, p.y)),
      };
    };
    const clampSize = (
      s: WindowSize | undefined,
      fallback: WindowSize,
      minW: number,
      minH: number,
    ): WindowSize => {
      if (!s || typeof s.width !== 'number' || typeof s.height !== 'number') return fallback;
      return {
        width: Math.max(minW, Math.min(window.innerWidth - 16, s.width)),
        height: Math.max(minH, Math.min(window.innerHeight - 16, s.height)),
      };
    };
    return {
      positions: {
        equipped: clampPos(parsed.positions?.equipped, defaultPositions.equipped),
        bag: clampPos(parsed.positions?.bag, defaultPositions.bag),
        stash: clampPos(parsed.positions?.stash, defaultPositions.stash),
      },
      sizes: {
        equipped: clampSize(parsed.sizes?.equipped, defaultSizes.equipped, 520, 480),
        bag: clampSize(parsed.sizes?.bag, defaultSizes.bag, 580, 480),
        stash: clampSize(parsed.sizes?.stash, defaultSizes.stash, 580, 480),
      },
    };
  } catch {
    return { positions: defaultPositions, sizes: defaultSizes };
  }
}

export default function App() {
  const initialLoadedRef = useRef<{ state: GameState; hasSave: boolean } | null>(null);
  if (!initialLoadedRef.current) {
    const loaded = loadSavedGame();
    initialLoadedRef.current = {
      state: loaded ?? createDefaultState(),
      hasSave: loaded !== null,
    };
  }

  const stateRef = useRef<GameState>(initialLoadedRef.current.state);
  const engineApiRef = useRef<DungeonEngineApi | null>(null);
  const [, setTickRev] = useState(0);
  const forceRender = useCallback(() => setTickRev((v) => v + 1), []);

  // Discrete HUD state synchronized from engine events (never 60Hz)
  const [hudMeta, setHudMeta] = useState<{
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
  }>({
    floorEncounters: stateRef.current.floorEncounters,
    stepsToStairs: 0,
    stairsFound: false,
    hasFloorKey: false,
    explorePct: 0,
    bossActive: false,
    paused: false,
    speed: 1,
    moveStyle: 'smooth',
    sizeMode: 'small',
  });

  // Floating Window states (Equipped / Bag / Stash)
  const [openWindows, setOpenWindows] = useState<Record<WindowKey, boolean>>({
    equipped: false,
    bag: false,
    stash: false,
  });
  const [windowOrder, setWindowOrder] = useState<WindowKey[]>(['equipped', 'bag', 'stash']);
  const [windowPositions, setWindowPositions] = useState<Record<WindowKey, WindowPos>>(
    () => loadWindowLayout().positions,
  );
  const [windowSizes, setWindowSizes] = useState<Record<WindowKey, WindowSize>>(
    () => loadWindowLayout().sizes,
  );
  const [selectedEquippedSlot, setSelectedEquippedSlot] = useState<SlotKey>('weapon');

  const [bagFilterSlot, setBagFilterSlot] = useState<'all' | SlotKey>('all');
  const [bagSortMode, setBagSortMode] = useState<SortMode>('newest');
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null);
  const [bagMobileDetail, setBagMobileDetail] = useState(false);

  const [stashFilterSlot, setStashFilterSlot] = useState<'all' | SlotKey>('all');
  const [stashSortMode, setStashSortMode] = useState<SortMode>('newest');
  const [selectedStashId, setSelectedStashId] = useState<string | null>(null);
  const [stashMobileDetail, setStashMobileDetail] = useState(false);

  const [draggedItem, setDraggedItem] = useState<DragItemPayload | null>(null);

  const [isRollingUpgrade, setIsRollingUpgrade] = useState(false);
  const [rouletteActiveIdx, setRouletteActiveIdx] = useState<number | null>(null);
  const [lastBoostedSubIdx, setLastBoostedSubIdx] = useState<number | null>(null);
  const [upgradeFeedback, setUpgradeFeedback] = useState('');

  const [chestModalOpen, setChestModalOpen] = useState(false);
  const [chestAutoSalvage, setChestAutoSalvage] = useState(true);
  const [isOpeningChests, setIsOpeningChests] = useState(false);
  const [chestResults, setChestResults] = useState<GachaPullResult[]>([]);

  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [offlineSummary, setOfflineSummary] = useState<OfflineSummary | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const [fairyCollapsed, setFairyCollapsed] = useState(false);
  const [fairyClaimMsg, setFairyClaimMsg] = useState('');
  const fairyMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingUpgradeFlushRef = useRef<(() => void) | null>(null);
  const pendingChestFlushesRef = useRef<Array<() => void>>([]);
  const activeIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const clearAllPendingTimers = useCallback(() => {
    for (const id of activeIntervalsRef.current) clearInterval(id);
    activeIntervalsRef.current.clear();
  }, []);

  const addLog = useCallback(
    (msg: string, color: string | null = null) => {
      const t = new Date();
      const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      stateRef.current.logs.unshift({ ts, msg, color });
      if (stateRef.current.logs.length > 30) stateRef.current.logs.length = 30;
      forceRender();
    },
    [forceRender],
  );

  const applyOfflineElapsed = useCallback(
    (elapsedSec: number, showModal: boolean) => {
      const st = stateRef.current;
      const summary = computeOfflineRewards(st, elapsedSec);
      if (!summary) return;

      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      advanceFairyCooldown(st.fairy, Math.min(elapsedSec, MAX_OFFLINE_SEC), fairyProfile.maxGifts);

      st.kills += summary.kills;
      st.stones += summary.stones;
      st.chests += summary.chests;
      for (let i = summary.keptItems.length - 1; i >= 0; i--) {
        st.inventory.unshift(summary.keptItems[i]);
      }
      addLog(
        `放置収益: ${summary.kills}体討伐 / +${fmt(summary.stones)}💎 / 装備${summary.keptItems.length} / 箱+${summary.chests}`,
        '#38bdf8',
      );
      persistGame(st);
      forceRender();
      if (showModal) {
        setOfflineSummary(summary);
      }
    },
    [addLog, forceRender],
  );

  const isOpeningChestsRef = useRef(isOpeningChests);
  isOpeningChestsRef.current = isOpeningChests;
  const isRollingUpgradeRef = useRef(isRollingUpgrade);
  isRollingUpgradeRef.current = isRollingUpgrade;
  const windowOrderRef = useRef(windowOrder);
  windowOrderRef.current = windowOrder;
  const initialOfflineCheckedRef = useRef(false);

  useEffect(() => {
    if (!initialOfflineCheckedRef.current) {
      initialOfflineCheckedRef.current = true;
      const { hasSave, state } = initialLoadedRef.current!;
      if (hasSave && state.lastSaveTime) {
        const elapsedSec = (Date.now() - state.lastSaveTime) / 1000;
        if (elapsedSec >= 10) {
          applyOfflineElapsed(elapsedSec, true);
        }
      }
    }

    const flushAndSave = () => {
      if (pendingUpgradeFlushRef.current) {
        const fn = pendingUpgradeFlushRef.current;
        pendingUpgradeFlushRef.current = null;
        fn();
      }
      if (pendingChestFlushesRef.current.length > 0) {
        const list = pendingChestFlushesRef.current.splice(0);
        for (const fn of list) fn();
      }
      persistGame(stateRef.current);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        flushAndSave();
      } else {
        forceRender();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isOpeningChestsRef.current) setChestModalOpen(false);
        if (!isRollingUpgradeRef.current) {
          setOpenWindows({ equipped: false, bag: false, stash: false });
        }
        setResetConfirmOpen(false);
      }
    };

    const handleResize = () => {
      if (window.innerWidth < 768) {
        setOpenWindows((prev) => {
          const openList = (['equipped', 'bag', 'stash'] as WindowKey[]).filter((k) => prev[k]);
          if (openList.length <= 1) return prev;
          const topOpen = [...windowOrderRef.current].reverse().find((k) => prev[k]) ?? openList[0];
          return {
            equipped: topOpen === 'equipped',
            bag: topOpen === 'bag',
            stash: topOpen === 'stash',
          };
        });
      } else {
        const maxX = Math.max(8, window.innerWidth - 220);
        const maxY = Math.max(8, window.innerHeight - 64);
        setWindowPositions((prev) => ({
          equipped: { x: Math.max(8, Math.min(maxX, prev.equipped.x)), y: Math.max(8, Math.min(maxY, prev.equipped.y)) },
          bag: { x: Math.max(8, Math.min(maxX, prev.bag.x)), y: Math.max(8, Math.min(maxY, prev.bag.y)) },
          stash: { x: Math.max(8, Math.min(maxX, prev.stash.x)), y: Math.max(8, Math.min(maxY, prev.stash.y)) },
        }));
      }
    };

    window.addEventListener('beforeunload', flushAndSave);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      clearAllPendingTimers();
      if (fairyMsgTimerRef.current) {
        clearTimeout(fairyMsgTimerRef.current);
        fairyMsgTimerRef.current = null;
      }
      window.removeEventListener('beforeunload', flushAndSave);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [applyOfflineElapsed, clearAllPendingTimers, forceRender]);

  const fairySimActive =
    !hudMeta.paused &&
    !chestModalOpen &&
    !milestoneOpen &&
    offlineSummary === null &&
    !resetConfirmOpen;

  useEffect(() => {
    if (!fairySimActive) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      const prof = getFairyProfile(getFairyRank(s.maxStage, s.cleared100));
      advanceFairyCooldown(s.fairy, 1, prof.maxGifts);
      if (s.fairy.buffKind && s.fairy.buffUntil <= Date.now()) {
        s.fairy.buffKind = null;
        s.fairy.buffUntil = 0;
      }
      forceRender();
    }, 1000);
    return () => clearInterval(id);
  }, [fairySimActive, forceRender]);

  const handleSyncHud = useCallback(
    (patch?: Partial<typeof hudMeta>) => {
      if (patch && Object.keys(patch).length > 0) {
        setHudMeta((prev) => ({ ...prev, ...patch }));
      }
      forceRender();
    },
    [forceRender],
  );

  const handleItemDrop = useCallback(
    (item: Item, silent = false) => {
      const st = stateRef.current;
      const rInfo = RARITIES[item.rarity];
      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      if (item.rarity <= st.autoSalvageRarity) {
        const dust = getSalvageValue(item, fairyProfile.salvageBonusPct);
        st.stones += dust;
        if (!silent) addLog(`自動分解: ${item.name} (+${dust}💎)`, rInfo.color);
      } else if (st.inventory.length >= MAX_BAG_SIZE) {
        const dust = getSalvageValue(item, fairyProfile.salvageBonusPct);
        st.stones += dust;
        if (!silent) addLog(`バッグ満杯で分解: ${item.name} (+${dust}💎)`, rInfo.color);
      } else {
        st.inventory.unshift(item);
        if (!silent) addLog(`入手: [${rInfo.name}] ${item.name} (St.${item.stage})`, rInfo.color);
      }
      forceRender();
    },
    [addLog, forceRender],
  );

  const findItemById = (
    id: string | null,
  ): { item: Item; location: 'equipped' | 'bag' | 'stash' } | null => {
    if (!id) return null;
    const st = stateRef.current;
    for (const k of SLOT_ORDER) {
      if (st.equipped[k] && st.equipped[k].id === id) {
        return { item: st.equipped[k], location: 'equipped' };
      }
    }
    const bagFound = st.inventory.find((i) => i.id === id);
    if (bagFound) return { item: bagFound, location: 'bag' };
    const stashFound = st.stash.find((i) => i.id === id);
    if (stashFound) return { item: stashFound, location: 'stash' };
    return null;
  };

  const focusWindow = (win: WindowKey) => {
    setWindowOrder((prev) => (prev[prev.length - 1] === win ? prev : [...prev.filter((w) => w !== win), win]));
  };

  const windowPositionsRef = useRef(windowPositions);
  windowPositionsRef.current = windowPositions;
  const windowSizesRef = useRef(windowSizes);
  windowSizesRef.current = windowSizes;

  const persistWindowLayout = (
    positions: Record<WindowKey, WindowPos>,
    sizes: Record<WindowKey, WindowSize>,
  ) => {
    try {
      localStorage.setItem(WINDOW_LAYOUT_KEY, JSON.stringify({ positions, sizes }));
    } catch {
      // ignore storage errors
    }
  };

  const moveWindowPosition = (win: WindowKey, pos: WindowPos) => {
    setWindowPositions((prev) => {
      const next = { ...prev, [win]: pos };
      persistWindowLayout(next, windowSizesRef.current);
      return next;
    });
  };

  const resizeWindowSize = (win: WindowKey, size: WindowSize) => {
    setWindowSizes((prev) => {
      const next = { ...prev, [win]: size };
      persistWindowLayout(windowPositionsRef.current, next);
      return next;
    });
  };

  const openWindow = (win: WindowKey, opts?: { slot?: SlotKey; toggle?: boolean }) => {
    if (isRollingUpgrade) return;
    const st = stateRef.current;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (win === 'equipped' && opts?.slot) {
      setSelectedEquippedSlot(opts.slot);
    }

    if (win === 'bag') {
      const visible = filterAndSortStorageItems(st.inventory, bagFilterSlot, bagSortMode);
      if (!selectedBagId || !visible.some((i) => i.id === selectedBagId)) {
        setSelectedBagId(visible[0]?.id ?? null);
      }
      setBagMobileDetail(false);
    }

    if (win === 'stash') {
      const visible = filterAndSortStorageItems(st.stash, stashFilterSlot, stashSortMode);
      if (!selectedStashId || !visible.some((i) => i.id === selectedStashId)) {
        setSelectedStashId(visible[0]?.id ?? null);
      }
      setStashMobileDetail(false);
    }

    setOpenWindows((prev) => {
      const nextOpen = opts?.toggle ? !prev[win] : true;
      if (isMobile && nextOpen) {
        return {
          equipped: win === 'equipped',
          bag: win === 'bag',
          stash: win === 'stash',
        };
      }
      return { ...prev, [win]: nextOpen };
    });
    focusWindow(win);
    setUpgradeFeedback('');
    setLastBoostedSubIdx(null);
  };

  const closeWindow = (win: WindowKey) => {
    if (isRollingUpgrade) return;
    setOpenWindows((prev) => ({ ...prev, [win]: false }));
  };

  const handleEquipItem = (itemId: string) => {
    if (isRollingUpgrade) return;
    const st = stateRef.current;

    const bagIdx = st.inventory.findIndex((i) => i.id === itemId);
    if (bagIdx !== -1) {
      const visibleBefore = filterAndSortStorageItems(st.inventory, bagFilterSlot, bagSortMode);
      const nextItem = st.inventory[bagIdx];
      const prevItem = st.equipped[nextItem.slot];
      st.inventory.splice(bagIdx, 1);
      if (prevItem) st.inventory.unshift(prevItem);
      st.equipped[nextItem.slot] = nextItem;

      setSelectedEquippedSlot(nextItem.slot);
      const prevVisible =
        prevItem && (bagFilterSlot === 'all' || bagFilterSlot === prevItem.slot);
      setSelectedBagId(
        prevVisible ? prevItem.id : getNextSelectedStorageId(visibleBefore, itemId),
      );
      setBagMobileDetail(false);
      setUpgradeFeedback('');
      setLastBoostedSubIdx(null);
      playSfx('upgrade', st.soundOn);
      addLog(`装備変更: ${nextItem.name} を装着`, RARITIES[nextItem.rarity].color);
      persistGame(st);
      forceRender();
      return;
    }

    const stashIdx = st.stash.findIndex((i) => i.id === itemId);
    if (stashIdx !== -1) {
      const visibleBefore = filterAndSortStorageItems(st.stash, stashFilterSlot, stashSortMode);
      const nextItem = st.stash[stashIdx];
      const prevItem = st.equipped[nextItem.slot];
      st.stash.splice(stashIdx, 1);
      if (prevItem) st.stash.unshift(prevItem);
      st.equipped[nextItem.slot] = nextItem;

      setSelectedEquippedSlot(nextItem.slot);
      const prevVisible =
        prevItem && (stashFilterSlot === 'all' || stashFilterSlot === prevItem.slot);
      setSelectedStashId(
        prevVisible ? prevItem.id : getNextSelectedStorageId(visibleBefore, itemId),
      );
      setStashMobileDetail(false);
      setUpgradeFeedback('');
      setLastBoostedSubIdx(null);
      playSfx('upgrade', st.soundOn);
      addLog(`装備変更(倉庫): ${nextItem.name} を装着`, RARITIES[nextItem.rarity].color);
      persistGame(st);
      forceRender();
    }
  };

  const handleMoveItemBetweenStorage = (itemId: string, target: 'bag' | 'stash') => {
    if (isRollingUpgrade) return;
    const st = stateRef.current;
    if (target === 'stash') {
      if (st.stash.length >= MAX_STASH_SIZE) {
        setUpgradeFeedback(`倉庫が満杯です（最大${MAX_STASH_SIZE}個）`);
        return;
      }
      const idx = st.inventory.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const visibleBefore = filterAndSortStorageItems(st.inventory, bagFilterSlot, bagSortMode);
      const [moved] = st.inventory.splice(idx, 1);
      st.stash.unshift(moved);
      if (selectedBagId === itemId) {
        setSelectedBagId(getNextSelectedStorageId(visibleBefore, itemId));
        setBagMobileDetail(false);
      }
      if (stashFilterSlot === 'all' || stashFilterSlot === moved.slot) {
        setSelectedStashId(moved.id);
      }
      setUpgradeFeedback(`📦 ${moved.name} を倉庫へ預けました`);
      playSfx('drop', st.soundOn);
      persistGame(st);
      forceRender();
    } else {
      if (st.inventory.length >= MAX_BAG_SIZE) {
        setUpgradeFeedback(`バッグが満杯です（最大${MAX_BAG_SIZE}個）`);
        return;
      }
      const idx = st.stash.findIndex((i) => i.id === itemId);
      if (idx === -1) return;
      const visibleBefore = filterAndSortStorageItems(st.stash, stashFilterSlot, stashSortMode);
      const [moved] = st.stash.splice(idx, 1);
      st.inventory.unshift(moved);
      if (selectedStashId === itemId) {
        setSelectedStashId(getNextSelectedStorageId(visibleBefore, itemId));
        setStashMobileDetail(false);
      }
      if (bagFilterSlot === 'all' || bagFilterSlot === moved.slot) {
        setSelectedBagId(moved.id);
      }
      setUpgradeFeedback(`🎒 ${moved.name} をバッグへ戻しました`);
      playSfx('drop', st.soundOn);
      persistGame(st);
      forceRender();
    }
  };

  const handleDropEquip = (payload: DragItemPayload) => {
    setDraggedItem(null);
    handleEquipItem(payload.itemId);
  };

  const handleDropMoveItem = (payload: DragItemPayload, target: 'bag' | 'stash') => {
    setDraggedItem(null);
    if (payload.source === target) return;
    handleMoveItemBetweenStorage(payload.itemId, target);
  };

  const handleUpgradeItem = (itemId: string) => {
    if (isRollingUpgrade) return;
    const st = stateRef.current;
    const found = findItemById(itemId);
    if (!found) return;
    const item = found.item;
    if (item.level >= getMaxEquipLevel(item)) return;

    const cost = getUpgradeCost(item);
    if (st.stones < cost) return;

    st.stones -= cost;
    item.spentStones = (item.spentStones || 0) + cost;
    item.level += 1;
    setLastBoostedSubIdx(null);

    if (item.level % SUBSTAT_STEP_INTERVAL === 0) {
      const milestone = rollSubstatMilestone(item);
      if (!milestone) return;

      if (milestone.mode === 'unlock') {
        item.subStats.push(milestone.newSub);
        setLastBoostedSubIdx(milestone.targetIdx);
        setUpgradeFeedback(
          formatUpgradeMessage(item.level, milestone.subLabel, milestone.boost, milestone.unit, true),
        );
        playSfx(milestone.isJackpot ? 'jackpot' : 'upgrade', st.soundOn);
        persistGame(st);
        forceRender();
        return;
      }

      const targetSub = item.subStats[milestone.targetIdx];
      let timer: ReturnType<typeof setInterval> | null = null;
      const commitBoost = () => {
        if (timer !== null) {
          clearInterval(timer);
          activeIntervalsRef.current.delete(timer);
          timer = null;
        }
        targetSub.val = +(targetSub.val + milestone.boost).toFixed(1);
        targetSub.boosts = (targetSub.boosts || 0) + 1;
        pendingUpgradeFlushRef.current = null;
        setRouletteActiveIdx(null);
        setLastBoostedSubIdx(milestone.targetIdx);
        setIsRollingUpgrade(false);
        setUpgradeFeedback(
          formatUpgradeMessage(item.level, milestone.subLabel, milestone.boost, milestone.unit, false),
        );
      };

      pendingUpgradeFlushRef.current = commitBoost;
      setIsRollingUpgrade(true);
      setUpgradeFeedback('サブステ抽選中...');
      forceRender();

      const steps = Math.max(6, item.subStats.length * 2 + milestone.targetIdx);
      let step = 0;

      timer = setInterval(() => {
        const curIdx = step % item.subStats.length;
        setRouletteActiveIdx(curIdx);
        playSfx('roulette', st.soundOn);

        if (step >= steps && curIdx === milestone.targetIdx) {
          commitBoost();
          playSfx(milestone.isJackpot ? 'jackpot' : 'upgrade', st.soundOn);
          persistGame(st);
          forceRender();
          return;
        }
        step++;
      }, 55);
      activeIntervalsRef.current.add(timer);
    } else {
      setUpgradeFeedback(formatUpgradeMessage(item.level));
      playSfx('upgrade', st.soundOn);
      persistGame(st);
      forceRender();
    }
  };

  const handleToggleLock = (itemId: string) => {
    const found = findItemById(itemId);
    if (!found) return;
    found.item.locked = !found.item.locked;
    persistGame(stateRef.current);
    forceRender();
  };

  const handleSalvageSingle = (itemId: string) => {
    const st = stateRef.current;
    const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
    const bagIdx = st.inventory.findIndex((i) => i.id === itemId);
    if (bagIdx !== -1) {
      const item = st.inventory[bagIdx];
      if (item.locked) return;
      const visibleBefore = filterAndSortStorageItems(st.inventory, bagFilterSlot, bagSortMode);
      const gain = getSalvageValue(item, fairyProfile.salvageBonusPct);
      st.inventory.splice(bagIdx, 1);
      st.stones += gain;
      if (selectedBagId === itemId) {
        setSelectedBagId(getNextSelectedStorageId(visibleBefore, itemId));
        setBagMobileDetail(false);
      }
      addLog(`分解: ${item.name} → +${gain}💎`);
      playSfx('drop', st.soundOn);
      persistGame(st);
      forceRender();
      return;
    }

    const stashIdx = st.stash.findIndex((i) => i.id === itemId);
    if (stashIdx !== -1) {
      const item = st.stash[stashIdx];
      if (item.locked) return;
      const visibleBefore = filterAndSortStorageItems(st.stash, stashFilterSlot, stashSortMode);
      const gain = getSalvageValue(item, fairyProfile.salvageBonusPct);
      st.stash.splice(stashIdx, 1);
      st.stones += gain;
      if (selectedStashId === itemId) {
        setSelectedStashId(getNextSelectedStorageId(visibleBefore, itemId));
        setStashMobileDetail(false);
      }
      addLog(`分解(倉庫): ${item.name} → +${gain}💎`);
      playSfx('drop', st.soundOn);
      persistGame(st);
      forceRender();
    }
  };

  const handleSalvageBulk = (mode: SalvageBulkMode) => {
    const st = stateRef.current;
    const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
    const res = partitionBulkSalvage(st.inventory, mode, st.equipped, fairyProfile.salvageBonusPct);

    if (res.salvagedCount === 0) {
      setUpgradeFeedback(
        res.protectedCount > 0
          ? `分解対象なし（上位の武器・防具 ${res.protectedCount}個を保護しました）`
          : 'バッグ内に分解対象の装備がありませんでした。',
      );
      return;
    }

    st.inventory = res.kept;
    st.stones += res.totalGain;
    setUpgradeFeedback(
      `♻️ バッグから ${res.salvagedCount}個を一括分解し +${fmt(res.totalGain)}💎 獲得` +
        (res.protectedCount > 0 ? `（上位品 ${res.protectedCount}個は保護）` : ''),
    );

    const visibleAfter = filterAndSortStorageItems(st.inventory, bagFilterSlot, bagSortMode);
    if (!visibleAfter.some((i) => i.id === selectedBagId)) {
      setSelectedBagId(visibleAfter[0]?.id ?? null);
      setBagMobileDetail(false);
    }
    addLog(`一括分解: ${res.salvagedCount}個 → +${fmt(res.totalGain)}💎`, '#38bdf8');
    playSfx('drop', st.soundOn);
    persistGame(st);
    forceRender();
  };

  const handlePullChests = (count: number, isMythicBox: boolean) => {
    if (isOpeningChestsRef.current) return;
    const st = stateRef.current;
    const avail = isMythicBox ? st.mythicChests : st.chests;
    const maxAllowed = isMythicBox ? 1 : CHEST_BATCH_MAX;
    const pullNum = Math.min(maxAllowed, count, avail);
    if (pullNum <= 0) return;

    if (isMythicBox) st.mythicChests -= pullNum;
    else st.chests -= pullNum;

    isOpeningChestsRef.current = true;
    setIsOpeningChests(true);
    const rollStage = st.maxStage;
    const autoSalvageFlag = chestAutoSalvage;

    interface ChestTimelineEntry {
      res: GachaPullResult;
      startAtMs: number;
      revealAtMs: number;
      started: boolean;
      revealed: boolean;
    }

    const timeline: ChestTimelineEntry[] = [];
    for (let i = 0; i < pullNum; i++) {
      const item = isMythicBox
        ? generateItem({ stage: rollStage, forcedRarity: 4, isBoss: true, fromChest: true, cleared100: st.cleared100 })
        : generateItem({ stage: rollStage, isBoss: true, fromChest: true, cleared100: st.cleared100 });
      const shouldPromoteAnim = item.rarity >= 2 && Math.random() < 0.45;
      const startAtMs = i * 80;
      const revealAtMs = startAtMs + (shouldPromoteAnim ? 300 : 0);
      timeline.push({
        res: {
          id: uid(),
          item,
          shouldPromoteAnim,
          phase: 'waiting',
          fakeRarityId: Math.max(1, item.rarity - 1) as GachaPullResult['fakeRarityId'],
          committed: false,
          salvagedDust: 0,
          bagFull: false,
          equippedFromModal: false,
        },
        startAtMs,
        revealAtMs,
        started: false,
        revealed: false,
      });
    }

    const commitEntry = (entry: ChestTimelineEntry) => {
      if (entry.res.committed) return;
      const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
      const { salvagedDust, bagFull } = commitChestItemToState(
        st,
        entry.res.item,
        autoSalvageFlag,
        fairyProfile.salvageBonusPct,
      );
      entry.res = {
        ...entry.res,
        phase: 'revealed',
        committed: true,
        salvagedDust,
        bagFull,
      };
      entry.started = true;
      entry.revealed = true;
    };

    pendingChestFlushesRef.current = timeline.map((entry) => () => commitEntry(entry));

    const startTime = performance.now();
    let timerId: ReturnType<typeof setInterval> | null = null;

    const stepTimeline = () => {
      const elapsed = performance.now() - startTime;
      let changed = false;
      let allDone = true;

      for (const entry of timeline) {
        if (!entry.started && elapsed >= entry.startAtMs) {
          entry.started = true;
          playSfx('chest', st.soundOn);
          if (entry.res.shouldPromoteAnim && elapsed < entry.revealAtMs) {
            entry.res = { ...entry.res, phase: 'shaking' };
            changed = true;
          }
        }

        if (!entry.revealed && elapsed >= entry.revealAtMs) {
          const r = entry.res.item.rarity;
          if (r === 4) playSfx('mythic', st.soundOn);
          else if (r === 3) playSfx('legend', st.soundOn);
          else if (r === 2) playSfx('drop', st.soundOn);
          commitEntry(entry);
          changed = true;
        }

        if (!entry.revealed) {
          allDone = false;
        }
      }

      if (changed) {
        setChestResults(timeline.map((t) => t.res));
      }

      if (allDone) {
        if (timerId !== null) {
          clearInterval(timerId);
          activeIntervalsRef.current.delete(timerId);
          timerId = null;
        }
        pendingChestFlushesRef.current = [];
        isOpeningChestsRef.current = false;
        setIsOpeningChests(false);
        persistGame(st);
        forceRender();
      }
    };

    setChestResults(timeline.map((t) => t.res));
    stepTimeline();

    if (timeline.some((t) => !t.revealed)) {
      timerId = setInterval(stepTimeline, 40);
      activeIntervalsRef.current.add(timerId);
    }
  };

  const handleEquipFromChest = (resultId: string, itemId: string) => {
    handleEquipItem(itemId);
    setChestResults((prev) =>
      prev.map((r) => (r.id === resultId ? { ...r, equippedFromModal: true } : r)),
    );
  };

  const handleConfirmReset = () => {
    clearAllPendingTimers();
    if (fairyMsgTimerRef.current) {
      clearTimeout(fairyMsgTimerRef.current);
      fairyMsgTimerRef.current = null;
    }
    pendingUpgradeFlushRef.current = null;
    pendingChestFlushesRef.current = [];
    setIsRollingUpgrade(false);
    setIsOpeningChests(false);
    setRouletteActiveIdx(null);
    setLastBoostedSubIdx(null);
    setUpgradeFeedback('');
    setFairyClaimMsg('');
    setChestResults([]);
    setChestModalOpen(false);
    setOpenWindows({ equipped: false, bag: false, stash: false });
    setBagMobileDetail(false);
    setStashMobileDetail(false);
    setDraggedItem(null);
    setMilestoneOpen(false);
    setOfflineSummary(null);
    setResetConfirmOpen(false);
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    stateRef.current = createDefaultState();
    setSelectedEquippedSlot('weapon');
    setSelectedBagId(null);
    setSelectedStashId(null);
    engineApiRef.current?.resetToCurrentStage();
    persistGame(stateRef.current);
    forceRender();
  };

  const st = stateRef.current;
  const fairyProfile = getFairyProfile(getFairyRank(st.maxStage, st.cleared100));
  const getWindowZ = (win: WindowKey) => 40 + Math.max(0, windowOrder.indexOf(win));

  const handleClaimFairyGift = () => {
    const res = claimFairyGift(st);
    if (!res) return;
    playSfx(res.mythicChests > 0 ? 'mythic' : res.chests > 0 ? 'legend' : 'drop', st.soundOn);
    addLog(`妖精のお土産: ${res.summaryText}`, fairyProfile.accentColor);
    setFairyClaimMsg(res.summaryText);
    if (fairyMsgTimerRef.current) clearTimeout(fairyMsgTimerRef.current);
    fairyMsgTimerRef.current = setTimeout(() => setFairyClaimMsg(''), 3200);
    persistGame(st);
    forceRender();
  };

  const handleEnterSanctum = (targetSanctum: number) => {
    if (!enterSanctumState(st, targetSanctum)) return;
    playSfx('chest', st.soundOn);
    addLog(`🏛️ ${targetSanctum}F 玄室へ入場！（🗝️玄室の鍵 -1）`, '#c084fc');
    engineApiRef.current?.resetToCurrentStage();
    persistGame(st);
    forceRender();
  };

  const handleRetreatSanctum = () => {
    const prev = st.stage;
    st.stage = resolveDefeatRetreatStage(st.stage);
    st.floorEncounters = 0;
    addLog(`🚪 ${prev}F玄室から${st.stage}Fへ撤退しました`, '#94a3b8');
    engineApiRef.current?.resetToCurrentStage();
    persistGame(st);
    forceRender();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#070b14]">
      <DungeonViewport
        stateRef={stateRef}
        engineApiRef={engineApiRef}
        hudSnapshot={{
          stage: st.stage,
          maxStage: st.maxStage,
          clearedSanctumMax: st.clearedSanctumMax,
          sanctumKeys: st.sanctumKeys,
          autoProgress: st.autoProgress,
          kills: st.kills,
          maxDmg: st.maxDmg,
          cleared100: st.cleared100,
          floorEncounters: hudMeta.floorEncounters,
          stepsToStairs: hudMeta.stepsToStairs,
          stairsFound: hudMeta.stairsFound,
          hasFloorKey: hudMeta.hasFloorKey,
          explorePct: hudMeta.explorePct,
          bossActive: hudMeta.bossActive,
          paused: hudMeta.paused,
          speed: hudMeta.speed,
          moveStyle: hudMeta.moveStyle,
          sizeMode: hudMeta.sizeMode,
        }}
        onSyncHud={handleSyncHud}
        onAddLog={addLog}
        onItemDrop={handleItemDrop}
        onTriggerMilestone100={() => setMilestoneOpen(true)}
        onOfflineElapsed={(sec) => applyOfflineElapsed(sec, false)}
        onRequestSave={() => persistGame(stateRef.current)}
        onEnterSanctum={handleEnterSanctum}
        onRetreatSanctum={handleRetreatSanctum}
        throttleCanvas={chestModalOpen || milestoneOpen || offlineSummary !== null || resetConfirmOpen}
        fairyOverlay={
          <FairyWidget
            fairy={st.fairy}
            profile={fairyProfile}
            bossActive={hudMeta.bossActive}
            collapsed={fairyCollapsed}
            claimFeedback={fairyClaimMsg}
            onClaimGift={handleClaimFairyGift}
            onToggleCollapse={() => setFairyCollapsed((v) => !v)}
          />
        }
      />

      <BottomStrip
        state={st}
        openWindows={openWindows}
        draggedItem={draggedItem}
        onPrevStage={() => {
          const target = getPrevManualStage(st.stage);
          if (target === null) return;
          st.stage = target;
          st.floorEncounters = 0;
          engineApiRef.current?.resetToCurrentStage();
          persistGame(st);
          forceRender();
        }}
        onNextStage={() => {
          const target = getNextManualStage(st.stage, st.maxStage, st.clearedSanctumMax);
          if (target === null) return;
          st.stage = target;
          st.floorEncounters = 0;
          engineApiRef.current?.resetToCurrentStage();
          persistGame(st);
          forceRender();
        }}
        onToggleAutoProgress={() => {
          st.autoProgress = !st.autoProgress;
          persistGame(st);
          forceRender();
        }}
        onOpenEquipped={(slot) => {
          if (slot) {
            openWindow('equipped', { slot, toggle: false });
          } else {
            openWindow('equipped', { toggle: true });
          }
        }}
        onToggleBag={() => openWindow('bag', { toggle: true })}
        onToggleStash={() => openWindow('stash', { toggle: true })}
        onDropEquip={handleDropEquip}
        onDropMoveItem={handleDropMoveItem}
        onOpenChests={() => setChestModalOpen(true)}
        onToggleSound={() => {
          st.soundOn = !st.soundOn;
          if (st.soundOn) playSfx('upgrade', true);
          persistGame(st);
          forceRender();
        }}
        onResetSave={() => setResetConfirmOpen(true)}
        onChangeAutoSalvage={(val) => {
          st.autoSalvageRarity = val;
          persistGame(st);
          forceRender();
        }}
      />

      <EquippedWindow
        open={openWindows.equipped}
        zIndex={getWindowZ('equipped')}
        position={windowPositions.equipped}
        windowSize={windowSizes.equipped}
        stones={st.stones}
        equipped={st.equipped}
        bagCount={st.inventory.length}
        stashCount={st.stash.length}
        selectedSlot={selectedEquippedSlot}
        draggedItem={draggedItem}
        isRollingUpgrade={isRollingUpgrade}
        rouletteActiveIdx={rouletteActiveIdx}
        lastBoostedSubIdx={lastBoostedSubIdx}
        upgradeFeedback={upgradeFeedback}
        onFocus={() => focusWindow('equipped')}
        onMovePosition={(pos) => moveWindowPosition('equipped', pos)}
        onResizeWindow={(sz) => resizeWindowSize('equipped', sz)}
        onSelectSlot={(slot) => {
          setSelectedEquippedSlot(slot);
          setUpgradeFeedback('');
          setLastBoostedSubIdx(null);
        }}
        onDropEquip={handleDropEquip}
        onUpgradeItem={handleUpgradeItem}
        onToggleLock={handleToggleLock}
        onOpenWindow={(win) => openWindow(win)}
        onClose={() => closeWindow('equipped')}
      />

      <StorageWindow
        location="bag"
        open={openWindows.bag}
        zIndex={getWindowZ('bag')}
        position={windowPositions.bag}
        windowSize={windowSizes.bag}
        stones={st.stones}
        equipped={st.equipped}
        items={st.inventory}
        otherCount={st.stash.length}
        filterSlot={bagFilterSlot}
        sortMode={bagSortMode}
        selectedItemId={selectedBagId}
        mobileShowDetail={bagMobileDetail}
        draggedItem={draggedItem}
        isRollingUpgrade={isRollingUpgrade}
        rouletteActiveIdx={rouletteActiveIdx}
        lastBoostedSubIdx={lastBoostedSubIdx}
        upgradeFeedback={upgradeFeedback}
        onFocus={() => focusWindow('bag')}
        onMovePosition={(pos) => moveWindowPosition('bag', pos)}
        onResizeWindow={(sz) => resizeWindowSize('bag', sz)}
        onChangeFilter={(slot) => {
          setBagFilterSlot(slot);
          const nextVisible = filterAndSortStorageItems(st.inventory, slot, bagSortMode);
          if (!nextVisible.some((i) => i.id === selectedBagId)) {
            setSelectedBagId(nextVisible[0]?.id ?? null);
          }
          setBagMobileDetail(false);
        }}
        onChangeSort={(mode) => setBagSortMode(mode)}
        onSelectItem={(id) => {
          setSelectedBagId(id);
          setBagMobileDetail(true);
          setUpgradeFeedback('');
          setLastBoostedSubIdx(null);
        }}
        onBackToList={() => {
          if (!isRollingUpgrade) setBagMobileDetail(false);
        }}
        onEquipItem={handleEquipItem}
        onMoveItem={(id) => handleMoveItemBetweenStorage(id, 'stash')}
        onUpgradeItem={handleUpgradeItem}
        onToggleLock={handleToggleLock}
        onSalvageSingle={handleSalvageSingle}
        onSalvageBulk={handleSalvageBulk}
        onDragStartItem={(payload) => setDraggedItem(payload)}
        onDragEndItem={() => setDraggedItem(null)}
        onDropFromOther={(payload) => handleDropMoveItem(payload, 'bag')}
        onOpenWindow={(win) => openWindow(win)}
        onClose={() => closeWindow('bag')}
        salvageBonusPct={fairyProfile.salvageBonusPct}
      />

      <StorageWindow
        location="stash"
        open={openWindows.stash}
        zIndex={getWindowZ('stash')}
        position={windowPositions.stash}
        windowSize={windowSizes.stash}
        stones={st.stones}
        equipped={st.equipped}
        items={st.stash}
        otherCount={st.inventory.length}
        filterSlot={stashFilterSlot}
        sortMode={stashSortMode}
        selectedItemId={selectedStashId}
        mobileShowDetail={stashMobileDetail}
        draggedItem={draggedItem}
        isRollingUpgrade={isRollingUpgrade}
        rouletteActiveIdx={rouletteActiveIdx}
        lastBoostedSubIdx={lastBoostedSubIdx}
        upgradeFeedback={upgradeFeedback}
        onFocus={() => focusWindow('stash')}
        onMovePosition={(pos) => moveWindowPosition('stash', pos)}
        onResizeWindow={(sz) => resizeWindowSize('stash', sz)}
        onChangeFilter={(slot) => {
          setStashFilterSlot(slot);
          const nextVisible = filterAndSortStorageItems(st.stash, slot, stashSortMode);
          if (!nextVisible.some((i) => i.id === selectedStashId)) {
            setSelectedStashId(nextVisible[0]?.id ?? null);
          }
          setStashMobileDetail(false);
        }}
        onChangeSort={(mode) => setStashSortMode(mode)}
        onSelectItem={(id) => {
          setSelectedStashId(id);
          setStashMobileDetail(true);
          setUpgradeFeedback('');
          setLastBoostedSubIdx(null);
        }}
        onBackToList={() => {
          if (!isRollingUpgrade) setStashMobileDetail(false);
        }}
        onEquipItem={handleEquipItem}
        onMoveItem={(id) => handleMoveItemBetweenStorage(id, 'bag')}
        onUpgradeItem={handleUpgradeItem}
        onToggleLock={handleToggleLock}
        onSalvageSingle={handleSalvageSingle}
        onDragStartItem={(payload) => setDraggedItem(payload)}
        onDragEndItem={() => setDraggedItem(null)}
        onDropFromOther={(payload) => handleDropMoveItem(payload, 'stash')}
        onOpenWindow={(win) => openWindow(win)}
        onClose={() => closeWindow('stash')}
        salvageBonusPct={fairyProfile.salvageBonusPct}
      />

      <ChestModal
        open={chestModalOpen}
        chests={st.chests}
        mythicChests={st.mythicChests}
        maxStage={st.maxStage}
        autoSalvageChecked={chestAutoSalvage}
        isOpening={isOpeningChests}
        results={chestResults}
        onToggleAutoSalvage={setChestAutoSalvage}
        onPull={handlePullChests}
        onEquipFromResult={handleEquipFromChest}
        onClose={() => !isOpeningChests && setChestModalOpen(false)}
      />

      <MilestoneModal open={milestoneOpen} onClose={() => setMilestoneOpen(false)} />
      <OfflineModal summary={offlineSummary} onClose={() => setOfflineSummary(null)} />

      {resetConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <div className="flex w-[min(360px,92vw)] flex-col gap-3 rounded-xl border border-red-400/50 bg-[#162033] p-4 shadow-2xl">
            <h2 id="reset-confirm-title" className="text-sm font-extrabold text-red-300">
              🗑️ セーブデータ初期化
            </h2>
            <p className="text-xs leading-relaxed text-slate-300">
              セーブデータをすべて初期化して最初からやり直しますか？
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-md border border-slate-400/25 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="rounded-md border border-red-400 bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600"
              >
                初期化する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
