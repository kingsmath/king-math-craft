// Mob / Animal / Fish Entity Rendering & Interpolation
// Positions are server-authoritative (broadcast via 'entity_update'); this module only
// renders + smoothly interpolates + handles simple local combat raycasting.

// Generic ray-vs-sphere nearest-hit test, reused for mobs and remote players.
function raySphereHitTest(eye, dir, targets, maxDist, radius) {
    let best = null;
    let bestDist = maxDist;
    targets.forEach((t) => {
        const toTarget = new THREE.Vector3(t.x - eye.x, t.y - eye.y, t.z - eye.z);
        const proj = toTarget.dot(dir);
        if (proj < 0 || proj > maxDist) return;
        const closest = new THREE.Vector3(eye.x + dir.x * proj, eye.y + dir.y * proj, eye.z + dir.z * proj);
        const dist = closest.distanceTo(new THREE.Vector3(t.x, t.y, t.z));
        if (dist <= radius && proj < bestDist) {
            bestDist = proj;
            best = t;
        }
    });
    return best;
}

// Frees every geometry/material (and its canvas textures) under an Object3D before it is
// dropped from the scene - character/held-item meshes get rebuilt whenever appearance or the
// equipped weapon changes, so without this the GPU would slowly leak them.
function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
        mats.forEach((m) => {
            if (m.map && m.map.dispose) m.map.dispose();
            if (m.dispose) m.dispose();
        });
    });
}

// Metal/head tint per tool tier - the prefix of every weapon/tool id in RECIPES
// ('iron_sword' -> 'iron'), used by buildHeldItemMesh below.
const TOOL_TIER_COLORS = {
    wood: 0xa9713d, stone: 0x9ca3af, iron: 0xe5e7eb, gold: 0xfbbf24, diamond: 0x22d3ee
};
const TOOL_HANDLE_COLOR = 0x6b4423;

// Blocky sword / axe / pickaxe / fishing-rod model for a crafted item id, so an equipped
// weapon is actually visible in the holder's hand (first-person view-model, third-person
// avatar, and every remote player). Built in "in hand" orientation: the handle runs along
// +Y with the head at the top, so the caller only has to tilt it forward at the wrist.
// Returns null for anything that isn't a held tool/weapon.
function buildHeldItemMesh(itemId) {
    if (!itemId || typeof itemId !== 'string') return null;

    const group = new THREE.Group();
    const handleMat = new THREE.MeshStandardMaterial({ color: TOOL_HANDLE_COLOR, roughness: 0.9 });
    const addBox = (w, h, d, mat, x, y, z) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
    };

    if (itemId === 'fishing_rod') {
        addBox(0.05, 0.72, 0.05, handleMat, 0, 0.18, 0);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
        addBox(0.012, 0.45, 0.012, lineMat, 0.02, 0.32, 0.14);
        return group;
    }

    const underscore = itemId.indexOf('_');
    if (underscore < 0) return null;
    const tier = itemId.slice(0, underscore);
    const kind = itemId.slice(underscore + 1);
    const headColor = TOOL_TIER_COLORS[tier];
    if (!headColor || (kind !== 'sword' && kind !== 'axe' && kind !== 'pickaxe')) return null;

    const headMat = new THREE.MeshStandardMaterial({
        color: headColor,
        metalness: tier === 'wood' ? 0.0 : 0.45,
        roughness: tier === 'wood' ? 0.9 : 0.35,
        emissive: tier === 'diamond' ? 0x0e7490 : 0x000000,
        emissiveIntensity: tier === 'diamond' ? 0.35 : 0
    });

    if (kind === 'sword') {
        addBox(0.06, 0.28, 0.06, handleMat, 0, 0, 0);          // grip
        addBox(0.26, 0.05, 0.08, headMat, 0, 0.17, 0);          // cross guard
        addBox(0.09, 0.52, 0.045, headMat, 0, 0.46, 0);         // blade
        addBox(0.05, 0.09, 0.045, headMat, 0, 0.76, 0);         // tip
    } else if (kind === 'axe') {
        addBox(0.06, 0.62, 0.06, handleMat, 0, 0.06, 0);        // haft
        addBox(0.1, 0.24, 0.09, headMat, 0.07, 0.3, 0);         // head body
        addBox(0.14, 0.3, 0.07, headMat, 0.17, 0.29, 0);        // blade edge
    } else {
        addBox(0.06, 0.62, 0.06, handleMat, 0, 0.06, 0);        // haft
        addBox(0.44, 0.07, 0.07, headMat, 0, 0.36, 0);          // cross head
        addBox(0.08, 0.1, 0.07, headMat, -0.18, 0.29, 0);       // left tip
        addBox(0.08, 0.1, 0.07, headMat, 0.18, 0.29, 0);        // right tip
    }

    return group;
}

