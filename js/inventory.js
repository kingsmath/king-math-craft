// Inventory / Crafting / Equipment / Hunger / Fishing / Farming System
// Design: the client decides recipe legality & resource math (same trust level the
// existing block-edit system already uses), then pushes a full snapshot to the server
// via 'inventory_update' so it persists across reconnects. HP is server-authoritative
// (mob/PVP damage), but starvation damage & eating heals are requested via 'hp_delta'.

const RESOURCE_ICONS = {
    dirt: '🟫', grass: '🟩', stone: '🪨', wood: '🪵', leaves: '🍃', brick: '🧱',
    glass: '🪟', glowstone: '💡', diamond_block: '💠', sand: '🟨', path: '🛤️', flower: '🌸',
    coal: '⚫', iron: '⚙️', gold: '🟡', diamond: '💎',
    leather: '🧵', sapling: '🌱', raw_meat: '🥩', cooked_meat: '🍖',
    raw_fish: '🐟', cooked_fish: '🍤'
};

const RESOURCE_NAMES = {
    dirt: '흙', grass: '잔디', stone: '돌', wood: '나무', leaves: '나뭇잎', brick: '벽돌',
    glass: '유리', glowstone: '발광석', diamond_block: '다이아 블록', sand: '모래', path: '길', flower: '꽃',
    coal: '석탄', iron: '철', gold: '금', diamond: '다이아몬드', leather: '가죽', sapling: '묘목'
};

// Every placeable/minable block type yields its own matching item when broken, so building
// something with the free creative hotbar and then breaking it back down is never a dead end,
// and cave/forest resources (wood, stone, ore) always feed the crafting table.
// NOTE: plain numeric keys on purpose - this is a top-level const evaluated as soon as this
// script runs, which is BEFORE game.js (where the BLOCK registry is defined) has loaded, so
// `BLOCK.DIRT`-style computed keys here would throw a ReferenceError. Keep in sync with the
// BLOCK registry in js/game.js.
const BLOCK_DROP_MAP = {
    1: 'dirt',           // BLOCK.DIRT
    2: 'grass',          // BLOCK.GRASS
    3: 'stone',          // BLOCK.STONE
    4: 'wood',           // BLOCK.WOOD
    5: 'leaves',         // BLOCK.LEAVES
    6: 'brick',          // BLOCK.BRICK
    7: 'glass',          // BLOCK.GLASS
    8: 'glowstone',      // BLOCK.GLOWSTONE
    9: 'diamond_block',  // BLOCK.DIAMOND_BLOCK
    21: 'sand',          // BLOCK.SAND
    22: 'path',          // BLOCK.PATH
    23: 'coal',          // BLOCK.COAL_ORE
    24: 'iron',          // BLOCK.IRON_ORE
    25: 'gold',          // BLOCK.GOLD_ORE
    26: 'diamond',       // BLOCK.DIAMOND_ORE
    27: 'sapling',       // BLOCK.SAPLING
    31: 'stone',         // BLOCK.CAVE_STONE
    32: 'flower'         // BLOCK.FLOWER
};

