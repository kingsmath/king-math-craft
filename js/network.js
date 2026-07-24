// WebSocket Network Manager for 킹수학크래프트 (Number PIN Auth Supported)
class NetworkManager {
    constructor(game) {
        this.game = game;
        this.ws = null;
        this.connected = false;
        this.sessionId = null;
        this.username = "";
        this.displayName = "";
        this.playerNumber = 1;
        this.isHost = false;
        this.otherPlayers = new Map();
        
        this.sendStateTimer = null;
    }

    connect(username, password, parcelPin, playerNumber, customServerUrl = "") {
        this.username = username;
        this.playerNumber = playerNumber;
        
        let wsUrl = customServerUrl ? customServerUrl.trim() : "";

        if (!wsUrl) {
            // Default Render Production Server WebSocket Address
            wsUrl = "wss://king-math-craft.onrender.com/ws";
        }

        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
            const isSecure = window.location.protocol === 'https:' || wsUrl.includes('onrender.com');
            const scheme = isSecure ? 'wss:' : 'ws:';
            wsUrl = `${scheme}//${wsUrl.replace(/^https?:\/\//, '')}`;
        }

        console.log(`[NET] Connecting to WebSocket server: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[NET] Connected to server. Sending login request...');
            this.ws.send(JSON.stringify({
                type: 'login',
                username: username,
                password: password,
                parcelPin: parcelPin,
                playerNumber: playerNumber
            }));
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (err) {
                console.error('[NET] Message parse error:', err);
            }
        };

        this.ws.onerror = (err) => {
            console.error('[NET] WebSocket error:', err);
            this.showError('서버 연결 실패 (게임 서버 연결을 확인하세요)');
        };

        this.ws.onclose = () => {
            console.log('[NET] Disconnected from server.');
            this.connected = false;
            if (this.sendStateTimer) clearInterval(this.sendStateTimer);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'login_res':
                if (data.success) {
                    this.connected = true;
                    this.sessionId = data.session_id;
                    this.displayName = data.display_name;
                    this.playerNumber = data.player_number;
                    this.isHost = data.is_host;

                    this.game.physics.playerNumber = this.playerNumber;

                    document.getElementById('display-room-name').innerText = `방: ${data.room_id}`;
                    document.getElementById('display-my-number').innerText = `내 번호: ${this.playerNumber}번`;

                    document.getElementById('login-modal').classList.add('hidden');
                    document.getElementById('game-ui').classList.remove('hidden');

                    if (data.world_edits) {
                        for (const [key, blockType] of Object.entries(data.world_edits)) {
                            const [x, y, z] = key.split(',').map(Number);
                            this.game.world.setBlock(x, y, z, blockType, false);
                        }
                        this.game.world.rebuildAllChunks();
                    }

                    if (data.existing_players) {
                        data.existing_players.forEach(p => this.addRemotePlayer(p));
                    }

                    if (data.prompt_host_load) {
                        this.game.showHostLoadModal();
                    } else {
                        this.game.start();
                    }

                    this.sendStateTimer = setInterval(() => this.sendPlayerState(), 33);
                } else {
                    this.showError(data.message || '로그인에 실패했습니다.');
                }
                break;

            case 'reload_world_edits':
                if (data.world_edits) {
                    for (const [key, blockType] of Object.entries(data.world_edits)) {
                        const [x, y, z] = key.split(',').map(Number);
                        this.game.world.setBlock(x, y, z, blockType, false);
                    }
                    this.game.world.rebuildAllChunks();
                    if (data.msg) this.game.showToast(`📜 ${data.msg}`);
                }
                break;

            case 'map_saved_notify':
                if (data.msg) this.game.showToast(`💾 ${data.msg}`);
                break;

            case 'block_denied':
                if (data.message) this.game.showToast(`⛔ ${data.message}`);
                break;

            case 'player_joined':
                if (data.player && data.player.id !== this.sessionId) {
                    this.addRemotePlayer(data.player);
                    this.game.addChatMessage('시스템', `${data.player.display_name}님이 입장에 성공했습니다.`);
                }
                break;

            case 'player_left':
                this.removeRemotePlayer(data.id, data.display_name);
                break;

            case 'player_moved':
                if (data.id !== this.sessionId && this.otherPlayers.has(data.id)) {
                    const p = this.otherPlayers.get(data.id);
                    p.targetPos.set(data.x, data.y, data.z);
                    p.targetRotY = data.rotY;
                    p.isMoving = data.isMoving;
                }
                break;

            case 'block_changed':
                this.game.world.setBlock(data.x, data.y, data.z, data.blockType, true);
                if (data.blockType === 0) sfx.playBlockBreak();
                else sfx.playBlockPlace();
                break;

            case 'chat_msg':
                this.game.addChatMessage(data.sender, data.text);
                break;

            case 'player_count':
                const badge = document.getElementById('player-count-badge');
                if (badge) badge.innerText = `${data.count} / ${data.max}`;
                break;
        }
    }

    sendHostLoadDecision(load) {
        if (!this.connected || !this.ws) return;
        this.ws.send(JSON.stringify({
            type: 'host_load_decision',
            load: load
        }));
    }

    sendSaveMapRequest() {
        if (!this.connected || !this.ws) return;
        this.ws.send(JSON.stringify({
            type: 'save_map'
        }));
    }

    sendPlayerState() {
        if (!this.connected || !this.ws) return;

        const physics = this.game.physics;
        this.ws.send(JSON.stringify({
            type: 'player_state',
            x: physics.position.x,
            y: physics.position.y,
            z: physics.position.z,
            rotX: physics.rotation.x,
            rotY: physics.rotation.y,
            isMoving: physics.velocity.lengthSq() > 0.1,
            selectedSlot: this.game.selectedSlot
        }));
    }

    sendBlockChange(x, y, z, blockType) {
        if (!this.connected || !this.ws) return;
        this.ws.send(JSON.stringify({
            type: 'block_change',
            x: x,
            y: y,
            z: z,
            blockType: blockType
        }));
    }

    sendChatMessage(text) {
        if (!this.connected || !this.ws) return;
        this.ws.send(JSON.stringify({
            type: 'chat',
            text: text
        }));
    }

    addRemotePlayer(playerData) {
        const group = new THREE.Group();

        const shirtMat = new THREE.MeshLambertMaterial({ color: 0x00a8a8 });
        const pantsMat = new THREE.MeshLambertMaterial({ color: 0x000080 });
        const skinMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });

        const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const headMesh = new THREE.Mesh(headGeo, skinMat);
        headMesh.position.y = 1.5;
        group.add(headMesh);

        const bodyGeo = new THREE.BoxGeometry(0.4, 0.6, 0.2);
        const bodyMesh = new THREE.Mesh(bodyGeo, shirtMat);
        bodyMesh.position.y = 1.0;
        group.add(bodyMesh);

        const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
        const leftArm = new THREE.Mesh(armGeo, shirtMat);
        leftArm.position.set(-0.3, 1.0, 0);
        group.add(leftArm);

        const rightArm = new THREE.Mesh(armGeo, shirtMat);
        rightArm.position.set(0.3, 1.0, 0);
        group.add(rightArm);

        const legGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
        const leftLeg = new THREE.Mesh(legGeo, pantsMat);
        leftLeg.position.set(-0.1, 0.4, 0);
        group.add(leftLeg);

        const rightLeg = new THREE.Mesh(legGeo, pantsMat);
        rightLeg.position.set(0.1, 0.4, 0);
        group.add(rightLeg);

        group.position.set(playerData.x, playerData.y, playerData.z);
        this.game.scene.add(group);

        const nametag = document.createElement('div');
        nametag.className = 'player-nametag';
        nametag.innerText = playerData.display_name;
        nametag.style.position = 'absolute';
        nametag.style.color = '#f59e0b';
        nametag.style.fontSize = '12px';
        nametag.style.fontWeight = 'bold';
        nametag.style.textShadow = '0 0 4px #000';
        nametag.style.background = 'rgba(15, 23, 42, 0.8)';
        nametag.style.padding = '3px 8px';
        nametag.style.borderRadius = '6px';
        nametag.style.border = '1px solid rgba(245, 158, 11, 0.5)';
        nametag.style.pointerEvents = 'none';

        document.getElementById('nametags-container').appendChild(nametag);

        this.otherPlayers.set(playerData.id, {
            mesh: group,
            leftArm, rightArm, leftLeg, rightLeg,
            nametag: nametag,
            targetPos: new THREE.Vector3(playerData.x, playerData.y, playerData.z),
            targetRotY: playerData.rotY || 0,
            isMoving: false,
            animTime: 0,
            displayName: playerData.display_name
        });

        this.updatePlayerList();
    }

    removeRemotePlayer(id, displayName) {
        if (this.otherPlayers.has(id)) {
            const p = this.otherPlayers.get(id);
            this.game.scene.remove(p.mesh);
            if (p.nametag && p.nametag.parentNode) {
                p.nametag.parentNode.removeChild(p.nametag);
            }
            this.otherPlayers.delete(id);
            this.updatePlayerList();

            this.game.addChatMessage('시스템', `${displayName}님이 퇴장하셨습니다.`);
        }
    }

    updateRemotePlayers(delta) {
        const camera = this.game.camera;

        this.otherPlayers.forEach((p, id) => {
            p.mesh.position.lerp(p.targetPos, delta * 15.0);
            p.mesh.rotation.y = p.targetRotY;

            if (p.isMoving) {
                p.animTime += delta * 10;
                const angle = Math.sin(p.animTime) * 0.6;
                p.leftArm.rotation.x = angle;
                p.rightArm.rotation.x = -angle;
                p.leftLeg.rotation.x = -angle;
                p.rightLeg.rotation.x = angle;
            } else {
                p.leftArm.rotation.x = 0;
                p.rightArm.rotation.x = 0;
                p.leftLeg.rotation.x = 0;
                p.rightLeg.rotation.x = 0;
            }

            const headPos = p.mesh.position.clone();
            headPos.y += 2.0;
            headPos.project(camera);

            if (headPos.z < 1.0) {
                const x = (headPos.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-(headPos.y * 0.5) + 0.5) * window.innerHeight;
                p.nametag.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
                p.nametag.style.display = 'block';
            } else {
                p.nametag.style.display = 'none';
            }
        });
    }

    updatePlayerList() {
        const ul = document.getElementById('player-list');
        if (!ul) return;
        ul.innerHTML = '';

        const selfLi = document.createElement('li');
        selfLi.className = 'self';
        selfLi.innerText = `🟢 ${this.displayName || '나'}`;
        ul.appendChild(selfLi);

        this.otherPlayers.forEach(p => {
            const li = document.createElement('li');
            li.innerText = `👤 ${p.displayName}`;
            ul.appendChild(li);
        });
    }

    showError(msg) {
        const errDiv = document.getElementById('login-error');
        if (errDiv) {
            errDiv.innerText = msg;
            errDiv.classList.remove('hidden');
        }
    }
}