// Puts (or clears) a held weapon in a humanoid character's right hand. `group` is any mesh
// built with userData.arms = [leftArmPivot, rightArmPivot] - i.e. remote players, the local
// third-person avatar. The arm pivot sits at the shoulder with a 0.65-long arm hanging below
// it, so the hand is at local y ≈ -0.65, and the item is tilted forward out of the fist.
function attachHeldItemToCharacter(group, itemId) {
    const ud = group && group.userData;
    if (!ud || !ud.arms || !ud.arms[1]) return;

    const hand = ud.arms[1];
    if (ud.heldItem) {
        hand.remove(ud.heldItem);
        disposeObject3D(ud.heldItem);
        ud.heldItem = null;
    }

    const item = buildHeldItemMesh(itemId);
    if (!item) return;
    item.position.set(0, -0.58, -0.06);
    item.rotation.set(-1.15, 0, 0.12);
    hand.add(item);
    ud.heldItem = item;
}

// A limb is a pivot Group positioned at the joint (shoulder/hip) with its box mesh hanging
// below, so rotating the pivot swings the limb around the joint instead of its own center.
function createLimbPivotMesh(w, h, d, mat, jointX, jointY, jointZ) {
    const pivot = new THREE.Group();
    pivot.position.set(jointX, jointY, jointZ);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    return pivot;
}

const MOB_COLORS = {
    zombie: { skin: 0x2e7d32, cloth: 0x1e293b },
    skeleton: { skin: 0xe5e7eb, cloth: 0x9ca3af },
    cow: { skin: 0xf5f5f4, cloth: 0x5c3a21 },
    pig: { skin: 0xf9a8d4, cloth: 0xec4899 },
    chicken: { skin: 0xfafaf9, cloth: 0xf59e0b },
    bear: { skin: 0x78350f, cloth: 0x451a03 },
    fish: { skin: 0x38bdf8, cloth: 0x0284c7 },
};

class EntityManager {
    constructor(game) {
        this.game = game;
        this.entities = new Map(); // id -> { type, hp, maxHp, group, targetPos, targetRotY, hpBar }
    }

    updateFromList(mobs) {
        (mobs || []).forEach((m) => this.spawnOrUpdate(m));
    }

    spawnOrUpdate(m) {
        let ent = this.entities.get(m.id);
        // Fish stay at the server's water-surface height; land mobs snap to the actual local
        // ground height (hills mean that's not always the server's fixed spawn y anymore).
        const y = (m.type === 'fish') ? m.y : this.game.world.getSurfaceY(m.x, m.z, m.y);
        if (!ent) {
            const group = this.createMesh(m.type);
            group.position.set(m.x, y, m.z);
            this.game.scene.add(group);
            ent = {
                type: m.type, hp: m.hp, maxHp: m.maxHp, group,
                targetPos: new THREE.Vector3(m.x, y, m.z),
                targetRotY: m.rotY || 0
            };
            this.entities.set(m.id, ent);
        } else {
            ent.hp = m.hp;
            ent.maxHp = m.maxHp;
            ent.targetPos.set(m.x, y, m.z);
            ent.targetRotY = m.rotY || 0;
        }
        this.updateHpBar(ent);
    }

    updateHpBar(ent) {
        if (!ent.hpBarFg) return;
        const pct = Math.max(0, Math.min(1, ent.hp / ent.maxHp));
        ent.hpBarFg.scale.x = pct;
        ent.hpBarFg.position.x = -0.3 * (1 - pct);
    }

    removeMany(ids, reason) {
        (ids || []).forEach((id) => this.remove(id, reason));
    }

    remove(id, reason) {
        const ent = this.entities.get(id);
        if (!ent) return;
        if (reason === 'burn') {
            this.spawnBurnParticles(ent.group.position);
            if (typeof sfx !== 'undefined' && sfx.playBlockBreak) sfx.playBlockBreak();
        }
        this.game.scene.remove(ent.group);
        this.entities.delete(id);
    }