const RECIPES = {
    wood_sword: { name: '🗡️ 나무검', icon: '🗡️', cost: { wood: 2 }, category: 'weapon', equipSlot: 'weapon', damage: 4 },
    stone_sword: { name: '🗡️ 돌검', icon: '🗡️', cost: { wood: 1, stone: 2 }, category: 'weapon', equipSlot: 'weapon', damage: 6 },
    iron_sword: { name: '🗡️ 철검', icon: '🗡️', cost: { wood: 1, iron: 2 }, category: 'weapon', equipSlot: 'weapon', damage: 9 },
    gold_sword: { name: '🗡️ 금검', icon: '🗡️', cost: { wood: 1, gold: 2 }, category: 'weapon', equipSlot: 'weapon', damage: 10 },
    diamond_sword: { name: '🗡️ 다이아몬드검', icon: '💠', cost: { wood: 1, diamond: 2 }, category: 'weapon', equipSlot: 'weapon', damage: 13 },
    wood_axe: { name: '🪓 나무도끼', icon: '🪓', cost: { wood: 3 }, category: 'tool', equipSlot: 'weapon', damage: 3 },
    stone_axe: { name: '🪓 돌도끼', icon: '🪓', cost: { wood: 1, stone: 3 }, category: 'tool', equipSlot: 'weapon', damage: 4 },
    iron_axe: { name: '🪓 철도끼', icon: '🪓', cost: { wood: 1, iron: 3 }, category: 'tool', equipSlot: 'weapon', damage: 6 },
    gold_axe: { name: '🪓 금도끼', icon: '🪓', cost: { wood: 1, gold: 3 }, category: 'tool', equipSlot: 'weapon', damage: 7 },
    diamond_axe: { name: '🪓 다이아몬드도끼', icon: '🪓', cost: { wood: 1, diamond: 3 }, category: 'tool', equipSlot: 'weapon', damage: 8 },
    wood_pickaxe: { name: '⛏️ 나무곡괭이', icon: '⛏️', cost: { wood: 3 }, category: 'tool', equipSlot: 'weapon', damage: 2 },
    stone_pickaxe: { name: '⛏️ 돌곡괭이', icon: '⛏️', cost: { wood: 1, stone: 3 }, category: 'tool', equipSlot: 'weapon', damage: 3 },
    iron_pickaxe: { name: '⛏️ 철곡괭이', icon: '⛏️', cost: { wood: 1, iron: 3 }, category: 'tool', equipSlot: 'weapon', damage: 4 },
    gold_pickaxe: { name: '⛏️ 금곡괭이', icon: '⛏️', cost: { wood: 1, gold: 3 }, category: 'tool', equipSlot: 'weapon', damage: 5 },
    diamond_pickaxe: { name: '⛏️ 다이아몬드곡괭이', icon: '⛏️', cost: { wood: 1, diamond: 3 }, category: 'tool', equipSlot: 'weapon', damage: 6 },
    fishing_rod: { name: '🎣 낚싯대', icon: '🎣', cost: { wood: 3, leather: 1 }, category: 'tool' },
    leather_helmet: { name: '🪖 가죽 모자', icon: '🪖', cost: { leather: 5 }, category: 'armor', equipSlot: 'helmet', defense: 0.04 },
    leather_chest: { name: '👕 가죽 조끼', icon: '👕', cost: { leather: 8 }, category: 'armor', equipSlot: 'chest', defense: 0.08 },
    leather_legs: { name: '👖 가죽 바지', icon: '👖', cost: { leather: 7 }, category: 'armor', equipSlot: 'legs', defense: 0.06 },
    leather_boots: { name: '🥾 가죽 신발', icon: '🥾', cost: { leather: 4 }, category: 'armor', equipSlot: 'boots', defense: 0.03 },
    iron_helmet: { name: '🪖 철 투구', icon: '🪖', cost: { iron: 5 }, category: 'armor', equipSlot: 'helmet', defense: 0.08 },
    iron_chest: { name: '👕 철 흉갑', icon: '👕', cost: { iron: 8 }, category: 'armor', equipSlot: 'chest', defense: 0.14 },
    iron_legs: { name: '👖 철 각반', icon: '👖', cost: { iron: 7 }, category: 'armor', equipSlot: 'legs', defense: 0.11 },
    iron_boots: { name: '🥾 철 부츠', icon: '🥾', cost: { iron: 4 }, category: 'armor', equipSlot: 'boots', defense: 0.06 },
    gold_helmet: { name: '🪖 금 투구', icon: '🪖', cost: { gold: 5 }, category: 'armor', equipSlot: 'helmet', defense: 0.10 },
    gold_chest: { name: '👕 금 흉갑', icon: '👕', cost: { gold: 8 }, category: 'armor', equipSlot: 'chest', defense: 0.17 },
    gold_legs: { name: '👖 금 각반', icon: '👖', cost: { gold: 7 }, category: 'armor', equipSlot: 'legs', defense: 0.13 },
    gold_boots: { name: '🥾 금 부츠', icon: '🥾', cost: { gold: 4 }, category: 'armor', equipSlot: 'boots', defense: 0.07 },
    diamond_helmet: { name: '🪖 다이아몬드 투구', icon: '🪖', cost: { diamond: 3 }, category: 'armor', equipSlot: 'helmet', defense: 0.12 },
    diamond_chest: { name: '👕 다이아몬드 흉갑', icon: '👕', cost: { diamond: 5 }, category: 'armor', equipSlot: 'chest', defense: 0.20 },
    diamond_legs: { name: '👖 다이아몬드 각반', icon: '👖', cost: { diamond: 4 }, category: 'armor', equipSlot: 'legs', defense: 0.16 },
    diamond_boots: { name: '🥾 다이아몬드 부츠', icon: '🥾', cost: { diamond: 2 }, category: 'armor', equipSlot: 'boots', defense: 0.09 },
    // placeableBlock uses plain numeric BLOCK ids (28=CRAFTING_TABLE, 29=FURNACE) - same reason
    // as BLOCK_DROP_MAP above: this file loads before game.js defines the BLOCK registry.
    crafting_table: { name: '🔨 제작대', icon: '🔨', cost: { wood: 4 }, category: 'block', placeableBlock: 28 },
    furnace: { name: '🔥 화로', icon: '🔥', cost: { stone: 8 }, category: 'block', placeableBlock: 29 },
};

