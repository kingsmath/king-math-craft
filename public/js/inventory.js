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
};

const FOODS = {
    wood: { name: '나무', hunger: 1, heal: 0 },
    raw_meat: { name: '생고기', hunger: 2, heal: 0 },
    cooked_meat: { name: '익힌 고기', hunger: 5, heal: 2 },
    raw_fish: { name: '생선(날것)', hunger: 2, heal: 0 },
    cooked_fish: { name: '구운 생선', hunger: 4, heal: 2 },
};

const COOK_MAP = { raw_meat: 'cooked_meat', raw_fish: 'cooked_fish' };

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
        return Object.entries(cost).every(([k, v]) => (this.resources[k] || 0) >= v);
    }

    consumeResources(cost) {
        Object.entries(cost).forEach(([k, v]) => { this.resources[k] = (this.resources[k] || 0) - v; });
    }

    // --- Crafting / Equipment -------------------------------------------
    craft(recipeId) {
        const r = RECIPES[recipeId];
        if (!r) return;
        if (!this.hasResources(r.cost)) {
            this.game.showToast('⚠️ 재료가 부족합니다!');
            return;
        }
        this.consumeResources(r.cost);
        this.grantResource(recipeId, 1);
        this.game.showToast(`🔨 ${r.name} 제작 완료!`);
        this.renderCraftingList();
    }

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
        const target = this.game.physics.raycastTarget(6.0);
        if (!target.hit || this.game.world.getBlock(target.targetBlock.x, target.targetBlock.y, target.targetBlock.z) !== BLOCK.WATER) {
            this.game.showToast('⚠️ 호수 물을 조준하고 낚시해주세요.');
            return;
        }
        this.fishing.active = true;
        this.game.showToast('🎣 낚싯줄을 던졌습니다... 기다리는 중');
        const waitTime = 2200 + Math.random() * 3200;
        setTimeout(() => {
            if (!this.fishing.active) return;
            this.fishing.active = false;
            if (Math.random() < 0.82) {
                this.grantResource('raw_fish', 1);
                this.game.showToast('🐟 물고기를 낚았습니다!');
            } else {
                this.game.showToast('💦 아쉽게 놓쳤습니다...');
            }
        }, waitTime);
    }

    // --- Interact key (F): crafting table / furnace / fishing ------------
    handleInteract() {
        const target = this.game.physics.raycastTarget(4.5);
        if (target.hit) {
            const block = this.game.world.getBlock(target.targetBlock.x, target.targetBlock.y, target.targetBlock.z);
            if (block === BLOCK.CRAFTING_TABLE) { this.openCrafting(); return; }
            if (block === BLOCK.FURNACE) { this.openFurnace(); return; }
            if (block === BLOCK.WATER) { this.startFishing(); return; }
        }
        this.game.showToast('ℹ️ 제작대/화로/호수를 조준하고 F를 눌러보세요.');
    }

    // --- Hunger tick (called every frame) ---------------------------------
    tick(delta) {
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
        this.renderCraftingList();
    }

    openFurnace() {
        const modal = document.getElementById('furnace-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this.renderFurnaceList();
    }

    renderCraftingList() {
        const list = document.getElementById('crafting-list');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(RECIPES).forEach(([id, r]) => {
            const costStr = Object.entries(r.cost).map(([k, v]) => `${RESOURCE_ICONS[k] || ''}${k} x${v}`).join(', ');
            const canCraft = this.hasResources(r.cost);
            const row = document.createElement('div');
            row.className = 'craft-row';
            row.innerHTML = `
                <span class="craft-name">${r.name}</span>
                <span class="craft-cost">${costStr}</span>
                <span class="craft-owned">보유: ${this.resources[id] || 0}</span>
                <button class="btn-craft" ${canCraft ? '' : 'disabled'}>제작</button>
                ${r.equipSlot ? `<button class="btn-equip" ${(this.resources[id] || 0) > 0 ? '' : 'disabled'}>${this.equipment[r.equipSlot] === id ? '장착됨' : '장착'}</button>` : ''}
            `;
            row.querySelector('.btn-craft').addEventListener('click', () => this.craft(id));
            const equipBtn = row.querySelector('.btn-equip');
            if (equipBtn) equipBtn.addEventListener('click', () => { this.equip(id); this.renderCraftingList(); });
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
            Object.entries(this.resources).forEach(([key, qty]) => {
                if (!qty) return;
                const icon = RESOURCE_ICONS[key] || (RECIPES[key] ? RECIPES[key].icon : '📦');
                const name = RECIPES[key] ? RECIPES[key].name : (FOODS[key] ? FOODS[key].name : (RESOURCE_NAMES[key] || key));
                const cell = document.createElement('div');
                cell.className = 'inv-cell';
                cell.innerHTML = `<div class="inv-icon">${icon}</div><div class="inv-qty">${qty}</div><div class="inv-name">${name}</div>`;
                grid.appendChild(cell);
            });
            if (!grid.children.length) grid.innerHTML = '<div class="inv-empty">아직 모은 자원이 없습니다. 나무/돌/동굴 광석을 채집해보세요!</div>';
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
        if (craftModal && !craftModal.classList.contains('hidden')) this.renderCraftingList();
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
