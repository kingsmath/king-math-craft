// 3D Voxel Engine & Ultra-Fast GPU Instanced Renderer for 킹수학크래프트 (60+ FPS Ultra-Smooth)

// Block Type Registry (IDs 20+ are new survival-system blocks; MUST mirror server.py constants)
const BLOCK = {
    AIR: 0, DIRT: 1, GRASS: 2, STONE: 3, WOOD: 4, LEAVES: 5, BRICK: 6, GLASS: 7,
    GLOWSTONE: 8, DIAMOND_BLOCK: 9, PLAZA: 10, SIGNPOST: 11,
    WATER: 20, SAND: 21, PATH: 22, COAL_ORE: 23, IRON_ORE: 24, GOLD_ORE: 25,
    DIAMOND_ORE: 26, SAPLING: 27, CRAFTING_TABLE: 28, FURNACE: 29, FENCE: 30,
    CAVE_STONE: 31, FLOWER: 32
};
const ORE_BLOCK_TYPES = new Set([BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.DIAMOND_ORE]);

// Central Hub Zone Bounds [xMin, xMax, zMin, zMax] - MUST mirror ZONE_* constants in server.py
const ZONES = {
    FOREST: [-58, -4, -58, -4],
    LAKE_ZONE: [4, 58, -58, -4],
    LAKE_BASIN: [16, 50, -50, -16],
    CAVE: [-56, -36, 4, 26],
    WILD: [-58, -33, 2, 31],
    PASTURE: [-30, -6, 34, 58],
    PVP_ARENA: [10, 34, 10, 34],
    CRAFT_PLAZA: [40, 57, 40, 57]
};
function inZone(x, z, zone) {
    return x >= zone[0] && x <= zone[1] && z >= zone[2] && z <= zone[3];
}

// Each player's "home" point: right at their own parcel's entrance, facing the plaza.
// Used both as the death-respawn point (server sends the matching table for player_number,
// see server.py PARCEL_SPAWN_POINTS) and as the local fall-through-world recovery point.
const PARCEL_SPAWN_POINTS = {
    1: { x: -53, z: -60 }, 2: { x: -38, z: -60 }, 3: { x: -23, z: -60 }, 4: { x: -8, z: -60 },
    5: { x: 7, z: -60 }, 6: { x: 22, z: -60 }, 7: { x: 37, z: -60 }, 8: { x: 52, z: -60 },
    9: { x: 59, z: -53 }, 10: { x: 59, z: -38 }, 11: { x: 59, z: -23 }, 12: { x: 59, z: -8 },
    13: { x: 59, z: 7 }, 14: { x: 59, z: 22 }, 15: { x: 59, z: 37 }, 16: { x: 59, z: 52 },
    17: { x: 52, z: 59 }, 18: { x: 37, z: 59 }, 19: { x: 22, z: 59 }, 20: { x: 7, z: 59 },
    21: { x: -8, z: 59 }, 22: { x: -23, z: 59 }, 23: { x: -38, z: 59 }, 24: { x: -53, z: 59 },
    25: { x: -60, z: 52 }, 26: { x: -60, z: 37 }, 27: { x: -60, z: 22 }, 28: { x: -60, z: 7 },
    29: { x: -60, z: -8 }, 30: { x: -60, z: -23 }, 31: { x: -60, z: -38 }, 32: { x: -60, z: -53 }
};

class VoxelWorld {
    constructor(scene) {
        this.scene = scene;
        this.worldSize = 160; // 160x160 blocks (-80 to 79)
        this.blocks = new Map();

        // Cache of just the currently-visible (surface-exposed) blocks, kept incrementally in
        // sync by setBlock(). rebuildAllChunks() only needs to iterate this much smaller set
        // instead of re-scanning the whole world (100k+ blocks) on every single block change.
        this.exposedBlocks = new Map();
        this._bulkGenerating = false;

        this.chunkGroup = null;
        this.materials = [];
        this.parcelMaterials = new Map();

        this.initTextures();
        this.generateWorld();
    }

