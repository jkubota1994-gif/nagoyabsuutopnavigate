/**
 * modules/subway.js - 名古屋市営地下鉄ネットワーク・ハイブリッドルート探索モジュール
 */

import { CONFIG } from '../config.js';
import { calculateDistance, formatDistanceAndWalkingTime } from './stops.js';

let subwayLines = [];
let subwayStations = [];
let stationMap = new Map(); // name -> station

/**
 * 地下鉄ネットワークデータのロード
 */
export async function loadSubwayData() {
  if (subwayLines.length > 0) return { subwayLines, subwayStations };

  const resp = await fetch('./data/subway_network.json');
  if (!resp.ok) {
    throw new Error(`地下鉄データの取得に失敗しました (HTTP ${resp.status})`);
  }

  const json = await resp.json();
  subwayLines = json.lines || [];
  subwayStations = json.stations || [];

  stationMap.clear();
  subwayStations.forEach(st => {
    stationMap.set(st.name, st);
  });

  return { subwayLines, subwayStations };
}

/**
 * 指定地点の最寄り地下鉄駅を探索
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radiusMeters 
 * @param {number} maxResults 
 */
export function findNearbySubwayStations(lat, lon, radiusMeters = 1500, maxResults = 5) {
  if (subwayStations.length === 0) return [];

  const nearby = [];
  for (const st of subwayStations) {
    const dist = calculateDistance(lat, lon, st.lat, st.lon);
    if (dist <= radiusMeters) {
      const fmt = formatDistanceAndWalkingTime(dist);
      nearby.push({
        ...st,
        distance: dist,
        distanceText: fmt.distanceText,
        walkingTimeText: fmt.walkingTimeText,
        durationMin: Math.max(1, Math.ceil(dist / CONFIG.walkingSpeedMeterPerMin))
      });
    }
  }

  nearby.sort((a, b) => a.distance - b.distance);

  // 指定半径内にない場合、最も近い2駅を返す
  if (nearby.length === 0) {
    const all = subwayStations.map(st => {
      const dist = calculateDistance(lat, lon, st.lat, st.lon);
      const fmt = formatDistanceAndWalkingTime(dist);
      return {
        ...st,
        distance: dist,
        distanceText: fmt.distanceText,
        walkingTimeText: fmt.walkingTimeText,
        durationMin: Math.max(1, Math.ceil(dist / CONFIG.walkingSpeedMeterPerMin))
      };
    });
    all.sort((a, b) => a.distance - b.distance);
    return all.slice(0, 2);
  }

  return nearby.slice(0, maxResults);
}

/**
 * 2つの地下鉄駅間の直通路線を探索 (非再帰)
 * @param {string} originStationName 
 * @param {string} destStationName 
 */
export function findDirectSubwayRoute(originStationName, destStationName) {
  if (!originStationName || !destStationName || originStationName === destStationName) return null;

  for (const line of subwayLines) {
    const stNames = line.stations.map(s => s.name);
    const origIdx = stNames.indexOf(originStationName);
    const destIdx = stNames.indexOf(destStationName);

    if (origIdx !== -1 && destIdx !== -1) {
      const stepCount = Math.abs(destIdx - origIdx);
      const directionForward = destIdx > origIdx;
      const termStation = directionForward ? line.stations[line.stations.length - 1].name : line.stations[0].name;

      const pathStations = directionForward
        ? line.stations.slice(origIdx, destIdx + 1)
        : line.stations.slice(destIdx, origIdx + 1).reverse();

      const rideMin = Math.max(2, Math.round(stepCount * 2.0)); // 地下鉄は1駅約2分

      return {
        isDirect: true,
        lineId: line.id,
        lineName: line.name,
        color: line.color,
        textColor: line.textColor,
        headsign: `${termStation} 方面`,
        boardingStation: pathStations[0],
        alightingStation: pathStations[pathStations.length - 1],
        stationsCount: stepCount,
        rideMinutes: rideMin,
        pathCoordinates: pathStations.map(s => [s.lat, s.lon]),
        intermediateStations: pathStations
      };
    }
  }

  return null;
}

