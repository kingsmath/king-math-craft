import asyncio
import json
import os
import random
import sys
import hashlib
import time
from pathlib import Path
from aiohttp import web, WSMsgType

# Ensure UTF-8 output encoding for Windows terminal compatibility
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Configurations - Environment PORT support for Render & Cloud deployments
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", 8000))
MAX_PLAYERS_PER_ROOM = 32  # Up to 32 players (1번~32번) simultaneously
DATA_PURGE_TIMEOUT = 30 * 24 * 3600  # 30 days in seconds (2,592,000s)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
ROOMS_FILE = DATA_DIR / "rooms_meta.json"

# In-memory room storage
rooms = {}
room_tasks = {}

# =====================================================================
# Survival Systems Constants (mirrored in js/game.js / js/daynight.js)
# =====================================================================
TICK_INTERVAL = 0.2  # 200ms server tick
DAY_SECONDS = 900     # 15 minutes
NIGHT_SECONDS = 900   # 15 minutes
DAY_NIGHT_CYCLE = DAY_SECONDS + NIGHT_SECONDS

# Block type IDs (must match BLOCK registry in js/game.js)
BLOCK_COAL_ORE = 23
BLOCK_IRON_ORE = 24
BLOCK_GOLD_ORE = 25
BLOCK_DIAMOND_ORE = 26
BLOCK_SAPLING = 27
BLOCK_CRAFTING_TABLE = 28
BLOCK_FURNACE = 29
BLOCK_CAVE_STONE = 31

# Zone bounds: (xMin, xMax, zMin, zMax) - must match js/game.js zone constants
ZONE_FOREST = (-58, -4, -58, -4)
ZONE_LAKE_BASIN = (16, 50, -50, -16)
ZONE_CAVE = (-56, -36, 4, 26)          # cave interior footprint (sheltered from sun)
ZONE_WILD = (-58, -33, 2, 31)          # hostile mob roam/spawn area (superset of cave)
ZONE_PASTURE = (-30, -6, 34, 58)
ZONE_PVP_ARENA = (10, 34,10, 34)

RESPAWN_POINT = {"x": 0.0, "y": 11.0, "z": 0.0}
SAPLING_GROW_SECONDS = 60
ORE_RESPAWN_SECONDS = 75

HOSTILE_CAP = 6
ANIMAL_CAP = 9
BEAR_CAP = 2
FISH_CAP = 6

AGGRO_RANGE = 9.0
HOSTILE_ATTACK_RANGE = 1.4
HOSTILE_ATTACK_COOLDOWN = 1.2
HOSTILE_DAMAGE = {"zombie": 8, "skeleton": 6}
BURN_DAMAGE_PER_TICK = 8

MOB_HP = {
    "zombie": 20, "skeleton": 16,
    "cow": 10, "pig": 8, "chicken": 4, "bear": 30,
    "fish": 4,
}
MOB_SPEED = {
    "zombie": 1.4, "skeleton": 1.3,
    "cow": 0.6, "pig": 0.6, "chicken": 0.8, "bear": 1.0,
    "fish": 0.5,
}
LOOT_TABLE = {
    "zombie": {},
    "skeleton": {},
    "cow": {"raw_meat": 2, "leather": 1},
    "pig": {"raw_meat": 2},
    "chicken": {"raw_meat": 1},
    "bear": {"raw_meat": 3, "leather": 2},
    "fish": {"raw_fish": 1},
}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def in_bounds(x, z, bounds):
    xmin, xmax, zmin, zmax = bounds
    return xmin <= x <= xmax and zmin <= z <= zmax


def rand_in_bounds(bounds, margin=2):
    xmin, xmax, zmin, zmax = bounds
    x = random.uniform(xmin + margin, xmax - margin)
    z = random.uniform(zmin + margin, zmax - margin)
    return x, z


# -----------------------------------------------------------------
# Deterministic cave wall/ore formula - MUST mirror js/game.js exactly
# -----------------------------------------------------------------
CAVE_X_MIN, CAVE_X_MAX, CAVE_Z_MIN, CAVE_Z_MAX = ZONE_CAVE
CAVE_ENTRANCE_X_MIN, CAVE_ENTRANCE_X_MAX = -48, -44


def _build_cave_wall_cells():
    cells = []
    for x in range(CAVE_X_MIN, CAVE_X_MAX + 1):
        if CAVE_ENTRANCE_X_MIN <= x <= CAVE_ENTRANCE_X_MAX:
            continue
        cells.append((x, CAVE_Z_MIN))
    for x in range(CAVE_X_MIN, CAVE_X_MAX + 1):
        cells.append((x, CAVE_Z_MAX))
    for z in range(CAVE_Z_MIN + 1, CAVE_Z_MAX):
        cells.append((CAVE_X_MIN, z))
    for z in range(CAVE_Z_MIN + 1, CAVE_Z_MAX):
        cells.append((CAVE_X_MAX, z))
    return cells