const FOODS = {
    wood: { name: '나무', hunger: 1, heal: 0 },
    raw_meat: { name: '생고기', hunger: 2, heal: 0 },
    cooked_meat: { name: '익힌 고기', hunger: 5, heal: 2 },
    raw_fish: { name: '생선(날것)', hunger: 2, heal: 0 },
    cooked_fish: { name: '구운 생선', hunger: 4, heal: 2 },
};

const COOK_MAP = { raw_meat: 'cooked_meat', raw_fish: 'cooked_fish' };

const INFINITE_RESOURCES = new Set(['dirt', 'grass', 'stone', 'wood', 'leaves', 'brick', 'glass', 'glowstone', 'diamond_block']);

class InventorySystem {
    constructor(game) {
        this.game = game;
        this.resources = {};
        this.equipment = { weapon: null, helmet: null, chest: null, legs: null, boots: null };
        this.hp = 20;
        this.maxHp = 20;
        this.hunger = 20;
        this.maxHunger = 20;
        this.hungerAccum = 0;
        this.starveAccum = 0;
        this.lastAttackTime = 0;
        this.fishing = { active: false };
        this.activeFurnace = null;

        // Set by MinecraftGame.applyGameMode() right after login - creative rooms skip hunger
        // drain/starvation and treat every resource as unlimited (see hasResources/tick below).
        this.creative = false;
        this.craftGrid = new Array(9).fill(null); // 3x3 free-combination crafting grid state

        // Set while a crafted placeable item (crafting table, furnace) is "armed" from the
        // inventory panel, waiting for the next place-block click to consume it - see
        // armPlacement() and MinecraftGame.placeBlockAt().
        this.pendingPlacement = null;

        this.initUI();
    }

    // --- Server sync -------------------------------------------------
    applyServerInventory(inv) {
        if (!inv) return;
        this.resources = inv.resources || {};
        this.equipment = inv.equipment || this.equipment;
        this.refreshAll();
    }

    applyServerHp(hp, maxHp) {
        this.hp = hp;
        if (maxHp) this.maxHp = maxHp;
        this.refreshHpBar();
    }

    onPlayerDied(respawn) {
        this.hp = this.maxHp;
        this.hunger = Math.max(this.hunger, 10);
        this.game.physics.position.set(respawn.x, respawn.y, respawn.z);
        this.game.physics.velocity.set(0, 0, 0);
        this.refreshAll();
        this.game.showToast('💀 쓰러져서 부활 지점으로 돌아왔습니다!');
    }

    syncToServer() {
        this.game.net.send({ type: 'inventory_update', inventory: { resources: this.resources, equipment: this.equipment } });
    }

    // --- Resources -----------------------------------------------------
    grantResource(item, qty = 1) {
        this.resources[item] = (this.resources[item] || 0) + qty;
        this.syncToServer();
        this.refreshAll();
    }

    grantFromBlockBreak(blockType) {
        const numType = Number(blockType);
        const dropKey = BLOCK_DROP_MAP[numType] || BLOCK_DROP_MAP[blockType];
        if (dropKey) {
            this.grantResource(dropKey, 1);
            const icon = RESOURCE_ICONS[dropKey] || '📦';
            const name = RESOURCE_NAMES[dropKey] || dropKey;
            if (this.game && this.game.showToast) {
                this.game.showToast(`🎒 ${icon} ${name} +1 (가방 저장)`);
            }
        }
        // Bonus chance at an extra sapling on top of the guaranteed leaves drop above
        if (numType === 5 && Math.random() < 0.15) this.grantResource('sapling', 1);
    }

