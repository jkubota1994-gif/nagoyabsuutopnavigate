"""
convert_gtfs.py - 名古屋市営バス GTFS-JP データ取得・変換スクリプト
BODIK CKAN API から最新の GTFS ZIP を自動取得し、Webアプリ用に最適化された軽量JSONを生成します。
"""

import os
import sys
import json
import zipfile
import urllib.request
import csv
import io
import re
from datetime import datetime

# 設定
CKAN_PACKAGE_URL = "https://data.bodik.jp/api/3/action/package_show?id=231002_7109030000_bus-gtfs-jp"
FALLBACK_ZIP_URL = "https://data.bodik.jp/dataset/c5794008-8053-42ab-99b9-ee7f6fdf9a9e/resource/125a1d12-7df6-489c-abde-911856e05d1b/download/20260328_bus-gtfs-jp.zip"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
LOCAL_ZIP_PATH = os.path.join(SCRIPTS_DIR, "gtfs.zip")

def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(SCRIPTS_DIR, exist_ok=True)

def fetch_latest_gtfs_url():
    print("[1/5] 最新の GTFS ZIP URL を CKAN API より確認中...")
    try:
        req = urllib.request.Request(
            CKAN_PACKAGE_URL,
            headers={"User-Agent": "NagoyaBusStopNavigator/1.0 (Python)"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success"):
                resources = data["result"].get("resources", [])
                zip_resources = [r for r in resources if r.get("format", "").upper() == "ZIP" or "zip" in r.get("url", "").lower()]
                if zip_resources:
                    # 最新のリソースを取得
                    latest = zip_resources[-1]
                    url = latest.get("url")
                    name = latest.get("name", "latest")
                    print(f"  -> 検出された最新リソース: {name}")
                    print(f"  -> URL: {url}")
                    return url
    except Exception as e:
        print(f"  -> CKAN API アクセス失敗 ({e})。フォールバックURLを使用します。")
    return FALLBACK_ZIP_URL

def download_gtfs_zip(url):
    print(f"[2/5] GTFS ZIP ファイルをダウンロード中: {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "NagoyaBusStopNavigator/1.0 (Python)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp, open(LOCAL_ZIP_PATH, "wb") as out_file:
        total_size = int(resp.headers.get('content-length', 0))
        downloaded = 0
        block_size = 1024 * 64
        while True:
            chunk = resp.read(block_size)
            if not chunk:
                break
            out_file.write(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                percent = int(downloaded * 100 / total_size)
                sys.stdout.write(f"\r  ダウンロード進捗: {percent}% ({downloaded / 1024 / 1024:.1f}MB)")
                sys.stdout.flush()
        print("\n  ダウンロード完了!")

def read_csv_from_zip(zf, filename):
    """ZIP内のCSVファイルをエンコーディング自動判定（utf-8-sig / utf-8 / cp932）で読み込み辞書リストを返す"""
    matched = [name for name in zf.namelist() if os.path.basename(name).lower() == filename.lower()]
    if not matched:
        return []
    target_name = matched[0]
    raw_data = zf.read(target_name)
    
    # エンコーディング判定
    for enc in ["utf-8-sig", "utf-8", "cp932"]:
        try:
            text = raw_data.decode(enc)
            f = io.StringIO(text)
            reader = csv.DictReader(f)
            return list(reader)
        except Exception:
            continue
    raise ValueError(f"CSVファイルのデコードに失敗しました: {filename}")

def parse_calendar(calendar_rows, calendar_dates_rows):
    """
    service_id の平日/土曜/休日の分類を作成
    """
    service_days = {}
    for row in calendar_rows:
        s_id = row.get("service_id")
        monday = int(row.get("monday", 0))
        tuesday = int(row.get("tuesday", 0))
        wednesday = int(row.get("wednesday", 0))
        thursday = int(row.get("thursday", 0))
        friday = int(row.get("friday", 0))
        saturday = int(row.get("saturday", 0))
        sunday = int(row.get("sunday", 0))
        
        # 平日・土曜・休日フラグ
        is_weekday = (monday == 1 or tuesday == 1 or wednesday == 1 or thursday == 1 or friday == 1) and saturday == 0 and sunday == 0
        is_sat = saturday == 1 and monday == 0 and sunday == 0
        is_sun = sunday == 1 and monday == 0 and saturday == 0
        
        if is_weekday:
            cat = "weekday"
        elif is_sat:
            cat = "saturday"
        elif is_sun:
            cat = "holiday"
        else:
            # 判別つかない場合のフォールバック（例：土日運行など）
            if saturday == 1 and sunday == 1:
                cat = "holiday"
            elif is_weekday:
                cat = "weekday"
            else:
                cat = "weekday"
        service_days[s_id] = cat
        
    return service_days

def process_gtfs():
    ensure_dirs()
    
    if not os.path.exists(LOCAL_ZIP_PATH):
        url = fetch_latest_gtfs_url()
        download_gtfs_zip(url)
    else:
        print(f"[2/5] 既存の GTFS ZIP ファイル ({LOCAL_ZIP_PATH}) を使用します。")
        
    print("[3/5] GTFS データの解析中...")
    with zipfile.ZipFile(LOCAL_ZIP_PATH, 'r') as zf:
        stops_rows = read_csv_from_zip(zf, "stops.txt")
        routes_rows = read_csv_from_zip(zf, "routes.txt")
        trips_rows = read_csv_from_zip(zf, "trips.txt")
        stop_times_rows = read_csv_from_zip(zf, "stop_times.txt")
        calendar_rows = read_csv_from_zip(zf, "calendar.txt")
        calendar_dates_rows = read_csv_from_zip(zf, "calendar_dates.txt")
        
    print(f"  - stops: {len(stops_rows)} 件")
    print(f"  - routes: {len(routes_rows)} 件")
    print(f"  - trips: {len(trips_rows)} 件")
    print(f"  - stop_times: {len(stop_times_rows)} 件")
    print(f"  - calendar: {len(calendar_rows)} 件")

    service_days = parse_calendar(calendar_rows, calendar_dates_rows)
    
    # 1. バス停データの整理
    # location_type: 0 または空 = 標柱（ポール/のりば）, 1 = 親停留所
    stops = []
    parents = {}
    stop_map = {} # id -> stop obj
    
    for row in stops_rows:
        s_id = row.get("stop_id", "").strip()
        s_name = row.get("stop_name", "").strip()
        try:
            s_lat = float(row.get("stop_lat", 0))
            s_lon = float(row.get("stop_lon", 0))
        except ValueError:
            continue
            
        loc_type = int(row.get("location_type", 0) or 0)
        parent_id = row.get("parent_station", "").strip()
        platform_code = row.get("platform_code", "").strip()
        
        stop_obj = {
            "id": s_id,
            "name": s_name,
            "lat": round(s_lat, 6),
            "lon": round(s_lon, 6),
            "locationType": loc_type,
            "parentStation": parent_id,
            "platformCode": platform_code
        }
        stop_map[s_id] = stop_obj
        
        if loc_type == 1:
            parents[s_id] = stop_obj
        else:
            stops.append(stop_obj)

    # 2. 系統・路線データの整理
    routes_map = {}
    for row in routes_rows:
        r_id = row.get("route_id", "").strip()
        short_name = row.get("route_short_name", "").strip()
        long_name = row.get("route_long_name", "").strip()
        r_color = row.get("route_color", "").strip()
        r_text_color = row.get("route_text_color", "").strip()
        
        routes_map[r_id] = {
            "routeId": r_id,
            "shortName": short_name or long_name,
            "longName": long_name,
            "color": f"#{r_color}" if r_color and not r_color.startswith("#") else (r_color or "#1976d2"),
            "textColor": f"#{r_text_color}" if r_text_color and not r_text_color.startswith("#") else (r_text_color or "#ffffff"),
            "patterns": [] # 方向ごとの停車順序パターン
        }

    # 3. 便と通過時刻データの整理
    print("[4/5] 停車パターン・逆引きインデックス・時刻表を構築中...")
    
    trip_map = {}
    for row in trips_rows:
        t_id = row.get("trip_id", "").strip()
        r_id = row.get("route_id", "").strip()
        s_id = row.get("service_id", "").strip()
        headsign = row.get("trip_headsign", "").strip()
        dir_id = int(row.get("direction_id", 0) or 0)
        
        trip_map[t_id] = {
            "tripId": t_id,
            "routeId": r_id,
            "serviceId": s_id,
            "headsign": headsign,
            "directionId": dir_id,
            "stopTimes": [] # [{stopId, seq, arrTime, depTime}]
        }
        
    for row in stop_times_rows:
        t_id = row.get("trip_id", "").strip()
        if t_id not in trip_map:
            continue
        s_id = row.get("stop_id", "").strip()
        seq = int(row.get("stop_sequence", 0))
        arr_time = row.get("arrival_time", "").strip()
        dep_time = row.get("departure_time", "").strip()
        
        trip_map[t_id]["stopTimes"].append({
            "stopId": s_id,
            "seq": seq,
            "depTime": dep_time or arr_time
        })
        
    # 各便の stopTimes を sequence 昇順にソート
    for t_id, t_info in trip_map.items():
        t_info["stopTimes"].sort(key=lambda x: x["seq"])
        
    # 系統・行先ごとの代表パターン（最も停車数が多いユニークパターン）を抽出
    # key: (routeId, directionId, headsign) -> list of stop_ids
    route_patterns = {} # (routeId, directionId, headsign) -> {stops: tuple, count: int}
    
    # 時刻表構造: timetables[stop_id][route_key] = { headsign, shortName, color, weekday: [], saturday: [], holiday: [] }
    timetables = {}
    
    # 逆引きインデックス: stop_id -> list of { routeId, shortName, headsign, nextStops: [...] }
    stop_route_index = {}
    
    for t_id, t_info in trip_map.items():
        r_id = t_info["routeId"]
        dir_id = t_info["directionId"]
        headsign = t_info["headsign"]
        service_id = t_info["serviceId"]
        day_type = service_days.get(service_id, "weekday")
        r_info = routes_map.get(r_id, {})
        short_name = r_info.get("shortName", "")
        r_color = r_info.get("color", "#1976d2")
        
        stop_seq_ids = [st["stopId"] for st in t_info["stopTimes"]]
        if not stop_seq_ids:
            continue
            
        pattern_key = (r_id, dir_id, headsign)
        stop_tuple = tuple(stop_seq_ids)
        
        if pattern_key not in route_patterns:
            route_patterns[pattern_key] = {}
        if stop_tuple not in route_patterns[pattern_key]:
            route_patterns[pattern_key][stop_tuple] = 0
        route_patterns[pattern_key][stop_tuple] += 1
        
        # 時刻表登録
        for idx, st in enumerate(t_info["stopTimes"]):
            s_id = st["stopId"]
            dep_time = st["depTime"]
            if not dep_time:
                continue
            # 終点の場合は発車時刻表に載せない（降車専用）
            if idx == len(t_info["stopTimes"]) - 1:
                continue
                
            # HH:MM:SS -> HH:MM に整形
            time_parts = dep_time.split(":")
            if len(time_parts) >= 2:
                time_str = f"{int(time_parts[0]):02d}:{time_parts[1]}"
            else:
                time_str = dep_time
                
            if s_id not in timetables:
                timetables[s_id] = {}
            # route_sub_key: routeId_directionId_headsign
            route_sub_key = f"{r_id}_{dir_id}_{headsign}"
            if route_sub_key not in timetables[s_id]:
                # [weekday_times, saturday_times, holiday_times]
                timetables[s_id][route_sub_key] = {
                    "w": [],
                    "s": [],
                    "h": []
                }
            day_key = "w" if day_type == "weekday" else ("s" if day_type == "saturday" else "h")
            timetables[s_id][route_sub_key][day_key].append(time_str)

    # 時刻表のソートと重複除去
    for s_id in timetables:
        for r_sub_key in timetables[s_id]:
            for d_key in ["w", "s", "h"]:
                times = sorted(list(set(timetables[s_id][r_sub_key][d_key])))
                timetables[s_id][r_sub_key][d_key] = times

    # 最多運行されているパターンを代表パターンとして各 route に設定
    for (r_id, dir_id, headsign), tuples_dict in route_patterns.items():
        if r_id not in routes_map:
            continue
        # 最も便数が多い順（同数なら停車駅が多い順）
        best_stops_tuple = sorted(tuples_dict.keys(), key=lambda t: (tuples_dict[t], len(t)), reverse=True)[0]
        
        pattern_idx = len(routes_map[r_id]["patterns"])
        pattern_obj = {
            "headsign": headsign,
            "directionId": dir_id,
            "stops": list(best_stops_tuple)
        }
        routes_map[r_id]["patterns"].append(pattern_obj)
        
        # 逆引きインデックスの構築 (超軽量化: 系統ID, パターン番号, 停車順インデックスのみ格納)
        stops_list = list(best_stops_tuple)
        for idx, s_id in enumerate(stops_list):
            if s_id not in stop_route_index:
                stop_route_index[s_id] = []
            
            # 終点でなければ乗車可能系統として登録
            if idx < len(stops_list) - 1:
                # 重複登録を避ける
                exists = any(
                    item[0] == r_id and item[1] == pattern_idx
                    for item in stop_route_index[s_id]
                )
                if not exists:
                    # [routeId, patternIdx, stopIdx]
                    stop_route_index[s_id].append([r_id, pattern_idx, idx])

    # 有効な系統のみに絞り込み
    active_routes = {r["routeId"]: r for r in routes_map.values() if r["patterns"]}
    
    print("[5/5] JSONファイルの書き出し中...")
    
    # 1. bus_stops.json
    bus_stops_data = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "totalStops": len(stops),
        "stops": stops,
        "parents": list(parents.values())
    }
    stops_file_path = os.path.join(DATA_DIR, "bus_stops.json")
    with open(stops_file_path, "w", encoding="utf-8") as f:
        json.dump(bus_stops_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  -> bus_stops.json 作成完了 ({os.path.getsize(stops_file_path) / 1024:.1f} KB)")
    
    # 2. bus_routes.json
    bus_routes_data = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "totalRoutes": len(active_routes),
        "routes": active_routes,
        "stopRouteIndex": stop_route_index
    }
    routes_file_path = os.path.join(DATA_DIR, "bus_routes.json")
    with open(routes_file_path, "w", encoding="utf-8") as f:
        json.dump(bus_routes_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  -> bus_routes.json 作成完了 ({os.path.getsize(routes_file_path) / 1024:.1f} KB)")
    
    # 3. bus_timetables.json
    bus_timetables_data = {
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "timetables": timetables
    }
    timetables_file_path = os.path.join(DATA_DIR, "bus_timetables.json")
    with open(timetables_file_path, "w", encoding="utf-8") as f:
        json.dump(bus_timetables_data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  -> bus_timetables.json 作成完了 ({os.path.getsize(timetables_file_path) / 1024:.1f} KB)")
    
    print("\nGTFS conversion finished successfully!")

if __name__ == "__main__":
    process_gtfs()
