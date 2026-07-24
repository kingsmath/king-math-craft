// Network Manager - Multiplayer WebSocket Protocol matching server.py EXACTLY
class NetworkManager {
    constructor(game) {
        this.game = game;
        this.ws = null;
        this.remotePlayers = new Map();
        this.username = '';
        this.parcelNumber = 1;
        this.myId = null;

        // Available Vibrant Shirt Colors for Random Avatar Clothes (fallback only)
        this.shirtColors = [
            0xef4444, 0xf97316, 0xf59e0b, 0x84cc16, 0x10b981, 0x06b6d4,
            0x3b82f6, 0x6366f1, 0x8b5cf6, 0xd946ef, 0xec4899, 0x14b8a6,
            0x0284c7, 0x7c3aed, 0xdb2777, 0xe11d48, 0x059669, 0xd97706
        ];
    }

    isExternalStaticHost() {
        const host = window.location.host;
        return host.includes('pages.dev') || host.includes('github.io') || host.includes('netlify.app') || host.includes('vercel.app');
    }

    getServerUrl() {
        const host = window.location.host;

        // If hosted on Cloudflare Pages (.pages.dev), GitHub Pages (.github.io), Netlify, or Vercel, connect to Render Python Backend!
        if (this.isExternalStaticHost()) {
            return 'wss://king-math-craft.onrender.com/ws';
        }

        if (!host || host.includes('localhost') || host.includes('127.0.0.1')) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${host || 'localhost:8000'}/ws`;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${host}/ws`;
    }

    getHttpBaseUrl() {
        const host = window.location.host;

        if (this.isExternalStaticHost()) {
            return 'https://king-math-craft.onrender.com';
        }
        if (!host || host.includes('localhost') || host.includes('127.0.0.1')) {
            const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
            return `${protocol}//${host || 'localhost:8000'}`;
        }
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        return `${protocol}//${host}`;
    }

