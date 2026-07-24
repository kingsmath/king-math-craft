// 3D Voxel Engine & World Generator for 킹수학크래프트 (15x15 Parcels, 4 Corner Living Rooms, Active Touch Joystick)
class VoxelWorld {
    constructor(scene) {
        this.scene = scene;
        this.worldSize = 160; // 160x160 blocks (-80 to 79)
        this.blocks = new Map();
        
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

    setBlock(x, y, z, blockType, rebuild = true) {
        const key = this.getKey(x, y, z);
        if (blockType === 0) {
            this.blocks.delete(key);
        } else {
            this.blocks.set(key, blockType);
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
            else if (30 <= z && z <= 44) return 26;
            else if (15 <= z && z <= 29) return 27;
            else if (0 <= z && z <= 14) return 28;
            else if (-15 <= z && z <= -1) return 29;
            else if (-30 <= z && z <= -16) return 30;
            else if (-45 <= z && z <= -31) return 31;
            else if (-60 <= z && z <= -46) return 32;
        }

        return 0;
    }

    // Completely Flat World Generation (Y = 4 Flat Everywhere, Green Living Room)
    generateWorld() {
        const half = 80;
        const groundHeight = 4;

        for (let x = -half; x < half; x++) {
            for (let z = -half; z < half; z++) {
                const parcel = this.getParcelNumber(x, z);

                for (let y = 0; y <= groundHeight; y++) {
                    if (y === groundHeight) {
                        if (parcel === 0) {
                            // Green Living Room Plaza (녹색 거실)
                            this.blocks.set(this.getKey(x, y, z), 10);
                        } else {
                            // 32 Distinct Parcel Colored Floor
                            this.blocks.set(this.getKey(x, y, z), 100 + parcel);
                        }
                    } else if (y === 0) {
                        this.blocks.set(this.getKey(x, y, z), 3); // Bedrock/Stone
                    } else {
                        this.blocks.set(this.getKey(x, y, z), 1); // Dirt
                    }
                }

                // Glowing Border Glowstones at Center Plaza Perimeter (-60, 59)
                if (((x === -60 || x === 59) && (z >= -60 && z <= 59)) || ((z === -60 || z === 59) && (x >= -60 && x <= 59))) {
                    if (parcel !== 0) {
                        this.blocks.set(this.getKey(x, groundHeight, z), 8);
                    }
                }
            }
        }

        this.createParcelSignposts(groundHeight);
        this.rebuildAllChunks();
    }

    createParcelSignposts(groundHeight) {
        // Signposts placed right at entrance facing the Central Living Room!
        const signPositions = [
            // North Side (Facing South)
            { num: 1, x: -53, z: -60 }, { num: 2, x: -38, z: -60 }, { num: 3, x: -23, z: -60 }, { num: 4, x: -8, z: -60 },
            { num: 5, x: 7, z: -60 },   { num: 6, x: 22, z: -60 },  { num: 7, x: 37, z: -60 },  { num: 8, x: 52, z: -60 },
            
            // East Side (Facing West)
            { num: 9, x: 59, z: -53 },  { num: 10, x: 59, z: -38 }, { num: 11, x: 59, z: -23 }, { num: 12, x: 59, z: -8 },
            { num: 13, x: 59, z: 7 },   { num: 14, x: 59, z: 22 },  { num: 15, x: 59, z: 37 },  { num: 16, x: 59, z: 52 },

            // South Side (Facing North)
            { num: 17, x: 52, z: 59 },  { num: 18, x: 37, z: 59 },  { num: 19, x: 22, z: 59 },  { num: 20, x: 7, z: 59 },
            { num: 21, x: -8, z: 59 },  { num: 22, x: -23, z: 59 }, { num: 23, x: -38, z: 59 }, { num: 24, x: -53, z: 59 },

            // West Side (Facing East)
            { num: 25, x: -60, z: 52 }, { num: 26, x: -60, z: 37 }, { num: 27, x: -60, z: 22 }, { num: 28, x: -60, z: 7 },
            { num: 29, x: -60, z: -8 }, { num: 30, x: -60, z: -23 },{ num: 31, x: -60, z: -38 },{ num: 32, x: -60, z: -53 }
        ];

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

            this.signGroup.add(signMesh);
        });

