// Day/Night Cycle System - 15 minutes day, 15 minutes night (30 min full cycle)
// Server is authoritative on the epoch (world_start_time); every client computes
// the current phase locally from that shared epoch so no per-frame network traffic is needed.
class DayNightCycle {
    constructor(game) {
        this.game = game;
        this.DAY_SECONDS = 900;
        this.NIGHT_SECONDS = 900;
        this.CYCLE = this.DAY_SECONDS + this.NIGHT_SECONDS;

        this.worldStartTime = Date.now() / 1000;
        this.phase = 'day';

        this.nightSky = new THREE.Color(0x0b1226);
        this.daySky = new THREE.Color(0x78a7ff);
        this.mixedSky = new THREE.Color();

        this.clockEl = document.getElementById('daynight-clock');
    }

    init(worldStartTime, phase) {
        this.worldStartTime = worldStartTime || (Date.now() / 1000);
        this.phase = phase || 'day';
    }

    onServerPhaseChanged(phase, worldStartTime) {
        if (worldStartTime) this.worldStartTime = worldStartTime;
        if (phase !== this.phase) {
            this.phase = phase;
            const msg = phase === 'night' ? '🌙 밤이 되었습니다! 몬스터가 나타납니다...' : '☀️ 아침이 밝았습니다! 좀비/스켈레톤이 햇빛에 타기 시작합니다.';
            this.game.showToast(msg);
        }
    }

    getCyclePos() {
        const elapsed = (Date.now() / 1000) - this.worldStartTime;
        return ((elapsed % this.CYCLE) + this.CYCLE) % this.CYCLE;
    }

    getPhase() {
        return this.getCyclePos() < this.DAY_SECONDS ? 'day' : 'night';
    }

    update() {
        const cyclePos = this.getCyclePos();
        const t = cyclePos / this.CYCLE;
        const localPhase = t < 0.5 ? 'day' : 'night';

        if (localPhase !== this.phase) {
            this.phase = localPhase;
        }

        // Smooth brightness curve: peaks at midday (t=0.25), troughs at midnight (t=0.75)
        const brightness = (Math.cos((t - 0.25) * 2 * Math.PI) + 1) / 2;

        this.mixedSky.lerpColors(this.nightSky, this.daySky, brightness);
        this.game.scene.background = this.mixedSky;
        if (this.game.scene.fog) {
            this.game.scene.fog.color = this.mixedSky;
            this.game.scene.fog.density = 0.015 + (1 - brightness) * 0.01;
        }

        if (this.game.hemiLight) {
            this.game.hemiLight.intensity = 0.22 + brightness * 0.55;
        }
        if (this.game.sun) {
            const angle = (t - 0.25) * 2 * Math.PI;
            const h = Math.cos(angle) * 100;
            const xh = Math.sin(angle) * 100;
            this.game.sun.position.set(xh, Math.max(h, 8), 50);
            this.game.sun.intensity = 0.1 + brightness * 0.6;
        }

        this.updateClockUI(t);
    }

    updateClockUI(t) {
        if (!this.clockEl) return;
        const hour = (6 + t * 24) % 24;
        const hh = String(Math.floor(hour)).padStart(2, '0');
        const mm = String(Math.floor((hour % 1) * 60)).padStart(2, '0');
        const icon = this.phase === 'day' ? '☀️' : '🌙';
        this.clockEl.innerText = `${icon} ${hh}:${mm}`;
    }
}