_CAVE_WALL_CELLS = _build_cave_wall_cells()


def get_cave_ore_type(x, y, z):
    """Returns the ore block id that belongs at (x,y,z) if it's an ore wall cell, else None.
    Ore rows sit at world y=10,11 (gy+1, gy+2 with gy=9) - MUST mirror js/game.js buildCaveAndMine."""
    if y not in (10, 11):
        return None
    idx = 0
    for (cx, cz) in _CAVE_WALL_CELLS:
        for wy in (10, 11):
            idx += 1
            if cx == x and cz == z and wy == y:
                if idx % 23 == 0:
                    return BLOCK_DIAMOND_ORE
                if idx % 17 == 0:
                    return BLOCK_GOLD_ORE
                if idx % 11 == 0:
                    return BLOCK_IRON_ORE
                if idx % 7 == 0:
                    return BLOCK_COAL_ORE
                return None
    return None


def default_inventory():
    return {"resources": {}, "equipment": {"weapon": None, "helmet": None, "chest": None, "legs": None, "boots": None}}


def default_appearance():
    return {"skin": "#ffdbac", "shirt": "#3b82f6", "pants": "#1e3a8a", "hair": "short", "expression": "smile"}


def load_rooms_data():
    global rooms
    if ROOMS_FILE.exists():
        try:
            with open(ROOMS_FILE, "r", encoding="utf-8") as f:
                saved_rooms = json.load(f)
                now = time.time()
                for r_key, r_data in saved_rooms.items():
                    last_active = r_data.get("last_active", now)
                    if now - last_active > DATA_PURGE_TIMEOUT:
                        print(f"[CLEANUP] Room '{r_data.get('room_id')}' expired (>30 days inactive). Purging data.")
                        continue

                    rooms[r_key] = {
                        "room_id": r_data.get("room_id"),
                        "password_hash": r_data.get("password_hash"),
                        "last_active": last_active,
                        "saved_world_edits": r_data.get("world_edits", {}),
                        "parcel_passwords": r_data.get("parcel_passwords", {}),
                        "active_world_edits": {},
                        "active_sockets": {},
                        "occupied_numbers": set(),
                        "has_prompted_host": False,
                        "player_inventories": r_data.get("player_inventories", {}),
                        "appearances": r_data.get("appearances", {}),
                        "world_start_time": time.time(),
                        "day_phase": "day",
                        "mobs": {},
                        "next_mob_id": 1,
                        "saplings": [],
                        "ore_respawns": [],
                    }
        except Exception as e:
            print(f"[DATA] Error loading rooms: {e}")
            rooms = {}