    async checkRoomId(roomId) {
        const url = `${this.getHttpBaseUrl()}/api/check-room?id=${encodeURIComponent(roomId)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('check-room request failed');
        return res.json();
    }

    connect(username, password, parcelPin, playerNum) {
        this.username = username;
        this.password = password;
        this.parcelNumber = playerNum;
        this.game.physics.playerNumber = playerNum;

        document.getElementById('login-error').classList.add('hidden');
        const loginBtn = document.getElementById('btn-login');
        if (loginBtn) {
            loginBtn.innerText = '서버 연결 중...';
            loginBtn.disabled = true;
        }

        const serverUrl = this.getServerUrl();
        console.log(`[Network] Connecting to WebSocket URL: ${serverUrl}`);

        try {
            this.ws = new WebSocket(serverUrl);
        } catch (e) {
            this.showLoginError('서버 연결 실패: ' + e.message);
            return;
        }

        this.ws.onopen = () => {
            console.log('[Network] Connected to server successfully.');
            // Send exact login message matching server.py
            this.send({
                type: 'login',
                username: username,
                password: password,
                parcelPin: parcelPin,
                playerNumber: playerNum
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (err) {
                console.error('[Network] Message parse error:', err);
            }
        };

        this.ws.onerror = (err) => {
            console.error('[Network] WebSocket Error:', err);
            this.showLoginError('서버에 연결할 수 없습니다. (Render 클라우드 서버가 자고 있을 경우 깨어나는 데 20초 정도 소요됩니다.)');
        };

        this.ws.onclose = () => {
            console.log('[Network] Connection closed.');
            this.game.showToast('⚠️ 서버와의 연결이 끊어졌습니다.');
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    showLoginError(msg) {
        const errDiv = document.getElementById('login-error');
        const loginBtn = document.getElementById('btn-login');
        if (errDiv) {
            errDiv.innerText = msg;
            errDiv.classList.remove('hidden');
        }
        if (loginBtn) {
            loginBtn.innerText = '월드 입장하기';
            loginBtn.disabled = false;
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'login_res':
                if (!data.success) {
                    this.showLoginError(data.message || '로그인 실패');
                    return;
                }

                console.log('[Network] Login success! Session ID:', data.session_id);
                this.myId = data.session_id;

                // Update UI Room Info
                document.getElementById('login-modal').classList.add('hidden');
                document.getElementById('game-ui').classList.remove('hidden');
                document.getElementById('display-room-name').innerText = this.username;
                document.getElementById('display-my-number').innerText = `${this.parcelNumber}번`;

                // Load World Edits from server
                if (data.world_edits) {
                    Object.entries(data.world_edits).forEach(([key, blockType]) => {
                        const [x, y, z] = key.split(',').map(Number);
                        this.game.world.setBlock(x, y, z, blockType, false);
                    });
                    this.game.world.rebuildAllChunks();
                }

                // Render existing players
                if (data.existing_players) {
                    data.existing_players.forEach(pData => {
                        this.addOrUpdateRemotePlayer(pData.id, pData);
                    });
                }

                // Update player count badge
                const countBadge = document.getElementById('player-count-badge');
                if (countBadge) {
                    const total = (data.existing_players ? data.existing_players.length : 0) + 1;
                    countBadge.innerText = `${total} / 32`;
                }

                // Survival systems init: day/night clock, mobs, inventory, appearance, HP
                if (this.game.dayNight) this.game.dayNight.init(data.world_start_time, data.day_phase);
                if (this.game.entities && data.mobs) this.game.entities.updateFromList(data.mobs);
                if (this.game.inventory) {
                    this.game.inventory.applyServerInventory(data.inventory);
                    this.game.inventory.applyServerHp(data.hp, data.maxHp);
                }
                this.myAppearance = data.appearance || this.myAppearance;
                this.game.onLoginAppearance(data.appearance);

                // If host map load prompt required
                if (data.prompt_host_load) {
                    this.game.showHostLoadModal();
                } else {
                    this.game.start();
                }
                break;

            case 'player_joined':
                this.game.showToast(`🎮 [${data.player.player_number}번] 님이 입장하셨습니다!`);
                this.addOrUpdateRemotePlayer(data.player.id, data.player);
                break;

            case 'player_left':
                this.game.showToast(`🚪 [${data.display_name || data.id}] 님이 퇴장하셨습니다.`);
                this.removeRemotePlayer(data.id);
                break;

            case 'player_count':
                const badge = document.getElementById('player-count-badge');
                if (badge) badge.innerText = `${data.count} / ${data.max}`;
                break;

            case 'player_moved':
                if (data.id !== this.myId) {
                    this.addOrUpdateRemotePlayer(data.id, data);
                }
                break;

            case 'block_changed':
                this.game.world.setBlock(data.x, data.y, data.z, data.blockType);
                if (data.blockType === 0) sfx.playBreak();
                else sfx.playPlace();
                break;

            case 'block_denied':
                this.game.showToast(data.message || '⚠️ 수용할 수 없는 작업입니다.');
                break;

            case 'reload_world_edits':
                if (data.world_edits) {
                    Object.entries(data.world_edits).forEach(([key, blockType]) => {
                        const [x, y, z] = key.split(',').map(Number);
                        this.game.world.setBlock(x, y, z, blockType, false);
                    });
                    this.game.world.rebuildAllChunks();
                }
                if (data.msg) this.game.showToast(`📜 ${data.msg}`);
                break;

            case 'map_saved_notify':
                if (data.msg) this.game.showToast(`💾 ${data.msg}`);
                break;

            case 'chat_msg':
                this.game.addChatMessage(data.sender, data.text);
                break;

            case 'day_phase_changed':
                if (this.game.dayNight) this.game.dayNight.onServerPhaseChanged(data.phase, data.world_start_time);
                break;

            case 'entity_update':
                if (this.game.entities) this.game.entities.updateFromList(data.mobs);
                break;

            case 'entity_removed':
                if (this.game.entities) this.game.entities.removeMany(data.ids, data.reason);
                break;

            case 'world_edits_batch':
                if (data.edits) {
                    Object.entries(data.edits).forEach(([key, blockType]) => {
                        const [x, y, z] = key.split(',').map(Number);
                        this.game.world.setBlock(x, y, z, blockType, false);
                    });
                    this.game.world.rebuildAllChunks();
                }
                break;

            case 'player_hp':
                if (this.game.inventory) this.game.inventory.applyServerHp(data.hp, data.maxHp);
                break;

            case 'player_died':
                if (this.game.inventory) this.game.inventory.onPlayerDied(data.respawn);
                break;

            case 'attack_result':
                if (!data.hit && data.reason) this.game.showToast(`⚔️ ${data.reason}`);
                break;

            case 'inventory_sync':
                if (this.game.inventory) this.game.inventory.applyServerInventory(data.inventory);
                break;

            case 'appearance_changed':
                this.updateRemotePlayerAppearance(data.id, data.appearance);
                break;
        }
    }

    // Nearest remote player hit by the crosshair ray, used for PVP melee targeting
    raycastNearestPlayer(eye, dir, maxDist) {
        const targets = [];
        this.remotePlayers.forEach((rp, id) => {
            targets.push({ id, x: rp.group.position.x, y: rp.group.position.y + 0.9, z: rp.group.position.z });
        });
        const hit = raySphereHitTest(eye, dir, targets, maxDist, 0.6);
        return hit ? hit.id : null;
    }

    // Appearance changes (skin/hair/face/etc.) alter geometry, not just color, so the simplest
    // reliable approach is to rebuild the whole character mesh rather than patch it piecemeal.
    updateRemotePlayerAppearance(id, appearance) {
        const rp = this.remotePlayers.get(id);
        if (!rp || !appearance) return;
        const oldGroup = rp.group;
        const newGroup = this.createPlayerMesh(rp.playerNumber || 1, id, appearance);
        newGroup.position.copy(oldGroup.position);
        newGroup.rotation.y = oldGroup.rotation.y;
        this.game.scene.remove(oldGroup);
        this.game.scene.add(newGroup);
        rp.group = newGroup;
    }

    sendBlockChange(x, y, z, blockType) {
        // Enforce Parcel Ownership Rule
        const targetParcel = this.game.world.getParcelNumber(x, z);

        if (targetParcel !== 0 && targetParcel !== this.parcelNumber) {
            this.game.showToast(`⛔ [${targetParcel}번 땅] 남의 땅에는 블록을 설치/파괴할 수 없습니다!`);
            return;
        }

        // Local instant update
        this.game.world.setBlock(x, y, z, blockType);

        // Send to server (matching server.py format)
        this.send({
            type: 'block_change',
            x: x,
            y: y,
            z: z,
            blockType: blockType
        });

        if (blockType === 0) sfx.playBreak();
        else sfx.playPlace();
    }

    sendSaveMapRequest() {
        this.send({
            type: 'save_map'
        });
    }

    sendHostLoadDecision(loadSavedMap) {
        this.send({
            type: 'host_load_decision',
            load: loadSavedMap
        });
    }

    sendChatMessage(text) {
        this.send({
            type: 'chat',
            text: text
        });
    }

    sendAppearanceUpdate(appearance) {
        this.myAppearance = appearance;
        this.send({ type: 'appearance_update', appearance });
    }

    sendPosition() {
        if (!this.myId) return;
        const pos = this.game.physics.position;
        const rot = this.game.physics.rotation;
        this.send({
            type: 'player_state',
            x: pos.x,
            y: pos.y,
            z: pos.z,
            rotX: rot.x,
            rotY: rot.y,
            isMoving: this.game.physics.keys.forward || this.game.physics.keys.backward || this.game.physics.keys.left || this.game.physics.keys.right,
            selectedSlot: this.game.selectedSlot
        });
    }

    addOrUpdateRemotePlayer(id, pData) {
        if (id === this.myId) return;

        if (!this.remotePlayers.has(id)) {
            const meshGroup = this.createPlayerMesh(pData.player_number || 1, id, pData.appearance);
            meshGroup.position.set(pData.x || 0, pData.y || 10.0, pData.z || 0);
            this.game.scene.add(meshGroup);
            this.remotePlayers.set(id, {
                group: meshGroup,
                targetPos: new THREE.Vector3(pData.x || 0, pData.y || 10.0, pData.z || 0),
                targetRotY: pData.rotY || 0,
                playerNumber: pData.player_number || 1,
                isMoving: pData.isMoving || false,
                walkTime: 0
            });
        } else {
            const rp = this.remotePlayers.get(id);
            if (pData.x !== undefined) rp.targetPos.set(pData.x, pData.y, pData.z);
            if (pData.rotY !== undefined) rp.targetRotY = pData.rotY;
            if (pData.isMoving !== undefined) rp.isMoving = pData.isMoving;
            if (pData.appearance) this.updateRemotePlayerAppearance(id, pData.appearance);
        }
    }

    // A limb is a pivot Group positioned at the joint (shoulder/hip) with its box mesh hanging
    // below, so rotating the pivot swings the limb around the joint instead of its own center.
    createLimbPivot(w, h, d, color, jointX, jointY, jointZ) {
        const pivot = new THREE.Group();
        pivot.position.set(jointX, jointY, jointZ);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
        mesh.position.y = -h / 2;
        pivot.add(mesh);
        return pivot;
    }

    // Small pixel-art face drawn onto a canvas, used as the head's -Z (front) face texture.
    createFaceTexture(skinColor, expression) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = '#1f2937';
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';

        switch (expression) {
            case 'neutral':
                ctx.fillRect(9, 13, 3, 3);
                ctx.fillRect(20, 13, 3, 3);
                ctx.beginPath(); ctx.moveTo(11, 22); ctx.lineTo(21, 22); ctx.stroke();
                break;
            case 'surprised':
                ctx.beginPath(); ctx.arc(10.5, 14.5, 2.2, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(21.5, 14.5, 2.2, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(16, 22, 3, 0, Math.PI * 2); ctx.stroke();
                break;
            case 'cool':
                ctx.fillRect(7, 14, 6, 2);
                ctx.fillRect(19, 13, 4, 4);
                ctx.beginPath(); ctx.moveTo(11, 22); ctx.quadraticCurveTo(16, 19, 21, 21); ctx.stroke();
                break;
            case 'angry':
                ctx.beginPath(); ctx.moveTo(7, 12); ctx.lineTo(13, 14); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(25, 12); ctx.lineTo(19, 14); ctx.stroke();
                ctx.fillRect(9, 15, 3, 3);
                ctx.fillRect(20, 15, 3, 3);
                ctx.beginPath(); ctx.moveTo(11, 23); ctx.quadraticCurveTo(16, 20, 21, 23); ctx.stroke();
                break;
            case 'smile':
            default:
                ctx.fillRect(9, 13, 3, 3);
                ctx.fillRect(20, 13, 3, 3);
                ctx.beginPath(); ctx.arc(16, 18, 5, 0, Math.PI); ctx.stroke();
                break;
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        return texture;
    }

    // 5 simple geometric hairstyles built from a few boxes on top of / behind the head.
    addHairstyle(group, style) {
        if (!style || style === 'bald') return;
        const hairMat = new THREE.MeshStandardMaterial({ color: 0x2d1b12 });
        const headTop = 1.75;
        const headBackZ = 0.25; // face is -Z, so back of the head is +Z

        if (style === 'short' || style === 'long' || style === 'ponytail') {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), hairMat);
            cap.position.set(0, headTop + 0.07, 0);
            group.add(cap);
        }
        if (style === 'long') {
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.55, 0.12), hairMat);
            back.position.set(0, 1.55, headBackZ + 0.06);
            group.add(back);
        }
        if (style === 'ponytail') {
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.4), hairMat);
            tail.position.set(0, 1.8, headBackZ + 0.2);
            tail.rotation.x = -0.35;
            group.add(tail);
        }
        if (style === 'mohawk') {
            const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.52), hairMat);
            ridge.position.set(0, headTop + 0.15, 0);
            group.add(ridge);
        }
    }

    // Create 3D Minecraft Humanoid Character, colored/shaped per the player's chosen appearance
    createPlayerMesh(parcelNum, id, appearance) {
        const group = new THREE.Group();

        const colorIndex = (typeof id === 'string' ? id.charCodeAt(id.length - 1) : parcelNum) % this.shirtColors.length;
        const skinColor = (appearance && appearance.skin) || '#ffdbac';
        const shirtColor = (appearance && appearance.shirt) || this.shirtColors[colorIndex];
        const pantsColor = (appearance && appearance.pants) || 0x1e3a8a;
        const hairStyle = (appearance && appearance.hair) || 'short';
        const expression = (appearance && appearance.expression) || 'smile';

        // Head - a plain skin material on 5 faces, a drawn face texture on the front (-Z) face
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
        const faceMat = new THREE.MeshStandardMaterial({ map: this.createFaceTexture(skinColor, expression) });
        const head = new THREE.Mesh(headGeo, [skinMat, skinMat, skinMat, skinMat, skinMat, faceMat]);
        head.position.y = 1.5;
        group.add(head);

        this.addHairstyle(group, hairStyle);

        // Arms (skin-colored, pivoting from the shoulder)
        const leftArm = this.createLimbPivot(0.2, 0.65, 0.2, skinColor, -0.35, 1.245, 0);
        const rightArm = this.createLimbPivot(0.2, 0.65, 0.2, skinColor, 0.35, 1.245, 0);
        group.add(leftArm, rightArm);

        // Body (Shirt)
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
        const bodyMat = new THREE.MeshStandardMaterial({ color: shirtColor });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.9;
        group.add(body);

        // Legs (Pants), pivoting from the hip
        const leftLeg = this.createLimbPivot(0.22, 0.65, 0.22, pantsColor, -0.13, 0.65, 0);
        const rightLeg = this.createLimbPivot(0.22, 0.65, 0.22, pantsColor, 0.13, 0.65, 0);
        group.add(leftLeg, rightLeg);

        group.userData = { head, body, legs: [leftLeg, rightLeg], arms: [leftArm, rightArm] };

        // 3D Nickname Tag above head
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`🚩 ${parcelNum}번 플레이어`, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const nameMat = new THREE.SpriteMaterial({ map: texture });
        const nameSprite = new THREE.Sprite(nameMat);
        nameSprite.position.y = 2.15; // cleared above the tallest hairstyle (mohawk)
        nameSprite.scale.set(2, 0.5, 1);
        group.add(nameSprite);

        return group;
    }

    removeRemotePlayer(id) {
        if (this.remotePlayers.has(id)) {
            const rp = this.remotePlayers.get(id);
            this.game.scene.remove(rp.group);
            this.remotePlayers.delete(id);
        }
    }

    updateRemotePlayers(delta) {
        // Send local player position every 50ms
        const now = performance.now();
        if (!this.lastSendTime || now - this.lastSendTime > 50) {
            this.sendPosition();
            this.lastSendTime = now;
        }

        // Smooth Lerp Interpolation for Remote Players
        this.remotePlayers.forEach((rp) => {
            rp.group.position.lerp(rp.targetPos, delta * 12.0);
            rp.group.rotation.y = rp.targetRotY;

            // Walk-cycle arm/leg swing while moving
            rp.walkTime = rp.isMoving ? (rp.walkTime || 0) + delta * 9.0 : 0;
            const swing = Math.sin(rp.walkTime) * 0.55;
            const ud = rp.group.userData;
            if (ud && ud.legs) {
                ud.legs[0].rotation.x = swing;
                ud.legs[1].rotation.x = -swing;
            }
            if (ud && ud.arms) {
                ud.arms[0].rotation.x = -swing;
                ud.arms[1].rotation.x = swing;
            }
        });
    }
}