    initTextures() {
        const createPixelTexture = (colorMain, colorNoise, isGrassSide = false, isLog = false, isGoldBorder = false, isDiamond = false) => {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = colorMain;
            ctx.fillRect(0, 0, 16, 16);

            for (let x = 0; x < 16; x++) {
                for (let y = 0; y < 16; y++) {
                    if (Math.random() > 0.6) {
                        ctx.fillStyle = colorNoise;
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
            }

            if (isGrassSide) {
                ctx.fillStyle = '#4CAF50';
                ctx.fillRect(0, 0, 16, 4);
                for (let x = 0; x < 16; x += 2) {
                    ctx.fillRect(x, 4, 1, Math.floor(Math.random() * 3));
                }
            }

            if (isLog) {
                ctx.fillStyle = '#5c3a21';
                for (let y = 0; y < 16; y += 4) {
                    ctx.fillRect(0, y, 16, 2);
                }
            }

            if (isGoldBorder) {
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 2;
                ctx.strokeRect(1, 1, 14, 14);
            }

            if (isDiamond) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(4, 4, 8, 8);
                ctx.fillStyle = '#00ffff';
                ctx.fillRect(5, 5, 6, 6);
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            return texture;
        };

        // Standard Block Materials
        const texDirt = createPixelTexture('#8B5A2B', '#5c3a21');
        const texGrassTop = createPixelTexture('#4CAF50', '#388E3C');
        const texGrassSide = createPixelTexture('#8B5A2B', '#5c3a21', true);
        const texStone = createPixelTexture('#808080', '#555555');
        const texWoodSide = createPixelTexture('#8B4513', '#5c3a21', false, true);
        const texWoodTop = createPixelTexture('#A0522D', '#8B4513');
        const texLeaves = createPixelTexture('#2E8B57', '#1b5e20');
        const texBrick = createPixelTexture('#B22222', '#800000');
        const texGlass = createPixelTexture('#e0f2fe', '#bae6fd');
        const texGlowstone = createPixelTexture('#fde047', '#eab308');
        const texDiamond = createPixelTexture('#00ffff', '#0284c7', false, false, false, true);
        
        // Lush Green Living Room Floor Texture (녹색 거실 잔디 타일)
        const texGreenPlazaTop = createPixelTexture('#22c55e', '#16a34a', false, false, true);

        // New Survival-System Block Textures
        const texWater = createPixelTexture('#0ea5e9', '#0284c7');
        const texSand = createPixelTexture('#e6d3a3', '#d4bc7d');
        const texPath = createPixelTexture('#a8a29e', '#78716c');
        const texCaveStone = createPixelTexture('#4b5563', '#374151');
        const texCoalOre = createPixelTexture('#57534e', '#1c1917');
        const texIronOre = createPixelTexture('#d6c9b8', '#b45309');
        const texGoldOre = createPixelTexture('#fde68a', '#eab308');
        const texDiamondOre = createPixelTexture('#67e8f9', '#06b6d4', false, false, false, true);
        const texSapling = createPixelTexture('#4ade80', '#16a34a');
        const texCraftingTop = createPixelTexture('#a16207', '#78350f', false, true);
        const texCraftingSide = createPixelTexture('#92400e', '#78350f', false, true);
        const texFurnace = createPixelTexture('#6b7280', '#374151', false, false, true);
        const texFence = createPixelTexture('#92400e', '#5c3a21', false, true);
        const texFlower = createPixelTexture('#fb7185', '#22c55e');

        this.materials = [
            null, // 0: Air
            new THREE.MeshStandardMaterial({ map: texDirt }), // 1: Dirt
            [ // 2: Grass
                new THREE.MeshStandardMaterial({ map: texGrassSide }),
                new THREE.MeshStandardMaterial({ map: texGrassSide }),
                new THREE.MeshStandardMaterial({ map: texGrassTop }),
                new THREE.MeshStandardMaterial({ map: texDirt }),
                new THREE.MeshStandardMaterial({ map: texGrassSide }),
                new THREE.MeshStandardMaterial({ map: texGrassSide }),
            ],
            new THREE.MeshStandardMaterial({ map: texStone }), // 3: Stone
            [ // 4: Wood Log
                new THREE.MeshStandardMaterial({ map: texWoodSide }),
                new THREE.MeshStandardMaterial({ map: texWoodSide }),
                new THREE.MeshStandardMaterial({ map: texWoodTop }),
                new THREE.MeshStandardMaterial({ map: texWoodTop }),
                new THREE.MeshStandardMaterial({ map: texWoodSide }),
                new THREE.MeshStandardMaterial({ map: texWoodSide }),
            ],
            new THREE.MeshStandardMaterial({ map: texLeaves, transparent: true, opacity: 0.9 }), // 5: Leaves
            new THREE.MeshStandardMaterial({ map: texBrick }), // 6: Brick
            new THREE.MeshStandardMaterial({ map: texGlass, transparent: true, opacity: 0.6 }), // 7: Glass
            new THREE.MeshStandardMaterial({ map: texGlowstone, emissive: 0xfde047, emissiveIntensity: 0.5 }), // 8: Glowstone
            new THREE.MeshStandardMaterial({ map: texDiamond, emissive: 0x00ffff, emissiveIntensity: 0.3 }), // 9: Diamond Block
            new THREE.MeshStandardMaterial({ map: texGreenPlazaTop }), // 10: Green Living Room Tile
            new THREE.MeshStandardMaterial({ map: texWoodTop })  // 11: Sign Wooden Post
        ];

        this.materials[BLOCK.WATER] = new THREE.MeshStandardMaterial({ map: texWater, transparent: true, opacity: 0.65 });
        this.materials[BLOCK.SAND] = new THREE.MeshStandardMaterial({ map: texSand });
        this.materials[BLOCK.PATH] = new THREE.MeshStandardMaterial({ map: texPath });
        this.materials[BLOCK.COAL_ORE] = new THREE.MeshStandardMaterial({ map: texCoalOre });
        this.materials[BLOCK.IRON_ORE] = new THREE.MeshStandardMaterial({ map: texIronOre });
        this.materials[BLOCK.GOLD_ORE] = new THREE.MeshStandardMaterial({ map: texGoldOre, emissive: 0xeab308, emissiveIntensity: 0.15 });
        this.materials[BLOCK.DIAMOND_ORE] = new THREE.MeshStandardMaterial({ map: texDiamondOre, emissive: 0x06b6d4, emissiveIntensity: 0.25 });
        this.materials[BLOCK.SAPLING] = new THREE.MeshStandardMaterial({ map: texSapling, transparent: true, opacity: 0.85 });
        this.materials[BLOCK.CRAFTING_TABLE] = [
            new THREE.MeshStandardMaterial({ map: texCraftingSide }),
            new THREE.MeshStandardMaterial({ map: texCraftingSide }),
            new THREE.MeshStandardMaterial({ map: texCraftingTop }),
            new THREE.MeshStandardMaterial({ map: texCraftingTop }),
            new THREE.MeshStandardMaterial({ map: texCraftingSide }),
            new THREE.MeshStandardMaterial({ map: texCraftingSide }),
        ];
        this.materials[BLOCK.FURNACE] = new THREE.MeshStandardMaterial({ map: texFurnace });
        this.materials[BLOCK.FENCE] = new THREE.MeshStandardMaterial({ map: texFence });
        this.materials[BLOCK.CAVE_STONE] = new THREE.MeshStandardMaterial({ map: texCaveStone });
        this.materials[BLOCK.FLOWER] = new THREE.MeshStandardMaterial({ map: texFlower, transparent: true, opacity: 0.9 });

        // 32 Distinct Parcel Floor Materials
        const parcelColors = [
            '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
            '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
            '#f43f5e', '#fb7185', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fb923c', '#facc15',
            '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#fb923c', '#38bdf8'
        ];

        for (let i = 1; i <= 32; i++) {
            const baseColor = parcelColors[(i - 1) % parcelColors.length];
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = baseColor;
            ctx.fillRect(0, 0, 16, 16);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(1, 1, 14, 14);
            ctx.fillStyle = baseColor;
            ctx.fillRect(2, 2, 12, 12);

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 16, 16);

            const texture = new THREE.CanvasTexture(canvas);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;

            this.parcelMaterials.set(i + 100, new THREE.MeshStandardMaterial({ map: texture }));
        }
    }

    getKey(x, y, z) {
        return `${x},${y},${z}`;
    }

    getBlock(x, y, z) {
        return this.blocks.get(this.getKey(x, y, z)) || 0;
    }

    isBlockExposed(x, y, z) {
        return (
            this.getBlock(x + 1, y, z) === 0 ||
            this.getBlock(x - 1, y, z) === 0 ||
            this.getBlock(x, y + 1, z) === 0 ||
            this.getBlock(x, y - 1, z) === 0 ||
            this.getBlock(x, y, z + 1) === 0 ||
            this.getBlock(x, y, z - 1) === 0
        );
    }

    // Re-evaluates exposure for a block and its 6 neighbors (the only ones whose exposure
    // could possibly have changed) instead of the whole world.
    updateExposureAround(x, y, z) {
        const coords = [[x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
        coords.forEach(([cx, cy, cz]) => {
            const key = this.getKey(cx, cy, cz);
            const type = this.blocks.get(key);
            if (type === undefined) {
                this.exposedBlocks.delete(key);
                return;
            }
            if (this.isBlockExposed(cx, cy, cz)) {
                this.exposedBlocks.set(key, type);
            } else {
                this.exposedBlocks.delete(key);
            }
        });
    }

    // One-time full scan, only used right after bulk world generation (see generateWorld()).
    computeAllExposure() {
        this.exposedBlocks.clear();
        this.blocks.forEach((type, key) => {
            const [x, y, z] = key.split(',').map(Number);
            if (this.isBlockExposed(x, y, z)) {
                this.exposedBlocks.set(key, type);
            }
        });
    }

    setBlock(x, y, z, blockType, rebuild = true) {
        const key = this.getKey(x, y, z);
        if (blockType === 0) {
            this.blocks.delete(key);
        } else {
            this.blocks.set(key, blockType);
        }
        // Skip incremental tracking during bulk world generation - a single computeAllExposure()
        // pass at the end is far cheaper than tens of thousands of redundant incremental updates.
        if (!this._bulkGenerating) {
            this.updateExposureAround(x, y, z);
        }
        if (rebuild) this.rebuildAllChunks();
    }

    getParcelNumber(x, z) {
        // Central Living Room Plaza (-60..59, -60..59)
        if (-60 <= x && x <= 59 && -60 <= z && z <= 59) {
            return 0;
        }

        // 4 Corner Regions (Public Living Room)
        if ((x < -60 && z < -60) || (x > 59 && z < -60) || (x > 59 && z > 59) || (x < -60 && z > 59)) {
            return 0;
        }

        // North Side (Z <= -61, 8 Parcels across X: -60 to 59, each 15 wide)
        if (z <= -61) {
            if (-60 <= x && x <= -46) return 1;
            else if (-45 <= x && x <= -31) return 2;
            else if (-30 <= x && x <= -16) return 3;
            else if (-15 <= x && x <= -1) return 4;
            else if (0 <= x && x <= 14) return 5;
            else if (15 <= x && x <= 29) return 6;
            else if (30 <= x && x <= 44) return 7;
            else if (45 <= x && x <= 59) return 8;
        }

        // East Side (X >= 60, 8 Parcels down Z: -60 to 59, each 15 deep)
        if (x >= 60) {
            if (-60 <= z && z <= -46) return 9;
            else if (-45 <= z && z <= -31) return 10;
            else if (-30 <= z && z <= -16) return 11;
            else if (-15 <= z && z <= -1) return 12;
            else if (0 <= z && z <= 14) return 13;
            else if (15 <= z && z <= 29) return 14;
            else if (30 <= z && z <= 44) return 15;
            else if (45 <= z && z <= 59) return 16;
        }

        // South Side (Z >= 60, 8 Parcels across X: 59 down to -60, each 15 wide)
        if (z >= 60) {
            if (45 <= x && x <= 59) return 17;
            else if (30 <= x && x <= 44) return 18;
            else if (15 <= x && x <= 29) return 19;
            else if (0 <= x && x <= 14) return 20;
            else if (-15 <= x && x <= -1) return 21;
            else if (-30 <= x && x <= -16) return 22;
            else if (-45 <= x && x <= -31) return 23;
            else if (-60 <= x && x <= -46) return 24;
        }

        // West Side (X <= -61, 8 Parcels up Z: 59 down to -60, each 15 deep)
        if (x <= -61) {
            if (45 <= z && z <= 59) return 25;
            else if (30 <= z && z <= 37) return 26;
            else if (15 <= z && z <= 29) return 27;
            else if (0 <= z && z <= 14) return 28;
            else if (-15 <= z && z <= -1) return 29;
            else if (-30 <= z && z <= -16) return 30;
            else if (-45 <= z && z <= -31) return 31;
            else if (-60 <= z && z <= -46) return 32;
        }

        return 0;
    }

    // Completely Flat Surface Generation (Y = 4 Surface Only for Ultra GPU Efficiency)
    generateWorld() {
        this._bulkGenerating = true;
        const half = 80;
        // Bedrock stays unbreakable at y=4 (BASE_UNBREAKABLE_Y, mirrored in server.py block_change
        // handler). Surface sits 5 layers above it (y=9) so players can dig down through 5 diggable
        // layers (dirt just under the surface, stone below that) before hitting solid bedrock.
        const groundHeight = 9;

        for (let x = -half; x < half; x++) {
            for (let z = -half; z < half; z++) {
                const parcel = this.getParcelNumber(x, z);

                // 4 diggable underground layers between bedrock (y=4) and the surface (y=9)
                this.blocks.set(this.getKey(x, groundHeight - 1, z), BLOCK.DIRT);
                this.blocks.set(this.getKey(x, groundHeight - 2, z), BLOCK.STONE);
                this.blocks.set(this.getKey(x, groundHeight - 3, z), BLOCK.STONE);
                this.blocks.set(this.getKey(x, groundHeight - 4, z), BLOCK.STONE);

                if (parcel === 0) {
                    // Green Living Room Plaza (녹색 거실)
                    this.blocks.set(this.getKey(x, groundHeight, z), 10);
                } else {
                    // 32 Distinct Parcel Colored Floor
                    this.blocks.set(this.getKey(x, groundHeight, z), 100 + parcel);
                }

                // Glowing Border Glowstones at Center Plaza Perimeter (-60, 59)
                if (((x === -60 || x === 59) && (z >= -60 && z <= 59)) || ((z === -60 || z === 59) && (x >= -60 && x <= 59))) {
                    if (parcel !== 0) {
                        this.blocks.set(this.getKey(x, groundHeight, z), 8);
                    }
                }
            }
        }

        this.buildCentralHub(groundHeight);
        this.createParcelSignposts(groundHeight);

        this._bulkGenerating = false;
        this.computeAllExposure();
        this.rebuildAllChunks();
    }

    // ==================================================================
    // Central Hub (거실) Renewal: Garden / Forest / Lake / Cave&Mine /
    // Pasture / PVP Arena / Crafting Plaza. Fully deterministic (no
    // Math.random) so every client generates byte-identical geometry
    // without needing to sync the base terrain over the network.
    // ==================================================================
    buildCentralHub(gy) {
        this.buildGardenCenter(gy);
        this.buildForest(gy);
        this.buildLake(gy);
        this.buildCaveAndMine(gy);
        this.buildPasture(gy);
        this.buildPvpArena(gy);
        this.buildCraftPlaza(gy);
    }

    buildGardenCenter(gy) {
        // Cross paths connecting all 4 hub quadrants
        for (let x = -58; x <= 58; x++) {
            for (let o = -1; o <= 1; o++) {
                if (Math.abs(x) > 3) this.setBlock(x, gy, o, BLOCK.PATH, false);
            }
        }
        for (let z = -58; z <= 58; z++) {
            for (let o = -1; o <= 1; o++) {
                if (Math.abs(z) > 3) this.setBlock(o, gy, z, BLOCK.PATH, false);
            }
        }

        // Fountain / monument at the exact center
        for (let x = -3; x <= 3; x++) {
            for (let z = -3; z <= 3; z++) {
                if (Math.max(Math.abs(x), Math.abs(z)) <= 3) this.setBlock(x, gy, z, BLOCK.PATH, false);
            }
        }
        const ring = [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -3], [0, 3], [-3, 0], [3, 0]];
        ring.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.GLOWSTONE, false));
        // Crown beacon pillar
        this.setBlock(0, gy + 1, 0, BLOCK.BRICK, false);
        this.setBlock(0, gy + 2, 0, BLOCK.BRICK, false);
        this.setBlock(0, gy + 3, 0, BLOCK.GLOWSTONE, false);

        // Decorative flowers around the fountain
        const flowers = [[-5, -5], [5, -5], [-5, 5], [5, 5], [-6, 0], [6, 0], [0, -6], [0, 6]];
        flowers.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.FLOWER, false));
    }

    buildForest(gy) {
        const [xMin, xMax, zMin, zMax] = ZONES.FOREST;
        for (let x = xMin; x <= xMax; x++) {
            for (let z = zMin; z <= zMax; z++) {
                this.setBlock(x, gy, z, BLOCK.GRASS, false);
            }
        }

        // Dense deterministic tree grid (staggered rows so it doesn't look like a checkerboard),
        // with a clearing left open near the sapling demo patch.
        let treeCount = 0;
        for (let z = zMin + 3, row = 0; z <= zMax - 3; z += 5, row++) {
            const rowOffset = (row % 2 === 0) ? 0 : 2;
            for (let x = xMin + 3 + rowOffset; x <= xMax - 3; x += 5) {
                if (x >= -25 && x <= -13 && z >= -23 && z <= -11) continue; // clearing for sapling demo
                this.plantFullTree(x, gy + 1, z);
                treeCount++;
            }
        }

        // Cleared patch with sample saplings, ready for players to grow more trees
        const saplingSpots = [[-20, -18], [-18, -16], [-22, -16], [-19, -14], [-21, -20]];
        saplingSpots.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.SAPLING, false));
    }

    plantFullTree(x, y, z) {
        for (let i = 0; i < 4; i++) this.setBlock(x, y + i, z, BLOCK.WOOD, false);
        for (let lx = -1; lx <= 1; lx++) {
            for (let lz = -1; lz <= 1; lz++) {
                this.setBlock(x + lx, y + 4, z + lz, BLOCK.LEAVES, false);
                this.setBlock(x + lx, y + 5, z + lz, BLOCK.LEAVES, false);
            }
        }
        this.setBlock(x, y + 6, z, BLOCK.LEAVES, false);
    }

    buildLake(gy) {
        const [zxMin, zxMax, zzMin, zzMax] = ZONES.LAKE_ZONE;
        for (let x = zxMin; x <= zxMax; x++) {
            for (let z = zzMin; z <= zzMax; z++) {
                this.setBlock(x, gy, z, BLOCK.GRASS, false);
            }
        }

        const [bxMin, bxMax, bzMin, bzMax] = ZONES.LAKE_BASIN;
        for (let x = bxMin - 2; x <= bxMax + 2; x++) {
            for (let z = bzMin - 2; z <= bzMax + 2; z++) {
                const insideBasin = x >= bxMin && x <= bxMax && z >= bzMin && z <= bzMax;
                if (insideBasin) {
                    this.setBlock(x, gy - 1, z, BLOCK.SAND, false);
                    this.setBlock(x, gy, z, BLOCK.WATER, false);
                    this.setBlock(x, gy + 1, z, BLOCK.AIR, false); // keep water flush with surrounding terrain, not raised above it
                } else {
                    this.setBlock(x, gy, z, BLOCK.SAND, false); // beach ring
                }
            }
        }

        // Small fishing dock jutting into the lake
        for (let z = bzMin - 3; z <= bzMin + 1; z++) {
            this.setBlock(33, gy, z, BLOCK.WOOD, false);
            this.setBlock(34, gy, z, BLOCK.WOOD, false);
        }
    }

    buildCaveAndMine(gy) {
        const [wxMin, wxMax, wzMin, wzMax] = ZONES.WILD;
        for (let x = wxMin; x <= wxMax; x++) {
            for (let z = wzMin; z <= wzMax; z++) {
                this.setBlock(x, gy, z, BLOCK.STONE, false);
            }
        }

        const [cxMin, cxMax, czMin, czMax] = ZONES.CAVE;
        const entranceMin = -48, entranceMax = -44;

        // Floor & roof
        for (let x = cxMin; x <= cxMax; x++) {
            for (let z = czMin; z <= czMax; z++) {
                this.setBlock(x, gy, z, BLOCK.CAVE_STONE, false);
                this.setBlock(x, gy + 5, z, BLOCK.CAVE_STONE, false); // roof (y = gy+5 == world y9)
            }
        }

        // Walls (deterministic ore formula - MUST mirror server.py get_cave_ore_type)
        const wallCells = [];
        for (let x = cxMin; x <= cxMax; x++) {
            if (x >= entranceMin && x <= entranceMax) continue;
            wallCells.push([x, czMin]);
        }
        for (let x = cxMin; x <= cxMax; x++) wallCells.push([x, czMax]);
        for (let z = czMin + 1; z <= czMax - 1; z++) wallCells.push([cxMin, z]);
        for (let z = czMin + 1; z <= czMax - 1; z++) wallCells.push([cxMax, z]);

        let idx = 0;
        wallCells.forEach(([x, z]) => {
            [5, 6].forEach((wy) => {
                idx++;
                let type = BLOCK.CAVE_STONE;
                if (idx % 23 === 0) type = BLOCK.DIAMOND_ORE;
                else if (idx % 17 === 0) type = BLOCK.GOLD_ORE;
                else if (idx % 11 === 0) type = BLOCK.IRON_ORE;
                else if (idx % 7 === 0) type = BLOCK.COAL_ORE;
                this.setBlock(x, gy + (wy - 4), z, type, false);
            });
            [7, 8].forEach((wy) => this.setBlock(x, gy + (wy - 4), z, BLOCK.CAVE_STONE, false));
        });

        // Standalone glowstone lamps on the cave floor (not part of the ore wall formula)
        const lamps = [[-53, 8], [-46, 8], [-39, 8], [-53, 20], [-46, 20], [-39, 20]];
        lamps.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.GLOWSTONE, false));
    }

    buildPasture(gy) {
        const [xMin, xMax, zMin, zMax] = ZONES.PASTURE;
        for (let x = xMin; x <= xMax; x++) {
            for (let z = zMin; z <= zMax; z++) {
                this.setBlock(x, gy, z, BLOCK.GRASS, false);
            }
        }
        // Fence ring with a gate gap facing the garden center
        for (let x = xMin; x <= xMax; x++) {
            this.setBlock(x, gy + 1, zMin, BLOCK.FENCE, false);
            this.setBlock(x, gy + 1, zMax, BLOCK.FENCE, false);
        }
        for (let z = zMin; z <= zMax; z++) {
            const isGate = z >= zMin && z <= zMin + 2;
            if (!isGate) this.setBlock(xMin, gy + 1, z, BLOCK.FENCE, false);
            this.setBlock(xMax, gy + 1, z, BLOCK.FENCE, false);
        }
    }

    buildPvpArena(gy) {
        const [xMin, xMax, zMin, zMax] = ZONES.PVP_ARENA;
        for (let x = xMin; x <= xMax; x++) {
            for (let z = zMin; z <= zMax; z++) {
                this.setBlock(x, gy, z, BLOCK.BRICK, false);
            }
        }
        for (let x = xMin; x <= xMax; x++) {
            const gate = x >= xMin + 10 && x <= xMin + 13;
            for (let wy = 1; wy <= 3; wy++) {
                if (!gate) {
                    this.setBlock(x, gy + wy, zMin, BLOCK.BRICK, false);
                    this.setBlock(x, gy + wy, zMax, BLOCK.BRICK, false);
                }
            }
        }
        for (let z = zMin; z <= zMax; z++) {
            const gate = z >= zMin + 10 && z <= zMin + 13;
            for (let wy = 1; wy <= 3; wy++) {
                if (!gate) {
                    this.setBlock(xMin, gy + wy, z, BLOCK.BRICK, false);
                    this.setBlock(xMax, gy + wy, z, BLOCK.BRICK, false);
                }
            }
        }
    }

    buildCraftPlaza(gy) {
        const [xMin, xMax, zMin, zMax] = ZONES.CRAFT_PLAZA;
        for (let x = xMin; x <= xMax; x++) {
            for (let z = zMin; z <= zMax; z++) {
                this.setBlock(x, gy, z, BLOCK.PATH, false);
            }
        }
        const tables = [[43, 44], [50, 44], [43, 52], [50, 52]];
        const furnaces = [[46, 44], [53, 44], [46, 52]];
        tables.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.CRAFTING_TABLE, false));
        furnaces.forEach(([x, z]) => this.setBlock(x, gy + 1, z, BLOCK.FURNACE, false));
    }

    createParcelSignposts(groundHeight) {
        // Signposts placed right at entrance facing the Central Living Room!
        const signPositions = Object.entries(PARCEL_SPAWN_POINTS).map(([num, p]) => ({ num: parseInt(num, 10), x: p.x, z: p.z }));

        this.signGroup = new THREE.Group();

        signPositions.forEach(p => {
            // Wood post block in voxel map
            this.blocks.set(this.getKey(p.x, groundHeight + 1, p.z), 11);

            // 3D Canvas Sign Board
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#78350f';
            ctx.fillRect(0, 0, 128, 64);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 4;
            ctx.strokeRect(4, 4, 120, 56);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 26px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`🚩 ${p.num}번 땅`, 64, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const signMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
            const signGeo = new THREE.PlaneGeometry(1.4, 0.7);
            const signMesh = new THREE.Mesh(signGeo, signMat);
            signMesh.position.set(p.x + 0.5, groundHeight + 2.1, p.z + 0.5);

            // Rotate each sign to face INTO the central plaza so the text reads left-to-right
            // for a viewer standing in the plaza, regardless of which of the 4 sides it's on.
            if (p.num >= 1 && p.num <= 8) signMesh.rotation.y = 0;                 // North: face south (+Z)
            else if (p.num >= 9 && p.num <= 16) signMesh.rotation.y = -Math.PI / 2; // East: face west (-X)
            else if (p.num >= 17 && p.num <= 24) signMesh.rotation.y = Math.PI;     // South: face north (-Z)
            else signMesh.rotation.y = Math.PI / 2;                                 // West: face east (+X)

            this.signGroup.add(signMesh);
        });

        this.scene.add(this.signGroup);
    }

    // High Performance THREE.InstancedMesh Rendering (Reduces Draw Calls from 25,600 to ~35!)
    rebuildAllChunks() {
        if (this.chunkGroup) {
            this.scene.remove(this.chunkGroup);
        }

        this.chunkGroup = new THREE.Group();
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const dummy = new THREE.Object3D();

        const materialGroups = new Map();

        // exposedBlocks is already filtered to just the surface-visible blocks (maintained
        // incrementally by setBlock/updateExposureAround), so no per-block neighbor checks here.
        this.exposedBlocks.forEach((type, key) => {
            const [x, y, z] = key.split(',').map(Number);

            if (!materialGroups.has(type)) {
                materialGroups.set(type, []);
            }
            materialGroups.get(type).push({ x, y, z });
        });

        materialGroups.forEach((positions, type) => {
            let mat;
            if (type > 100) {
                mat = this.parcelMaterials.get(type);
            } else {
                mat = this.materials[type];
            }

            if (!mat) return;

            // Use InstancedMesh for Single-Material Blocks, or Mesh for Array Material (Grass/Logs)
            if (Array.isArray(mat)) {
                positions.forEach(p => {
                    const mesh = new THREE.Mesh(boxGeo, mat);
                    mesh.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
                    this.chunkGroup.add(mesh);
                });
            } else {
                const instancedMesh = new THREE.InstancedMesh(boxGeo, mat, positions.length);
                for (let i = 0; i < positions.length; i++) {
                    const p = positions[i];
                    dummy.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
                    dummy.updateMatrix();
                    instancedMesh.setMatrixAt(i, dummy.matrix);
                }
                instancedMesh.instanceMatrix.needsUpdate = true;
                this.chunkGroup.add(instancedMesh);
            }
        });

        this.scene.add(this.chunkGroup);
    }
}