    hasResources(cost) {
        if (this.creative) return true;
        return Object.entries(cost).every(([k, v]) => INFINITE_RESOURCES.has(k) || (this.resources[k] || 0) >= v);
    }

    // --- Crafting / Equipment -------------------------------------------
    equip(itemId) {
        const r = RECIPES[itemId];
        if (!r || !r.equipSlot) return;
        if ((this.resources[itemId] || 0) < 1) return;
        this.equipment[r.equipSlot] = itemId;
        this.syncToServer();
        this.refreshAll();
    }

    unequip(slot) {
        this.equipment[slot] = null;
        this.syncToServer();
        this.refreshAll();
    }

    // Arms a crafted placeable item (crafting table / furnace) for the next place-block action.
    // MinecraftGame.placeBlockAt() consumes it once the player actually places a block.
    armPlacement(itemId) {
        const r = RECIPES[itemId];
        if (!r || !r.placeableBlock) return;
        if (!this.creative && (this.resources[itemId] || 0) < 1) {
            this.game.showToast('⚠️ 설치할 아이템이 없습니다!');
            return;
        }
        this.pendingPlacement = { itemId, blockType: r.placeableBlock, name: r.name };
        this.game.showToast(`📍 ${r.name} 설치할 위치를 조준하고 설치(우클릭/🧱버튼)하세요! (Esc로 취소)`);
        const invPanel = document.getElementById('inventory-panel');
        if (invPanel) invPanel.classList.add('hidden');
    }

    getWeaponDamage() {
        const w = this.equipment.weapon;
        return (w && RECIPES[w]) ? RECIPES[w].damage : 2;
    }

    getArmorReduction() {
        let total = 0;
        ['helmet', 'chest', 'legs', 'boots'].forEach((slot) => {
            const it = this.equipment[slot];
            if (it && RECIPES[it]) total += RECIPES[it].defense;
        });
        return Math.min(0.6, total);
    }

    // --- Combat ----------------------------------------------------------
    attemptAttack() {
        const now = performance.now();
        if (now - this.lastAttackTime < 400) return false;

        const eye = this.game.physics.getEyePosition();
        const dir = this.game.physics.getLookVector();

        const mobId = this.game.entities.raycastNearestMob(eye, dir, 4.5);
        if (mobId) {
            this.lastAttackTime = now;
            this.game.net.send({ type: 'attack_entity', targetId: mobId, dmg: this.getWeaponDamage() });
            if (typeof sfx !== 'undefined' && sfx.playBlockBreak) sfx.playBlockBreak();
            return true;
        }

        const playerId = this.game.net.raycastNearestPlayer ? this.game.net.raycastNearestPlayer(eye, dir, 4.5) : null;
        if (playerId) {
            this.lastAttackTime = now;
            this.game.net.send({ type: 'attack_player', targetId: playerId, dmg: this.getWeaponDamage() });
            return true;
        }
        return false;
    }

    // --- Food ----------------------------------------------------------
    eat(itemId) {
        const food = FOODS[itemId];
        if (!food) return;
        if ((this.resources[itemId] || 0) < 1) {
            this.game.showToast('⚠️ 해당 음식이 없습니다!');
            return;
        }
        this.resources[itemId]--;
        this.hunger = Math.min(this.maxHunger, this.hunger + food.hunger);
        if (food.heal > 0 && this.hp < this.maxHp) {
            this.game.net.send({ type: 'hp_delta', delta: food.heal, reason: 'eat' });
        }
        this.syncToServer();
        this.refreshAll();
        this.game.showToast(`🍽️ ${food.name}을(를) 먹었습니다!`);
    }

    cookFood(rawKey) {
        const outKey = COOK_MAP[rawKey];
        if (!outKey) return;
        if ((this.resources.coal || 0) < 1) { this.game.showToast('⚠️ 화로 연료(석탄)가 부족합니다!'); return; }
        if ((this.resources[rawKey] || 0) < 1) { this.game.showToast('⚠️ 재료가 부족합니다!'); return; }
        this.resources.coal--;
        this.resources[rawKey]--;
        this.syncToServer();
        this.refreshAll();
        this.game.showToast('🔥 화로에서 굽는 중... (4초)');
        setTimeout(() => {
            this.grantResource(outKey, 1);
            this.game.showToast(`✅ ${FOODS[outKey].name} 완성!`);
            this.renderFurnaceList();
        }, 4000);
    }