        this.scene.add(this.signGroup);
    }

    rebuildAllChunks() {
        if (this.chunkGroup) {
            this.scene.remove(this.chunkGroup);
        }

        this.chunkGroup = new THREE.Group();
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);

        this.blocks.forEach((type, key) => {
            const [x, y, z] = key.split(',').map(Number);

            const isExposed = (
                this.getBlock(x + 1, y, z) === 0 ||
                this.getBlock(x - 1, y, z) === 0 ||
                this.getBlock(x, y + 1, z) === 0 ||
                this.getBlock(x, y - 1, z) === 0 ||
                this.getBlock(x, y, z + 1) === 0 ||
                this.getBlock(x, y, z - 1) === 0
            );

            if (!isExposed) return;

            let mat;
            if (type > 100) {
                mat = this.parcelMaterials.get(type);
            } else {
                mat = this.materials[type];
            }

            if (mat) {
                const mesh = new THREE.Mesh(boxGeo, mat);
                mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
                this.chunkGroup.add(mesh);
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
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;

        this.selectedSlot = 1;
        this.cameraMode = 0; // 0: First-Person, 1: Third-Person Back, 2: Third-Person Front

        // Touch Drag Camera Vars
        this.touchPreviousX = 0;
        this.touchPreviousY = 0;

        // Modules
        this.world = new VoxelWorld(this.scene);
        this.physics = new PlayerPhysics(this.world);
        this.net = new NetworkManager(this);

        const wireGeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });
        this.targetBox = new THREE.Mesh(wireGeo, wireMat);
        this.targetBox.visible = false;
        this.scene.add(this.targetBox);

        this.initLighting();
        this.initNumberGridSelector();
        this.initEventListeners();
        this.initActiveTouchJoystick();
    }

    initLighting() {
        this.scene.background = new THREE.Color(0x78a7ff);
        this.scene.fog = new THREE.FogExp2(0x78a7ff, 0.015);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        this.scene.add(hemiLight);

        this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
        this.sun.position.set(50, 100, 50);
        this.sun.castShadow = true;
        this.scene.add(this.sun);
    }

    initNumberGridSelector() {
        const grid = document.getElementById('number-grid');
        if (!grid) return;
        grid.innerHTML = '';

        for (let i = 1; i <= 32; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `num-btn ${i === 1 ? 'selected' : ''}`;
            btn.innerText = `${i}번`;
            btn.dataset.num = i;

            btn.addEventListener('click', () => {
                document.querySelectorAll('.num-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                document.getElementById('selected-number').value = i;
            });

            grid.appendChild(btn);
        }
    }

    // Active Movable Dynamic Touch Joystick Implementation
    initActiveTouchJoystick() {
        const container = document.getElementById('joystick-container');
        const knob = document.getElementById('joystick-knob');
        if (!container || !knob) return;

        let activeTouchId = null;
        let baseRect = null;
        let centerX = 0;
        let centerY = 0;
        const maxRadius = 45; // Max knob drag radius in pixels

        const handleStart = (e) => {
            if (activeTouchId !== null) return;
            const touch = e.changedTouches ? e.changedTouches[0] : e;
            activeTouchId = touch.identifier !== undefined ? touch.identifier : 'mouse';
            
            baseRect = container.getBoundingClientRect();
            centerX = baseRect.left + baseRect.width / 2;
            centerY = baseRect.top + baseRect.height / 2;

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

            // Auto Sprint if pushed past 80% radius
            this.physics.keys.sprint = dist / maxRadius > 0.8;
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

            this.physics.keys.forward = false;
            this.physics.keys.backward = false;
            this.physics.keys.left = false;
            this.physics.keys.right = false;
            this.physics.keys.sprint = false;
        };

        container.addEventListener('touchstart', handleStart);
        window.addEventListener('touchmove', handleMove);
        window.addEventListener('touchend', handleEnd);
        window.addEventListener('touchcancel', handleEnd);

        // Desktop mouse support for testing active joystick
        container.addEventListener('mousedown', handleStart);
        window.addEventListener('mousemove', (e) => {
            if (activeTouchId === 'mouse') handleMove(e);
        });
        window.addEventListener('mouseup', (e) => {
            if (activeTouchId === 'mouse') handleEnd(e);
        });

        // Break Block Button
        const breakBtn = document.getElementById('btn-touch-break');
        if (breakBtn) {
            breakBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const target = this.physics.raycastTarget(6.0);
                if (target.hit) {
                    const { x, y, z } = target.targetBlock;
                    this.net.sendBlockChange(x, y, z, 0);
                }
            });
        }

        // Place Block Button
        const placeBtn = document.getElementById('btn-touch-place');
        if (placeBtn) {
            placeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const target = this.physics.raycastTarget(6.0);
                if (target.hit) {
                    const { x, y, z } = target.placeBlock;
                    this.net.sendBlockChange(x, y, z, this.selectedSlot);
                }
            });
        }

        // Jump Button
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

        // Camera Switch Button
        const camBtn = document.getElementById('btn-touch-cam');
        if (camBtn) {
            camBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.cameraMode = (this.cameraMode + 1) % 3;
            });
        }

        // Touch Drag for Camera Rotation on Canvas
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                this.touchPreviousX = e.touches[0].clientX;
                this.touchPreviousY = e.touches[0].clientY;
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                const touchX = e.touches[0].clientX;
                const touchY = e.touches[0].clientY;

                const deltaX = touchX - this.touchPreviousX;
                const deltaY = touchY - this.touchPreviousY;

                const sensitivity = 0.004;
                this.physics.rotation.y -= deltaX * sensitivity;
                this.physics.rotation.x -= deltaY * sensitivity;

                const maxPitch = Math.PI / 2 - 0.05;
                this.physics.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this.physics.rotation.x));

                this.touchPreviousX = touchX;
                this.touchPreviousY = touchY;
            }
        });
    }

    initEventListeners() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

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

            if (e.code === 'F5') {
                e.preventDefault();
                this.cameraMode = (this.cameraMode + 1) % 3;
            }

            if (e.code === 'KeyT' || e.code === 'Enter') {
                const chatForm = document.getElementById('chat-form');
                const chatInput = document.getElementById('chat-input');
                if (chatForm.classList.contains('hidden')) {
                    chatForm.classList.remove('hidden');
                    chatInput.focus();
                    document.exitPointerLock();
                } else if (e.code === 'Enter' && chatInput.value.trim()) {
                    this.net.sendChatMessage(chatInput.value.trim());
                    chatInput.value = '';
                    chatForm.classList.add('hidden');
                    this.canvas.requestPointerLock();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
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

            const target = this.physics.raycastTarget(6.0);
            if (target.hit) {
                if (e.button === 0) {
                    const { x, y, z } = target.targetBlock;
                    this.net.sendBlockChange(x, y, z, 0);
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

        // Login Form Submission
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const parcelPin = document.getElementById('parcel-pin').value.trim();
            const playerNum = parseInt(document.getElementById('selected-number').value || '1');
            if (username && password && parcelPin) {
                this.net.connect(username, password, parcelPin, playerNum);
            }
        });

        // Save Map Button Handler
        document.getElementById('btn-save-map').addEventListener('click', () => {
            this.net.sendSaveMapRequest();
        });

        // Download Map File Button Handler
        document.getElementById('btn-download-map').addEventListener('click', () => {
            this.downloadMapFile();
        });

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

    downloadMapFile() {
        const roomName = this.net.username || '수학방';
        const mapData = {
            room_id: roomName,
            saved_at: new Date().toISOString(),
            blocks: Object.fromEntries(this.world.blocks)
        };

        const jsonStr = JSON.stringify(mapData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `킹수학크래프트_지도_${roomName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast(`📥 [${roomName}] 지도가 파일로 다운로드되었습니다!`);
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

        const eyePos = this.physics.getEyePosition();

        this.camera.rotation.order = 'YXZ';

        if (this.cameraMode === 0) {
            // First-Person View
            this.camera.position.copy(eyePos);
            this.camera.rotation.y = this.physics.rotation.y;
            this.camera.rotation.x = this.physics.rotation.x;
        } else if (this.cameraMode === 1) {
            // Third-Person Back View
            const lookDir = this.physics.getLookVector();
            const camPos = eyePos.clone().sub(lookDir.clone().multiplyScalar(4.0));
            this.camera.position.copy(camPos);
            this.camera.rotation.y = this.physics.rotation.y;
            this.camera.rotation.x = this.physics.rotation.x;
        } else if (this.cameraMode === 2) {
            // Third-Person Front View
            const lookDir = this.physics.getLookVector();
            const camPos = eyePos.clone().add(lookDir.clone().multiplyScalar(4.0));
            this.camera.position.copy(camPos);
            this.camera.lookAt(eyePos);
        }

        const target = this.physics.raycastTarget(6.0);
        if (target.hit) {
            const { x, y, z } = target.targetBlock;
            this.targetBox.position.set(x + 0.5, y + 0.5, z + 0.5);
            this.targetBox.visible = true;
        } else {
            this.targetBox.visible = false;
        }

        this.net.updateRemotePlayers(delta);

        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.game = new MinecraftGame();
});
