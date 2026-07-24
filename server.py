import asyncio
import json
import os
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

# Configurations
HOST = "0.0.0.0"
PORT = 8000
MAX_PLAYERS_PER_ROOM = 32  # Up to 32 players (1번~32번) simultaneously
DATA_PURGE_TIMEOUT = 30 * 24 * 3600  # 30 days in seconds (2,592,000s)

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
ROOMS_FILE = DATA_DIR / "rooms_meta.json"

# In-memory room storage
rooms = {}

# 15x15 Parcel Math (-60 to 59 Central Plaza, Corner Living Rooms, 32 Border Parcels)
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
                        "has_prompted_host": False
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
                "parcel_passwords": r_data.get("parcel_passwords", {})
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
                            "has_prompted_host": False
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

                    session_info = {
                        "id": session_id,
                        "username": room_id,
                        "display_name": display_name,
                        "player_number": player_num,
                        "is_host": is_host,
                        "x": 0.0,
                        "y": 5.0,
                        "z": 0.0,
                        "rotX": 0.0,
                        "rotY": 0.0,
                        "isMoving": False,
                        "selectedSlot": 1
                    }

                    current_room_key = room_key
                    room["active_sockets"][ws] = session_info
                    room["occupied_numbers"].add(player_num)

                    existing_players = [info for w, info in room["active_sockets"].items() if w != ws]

                    has_saved_map = len(room.get("saved_world_edits", {})) > 0
                    prompt_host = is_host and has_saved_map and not room["has_prompted_host"]

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
                        "prompt_host_load": prompt_host
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

async def start_background_tasks(app):
    app['cleanup_task'] = asyncio.create_task(periodic_cleanup_task(app))

async def cleanup_background_tasks(app):
    app['cleanup_task'].cancel()
    await app['cleanup_task']

def create_app():
    load_rooms_data()
    app = web.Application()
    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    app.router.add_get('/ws', websocket_handler)
    app.router.add_get('/', index_handler)
    app.router.add_static('/', path=str(BASE_DIR))
    return app

if __name__ == "__main__":
    print("=" * 60)
    print(f"  [KING MATH CRAFT] Web Server Running!")
    print(f"  [URL] http://localhost:{PORT}")
    print(f"  [LIMIT] Max Players per Room: {MAX_PLAYERS_PER_ROOM}")
    print(f"  [PARCELS] 32 Parcels (15x15 blocks each) + 4 Corner Living Rooms")
    print("=" * 60)

    app = create_app()
    web.run_app(app, host=HOST, port=PORT)