    // --- Planting --------------------------------------------------------
    plantSaplingAtTarget() {
        if ((this.resources.sapling || 0) < 1) {
            this.game.showToast('⚠️ 심을 묘목이 없습니다! (나뭇잎을 부수면 가끔 획득)');
            return;
        }
        const target = this.game.physics.raycastTarget(6.0);
        if (!target.hit) { this.game.showToast('⚠️ 심을 위치를 조준해주세요.'); return; }
        const { x, y, z } = target.placeBlock;
        if (!inZone(x, z, ZONES.FOREST)) {
            this.game.showToast('⚠️ 묘목은 숲 구역(서북쪽)에만 심을 수 있습니다!');
            return;
        }
        this.resources.sapling--;
        this.syncToServer();
        this.refreshAll();
        this.game.net.send({ type: 'plant_sapling', x, y, z });
        this.game.showToast('🌱 묘목을 심었습니다! (약 1분 후 나무로 자랍니다)');
    }

    // --- Fishing -----------------------------------------------------------
    startFishing() {
        if ((this.resources.fishing_rod || 0) < 1) {
            this.game.showToast('⚠️ 낚싯대가 필요합니다! (제작대에서 제작)');
            return;
        }
        if (this.fishing.active) return;
        this.fishing.active = true;
        this.game.showToast('🎣 낚싯줄을 던졌습니다... 기다리는 중');
        const waitTime = 2200 + Math.random() * 3200;
        setTimeout(() => {
            if (!this.fishing.active) return;
            this.fishing.active = false;
            if (Math.random() < 0.85) {
                this.grantResource('raw_fish', 1);
                this.game.showToast('🐟 물고기를 낚았습니다! (가방 저장)');
            } else {
                this.game.showToast('💦 아쉽게 놓쳤습니다...');
            }
        }, waitTime);
    }

    // --- Interact key (F): crafting table / furnace / fishing ------------
    handleInteract() {
        const target = this.game.physics.raycastTarget(5.0);
        if (target.hit) {
            const { x, y, z } = target.targetBlock;
            const block = this.game.world.getBlock(x, y, z);
            if (block === BLOCK.CRAFTING_TABLE) { this.openCrafting(); return; }
            if (block === BLOCK.FURNACE) { this.openFurnace(); return; }
            if (block === BLOCK.WATER || this.game.world.getBlock(x, y - 1, z) === BLOCK.WATER || inZone(x, z, ZONES.LAKE_BASIN)) {
                this.startFishing();
                return;
            }
        }
        this.game.showToast('ℹ️ 제작대/화로/호수를 조준하고 F(또는 ✋)를 눌러보세요.');
    }

    // --- Hunger tick (called every frame) ---------------------------------
    tick(delta) {
        if (this.creative) return; // no hunger/starvation in creative mode
        this.hungerAccum += delta;
        if (this.hungerAccum >= 40) {
            this.hungerAccum = 0;
            this.hunger = Math.max(0, this.hunger - 1);
            this.refreshHungerBar();
        }
        if (this.hunger <= 0) {
            this.starveAccum += delta;
            if (this.starveAccum >= 4) {
                this.starveAccum = 0;
                this.game.net.send({ type: 'hp_delta', delta: -1, reason: 'starve' });
            }
        }
    }

    // =====================================================================
    // UI
    // =====================================================================
    initUI() {
        const btnInv = document.getElementById('btn-inventory');
        const invPanel = document.getElementById('inventory-panel');
        if (btnInv && invPanel) {
            btnInv.addEventListener('click', () => {
                invPanel.classList.toggle('hidden');
                if (!invPanel.classList.contains('hidden')) this.renderInventoryPanel();
            });
        }
        const closeInv = document.getElementById('btn-close-inventory');
        if (closeInv) closeInv.addEventListener('click', () => invPanel.classList.add('hidden'));

        const closeCraft = document.getElementById('btn-close-crafting');
        if (closeCraft) closeCraft.addEventListener('click', () => document.getElementById('crafting-modal').classList.add('hidden'));

        const closeFurnace = document.getElementById('btn-close-furnace');
        if (closeFurnace) closeFurnace.addEventListener('click', () => document.getElementById('furnace-modal').classList.add('hidden'));

        const plantBtn = document.getElementById('btn-plant-sapling');
        if (plantBtn) plantBtn.addEventListener('click', () => this.plantSaplingAtTarget());
    }

