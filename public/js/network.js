// Network Manager - Multiplayer WebSocket Protocol matching server.py EXACTLY
class NetworkManager {
    constructor(game) {
        this.game = game;
        this.ws = null;
        this.remotePlayers = new Map();
        this.username = '';
        this.parcelNumber = 1;
        this.myId = null;
        
        // Available Vibrant Shirt Colors for Random Avatar Clothes
        this.shirtColors = [
            0xef4444, 0xf97316, 0xf59e0b, 0x84cc16, 0x10b981, 0x06b6d4,
            0x3b82f6, 0x6366f1, 0x8b5cf6, 0xd946ef, 0xec4899, 0x14b8a6,
            0x0284c7, 0x7c3aed, 0xdb2777, 0xe11d48, 0x059669, 0xd97706
        ];
    }

    getServerUrl() {
        const host = window.location.host;

        // If hosted on Cloudflare Pages (.pages.dev), GitHub Pages (.github.io), Netlify, or Vercel, connect to Render Python Backend!
        if (host.includes('pages.dev') || host.includes('github.io') || host.includes('netlify.app') || host.includes('vercel.app')) {
            return 'wss://king-math-craft.onrender.com/ws';
        }

        if (!host || host.includes('localhost') || host.includes('127.0.0.1')) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${host || 'localhost:8000'}/ws`;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${host}/ws`;
    }

    connect(username, password, parcelPin, playerNum) {
        this.username = username;
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
                document.getElementById('display-room-name').innerText = `방: ${this.username}`;
                document.getElementById('display-my-number').innerText = `내 번호: ${this.parcelNumber}번`;

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
        }
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
            const meshGroup = this.createPlayerMesh(pData.player_number || 1, id);
            meshGroup.position.set(pData.x || 0, pData.y || 5.0, pData.z || 0);
            this.game.scene.add(meshGroup);
            this.remotePlayers.set(id, {
                group: meshGroup,
                targetPos: new THREE.Vector3(pData.x || 0, pData.y || 5.0, pData.z || 0),
                targetRotY: pData.rotY || 0
            });
        } else {
            const rp = this.remotePlayers.get(id);
            if (pData.x !== undefined) rp.targetPos.set(pData.x, pData.y, pData.z);
            if (pData.rotY !== undefined) rp.targetRotY = pData.rotY;
        }
    }

    // Create 3D Minecraft Humanoid Character with Random Clothes Color
    createPlayerMesh(parcelNum, id) {
        const group = new THREE.Group();

        // Pick Random Shirt Color for Clothes based on Player ID / Parcel Number
        const colorIndex = (typeof id === 'string' ? id.charCodeAt(id.length - 1) : parcelNum) % this.shirtColors.length;
        const shirtColor = this.shirtColors[colorIndex];
        const pantsColor = 0x1e3a8a; // Dark Blue Jeans

        // Head
        const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.5;
        group.add(head);

        // Body (Shirt with Random Color!)
        const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
        const bodyMat = new THREE.MeshStandardMaterial({ color: shirtColor });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.9;
        group.add(body);

        // Legs (Pants)
        const legGeo = new THREE.BoxGeometry(0.22, 0.65, 0.22);
        const legMat = new THREE.MeshStandardMaterial({ color: pantsColor });
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.13, 0.325, 0);
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.13, 0.325, 0);
        group.add(leftLeg);
        group.add(rightLeg);

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
        nameSprite.position.y = 2.0;
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
        });
    }
}