class MinecraftGame {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.canvas = document.getElementById('game-canvas');
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.rotation.order = 'YXZ'; // FPS Natural Mouse Euler Rotation Order

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Optimized Pixel Ratio
        this.renderer.shadowMap.enabled = false; // Disable heavy dynamic shadows for ultra 60+ FPS

        this.selectedSlot = 1;

        // Touch Drag Camera Vars
        this.touchPreviousX = 0;
        this.touchPreviousY = 0;

        // Modules
        this.world = new VoxelWorld(this.scene);
        this.physics = new PlayerPhysics(this.world);
        this.net = new NetworkManager(this);
        this.dayNight = new DayNightCycle(this);
        this.entities = new EntityManager(this);
        this.inventory = new InventorySystem(this);

        const wireGeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
        this.targetBox = new THREE.Mesh(wireGeo, wireMat);
        this.targetBox.visible = false;
        this.scene.add(this.targetBox);

        this.initLighting();
        this.initNumberGridSelector();
        this.initEventListeners();
        this.initActiveTouchJoystick();
        this.initCharacterCustomization();
        this.initRoomIdCheck();
        this.initViewmodelArm();
        this.initInviteFeature();
        this.applyJoinLinkPrefill();
    }

    // First-person view-model arm attached to the camera (visible only to the local player)
    initViewmodelArm() {
        this.scene.add(this.camera); // camera must be in the scene graph for its children to render

        const armGeo = new THREE.BoxGeometry(0.18, 0.5, 0.18);
        const skin = (this.appearance && this.appearance.skin) || '#ffdbac';
        const armMat = new THREE.MeshStandardMaterial({ color: skin });
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.position.set(0.32, -0.42, -0.55);
        arm.rotation.set(0.35, -0.2, 0.3);
        this.viewmodelArm = arm;
        this.camera.add(arm);
    }

    updateViewmodelArmColor() {
        if (this.viewmodelArm && this.appearance) {
            this.viewmodelArm.material.color.set(this.appearance.skin || '#ffdbac');
        }
    }

    // Safety net: bedrock (y=4) should always block falling further down, but if anything ever
    // lets a player slip through (lag, a movement edge case, etc.), auto-recover them back to
    // their own parcel's entrance instead of leaving them stuck falling forever.
    checkFallRecovery() {
        if (this.physics.position.y >= -6) return;
        const spawn = PARCEL_SPAWN_POINTS[this.physics.playerNumber] || { x: 0, z: 0 };
        this.physics.position.set(spawn.x + 0.5, 10, spawn.z + 0.5);
        this.physics.velocity.set(0, 0, 0);
        this.showToast('⚠️ 바닥 아래로 떨어져서 내 땅 앞으로 돌아왔습니다!');
    }

    // Real-time room-id availability check (debounced) - min 4 characters required
    initRoomIdCheck() {
        const input = document.getElementById('username');
        const statusEl = document.getElementById('room-id-status');
        if (!input || !statusEl) return;

        let debounceTimer = null;
        input.addEventListener('input', () => {
            const val = input.value.trim();
            clearTimeout(debounceTimer);

            if (val.length === 0) {
                statusEl.textContent = '';
                statusEl.className = 'room-id-status';
                this.applyNumberRegistrationColors(null);
                return;
            }
            if (val.length < 4) {
                statusEl.textContent = '⚠️ 4글자 이상 입력해주세요';
                statusEl.className = 'room-id-status warn';
                this.applyNumberRegistrationColors(null);
                return;
            }

            statusEl.textContent = '🔍 확인 중...';
            statusEl.className = 'room-id-status checking';

            debounceTimer = setTimeout(async () => {
                try {
                    const result = await this.net.checkRoomId(val);
                    if (input.value.trim() !== val) return; // stale response, input changed since
                    if (result.exists) {
                        statusEl.textContent = 'ℹ️ 이미 있는 방이에요 (비밀번호 필요)';
                        statusEl.className = 'room-id-status info';
                    } else {
                        statusEl.textContent = '✅ 사용 가능한 이름이에요!';
                        statusEl.className = 'room-id-status ok';
                    }
                    this.applyNumberRegistrationColors(result.registered_numbers || []);
                } catch (e) {
                    statusEl.textContent = '';
                    statusEl.className = 'room-id-status';
                }
            }, 450);
        });
    }

    // If arriving via an invite link (?room=...&pw=...), pre-fill the room id/password so the
    // visitor only has to pick a land number and set their own number password.
    applyJoinLinkPrefill() {
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        const pw = params.get('pw');
        if (!room && !pw) return;

        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        if (room && usernameInput) {
            usernameInput.value = room;
            usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (pw && passwordInput) passwordInput.value = pw;

        const pinInput = document.getElementById('parcel-pin');
        if (pinInput) pinInput.focus();
        this.showToast('📨 초대 링크로 들어왔어요! 번호와 번호 비밀번호만 정하면 돼요.');
    }

    // Friend-invite QR code: encodes a link that pre-fills this room's id/password for the visitor.
    initInviteFeature() {
        const btn = document.getElementById('btn-invite');
        const modal = document.getElementById('invite-modal');
        const closeBtn = document.getElementById('btn-close-invite');
        const qrImg = document.getElementById('invite-qr-img');
        const linkInput = document.getElementById('invite-link-input');
        const copyBtn = document.getElementById('btn-copy-invite');
        if (!btn || !modal) return;

        btn.addEventListener('click', () => {
            const roomId = this.net.username;
            const password = this.net.password;
            if (!roomId) {
                this.showToast('⚠️ 먼저 방에 접속한 뒤 초대할 수 있어요.');
                return;
            }
            const url = new URL(window.location.origin + window.location.pathname);
            url.searchParams.set('room', roomId);
            url.searchParams.set('pw', password || '');
            const inviteUrl = url.toString();

            if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(inviteUrl)}`;
            if (linkInput) linkInput.value = inviteUrl;
            modal.classList.remove('hidden');
        });

        if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

        if (copyBtn && linkInput) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(linkInput.value);
                } catch (e) {
                    linkInput.select();
                    document.execCommand('copy');
                }
                this.showToast('📋 초대 링크를 복사했어요!');
            });
        }
    }

    initLighting() {
        this.scene.background = new THREE.Color(0x78a7ff);
        this.scene.fog = new THREE.FogExp2(0x78a7ff, 0.015);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
        this.hemiLight = hemiLight;
        this.scene.add(hemiLight);

        this.sun = new THREE.DirectionalLight(0xffffff, 0.6);
        this.sun.position.set(50, 100, 50);
        this.scene.add(this.sun);
    }

    initNumberGridSelector() {
        const grid = document.getElementById('number-grid');
        const hiddenInput = document.getElementById('selected-number');
        if (!grid || !hiddenInput) return;

        grid.innerHTML = '';
        this.registeredNumbers = new Set();

        const selectNumber = (num, btnElement) => {
            document.querySelectorAll('.num-btn').forEach(b => b.classList.remove('selected'));
            if (btnElement) btnElement.classList.add('selected');
            hiddenInput.value = String(num);
            this.updateParcelStatusMessage(num);
        };

        for (let i = 1; i <= 32; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `num-btn ${i === 1 ? 'selected' : ''}`;
            btn.innerText = `${i}번`;
            btn.dataset.num = i;

            const handleSelect = (e) => {
                e.preventDefault();
                e.stopPropagation();
                selectNumber(i, btn);
            };

            btn.addEventListener('click', handleSelect);
            btn.addEventListener('touchstart', handleSelect, { passive: false });

            grid.appendChild(btn);
        }
    }

    // Recolor the 1~32 grid to mark numbers already registered in the typed room id.
    // Pass null to reset to the "not checked yet" state (input empty/too short).
    applyNumberRegistrationColors(registeredNumbers) {
        this.roomIdChecked = registeredNumbers !== null;
        this.registeredNumbers = new Set(registeredNumbers || []);
        document.querySelectorAll('.num-btn').forEach((btn) => {
            const num = parseInt(btn.dataset.num, 10);
            btn.classList.toggle('registered', this.registeredNumbers.has(num));
        });
        const selectedInput = document.getElementById('selected-number');
        if (selectedInput) this.updateParcelStatusMessage(parseInt(selectedInput.value || '1', 10));
    }

    updateParcelStatusMessage(num) {
        const statusEl = document.getElementById('parcel-status');
        if (!statusEl) return;
        if (!this.roomIdChecked) {
            statusEl.textContent = '';
            statusEl.className = 'room-id-status';
            return;
        }
        const set = this.registeredNumbers || new Set();
        if (set.has(num)) {
            statusEl.textContent = `⚠️ ${num}번은 이미 등록된 번호입니다. 비밀번호를 입력하세요.`;
            statusEl.className = 'room-id-status taken';
        } else {
            statusEl.textContent = `🆕 ${num}번은 새 번호예요. 비밀번호를 새로 만들고 꼭 기억하세요!`;
            statusEl.className = 'room-id-status ok';
        }
    }

    // Active Movable Dynamic Touch Joystick Implementation (Bottom-Left Joystick, Bottom-Right Actions)
    initActiveTouchJoystick() {
        const zone = document.getElementById('joystick-zone');
        const container = document.getElementById('joystick-container');
        const knob = document.getElementById('joystick-knob');
        if (!zone || !container || !knob) return;

        let activeTouchId = null;
        let centerX = 0;
        let centerY = 0;
        const maxRadius = 45; // Max knob drag radius in pixels
        const half = 60; // half of the 120px joystick container

        const handleStart = (e) => {
            if (activeTouchId !== null) return;
            const touch = e.changedTouches ? e.changedTouches[0] : e;
            activeTouchId = touch.identifier !== undefined ? touch.identifier : 'mouse';

            // Floating joystick: spawn centered exactly where the finger landed
            centerX = touch.clientX;
            centerY = touch.clientY;
            container.style.left = `${centerX - half}px`;
            container.style.top = `${centerY - half}px`;
            container.classList.add('active');

            handleMove(e);
        };

        const handleMove = (e) => {
            if (activeTouchId === null) return;

            let touch = null;
            if (e.changedTouches) {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeTouchId) {
                        touch = e.changedTouches[i];
                        break;
                    }
                }
            } else {
                touch = e;
            }

            if (!touch) return;

            const dx = touch.clientX - centerX;
            const dy = touch.clientY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            let clampedX = dx;
            let clampedY = dy;

            if (dist > maxRadius) {
                clampedX = (dx / dist) * maxRadius;
                clampedY = (dy / dist) * maxRadius;
            }

            knob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

            const normX = clampedX / maxRadius;
            const normY = clampedY / maxRadius;

            const deadZone = 0.18;
            this.physics.keys.forward = normY < -deadZone;
            this.physics.keys.backward = normY > deadZone;
            this.physics.keys.right = normX > deadZone;
            this.physics.keys.left = normX < -deadZone;
        };

        const handleEnd = (e) => {
            if (activeTouchId === null) return;

            if (e.changedTouches) {
                let matched = false;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeTouchId) {
                        matched = true;
                        break;
                    }
                }
                if (!matched) return;
            }

            activeTouchId = null;
            knob.style.transform = `translate(0px, 0px)`;
            container.classList.remove('active');

            this.physics.keys.forward = false;
            this.physics.keys.backward = false;
            this.physics.keys.left = false;
            this.physics.keys.right = false;
        };

        zone.addEventListener('touchstart', handleStart);
        window.addEventListener('touchmove', handleMove);
        window.addEventListener('touchend', handleEnd);
        window.addEventListener('touchcancel', handleEnd);

        // Desktop mouse support for testing the floating joystick
        zone.addEventListener('mousedown', handleStart);
        window.addEventListener('mousemove', (e) => {
            if (activeTouchId === 'mouse') handleMove(e);
        });
        window.addEventListener('mouseup', (e) => {
            if (activeTouchId === 'mouse') handleEnd(e);
        });

        // Bind both touchstart (instant, no ghost-click delay) and click (desktop mouse) to the
        // same handler so touch action buttons respond reliably on mobile browsers.
        const bindTapAction = (el, handler) => {
            if (!el) return;
            const wrapped = (e) => { e.preventDefault(); handler(); };
            el.addEventListener('touchstart', wrapped, { passive: false });
            el.addEventListener('click', wrapped);
        };

        // Break Block / Attack Button (Bottom-Right)
        bindTapAction(document.getElementById('btn-touch-break'), () => {
            if (this.inventory.attemptAttack()) return;
            const target = this.physics.raycastTarget(6.0);
            if (target.hit) {
                const { x, y, z } = target.targetBlock;
                if (y <= 4) {
                    this.showToast('⚠️ 가장 바닥 지형은 파괴할 수 없습니다!');
                    return;
                }
                const MathX = Math.round(x);
                const MathY = Math.round(y);
                const MathZ = Math.round(z);
                let brokenType = this.world.getBlock(MathX, MathY, MathZ);
                if (!brokenType) brokenType = this.world.getBlock(x, y, z);

                if (this.net.sendBlockChange(x, y, z, 0)) {
                    // Fallback to WOOD (4) if breaking a tree trunk block that was set via generator
                    if (!brokenType) brokenType = 4;
                    this.inventory.grantFromBlockBreak(brokenType);
                }
            }
        });

        // Place Block Button (Bottom-Right)
        bindTapAction(document.getElementById('btn-touch-place'), () => {
            const target = this.physics.raycastTarget(6.0);
            if (target.hit) {
                const { x, y, z } = target.placeBlock;
                this.net.sendBlockChange(x, y, z, this.selectedSlot);
            }
        });

        // Interact Button (crafting table / furnace / fishing) - mobile equivalent of the 'F' key
        bindTapAction(document.getElementById('btn-touch-interact'), () => {
            this.inventory.handleInteract();
        });

        // Jump Button (Bottom-Right)
        const jumpBtn = document.getElementById('btn-touch-jump');
        if (jumpBtn) {
            const jumpPress = (e) => {
                e.preventDefault();
                this.physics.keys.jump = true;
            };
            const jumpRelease = (e) => {
                e.preventDefault();
                this.physics.keys.jump = false;
            };
            jumpBtn.addEventListener('touchstart', jumpPress);
            jumpBtn.addEventListener('touchend', jumpRelease);
            jumpBtn.addEventListener('mousedown', jumpPress);
            jumpBtn.addEventListener('mouseup', jumpRelease);
        }

        // Sprint Button (Bottom-Right)
        const sprintBtn = document.getElementById('btn-touch-sprint');
        if (sprintBtn) {
            const toggleSprint = (e) => {
                e.preventDefault();
                this.physics.keys.sprint = !this.physics.keys.sprint;
                if (this.physics.keys.sprint) {
                    sprintBtn.classList.add('active');
                } else {
                    sprintBtn.classList.remove('active');
                }
            };
            sprintBtn.addEventListener('click', toggleSprint);
            sprintBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                toggleSprint(e);
            }, { passive: false });
        }

        // Touch Drag for Camera Rotation on Canvas - tracked by its OWN touch identifier so it
        // keeps working simultaneously while a separate finger drives the movement joystick
        // (e.touches includes every touch on the whole screen, not just this element, so we
        // must use changedTouches + identifier matching instead of blindly reading touches[0]).
        let cameraTouchId = null;

        this.canvas.addEventListener('touchstart', (e) => {
            if (cameraTouchId !== null) return;
            const touch = e.changedTouches[0];
            cameraTouchId = touch.identifier;
            this.touchPreviousX = touch.clientX;
            this.touchPreviousY = touch.clientY;
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (cameraTouchId === null) return;
            let touch = null;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === cameraTouchId) {
                    touch = e.changedTouches[i];
                    break;
                }
            }
            if (!touch) return;

            const touchX = touch.clientX;
            const touchY = touch.clientY;

            const deltaX = touchX - this.touchPreviousX;
            const deltaY = touchY - this.touchPreviousY;

            const sensitivity = 0.004;
            this.physics.rotation.y -= deltaX * sensitivity;
            this.physics.rotation.x -= deltaY * sensitivity;

            const maxPitch = Math.PI / 2 - 0.05;
            this.physics.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.physics.rotation.x));

            this.touchPreviousX = touchX;
            this.touchPreviousY = touchY;
        });

        const releaseCameraTouch = (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === cameraTouchId) {
                    cameraTouchId = null;
                    break;
                }
            }
        };
        this.canvas.addEventListener('touchend', releaseCameraTouch);
        this.canvas.addEventListener('touchcancel', releaseCameraTouch);
    }

    initEventListeners() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Controls Dropdown Toggle & Close Handlers (Top Header Area)
        const toggleControlsBtn = document.getElementById('btn-toggle-controls');
        const closeDropdownBtn = document.getElementById('btn-close-dropdown');
        const controlsDropdown = document.getElementById('controls-dropdown');

        const toggleDropdown = () => {
            if (controlsDropdown) {
                controlsDropdown.classList.toggle('hidden');
            }
        };

        if (toggleControlsBtn) {
            toggleControlsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleDropdown();
            });
        }
        if (closeDropdownBtn) {
            closeDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleDropdown();
            });
        }

        // Mouse Look Rotation (Standard FPS Control)
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === this.canvas) {
                const sensitivity = 0.0022;
                this.physics.rotation.y -= e.movementX * sensitivity;
                this.physics.rotation.x -= e.movementY * sensitivity;

                const maxPitch = Math.PI / 2 - 0.05;
                this.physics.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.physics.rotation.x));
            }
        });

        document.addEventListener('keydown', (e) => {
            const chatForm = document.getElementById('chat-form');
            const chatInput = document.getElementById('chat-input');
            const isChatOpen = chatForm && !chatForm.classList.contains('hidden');

            // BUGFIX: while the chat box is focused/open, typed characters (w/a/s/d, space,
            // number keys, h, etc.) must NOT leak into game hotkeys (movement, jump, hotbar, controls popup).
            if (isChatOpen && document.activeElement === chatInput) {
                // Prevent the native <form> submit-on-Enter default action, which was
                // reloading the page (and dumping the player back to the login screen)
                // instead of just sending the chat message.
                if (e.code === 'Enter') e.preventDefault();

                if (e.code === 'Enter') {
                    if (chatInput.value.trim()) {
                        this.net.sendChatMessage(chatInput.value.trim());
                        chatInput.value = '';
                    }
                    chatForm.classList.add('hidden');
                    this.canvas.requestPointerLock();
                } else if (e.code === 'Escape') {
                    chatInput.value = '';
                    chatForm.classList.add('hidden');
                    this.canvas.requestPointerLock();
                }
                return; // Swallow every other key while typing in chat
            }

            if (e.code === 'KeyW') this.physics.keys.forward = true;
            if (e.code === 'KeyS') this.physics.keys.backward = true;
            if (e.code === 'KeyA') this.physics.keys.left = true;
            if (e.code === 'KeyD') this.physics.keys.right = true;
            if (e.code === 'Space') this.physics.keys.jump = true;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.physics.keys.sneak = true;
            if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.physics.keys.sprint = true;

            if (e.key >= '1' && e.key <= '9') {
                this.selectSlot(parseInt(e.key));
            }

            // 'H' key toggles controls dropdown overlay
            if (e.code === 'KeyH') {
                toggleDropdown();
            }

            // 'F' key interacts with crafting table / furnace / water (fishing)
            if (e.code === 'KeyF') {
                this.inventory.handleInteract();
            }

            if (e.code === 'KeyT' || e.code === 'Enter') {
                if (chatForm.classList.contains('hidden')) {
                    chatForm.classList.remove('hidden');
                    chatInput.focus();
                    document.exitPointerLock();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            const chatInput = document.getElementById('chat-input');
            if (document.activeElement === chatInput) return;

            if (e.code === 'KeyW') this.physics.keys.forward = false;
            if (e.code === 'KeyS') this.physics.keys.backward = false;
            if (e.code === 'KeyA') this.physics.keys.left = false;
            if (e.code === 'KeyD') this.physics.keys.right = false;
            if (e.code === 'Space') this.physics.keys.jump = false;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.physics.keys.sneak = false;
            if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.physics.keys.sprint = false;
        });

        window.addEventListener('wheel', (e) => {
            if (document.pointerLockElement === this.canvas) {
                if (e.deltaY > 0) {
                    this.selectSlot((this.selectedSlot % 9) + 1);
                } else {
                    this.selectSlot(((this.selectedSlot - 2 + 9) % 9) + 1);
                }
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (document.pointerLockElement !== this.canvas) {
                this.canvas.requestPointerLock();
                sfx.init();
                return;
            }

            if (e.button === 0 && this.inventory.attemptAttack()) return;

            const target = this.physics.raycastTarget(6.0);
            if (target.hit) {
                if (e.button === 0) {
                    const { x, y, z } = target.targetBlock;
                    if (y <= 4) {
                        this.showToast('⚠️ 가장 바닥 지형은 파괴할 수 없습니다!');
                        return;
                    }
                    const MathX = Math.round(x);
                    const MathY = Math.round(y);
                    const MathZ = Math.round(z);
                    let brokenType = this.world.getBlock(MathX, MathY, MathZ);
                    if (!brokenType) brokenType = this.world.getBlock(x, y, z);

                    if (this.net.sendBlockChange(x, y, z, 0)) {
                        // Fallback to WOOD (4) if breaking a tree trunk block that was set via generator
                        if (!brokenType) brokenType = 4;
                        this.inventory.grantFromBlockBreak(brokenType);
                    }
                } else if (e.button === 2) {
                    const { x, y, z } = target.placeBlock;
                    const p = this.physics.position;
                    const minX = p.x - 0.3, maxX = p.x + 0.3;
                    const minY = p.y, maxY = p.y + 1.8;
                    const minZ = p.z - 0.3, maxZ = p.z + 0.3;

                    if (!(x >= Math.floor(minX) && x <= Math.floor(maxX) &&
                          y >= Math.floor(minY) && y <= Math.floor(maxY) &&
                          z >= Math.floor(minZ) && z <= Math.floor(maxZ))) {
                        this.net.sendBlockChange(x, y, z, this.selectedSlot);
                    }
                }
            }
        });

        this.canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Chat Form Submission Guard (defensive backstop against native form-submit/page-reload,
        // e.g. from mobile virtual keyboard "Send" actions that fire 'submit' directly)
        const chatFormEl = document.getElementById('chat-form');
        if (chatFormEl) {
            chatFormEl.addEventListener('submit', (e) => e.preventDefault());
        }

        // Login Form Submission
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const parcelPin = document.getElementById('parcel-pin').value.trim();
            const playerNum = parseInt(document.getElementById('selected-number').value || '1');

            if (username.length < 4) {
                const errDiv = document.getElementById('login-error');
                if (errDiv) {
                    errDiv.innerText = '⚠️ 방 아이디는 4글자 이상이어야 합니다.';
                    errDiv.classList.remove('hidden');
                }
                return;
            }
            if (username && password && parcelPin) {
                this.net.connect(username, password, parcelPin, playerNum);
            }
        });

        // Fullscreen Toggle Button Handler
        const fullscreenBtn = document.getElementById('btn-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                } else {
                    document.exitFullscreen().catch(() => {});
                }
            });
        }

        // Host Load Map Prompt Modal Buttons
        document.getElementById('btn-load-yes').addEventListener('click', () => {
            document.getElementById('host-modal').classList.add('hidden');
            this.net.sendHostLoadDecision(true);
            this.start();
        });

        document.getElementById('btn-load-no').addEventListener('click', () => {
            document.getElementById('host-modal').classList.add('hidden');
            this.net.sendHostLoadDecision(false);
            this.start();
        });

        // Hotbar Slot Click Selection
        document.querySelectorAll('.hotbar-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                this.selectSlot(parseInt(slot.dataset.slot));
            });
        });
    }

    showHostLoadModal() {
        document.getElementById('host-modal').classList.remove('hidden');
    }

    showToast(msg) {
        const toast = document.getElementById('toast-notify');
        if (!toast) return;
        toast.innerText = msg;
        toast.classList.remove('hidden');
        
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 3500);
    }

    selectSlot(slotNum) {
        this.selectedSlot = slotNum;
        document.querySelectorAll('.hotbar-slot').forEach(slot => {
            if (parseInt(slot.dataset.slot) === slotNum) {
                slot.classList.add('active');
            } else {
                slot.classList.remove('active');
            }
        });
    }

    addChatMessage(sender, text) {
        const history = document.getElementById('chat-history');
        if (!history) return;

        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `<span class="sender">${sender}:</span> <span>${text}</span>`;
        history.appendChild(div);

        history.scrollTop = history.scrollHeight;

        setTimeout(() => {
            if (div.parentNode) div.parentNode.removeChild(div);
        }, 10000);
    }

    start() {
        this.lastTime = performance.now();
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const now = performance.now();
        const delta = (now - this.lastTime) / 1000;
        this.lastTime = now;

        this.physics.update(delta);
        this.checkFallRecovery();

        if (this.viewmodelArm) {
            const isWalking = this.physics.keys.forward || this.physics.keys.backward || this.physics.keys.left || this.physics.keys.right;
            const swing = isWalking && this.physics.onGround ? Math.sin(this.physics.bobTimer) * 0.3 : 0;
            this.viewmodelArm.position.y = -0.42 + this.physics.currentBobOffset * 1.6;
            this.viewmodelArm.position.x = 0.32 + this.physics.currentBobOffset * 0.8;
            this.viewmodelArm.rotation.x = 0.35 + swing;
        }

        const eyePos = this.physics.getEyePosition();

        this.camera.rotation.order = 'YXZ';

        // Locked to First-Person View (Human Perspective)
        this.camera.position.copy(eyePos);
        this.camera.rotation.y = this.physics.rotation.y;
        this.camera.rotation.x = this.physics.rotation.x;

        const target = this.physics.raycastTarget(6.0);
        if (target.hit) {
            const { x, y, z } = target.targetBlock;
            this.targetBox.position.set(x + 0.5, y + 0.5, z + 0.5);
            this.targetBox.visible = true;
        } else {
            this.targetBox.visible = false;
        }

        this.net.updateRemotePlayers(delta);
        this.dayNight.update();
        this.entities.update(delta);
        this.inventory.tick(delta);

        this.renderer.render(this.scene, this.camera);
    }

    // ==================================================================
    // Character Customization (skin / shirt / pants / hairstyle / expression)
    // ==================================================================
    initCharacterCustomization() {
        const SKIN_COLORS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#3b2417'];
        const SHIRT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#f8fafc'];
        const PANTS_COLORS = ['#1e3a8a', '#374151', '#78350f', '#166534', '#111827', '#7c2d12'];
        const HAIRSTYLES = [
            { id: 'bald', label: '민머리' }, { id: 'short', label: '짧은머리' }, { id: 'long', label: '장발' },
            { id: 'ponytail', label: '포니테일' }, { id: 'mohawk', label: '모히칸' }
        ];
        const EXPRESSIONS = [
            { id: 'smile', label: '😊 미소' }, { id: 'neutral', label: '😐 무표정' }, { id: 'surprised', label: '😲 놀람' },
            { id: 'cool', label: '😎 쿨' }, { id: 'angry', label: '😠 화남' }
        ];

        this.appearance = { skin: SKIN_COLORS[0], shirt: SHIRT_COLORS[5], pants: PANTS_COLORS[0], hair: 'short', expression: 'smile' };
        try {
            const saved = localStorage.getItem('kmc_appearance');
            if (saved) this.appearance = Object.assign(this.appearance, JSON.parse(saved));
            delete this.appearance.hat; // legacy field, no longer used
        } catch (e) { /* ignore corrupt storage */ }

        const buildSwatchRow = (containerId, key, values, isColor) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';
            values.forEach((v) => {
                const el = document.createElement('div');
                el.className = isColor ? 'swatch' : 'swatch label-swatch';
                if (isColor) el.style.background = v;
                else el.innerText = v.label;
                const value = isColor ? v : v.id;
                if (this.appearance[key] === value) el.classList.add('selected');
                el.addEventListener('click', () => {
                    this.appearance[key] = value;
                    container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
                    el.classList.add('selected');
                    this.saveAndBroadcastAppearance();
                });
                container.appendChild(el);
            });
        };

        const btn = document.getElementById('btn-character');
        const modal = document.getElementById('character-modal');
        if (btn && modal) {
            btn.addEventListener('click', () => {
                modal.classList.remove('hidden');
                buildSwatchRow('swatch-skin', 'skin', SKIN_COLORS, true);
                buildSwatchRow('swatch-shirt', 'shirt', SHIRT_COLORS, true);
                buildSwatchRow('swatch-pants', 'pants', PANTS_COLORS, true);
                buildSwatchRow('swatch-hair', 'hair', HAIRSTYLES, false);
                buildSwatchRow('swatch-expression', 'expression', EXPRESSIONS, false);
            });
        }
        const closeBtn = document.getElementById('btn-close-character');
        if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    }

    saveAndBroadcastAppearance() {
        try { localStorage.setItem('kmc_appearance', JSON.stringify(this.appearance)); } catch (e) { /* ignore */ }
        this.net.sendAppearanceUpdate(this.appearance);
        this.updateViewmodelArmColor();
    }

    // Called once after login: if the player previously customized their look on this
    // browser, push it to the server; otherwise adopt whatever the server had saved.
    onLoginAppearance(serverAppearance) {
        let hadLocal = false;
        try { hadLocal = !!localStorage.getItem('kmc_appearance'); } catch (e) { /* ignore */ }
        if (hadLocal) {
            this.saveAndBroadcastAppearance();
        } else if (serverAppearance) {
            this.appearance = Object.assign(this.appearance, serverAppearance);
        }
        this.updateViewmodelArmColor();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.game = new MinecraftGame();
});