def save_rooms_data():
    try:
        data_to_save = {}
        now = time.time()
        expired_keys = []

        for r_key, r_data in list(rooms.items()):
            if now - r_data["last_active"] > DATA_PURGE_TIMEOUT and len(r_data["active_sockets"]) == 0:
                expired_keys.append(r_key)
                continue

            data_to_save[r_key] = {
                "room_id": r_data["room_id"],
                "password_hash": r_data["password_hash"],
                "last_active": r_data["last_active"],
                "world_edits": r_data.get("active_world_edits", r_data.get("saved_world_edits", {})),
                "parcel_passwords": r_data.get("parcel_passwords", {}),
                "player_inventories": r_data.get("player_inventories", {}),
                "appearances": r_data.get("appearances", {}),
            }

        for k in expired_keys:
            print(f"[CLEANUP] Purging 30d+ inactive room: {k}")
            del rooms[k]

        with open(ROOMS_FILE, "w", encoding="utf-8") as f:
            json.dump(data_to_save, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[DATA] Error saving rooms: {e}")


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


async def broadcast_room(room_data, message_dict, exclude_ws=None):
    sockets = list(room_data["active_sockets"].keys())
    if not sockets:
        return
    msg_str = json.dumps(message_dict)
    coros = []
    for ws in sockets:
        if ws != exclude_ws:
            try:
                coros.append(ws.send_str(msg_str))
            except Exception:
                pass
    if coros:
        await asyncio.gather(*coros, return_exceptions=True)


async def send_to_id(room_data, target_id, message_dict):
    for ws, info in room_data["active_sockets"].items():
        if info["id"] == target_id:
            try:
                await ws.send_str(json.dumps(message_dict))
            except Exception:
                pass
            return True
    return False


# =====================================================================
# Room Survival Tick Loop (day/night, mobs, sapling growth, ore respawn)
# =====================================================================

def ensure_room_task(room_key):
    task = room_tasks.get(room_key)
    if task is None or task.done():
        room_tasks[room_key] = asyncio.create_task(room_tick_loop(room_key))


async def room_tick_loop(room_key):
    try:
        while True:
            await asyncio.sleep(TICK_INTERVAL)
            room = rooms.get(room_key)
            if room is None or not room["active_sockets"]:
                break
            await tick_room(room, room_key)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[TICK] Error in room '{room_key}': {e}")
    finally:
        room_tasks.pop(room_key, None)


async def tick_room(room, room_key):
    now = time.time()
    elapsed = now - room["world_start_time"]
    cycle_pos = elapsed % DAY_NIGHT_CYCLE
    phase = "day" if cycle_pos < DAY_SECONDS else "night"

    if phase != room["day_phase"]:
        room["day_phase"] = phase
        await broadcast_room(room, {
            "type": "day_phase_changed",
            "phase": phase,
            "world_start_time": room["world_start_time"]
        })

    _spawn_mobs(room)
    _update_mob_ai(room, phase)
    await _apply_mob_player_damage(room)
    await _process_sapling_growth(room)
    await _process_ore_respawns(room)

    if room["mobs"]:
        await broadcast_room(room, {
            "type": "entity_update",
            "mobs": list(room["mobs"].values())
        })


def _spawn_mobs(room):
    mobs = room["mobs"]
    hostiles = [m for m in mobs.values() if m["type"] in ("zombie", "skeleton")]
    animals = [m for m in mobs.values() if m["type"] in ("cow", "pig", "chicken")]
    bears = [m for m in mobs.values() if m["type"] == "bear"]
    fish = [m for m in mobs.values() if m["type"] == "fish"]

    if room["day_phase"] == "night" and len(hostiles) < HOSTILE_CAP:
        mob_type = random.choice(["zombie", "skeleton"])
        x, z = rand_in_bounds(ZONE_WILD, margin=1)
        _create_mob(room, mob_type, x, 10.0, z)

    if len(animals) < ANIMAL_CAP:
        mob_type = random.choice(["cow", "pig", "chicken"])
        x, z = rand_in_bounds(ZONE_PASTURE, margin=2)
        _create_mob(room, mob_type, x, 10.0, z)

    if len(bears) < BEAR_CAP and random.random() < 0.15:
        x, z = rand_in_bounds(ZONE_PASTURE, margin=2)
        _create_mob(room, "bear", x, 10.0, z)

    if len(fish) < FISH_CAP:
        x, z = rand_in_bounds(ZONE_LAKE_BASIN, margin=1)
        _create_mob(room, "fish", x, 9.6, z)


def _create_mob(room, mob_type, x, y, z):
    mob_id = f"m{room['next_mob_id']}"
    room["next_mob_id"] += 1
    room["mobs"][mob_id] = {
        "id": mob_id, "type": mob_type, "x": x, "y": y, "z": z,
        "hp": MOB_HP[mob_type], "maxHp": MOB_HP[mob_type],
        "rotY": random.uniform(0, 6.28), "lastAttack": 0.0,
    }


def _update_mob_ai(room, phase):
    now = time.time()
    dead_ids = []

    for mob in room["mobs"].values():
        mtype = mob["type"]
        speed = MOB_SPEED[mtype] * TICK_INTERVAL

        if mtype in ("zombie", "skeleton"):
            target = _nearest_player(room, mob["x"], mob["z"], AGGRO_RANGE)
            if target is not None:
                dx = target["x"] - mob["x"]
                dz = target["z"] - mob["z"]
                dist = (dx * dx + dz * dz) ** 0.5
                if dist > 0.01:
                    mob["x"] += (dx / dist) * speed
                    mob["z"] += (dz / dist) * speed
                    mob["rotY"] = -1 * (0 if dx == 0 and dz == 0 else __import__("math").atan2(dx, dz))
            else:
                _wander(mob, ZONE_WILD, speed)

            # Burn in daylight when not sheltered inside the cave interior
            if phase == "day" and not in_bounds(mob["x"], mob["z"], ZONE_CAVE):
                mob["hp"] -= BURN_DAMAGE_PER_TICK
                if mob["hp"] <= 0:
                    dead_ids.append((mob["id"], "burn"))
        elif mtype == "fish":
            _wander(mob, ZONE_LAKE_BASIN, speed)
        elif mtype == "bear":
            _wander(mob, ZONE_PASTURE, speed)
        else:
            _wander(mob, ZONE_PASTURE, speed)

    if dead_ids:
        for mob_id, reason in dead_ids:
            room["mobs"].pop(mob_id, None)
        asyncio.ensure_future(broadcast_room(room, {
            "type": "entity_removed",
            "ids": [mid for mid, _ in dead_ids],
            "reason": "burn"
        }))


def _wander(mob, bounds, speed):
    if random.random() < 0.08:
        mob["_dir"] = random.uniform(0, 6.28318)
    d = mob.get("_dir", random.uniform(0, 6.28318))
    mob["_dir"] = d
    import math
    nx = mob["x"] + math.sin(d) * speed
    nz = mob["z"] + math.cos(d) * speed
    xmin, xmax, zmin, zmax = bounds
    if xmin <= nx <= xmax:
        mob["x"] = nx
    else:
        mob["_dir"] = -d
    if zmin <= nz <= zmax:
        mob["z"] = nz
    else:
        mob["_dir"] = math.pi - d
    mob["rotY"] = d


def _nearest_player(room, x, z, max_range):
    best = None
    best_dist = max_range
    for info in room["active_sockets"].values():
        dx = info["x"] - x
        dz = info["z"] - z
        dist = (dx * dx + dz * dz) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best = info
    return best


async def _apply_mob_player_damage(room):
    now = time.time()
    for mob in room["mobs"].values():
        if mob["type"] not in ("zombie", "skeleton"):
            continue
        if now - mob.get("lastAttack", 0) < HOSTILE_ATTACK_COOLDOWN:
            continue
        target = _nearest_player(room, mob["x"], mob["z"], HOSTILE_ATTACK_RANGE)
        if target is not None:
            mob["lastAttack"] = now
            dmg = HOSTILE_DAMAGE.get(mob["type"], 5)
            await apply_player_damage(room, target, dmg)


async def apply_player_damage(room, session_info, dmg):
    session_info["hp"] = clamp(session_info.get("hp", 20) - dmg, 0, session_info.get("maxHp", 20))
    await send_to_id(room, session_info["id"], {"type": "player_hp", "hp": session_info["hp"], "maxHp": session_info.get("maxHp", 20)})
    if session_info["hp"] <= 0:
        await handle_player_death(room, session_info)


async def handle_player_death(room, session_info):
    session_info["hp"] = session_info.get("maxHp", 20)
    await send_to_id(room, session_info["id"], {
        "type": "player_died",
        "respawn": RESPAWN_POINT,
        "hp": session_info["hp"]
    })
    await broadcast_room(room, {
        "type": "chat_msg",
        "sender": "시스템",
        "text": f"💀 {session_info['display_name']} 님이 쓰러졌습니다!"
    })


async def _process_sapling_growth(room):
    now = time.time()
    remaining = []
    grown_batch = {}
    for sap in room["saplings"]:
        if now - sap["planted_at"] >= SAPLING_GROW_SECONDS:
            for (bx, by, bz, btype) in _tree_blocks(sap["x"], sap["y"], sap["z"]):
                key = f"{bx},{by},{bz}"
                room["active_world_edits"][key] = btype
                grown_batch[key] = btype
        else:
            remaining.append(sap)
    room["saplings"] = remaining
    if grown_batch:
        room["last_active"] = now
        save_rooms_data()
        await broadcast_room(room, {"type": "world_edits_batch", "edits": grown_batch})


def _tree_blocks(x, y, z):
    blocks = []
    trunk_h = 4
    for i in range(trunk_h):
        blocks.append((x, y + i, z, 4))  # wood log
    for lx in range(-1, 2):
        for lz in range(-1, 2):
            blocks.append((x + lx, y + trunk_h, z + lz, 5))  # leaves
    for lx in range(-1, 2):
        for lz in range(-1, 2):
            blocks.append((x + lx, y + trunk_h + 1, z + lz, 5))
    blocks.append((x, y + trunk_h + 2, z, 5))
    return blocks


async def _process_ore_respawns(room):
    now = time.time()
    remaining = []
    batch = {}
    for entry in room["ore_respawns"]:
        if now - entry["mined_at"] >= ORE_RESPAWN_SECONDS:
            key = f"{entry['x']},{entry['y']},{entry['z']}"
            room["active_world_edits"].pop(key, None)
            batch[key] = entry["ore_type"]
        else:
            remaining.append(entry)
    room["ore_respawns"] = remaining
    if batch:
        room["last_active"] = now
        save_rooms_data()
        await broadcast_room(room, {"type": "world_edits_batch", "edits": batch})


def get_parcel_number(x, z):
    # Central Living Room Plaza (-60..59, -60..59)
    if -60 <= x <= 59 and -60 <= z <= 59:
        return 0

    # 4 Corner Regions (Public Living Room)
    if (x < -60 and z < -60) or (x > 59 and z < -60) or (x > 59 and z > 59) or (x < -60 and z > 59):
        return 0

    # North Side (Z <= -61, 8 Parcels across X: -60 to 59, each 15 wide)
    if z <= -61:
        if -60 <= x <= -46: return 1
        elif -45 <= x <= -31: return 2
        elif -30 <= x <= -16: return 3
        elif -15 <= x <= -1: return 4
        elif 0 <= x <= 14: return 5
        elif 15 <= x <= 29: return 6
        elif 30 <= x <= 44: return 7
        elif 45 <= x <= 59: return 8

    # East Side (X >= 60, 8 Parcels down Z: -60 to 59, each 15 deep)
    if x >= 60:
        if -60 <= z <= -46: return 9
        elif -45 <= z <= -31: return 10
        elif -30 <= z <= -16: return 11
        elif -15 <= z <= -1: return 12
        elif 0 <= z <= 14: return 13
        elif 15 <= z <= 29: return 14
        elif 30 <= z <= 44: return 15
        elif 45 <= z <= 59: return 16

    # South Side (Z >= 60, 8 Parcels across X: 59 down to -60, each 15 wide)
    if z >= 60:
        if 45 <= x <= 59: return 17
        elif 30 <= x <= 44: return 18
        elif 15 <= x <= 29: return 19
        elif 0 <= x <= 14: return 20
        elif -15 <= x <= -1: return 21
        elif -30 <= x <= -16: return 22
        elif -45 <= x <= -31: return 23
        elif -60 <= x <= -46: return 24

    # West Side (X <= -61, 8 Parcels up Z: 59 down to -60, each 15 deep)
    if x <= -61:
        if 45 <= z <= 59: return 25
        elif 30 <= z <= 44: return 26
        elif 15 <= z <= 29: return 27
        elif 0 <= z <= 14: return 28
        elif -15 <= z <= -1: return 29
        elif -30 <= z <= -16: return 30
        elif -45 <= z <= -31: return 31
        elif -60 <= z <= -46: return 32

    return 0


async def periodic_cleanup_task(app):
    while True:
        await asyncio.sleep(600)
        save_rooms_data()


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print(f"[WS] New connection from {request.remote}")

    current_room_key = None
    session_info = None

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    continue

                msg_type = data.get("type")

                if msg_type == "login":
                    room_id = str(data.get("username", "")).strip()
                    password = str(data.get("password", "")).strip()
                    parcel_pin = str(data.get("parcelPin", "")).strip()
                    player_num = int(data.get("playerNumber", 1))

                    if not room_id or not password or not parcel_pin:
                        await ws.send_str(json.dumps({
                            "type": "login_res",
                            "success": False,
                            "message": "방 아이디, 비밀번호, 번호 비밀번호를 모두 입력해주세요."
                        }))
                        continue

                    if player_num < 1 or player_num > 32:
                        await ws.send_str(json.dumps({
                            "type": "login_res",
                            "success": False,
                            "message": "선택한 번호가 올바르지 않습니다 (1번~32번)."
                        }))
                        continue

                    pw_hash = hash_password(password)
                    pin_hash = hash_password(parcel_pin)
                    room_key = f"{room_id}#{pw_hash}"

                    if room_key not in rooms:
                        rooms[room_key] = {
                            "room_id": room_id,
                            "password_hash": pw_hash,
                            "last_active": time.time(),
                            "saved_world_edits": {},
                            "parcel_passwords": {},
                            "active_world_edits": {},
                            "active_sockets": {},
                            "occupied_numbers": set(),
                            "has_prompted_host": False,
                            "player_inventories": {},
                            "appearances": {},
                            "world_start_time": time.time(),
                            "day_phase": "day",
                            "mobs": {},
                            "next_mob_id": 1,
                            "saplings": [],
                            "ore_respawns": [],
                        }
                        print(f"[ROOM] Created new room instance: '{room_id}'")

                    room = rooms[room_key]
                    room["last_active"] = time.time()

                    # Number PIN Authentication Check
                    parcel_str = str(player_num)
                    if parcel_str not in room["parcel_passwords"]:
                        # First time registering this number PIN!
                        room["parcel_passwords"][parcel_str] = pin_hash
                        save_rooms_data()
                        print(f"[PIN] Created new PIN for Parcel {player_num} in Room '{room_id}'")
                    else:
                        # Validate existing number PIN
                        if room["parcel_passwords"][parcel_str] != pin_hash:
                            await ws.send_str(json.dumps({
                                "type": "login_res",
                                "success": False,
                                "message": f"❌ {player_num}번의 번호 비밀번호가 일치하지 않습니다!"
                            }))
                            continue

                    if player_num in room["occupied_numbers"]:
                        await ws.send_str(json.dumps({
                            "type": "login_res",
                            "success": False,
                            "message": f"{player_num}번은 이미 접속 중입니다. 다른 번호를 선택해주세요."
                        }))
                        continue

                    if len(room["active_sockets"]) >= MAX_PLAYERS_PER_ROOM:
                        await ws.send_str(json.dumps({
                            "type": "login_res",
                            "success": False,
                            "message": f"이 방은 인원이 가득 찼습니다. (최대 {MAX_PLAYERS_PER_ROOM}명)"
                        }))
                        continue

                    is_host = len(room["active_sockets"]) == 0
                    display_name = f"{room_id} ({player_num}번)"
                    session_id = str(id(ws))

                    appearance = room["appearances"].get(parcel_str, default_appearance())

                    session_info = {
                        "id": session_id,
                        "username": room_id,
                        "display_name": display_name,
                        "player_number": player_num,
                        "is_host": is_host,
                        "x": 0.0,
                        "y": 10.0,
                        "z": 0.0,
                        "rotX": 0.0,
                        "rotY": 0.0,
                        "isMoving": False,
                        "selectedSlot": 1,
                        "hp": 20,
                        "maxHp": 20,
                        "appearance": appearance,
                    }

                    current_room_key = room_key
                    room["active_sockets"][ws] = session_info
                    room["occupied_numbers"].add(player_num)
                    ensure_room_task(room_key)

                    existing_players = [info for w, info in room["active_sockets"].items() if w != ws]

                    has_saved_map = len(room.get("saved_world_edits", {})) > 0
                    prompt_host = is_host and has_saved_map and not room["has_prompted_host"]

                    inventory = room["player_inventories"].get(parcel_str, default_inventory())

                    await ws.send_str(json.dumps({
                        "type": "login_res",
                        "success": True,
                        "session_id": session_id,
                        "display_name": display_name,
                        "player_number": player_num,
                        "is_host": is_host,
                        "room_id": room_id,
                        "max_players": MAX_PLAYERS_PER_ROOM,
                        "world_edits": room["active_world_edits"],
                        "existing_players": existing_players,
                        "occupied_numbers": list(room["occupied_numbers"]),
                        "prompt_host_load": prompt_host,
                        "world_start_time": room["world_start_time"],
                        "day_phase": room["day_phase"],
                        "mobs": list(room["mobs"].values()),
                        "inventory": inventory,
                        "appearance": appearance,
                        "hp": session_info["hp"],
                        "maxHp": session_info["maxHp"],
                    }))

                    if prompt_host:
                        room["has_prompted_host"] = True

                    print(f"[GAME] Player '{display_name}' joined room '{room_id}' (Total: {len(room['active_sockets'])}/{MAX_PLAYERS_PER_ROOM})")

                    await broadcast_room(room, {
                        "type": "player_joined",
                        "player": session_info,
                        "occupied_numbers": list(room["occupied_numbers"])
                    }, exclude_ws=ws)

                    await broadcast_room(room, {
                        "type": "player_count",
                        "count": len(room["active_sockets"]),
                        "max": MAX_PLAYERS_PER_ROOM
                    })

                elif msg_type == "host_load_decision" and current_room_key and session_info:
                    if not session_info.get("is_host"):
                        continue

                    load_saved = bool(data.get("load", False))
                    room = rooms.get(current_room_key)
                    if room and load_saved:
                        room["active_world_edits"] = dict(room.get("saved_world_edits", {}))
                        print(f"[HOST] Host loaded saved map edits ({len(room['active_world_edits'])} edits)")

                        await broadcast_room(room, {
                            "type": "reload_world_edits",
                            "world_edits": room["active_world_edits"],
                            "msg": "방장님이 이전 지도를 불러왔습니다!"
                        })

                elif msg_type == "save_map" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if room:
                        room["last_active"] = time.time()
                        save_rooms_data()
                        print(f"[MAP] Map saved by '{session_info['display_name']}' for room '{room['room_id']}'")

                        await broadcast_room(room, {
                            "type": "map_saved_notify",
                            "by": session_info["display_name"],
                            "msg": f"지도가 성공적으로 저장되었습니다! (저장한 유저: {session_info['display_name']})"
                        })

                elif msg_type == "player_state" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue

                    session_info["x"] = data.get("x", session_info["x"])
                    session_info["y"] = data.get("y", session_info["y"])
                    session_info["z"] = data.get("z", session_info["z"])
                    session_info["rotX"] = data.get("rotX", session_info["rotX"])
                    session_info["rotY"] = data.get("rotY", session_info["rotY"])
                    session_info["isMoving"] = data.get("isMoving", False)
                    session_info["selectedSlot"] = data.get("selectedSlot", 1)

                    await broadcast_room(room, {
                        "type": "player_moved",
                        "id": session_info["id"],
                        "x": session_info["x"],
                        "y": session_info["y"],
                        "z": session_info["z"],
                        "rotX": session_info["rotX"],
                        "rotY": session_info["rotY"],
                        "isMoving": session_info["isMoving"],
                        "selectedSlot": session_info["selectedSlot"]
                    }, exclude_ws=ws)

                elif msg_type == "block_change" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue

                    x = int(data.get("x"))
                    y = int(data.get("y"))
                    z = int(data.get("z"))
                    block_type = int(data.get("blockType"))

                    # Base Ground Floor (Y <= 4) is Unbreakable!
                    if y <= 4 and block_type == 0:
                        await ws.send_str(json.dumps({
                            "type": "block_denied",
                            "message": "⚠️ 가장 바닥 잔디/지형은 파괴할 수 없습니다!"
                        }))
                        continue

                    # Public crafting stations cannot be broken
                    existing_key = f"{x},{y},{z}"
                    if block_type == 0 and room["active_world_edits"].get(existing_key) in (BLOCK_CRAFTING_TABLE, BLOCK_FURNACE):
                        await ws.send_str(json.dumps({
                            "type": "block_denied",
                            "message": "⚠️ 공용 제작대/화로는 파괴할 수 없습니다!"
                        }))
                        continue

                    parcel = get_parcel_number(x, z)
                    user_num = session_info["player_number"]

                    if parcel != 0 and parcel != user_num:
                        await ws.send_str(json.dumps({
                            "type": "block_denied",
                            "message": f"해당 영역은 {parcel}번 플레이어의 개인 영역입니다!"
                        }))
                        continue

                    room["last_active"] = time.time()
                    key = f"{x},{y},{z}"
                    room["active_world_edits"][key] = block_type
                    save_rooms_data()

                    # Schedule ore respawn if a cave ore wall cell was mined
                    if block_type == 0:
                        ore_type = get_cave_ore_type(x, y, z)
                        if ore_type is not None:
                            room["ore_respawns"].append({
                                "x": x, "y": y, "z": z,
                                "ore_type": ore_type, "mined_at": time.time()
                            })

                    await broadcast_room(room, {
                        "type": "block_changed",
                        "x": x,
                        "y": y,
                        "z": z,
                        "blockType": block_type,
                        "by": session_info["display_name"]
                    })

                elif msg_type == "chat" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue

                    text = str(data.get("text", "")).strip()
                    if text:
                        await broadcast_room(room, {
                            "type": "chat_msg",
                            "sender": session_info["display_name"],
                            "text": text
                        })

                elif msg_type == "plant_sapling" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    x = int(data.get("x")); y = int(data.get("y")); z = int(data.get("z"))
                    if not in_bounds(x, z, ZONE_FOREST):
                        await ws.send_str(json.dumps({"type": "block_denied", "message": "⚠️ 묘목은 숲 구역에만 심을 수 있습니다!"}))
                        continue
                    key = f"{x},{y},{z}"
                    room["active_world_edits"][key] = BLOCK_SAPLING
                    room["saplings"].append({"x": x, "y": y, "z": z, "planted_at": time.time()})
                    room["last_active"] = time.time()
                    save_rooms_data()
                    await broadcast_room(room, {"type": "block_changed", "x": x, "y": y, "z": z, "blockType": BLOCK_SAPLING, "by": session_info["display_name"]})

                elif msg_type == "attack_entity" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    target_id = str(data.get("targetId", ""))
                    dmg = max(1, min(50, int(data.get("dmg", 1))))
                    mob = room["mobs"].get(target_id)
                    if not mob:
                        continue
                    mob["hp"] -= dmg
                    if mob["hp"] <= 0:
                        loot = LOOT_TABLE.get(mob["type"], {})
                        pnum = str(session_info["player_number"])
                        inv = room["player_inventories"].setdefault(pnum, default_inventory())
                        for item, qty in loot.items():
                            inv["resources"][item] = inv["resources"].get(item, 0) + qty
                        del room["mobs"][target_id]
                        save_rooms_data()
                        await ws.send_str(json.dumps({"type": "inventory_sync", "inventory": inv}))
                        await broadcast_room(room, {"type": "entity_removed", "ids": [target_id], "reason": "killed"})
                    else:
                        await broadcast_room(room, {"type": "entity_update", "mobs": [mob]})

                elif msg_type == "attack_player" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    target_id = str(data.get("targetId", ""))
                    dmg = max(1, min(50, int(data.get("dmg", 1))))

                    attacker_in_zone = in_bounds(session_info["x"], session_info["z"], ZONE_PVP_ARENA)
                    target_info = None
                    for info in room["active_sockets"].values():
                        if info["id"] == target_id:
                            target_info = info
                            break

                    if not target_info or not attacker_in_zone or not in_bounds(target_info["x"], target_info["z"], ZONE_PVP_ARENA):
                        await ws.send_str(json.dumps({"type": "attack_result", "hit": False, "reason": "PVP 아레나 안에서만 공격할 수 있습니다."}))
                        continue

                    await apply_player_damage(room, target_info, dmg)
                    await ws.send_str(json.dumps({"type": "attack_result", "hit": True}))

                elif msg_type == "hp_delta" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    delta = int(data.get("delta", 0))
                    if delta < 0:
                        await apply_player_damage(room, session_info, -delta)
                    else:
                        session_info["hp"] = clamp(session_info["hp"] + delta, 0, session_info["maxHp"])
                        await ws.send_str(json.dumps({"type": "player_hp", "hp": session_info["hp"], "maxHp": session_info["maxHp"]}))

                elif msg_type == "inventory_update" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    pnum = str(session_info["player_number"])
                    inv = data.get("inventory")
                    if isinstance(inv, dict):
                        room["player_inventories"][pnum] = inv
                        room["last_active"] = time.time()
                        save_rooms_data()

                elif msg_type == "appearance_update" and current_room_key and session_info:
                    room = rooms.get(current_room_key)
                    if not room:
                        continue
                    appearance = data.get("appearance")
                    if isinstance(appearance, dict):
                        pnum = str(session_info["player_number"])
                        room["appearances"][pnum] = appearance
                        session_info["appearance"] = appearance
                        save_rooms_data()
                        await broadcast_room(room, {
                            "type": "appearance_changed",
                            "id": session_info["id"],
                            "appearance": appearance
                        })

            elif msg.type == WSMsgType.ERROR:
                print(f"[WS] Connection error: {ws.exception()}")

    finally:
        if current_room_key and current_room_key in rooms:
            room = rooms[current_room_key]
            if ws in room["active_sockets"]:
                info = room["active_sockets"].pop(ws)
                user_num = info["player_number"]
                if user_num in room["occupied_numbers"]:
                    room["occupied_numbers"].remove(user_num)

                room["last_active"] = time.time()
                print(f"[GAME] Player '{info['display_name']}' left room '{room['room_id']}' (Total: {len(room['active_sockets'])}/{MAX_PLAYERS_PER_ROOM})")

                await broadcast_room(room, {
                    "type": "player_left",
                    "id": info["id"],
                    "display_name": info["display_name"],
                    "occupied_numbers": list(room["occupied_numbers"])
                })
                await broadcast_room(room, {
                    "type": "player_count",
                    "count": len(room["active_sockets"]),
                    "max": MAX_PLAYERS_PER_ROOM
                })

            save_rooms_data()

    return ws


async def index_handler(request):
    return web.FileResponse(BASE_DIR / "index.html")


async def check_room_handler(request):
    room_id = request.query.get("id", "").strip()
    matched_room = next((r for r in rooms.values() if r.get("room_id") == room_id), None)
    registered_numbers = []
    if matched_room:
        try:
            registered_numbers = sorted(int(n) for n in matched_room.get("parcel_passwords", {}).keys())
        except (TypeError, ValueError):
            registered_numbers = []
    return web.json_response(
        {
            "exists": matched_room is not None,
            "valid_length": len(room_id) >= 4,
            "registered_numbers": registered_numbers,
        },
        headers={"Access-Control-Allow-Origin": "*"}
    )


async def start_background_tasks(app):
    app['cleanup_task'] = asyncio.create_task(periodic_cleanup_task(app))


async def cleanup_background_tasks(app):
    app['cleanup_task'].cancel()
    await app['cleanup_task']
    for task in list(room_tasks.values()):
        task.cancel()


def create_app():
    load_rooms_data()
    app = web.Application()
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/api/check-room', check_room_handler)
    app.router.add_get('/', index_handler)
    app.router.add_static('/', path=str(BASE_DIR))
    return app


if __name__ == "__main__":
    print("=" * 60)
    print(f"  [KING MATH CRAFT] Web Server Running!")
    print(f"  [URL] http://0.0.0.0:{PORT}")
    print(f"  [LIMIT] Max Players per Room: {MAX_PLAYERS_PER_ROOM}")
    print(f"  [PARCELS] 32 Parcels (15x15 blocks each) + 4 Corner Living Rooms")
    print("=" * 60)

    app = create_app()
    web.run_app(app, host=HOST, port=PORT)