    spawnBurnParticles(pos) {
        const group = new THREE.Group();
        for (let i = 0; i < 10; i++) {
            const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
            const mat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xf97316 : 0xfde047 });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(pos);
            p.position.y += 0.5;
            const vel = new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 3 + 1.5, (Math.random() - 0.5) * 2.5);
            group.add(p);
            p.userData.vel = vel;
        }
        this.game.scene.add(group);
        const start = performance.now();
        const animateParticles = () => {
            const elapsed = (performance.now() - start) / 1000;
            if (elapsed > 0.8) {
                this.game.scene.remove(group);
                return;
            }
            group.children.forEach((p) => {
                p.position.addScaledVector(p.userData.vel, 0.016);
                p.userData.vel.y -= 0.12;
                p.material.opacity = 1 - elapsed / 0.8;
                p.material.transparent = true;
            });
            requestAnimationFrame(animateParticles);
        };
        animateParticles();
    }

    createMesh(type) {
        const group = new THREE.Group();
        const colors = MOB_COLORS[type] || MOB_COLORS.zombie;
        const skinMat = new THREE.MeshStandardMaterial({ color: colors.skin });
        const clothMat = new THREE.MeshStandardMaterial({ color: colors.cloth });

        if (type === 'chicken' || type === 'fish') {
            const bodyGeo = new THREE.BoxGeometry(0.5, 0.4, 0.7);
            const body = new THREE.Mesh(bodyGeo, skinMat);
            body.position.y = type === 'fish' ? 0.25 : 0.5;
            group.add(body);
            const headGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
            const head = new THREE.Mesh(headGeo, clothMat);
            head.position.set(0, type === 'fish' ? 0.3 : 0.75, 0.4);
            group.add(head);
        } else if (type === 'cow' || type === 'pig' || type === 'bear') {
            const scale = type === 'bear' ? 1.35 : 1.0;
            const bodyGeo = new THREE.BoxGeometry(0.75 * scale, 0.65 * scale, 1.15 * scale);
            const body = new THREE.Mesh(bodyGeo, skinMat);
            body.position.y = 0.7 * scale;
            group.add(body);
            const headGeo = new THREE.BoxGeometry(0.45 * scale, 0.45 * scale, 0.4 * scale);
            const head = new THREE.Mesh(headGeo, clothMat);
            head.position.set(0, 0.75 * scale, 0.75 * scale);
            group.add(head);
            const legH = 0.5 * scale;
            const legs = [];
            [[-0.28, -0.45], [0.28, -0.45], [-0.28, 0.45], [0.28, 0.45]].forEach(([lx, lz]) => {
                const leg = createLimbPivotMesh(0.18 * scale, legH, 0.18 * scale, clothMat, lx * scale, legH, lz * scale);
                group.add(leg);
                legs.push(leg);
            });
            group.userData.legs = legs;
        } else {
            // zombie / skeleton: humanoid like the player mesh
            const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
            const head = new THREE.Mesh(headGeo, skinMat);
            head.position.y = 1.5;
            group.add(head);
            const bodyGeo = new THREE.BoxGeometry(0.5, 0.7, 0.3);
            const body = new THREE.Mesh(bodyGeo, clothMat);
            body.position.y = 0.9;
            group.add(body);
            const leftArm = createLimbPivotMesh(0.2, 0.65, 0.2, skinMat, -0.35, 1.245, 0);
            const rightArm = createLimbPivotMesh(0.2, 0.65, 0.2, skinMat, 0.35, 1.245, 0);
            group.add(leftArm, rightArm);
            const legMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 });
            const leftLeg = createLimbPivotMesh(0.22, 0.65, 0.22, legMat, -0.13, 0.65, 0);
            const rightLeg = createLimbPivotMesh(0.22, 0.65, 0.22, legMat, 0.13, 0.65, 0);
            group.add(leftLeg, rightLeg);
            group.userData.legs = [leftLeg, rightLeg];
            group.userData.arms = [leftArm, rightArm];
        }

        // Floating HP bar wrapped in billboard group
        const hpGroup = new THREE.Group();
        hpGroup.position.y = 2.0;
        const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.09), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.6, transparent: true }));
        const barFg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.07), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
        barFg.position.z = 0.001;
        hpGroup.add(barBg, barFg);
        group.add(hpGroup);
        group._hpGroup = hpGroup;
        group._hpBarFg = barFg;
        Object.defineProperty(group, 'hpBarFgRef', { value: barFg });
        return group;
    }

    update(delta) {
        this.entities.forEach((ent) => {
            ent.group.position.lerp(ent.targetPos, Math.min(1, delta * 8.0));
            ent.group.rotation.y = ent.targetRotY;
            if (ent.group._hpGroup) ent.group._hpGroup.lookAt(this.game.camera.position);
            if (!ent.hpBarFg) ent.hpBarFg = ent.group.hpBarFgRef;

            // Mobs wander/chase almost continuously, so just always animate their walk cycle
            ent.walkTime = (ent.walkTime || 0) + delta * 7.0;
            const swing = Math.sin(ent.walkTime) * 0.5;
            const ud = ent.group.userData;
            if (ud && ud.legs) {
                ud.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === 0 ? swing : -swing); });
            }
            if (ud && ud.arms) {
                ud.arms[0].rotation.x = -swing;
                ud.arms[1].rotation.x = swing;
            }
        });
    }

    // Finds nearest mob hit by the crosshair ray, for melee attack targeting
    raycastNearestMob(eye, dir, maxDist) {
        const targets = [];
        this.entities.forEach((ent, id) => {
            targets.push({ id, x: ent.group.position.x, y: ent.group.position.y + 0.6, z: ent.group.position.z });
        });
        const hit = raySphereHitTest(eye, dir, targets, maxDist, 0.75);
        return hit ? hit.id : null;
    }

    getType(id) {
        const ent = this.entities.get(id);
        return ent ? ent.type : null;
    }
}