    openCrafting() {
        const modal = document.getElementById('crafting-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this.renderCraftingGrid();
    }

    openFurnace() {
        const modal = document.getElementById('furnace-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this.renderFurnaceList();
    }

    // =====================================================================
    // 3x3 Free-Combination Crafting Grid (Minecraft-style): recipe data/cost math is unchanged
    // (RECIPES/hasResources above) - only how the player assembles a recipe
    // changed, from "click a button in a list" to "place raw resources into a 3x3 grid until
    // the totals match a known recipe". Matching is shapeless: only the summed quantity per
    // resource matters, not which of the 9 cells it's in ("자유 조합" = free combination).
    // =====================================================================

    // Moves 1 unit of a resource from the inventory into the grid (first cell with the same
    // resource, else the first empty cell). Mutates state only - callers re-render afterward.
    placeInGrid(resourceKey) {
        const unlimited = this.creative || INFINITE_RESOURCES.has(resourceKey);
        const owned = unlimited ? Infinity : (this.resources[resourceKey] || 0);
        if (owned <= 0) return;

        const existing = this.craftGrid.find((c) => c && c.key === resourceKey);
        if (existing) {
            existing.qty++;
        } else {
            const idx = this.craftGrid.findIndex((c) => c === null);
            if (idx === -1) { this.game.showToast('⚠️ 조합 칸이 가득 찼습니다!'); return; }
            this.craftGrid[idx] = { key: resourceKey, qty: 1 };
        }
        if (!unlimited) this.resources[resourceKey] = owned - 1;
    }

    // Returns a grid cell's contents back to the inventory and empties the cell.
    clearGridCell(index) {
        const cell = this.craftGrid[index];
        if (!cell) return;
        const unlimited = this.creative || INFINITE_RESOURCES.has(cell.key);
        if (!unlimited) this.resources[cell.key] = (this.resources[cell.key] || 0) + cell.qty;
        this.craftGrid[index] = null;
    }

    // Finds the known recipe (if any) whose cost exactly matches the grid's current contents.
    matchGridRecipe() {
        const totals = {};
        this.craftGrid.forEach((cell) => {
            if (!cell) return;
            totals[cell.key] = (totals[cell.key] || 0) + cell.qty;
        });
        const totalKeys = Object.keys(totals);
        if (totalKeys.length === 0) return null;

        return Object.keys(RECIPES).find((id) => {
            const costKeys = Object.keys(RECIPES[id].cost);
            return costKeys.length === totalKeys.length && costKeys.every((k) => totals[k] === RECIPES[id].cost[k]);
        }) || null;
    }

    craftFromGrid() {
        const recipeId = this.matchGridRecipe();
        if (!recipeId) return;
        const r = RECIPES[recipeId];
        // Ingredients were already deducted from the inventory when placed into the grid, and
        // the grid's totals exactly equal r.cost (that's how matchGridRecipe found it) - so
        // completing the craft is just clearing the grid and granting the result.
        this.craftGrid = new Array(9).fill(null);
        this.grantResource(recipeId, 1);
        this.game.showToast(`🔨 ${r.name} 제작 완료!`);
        this.renderCraftingGrid();
    }

    // Convenience "recipe book" auto-fill: clicking a reference recipe stages its exact
    // ingredients into the grid for you, same as Minecraft's recipe book.
    fillGridForRecipe(recipeId) {
        const r = RECIPES[recipeId];
        if (!r) return;
        if (!this.hasResources(r.cost)) {
            this.game.showToast('⚠️ 재료가 부족해서 자동으로 채울 수 없습니다!');
            return;
        }
        this.craftGrid.forEach((_, idx) => this.clearGridCell(idx));
        Object.entries(r.cost).forEach(([key, qty]) => {
            for (let i = 0; i < qty; i++) this.placeInGrid(key);
        });
        this.renderCraftingGrid();
    }

    renderCraftingGrid() {
        const gridEl = document.getElementById('craft-grid-3x3');
        const outputEl = document.getElementById('craft-output-slot');
        if (!gridEl || !outputEl) return;

        gridEl.innerHTML = '';
        this.craftGrid.forEach((cell, idx) => {
            const div = document.createElement('div');
            div.className = 'craft-cell';
            if (cell) {
                const icon = RESOURCE_ICONS[cell.key] || '📦';
                div.innerHTML = `${icon}<span class="craft-cell-qty">${cell.qty}</span>`;
            }
            div.addEventListener('click', () => { this.clearGridCell(idx); this.renderCraftingGrid(); });
            gridEl.appendChild(div);
        });

        const recipeId = this.matchGridRecipe();
        outputEl.onclick = null;
        if (recipeId) {
            const r = RECIPES[recipeId];
            outputEl.innerHTML = r.icon;
            outputEl.title = `${r.name} - 클릭해서 제작`;
            outputEl.classList.add('ready');
            outputEl.onclick = () => this.craftFromGrid();
        } else {
            outputEl.innerHTML = '';
            outputEl.title = '';
            outputEl.classList.remove('ready');
        }

        this.renderCraftPalette();
        this.renderRecipeGuide();
    }

    renderCraftPalette() {
        const paletteEl = document.getElementById('craft-palette');
        if (!paletteEl) return;
        paletteEl.innerHTML = '';

        let keys;
        if (this.creative) {
            keys = Object.keys(RESOURCE_ICONS);
        } else {
            const gathered = Object.keys(this.resources).filter((k) => !RECIPES[k] && (this.resources[k] || 0) > 0);
            keys = Array.from(new Set([...INFINITE_RESOURCES, ...gathered]));
        }

        keys.forEach((key) => {
            if (RECIPES[key]) return; // crafted items aren't raw ingredients
            const icon = RESOURCE_ICONS[key] || '📦';
            const name = RESOURCE_NAMES[key] || key;
            const unlimited = this.creative || INFINITE_RESOURCES.has(key);
            const qty = unlimited ? '♾️' : (this.resources[key] || 0);
            const item = document.createElement('div');
            item.className = 'craft-palette-item';
            item.innerHTML = `<div>${icon}</div><div class="palette-qty">${qty}</div><div class="palette-name">${name}</div>`;
            item.addEventListener('click', () => { this.placeInGrid(key); this.renderCraftingGrid(); });
            paletteEl.appendChild(item);
        });
    }

    renderRecipeGuide() {
        const list = document.getElementById('craft-recipe-guide');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(RECIPES).forEach(([id, r]) => {
            const costStr = Object.entries(r.cost).map(([k, v]) => `${RESOURCE_ICONS[k] || ''}${RESOURCE_NAMES[k] || k} x${v}`).join(', ');
            const row = document.createElement('div');
            row.className = 'craft-row';
            row.innerHTML = `
                <span class="craft-name">${r.name}</span>
                <span class="craft-cost">${costStr}</span>
                <span class="craft-owned">보유: ${this.resources[id] || 0}</span>
                <button class="btn-craft">그리드에 채우기</button>
            `;
            row.querySelector('.btn-craft').addEventListener('click', () => this.fillGridForRecipe(id));
            list.appendChild(row);
        });
    }

    renderFurnaceList() {
        const list = document.getElementById('furnace-list');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(COOK_MAP).forEach(([rawKey, cookedKey]) => {
            const row = document.createElement('div');
            row.className = 'craft-row';
            row.innerHTML = `
                <span class="craft-name">${RESOURCE_ICONS[rawKey] || ''} ${FOODS[rawKey].name} → ${FOODS[cookedKey].name}</span>
                <span class="craft-cost">⚫ 석탄 x1 필요</span>
                <span class="craft-owned">보유: ${this.resources[rawKey] || 0}</span>
                <button class="btn-craft">굽기</button>
            `;
            row.querySelector('.btn-craft').addEventListener('click', () => this.cookFood(rawKey));
            list.appendChild(row);
        });
        const eatSection = document.getElementById('furnace-eat-list');
        if (eatSection) {
            eatSection.innerHTML = '<div class="craft-section-title">🍽️ 음식 먹기</div>';
            Object.keys(FOODS).forEach((foodKey) => {
                if ((this.resources[foodKey] || 0) <= 0) return;
                const btn = document.createElement('button');
                btn.className = 'btn-craft';
                btn.style.marginRight = '6px';
                btn.innerText = `${FOODS[foodKey].name} 먹기 (${this.resources[foodKey]})`;
                btn.addEventListener('click', () => { this.eat(foodKey); this.renderFurnaceList(); });
                eatSection.appendChild(btn);
            });
        }
    }

    renderInventoryPanel() {
        const grid = document.getElementById('inventory-resource-grid');
        const equipGrid = document.getElementById('inventory-equip-grid');
        if (grid) {
            grid.innerHTML = '';

            // Render infinite base building materials
            INFINITE_RESOURCES.forEach((key) => {
                const icon = RESOURCE_ICONS[key] || '📦';
                const name = RESOURCE_NAMES[key] || key;
                const cell = document.createElement('div');
                cell.className = 'inv-cell infinite-cell';
                cell.innerHTML = `<div class="inv-icon">${icon}</div><div class="inv-qty">♾️</div><div class="inv-name">${name}</div>`;
                grid.appendChild(cell);
            });

            // Render collected survival loot & items
            Object.entries(this.resources).forEach(([key, qty]) => {
                if (!qty || INFINITE_RESOURCES.has(key)) return;
                const recipe = RECIPES[key];
                const icon = RESOURCE_ICONS[key] || (recipe ? recipe.icon : '📦');
                const name = recipe ? recipe.name : (FOODS[key] ? FOODS[key].name : (RESOURCE_NAMES[key] || key));
                const cell = document.createElement('div');
                cell.className = 'inv-cell';
                cell.innerHTML = `<div class="inv-icon">${icon}</div><div class="inv-qty">${qty}</div><div class="inv-name">${name}</div>` +
                    (recipe && recipe.equipSlot ? `<button class="btn-equip">${this.equipment[recipe.equipSlot] === key ? '장착됨' : '장착'}</button>` : '') +
                    (recipe && recipe.placeableBlock ? `<button class="btn-craft btn-place-item">📍 설치하기</button>` : '');
                const equipBtn = cell.querySelector('.btn-equip');
                if (equipBtn) equipBtn.addEventListener('click', () => { this.equip(key); this.renderInventoryPanel(); });
                const placeBtn = cell.querySelector('.btn-place-item');
                if (placeBtn) placeBtn.addEventListener('click', () => this.armPlacement(key));
                grid.appendChild(cell);
            });
        }
        if (equipGrid) {
            equipGrid.innerHTML = '';
            ['weapon', 'helmet', 'chest', 'legs', 'boots'].forEach((slot) => {
                const itemId = this.equipment[slot];
                const label = { weapon: '⚔️ 무기', helmet: '🪖 머리', chest: '👕 상의', legs: '👖 하의', boots: '🥾 신발' }[slot];
                const cell = document.createElement('div');
                cell.className = 'equip-cell';
                cell.innerHTML = `<span>${label}: ${itemId ? RECIPES[itemId].name : '(없음)'}</span>` +
                    (itemId ? '<button class="btn-unequip">해제</button>' : '');
                const unequipBtn = cell.querySelector('.btn-unequip');
                if (unequipBtn) unequipBtn.addEventListener('click', () => { this.unequip(slot); this.renderInventoryPanel(); });
                equipGrid.appendChild(cell);
            });
        }
    }

    refreshAll() {
        this.refreshHpBar();
        this.refreshHungerBar();
        const invPanel = document.getElementById('inventory-panel');
        if (invPanel && !invPanel.classList.contains('hidden')) this.renderInventoryPanel();
        const craftModal = document.getElementById('crafting-modal');
        if (craftModal && !craftModal.classList.contains('hidden')) this.renderCraftingGrid();
    }

    refreshHpBar() {
        const fg = document.getElementById('hp-bar-fg');
        const label = document.getElementById('hp-bar-label');
        if (fg) fg.style.width = `${Math.max(0, Math.min(100, (this.hp / this.maxHp) * 100))}%`;
        if (label) label.innerText = `❤️ ${this.hp}/${this.maxHp}`;
    }

    refreshHungerBar() {
        const fg = document.getElementById('hunger-bar-fg');
        const label = document.getElementById('hunger-bar-label');
        if (fg) fg.style.width = `${Math.max(0, Math.min(100, (this.hunger / this.maxHunger) * 100))}%`;
        if (label) label.innerText = `🍗 ${this.hunger}/${this.maxHunger}`;
    }
}
