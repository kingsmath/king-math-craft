// Player Physics & Traditional Minecraft Controls Engine (15x15 Parcels)
class PlayerPhysics {
    constructor(world) {
        this.world = world;
        this.position = new THREE.Vector3(0, 5.0, 0); // Start on Flat Ground (Y=5)
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = { x: 0, y: 0 }; // x: pitch, y: yaw
        this.onGround = false;

        // Player AABB Bounding Box Dimensions
        this.width = 0.6;
        this.height = 1.8;
        this.eyeHeight = 1.62;
        
        // Assigned Player Parcel Number (1-32)
        this.playerNumber = 1;

        // Key states (Keyboard & Touch)
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            sneak: false,
            sprint: false
        };

        // Traditional Minecraft Physics Constants
        this.walkSpeed = 6.0;
        this.sprintSpeed = 9.0;
        this.sneakSpeed = 2.4;
        this.jumpForce = 8.5;
        this.gravity = 24.0;
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

    getEyePosition() {
        const currentEyeHeight = this.keys.sneak ? 1.45 : this.eyeHeight;
        return new THREE.Vector3(
            this.position.x,
            this.position.y + currentEyeHeight,
            this.position.z
        );
    }

    getLookVector() {
        const cosPitch = Math.cos(this.rotation.x);
        const sinPitch = Math.sin(this.rotation.x);
        const cosYaw = Math.cos(this.rotation.y);
        const sinYaw = Math.sin(this.rotation.y);

        return new THREE.Vector3(
            -sinYaw * cosPitch,
            sinPitch,
            -cosYaw * cosPitch
        ).normalize();
    }

    update(delta) {
        if (delta > 0.1) delta = 0.1;

        // Apply Speed Modifiers (Sprint / Sneak)
        let currentSpeed = this.walkSpeed;
        if (this.keys.sprint && !this.keys.sneak) {
            currentSpeed = this.sprintSpeed;
        } else if (this.keys.sneak) {
            currentSpeed = this.sneakSpeed;
        }

        // Standard FPS Movement Vectors (Forward / Right)
        let forwardInput = 0;
        let rightInput = 0;

        if (this.keys.forward) forwardInput += 1;
        if (this.keys.backward) forwardInput -= 1;
        if (this.keys.right) rightInput += 1;
        if (this.keys.left) rightInput -= 1;

        if (forwardInput !== 0 || rightInput !== 0) {
            const length = Math.sqrt(forwardInput * forwardInput + rightInput * rightInput);
            forwardInput /= length;
            rightInput /= length;

            const sinYaw = Math.sin(this.rotation.y);
            const cosYaw = Math.cos(this.rotation.y);

            // Exact FPS Directional Math
            const dx = forwardInput * (-sinYaw) + rightInput * cosYaw;
            const dz = forwardInput * (-cosYaw) + rightInput * (-sinYaw);

            this.velocity.x = dx * currentSpeed;
            this.velocity.z = dz * currentSpeed;
        } else {
            this.velocity.x *= 0.2;
            this.velocity.z *= 0.2;
        }

        // Traditional Jump
        if (this.keys.jump && this.onGround) {
            this.velocity.y = this.jumpForce;
            this.onGround = false;
            if (typeof sfx !== 'undefined') sfx.playJump();
        }

        // Gravity
        this.velocity.y -= this.gravity * delta;

        // Axis-by-Axis Movement & AABB Collisions
        this.moveAxis(this.velocity.x * delta, 0, 0);
        this.moveAxis(0, 0, this.velocity.z * delta);
        this.moveAxis(0, this.velocity.y * delta, 0);

        // Parcel Border Barrier Check
        const currentParcel = this.getParcelNumber(this.position.x, this.position.z);
        if (currentParcel !== 0 && currentParcel !== this.playerNumber) {
            this.position.x -= this.velocity.x * delta * 1.5;
            this.position.z -= this.velocity.z * delta * 1.5;
            this.velocity.x = 0;
            this.velocity.z = 0;
        }
    }

    moveAxis(dx, dy, dz) {
        this.position.x += dx;
        this.position.y += dy;
        this.position.z += dz;

        const halfW = this.width / 2;
        const minX = Math.floor(this.position.x - halfW);
        const maxX = Math.floor(this.position.x + halfW);
        const minY = Math.floor(this.position.y);
        const maxY = Math.floor(this.position.y + this.height);
        const minZ = Math.floor(this.position.z - halfW);
        const maxZ = Math.floor(this.position.z + halfW);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const block = this.world.getBlock(x, y, z);
                    if (block !== 0) {
                        if (dx > 0) this.position.x = x - halfW - 0.001;
                        if (dx < 0) this.position.x = x + 1 + halfW + 0.001;

                        if (dy > 0) {
                            this.position.y = y - this.height - 0.001;
                            this.velocity.y = 0;
                        }
                        if (dy < 0) {
                            this.position.y = y + 1 + 0.001;
                            this.velocity.y = 0;
                            this.onGround = true;
                        }

                        if (dz > 0) this.position.z = z - halfW - 0.001;
                        if (dz < 0) this.position.z = z + 1 + halfW + 0.001;
                    }
                }
            }
        }
    }

    // Accurate Raycasting for Block Detection & Placement
    raycastTarget(maxDistance = 6.0) {
        const eye = this.getEyePosition();
        const dir = this.getLookVector();

        let x = Math.floor(eye.x);
        let y = Math.floor(eye.y);
        let z = Math.floor(eye.z);

        const stepX = dir.x > 0 ? 1 : -1;
        const stepY = dir.y > 0 ? 1 : -1;
        const stepZ = dir.z > 0 ? 1 : -1;

        const tDeltaX = Math.abs(1 / dir.x);
        const tDeltaY = Math.abs(1 / dir.y);
        const tDeltaZ = Math.abs(1 / dir.z);

        let tMaxX = dir.x > 0 ? (x + 1 - eye.x) * tDeltaX : (eye.x - x) * tDeltaX;
        let tMaxY = dir.y > 0 ? (y + 1 - eye.y) * tDeltaY : (eye.y - y) * tDeltaY;
        let tMaxZ = dir.z > 0 ? (z + 1 - eye.z) * tDeltaZ : (eye.z - z) * tDeltaZ;

        let faceNormal = new THREE.Vector3(0, 0, 0);

        for (let i = 0; i < 40; i++) {
            const dist = Math.sqrt(
                (x + 0.5 - eye.x) ** 2 +
                (y + 0.5 - eye.y) ** 2 +
                (z + 0.5 - eye.z) ** 2
            );

            if (dist > maxDistance) break;

            const block = this.world.getBlock(x, y, z);
            if (block !== 0) {
                return {
                    hit: true,
                    targetBlock: { x, y, z },
                    placeBlock: {
                        x: x + faceNormal.x,
                        y: y + faceNormal.y,
                        z: z + faceNormal.z
                    },
                    normal: faceNormal.clone()
                };
            }

            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    x += stepX;
                    tMaxX += tDeltaX;
                    faceNormal.set(-stepX, 0, 0);
                } else {
                    z += stepZ;
                    tMaxZ += tDeltaZ;
                    faceNormal.set(0, 0, -stepZ);
                }
            } else {
                if (tMaxY < tMaxZ) {
                    y += stepY;
                    tMaxY += tDeltaY;
                    faceNormal.set(0, -stepY, 0);
                } else {
                    z += stepZ;
                    tMaxZ += tDeltaZ;
                    faceNormal.set(0, 0, -stepZ);
                }
            }
        }

        return { hit: false };
    }
}