/**
 * 2つの地下鉄駅間の最適地下鉄ルート（直通または1回乗換）を探索
 * @param {string} originStationName 
 * @param {string} destStationName 
 */
export function findSubwayRoute(originStationName, destStationName) {
  if (!originStationName || !destStationName || originStationName === destStationName) return null;

  // 1. 直通路線をチェック
  const directRoute = findDirectSubwayRoute(originStationName, destStationName);
  if (directRoute) return directRoute;

  // 2. 乗換1回ルートをチェック (主要乗換駅: 栄, 伏見, 名古屋, 久屋大通, 今池, 本山, 八事, 御器所, 新瑞橋, 金山, 丸の内, 平安通)
  const transferCandidateStations = [
    "栄", "伏見", "名古屋", "久屋大通", "今池", "本山", "八事", "御器所", "新瑞橋", "金山", "丸の内", "平安通"
  ];

  let bestTransferRoute = null;

  for (const transName of transferCandidateStations) {
    if (transName === originStationName || transName === destStationName) continue;

    const leg1 = findDirectSubwayRoute(originStationName, transName);
    const leg2 = findDirectSubwayRoute(transName, destStationName);

    if (leg1 && leg2 && leg1.lineId !== leg2.lineId) {
      const totalStations = leg1.stationsCount + leg2.stationsCount;
      const transferWait = 4; // 乗換標準4分
      const totalRideMin = leg1.rideMinutes + transferWait + leg2.rideMinutes;

      const plan = {
        isDirect: false,
        transferStation: stationMap.get(transName) || { name: transName, lat: leg1.alightingStation.lat, lon: leg1.alightingStation.lon },
        leg1: leg1,
        leg2: leg2,
        totalStations: totalStations,
        totalRideMinutes: totalRideMin,
        pathCoordinates: [...leg1.pathCoordinates, ...leg2.pathCoordinates]
      };

      if (!bestTransferRoute || totalRideMin < bestTransferRoute.totalRideMinutes) {
        bestTransferRoute = plan;
      }
    }
  }

  return bestTransferRoute;
}

/**
 * 出発地座標と目的地座標から、地下鉄を活用したハイブリッドルートを探索
 * @param {number} fromLat 
 * @param {number} fromLon 
 * @param {number} toLat 
 * @param {number} toLon 
 * @returns {Array<Object>}
 */
export function findSubwayHybridPlans(fromLat, fromLon, toLat, toLon) {
  const originSubways = findNearbySubwayStations(fromLat, fromLon, 1200, 3);
  const destSubways = findNearbySubwayStations(toLat, toLon, 1200, 3);

  if (originSubways.length === 0 || destSubways.length === 0) {
    return [];
  }

  const plans = [];
  const seenPairs = new Set();

  for (const oSub of originSubways) {
    for (const dSub of destSubways) {
      if (oSub.name === dSub.name) continue;

      const pairKey = `${oSub.name}->${dSub.name}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const subwayRoute = findSubwayRoute(oSub.name, dSub.name);
      if (!subwayRoute) continue;

      const walk1Min = oSub.durationMin;
      const walk2Min = dSub.durationMin;
      const subwayMin = subwayRoute.isDirect ? subwayRoute.rideMinutes : subwayRoute.totalRideMinutes;
      const totalMin = walk1Min + subwayMin + walk2Min;

      plans.push({
        type: 'subway_hybrid',
        totalDurationMin: totalMin,
        originWalk: {
          toStation: oSub,
          distance: oSub.distance,
          distanceText: oSub.distanceText,
          durationMin: walk1Min,
          durationText: `徒歩 約${walk1Min}分`
        },
        subway: subwayRoute,
        destWalk: {
          fromStation: dSub,
          distance: dSub.distance,
          distanceText: dSub.distanceText,
          durationMin: walk2Min,
          durationText: `徒歩 約${walk2Min}分`
        },
        totalWalkingDistance: oSub.distance + dSub.distance
      });
    }
  }

  plans.sort((a, b) => a.totalDurationMin - b.totalDurationMin);
  return plans.slice(0, 3);
}
