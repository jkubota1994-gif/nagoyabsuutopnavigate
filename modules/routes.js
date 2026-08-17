/**
 * modules/routes.js - バス路線・系統・行先・停車バス停一覧モジュール
 */

import { CONFIG } from '../config.js';
import { getStopById, findNearbyStops } from './stops.js';

let routesData = {}; // routeId -> route info
let stopRouteIndex = {}; // stopId -> [ [routeId, patternIdx, stopIdx], ... ]

/**
 * 系統・路線データのロード
 */
export async function loadBusRoutesData() {
  if (Object.keys(routesData).length > 0) return { routesData, stopRouteIndex };

  const response = await fetch(CONFIG.data.routes);
  if (!response.ok) {
    throw new Error(`系統データの取得に失敗しました (HTTP ${response.status})`);
  }

  const json = await response.json();
  routesData = json.routes || {};
  stopRouteIndex = json.stopRouteIndex || {};

  return { routesData, stopRouteIndex };
}

/**
 * 指定したバス停（標柱）から乗車できる系統・行先一覧を取得
 * @param {string} stopId 
 * @returns {Array} 系統・行先・この先の停車バス停情報
 */
export function getRoutesForStop(stopId) {
  const indexEntries = stopRouteIndex[stopId] || [];
  const results = [];

  for (const [rId, patternIdx, stopIdx] of indexEntries) {
    const route = routesData[rId];
    if (!route || !route.patterns || !route.patterns[patternIdx]) continue;

    const pattern = route.patterns[patternIdx];
    const headsign = pattern.headsign;
    const allStopIds = pattern.stops || [];

    // この先の停車バス停（自分より後の停留所）
    const nextStopIds = allStopIds.slice(stopIdx + 1);
    const nextStops = nextStopIds.map(nid => {
      const s = getStopById(nid);
      return {
        id: nid,
        name: s ? s.name : nid,
        platformCode: s ? s.platformCode : '',
        lat: s ? s.lat : null,
        lon: s ? s.lon : null
      };
    });

    results.push({
      routeId: rId,
      shortName: route.shortName || rId,
      longName: route.longName || '',
      color: route.color || '#1976d2',
      textColor: route.textColor || '#ffffff',
      headsign: headsign,
      directionId: pattern.directionId,
      patternIdx: patternIdx,
      currentStopIdx: stopIdx,
      totalStopsInPattern: allStopIds.length,
      remainingStopsCount: nextStops.length,
      nextStops: nextStops,
      finalDestination: nextStops.length > 0 ? nextStops[nextStops.length - 1].name : headsign
    });
  }

  return results;
}

/**
 * 系統IDとパターン番号から、停車バス停すべての座標リストを取得（地図ポリライン描画用）
 * @param {string} routeId 
 * @param {number} patternIdx 
 * @returns {{ coordinates: Array<[number, number]>, stops: Array<Object>, color: string }}
 */
export function getRoutePatternGeometry(routeId, patternIdx = 0) {
  const route = routesData[routeId];
  if (!route || !route.patterns || !route.patterns[patternIdx]) {
    return { coordinates: [], stops: [], color: '#1976d2' };
  }

  const pattern = route.patterns[patternIdx];
  const stopIds = pattern.stops || [];
  const coordinates = [];
  const stopsList = [];

  for (const sid of stopIds) {
    const s = getStopById(sid);
    if (s && s.lat && s.lon) {
      coordinates.push([s.lat, s.lon]);
      stopsList.push(s);
    }
  }

  return {
    coordinates,
    stops: stopsList,
    color: route.color || '#1976d2',
    shortName: route.shortName || routeId,
    headsign: pattern.headsign
  };
}

/**
 * 2つのバス停間（乗車バス停 → 降車バス停）を直通で結ぶ系統を検索
 * @param {string} originStopId 
 * @param {string} destStopId 
 */
export function findDirectRoutesBetweenStops(originStopId, destStopId) {
  const availableRoutes = getRoutesForStop(originStopId);
  const directRoutes = [];

  for (const r of availableRoutes) {
    const targetIdx = r.nextStops.findIndex(ns => ns.id === destStopId);
    if (targetIdx !== -1) {
      directRoutes.push({
        ...r,
        stopsCountToDestination: targetIdx + 1,
        intermediateStops: r.nextStops.slice(0, targetIdx + 1)
      });
    }
  }

  return directRoutes;
}

/**
 * 出発地座標と目的地座標から、最適なバス利用ルート（直通 ＆ 乗換1回ルート）を総合探索
 * @param {number} fromLat - 出発地緯度（現在地）
 * @param {number} fromLon - 出発地経度
 * @param {number} toLat - 目的地緯度
 * @param {number} toLon - 目的地経度
 * @param {number} searchRadius - バス停検索半径 (m)
 * @returns {Array<Object>} 候補ルート一覧（直通優先・所要時間順）
 */
export function findTransitRoutesBetweenPoints(fromLat, fromLon, toLat, toLon, searchRadius = 1000) {
  // 1. 出発地周辺の乗車候補バス停
  const originCandidateStops = findNearbyStops(fromLat, fromLon, searchRadius, 15);
  // 2. 目的地周辺の降車候補バス停
  const destCandidateStops = findNearbyStops(toLat, toLon, searchRadius, 15);

  if (originCandidateStops.length === 0 || destCandidateStops.length === 0) {
    return [];
  }

  const directPlans = [];
  const transferPlans = [];
  const seenDirectKeys = new Set();
  const seenTransferKeys = new Set();

  // 出発候補バス停から行ける全停留所マップ (stopId -> list of leg1 info)
  const reachableFromOrigin = new Map();

  for (const origStop of originCandidateStops) {
    const entries = stopRouteIndex[origStop.id] || [];
    for (const [rId, pIdx, sIdx] of entries) {
      const route = routesData[rId];
      if (!route || !route.patterns || !route.patterns[pIdx]) continue;
      const pattern = route.patterns[pIdx];
      const allStops = pattern.stops || [];
      const downstreamStops = allStops.slice(sIdx + 1);

      for (let dIdx = 0; dIdx < downstreamStops.length; dIdx++) {
        const destId = downstreamStops[dIdx];
        if (!reachableFromOrigin.has(destId)) {
          reachableFromOrigin.set(destId, []);
        }
        reachableFromOrigin.get(destId).push({
          origStop,
          route,
          pattern,
          patternIdx: pIdx,
          stopsCount: dIdx + 1,
          intermediateIds: downstreamStops.slice(0, dIdx + 1)
        });
      }
    }
  }

  // A. 直通ルート探索
  for (const destStop of destCandidateStops) {
    const leg1List = reachableFromOrigin.get(destStop.id);
    if (!leg1List) continue;

    for (const leg1 of leg1List) {
      const origStop = leg1.origStop;
      const route = leg1.route;
      const pattern = leg1.pattern;

      const dedupKey = `${origStop.name}_${origStop.platformCode}_${route.shortName}_${pattern.headsign}_${destStop.name}`;
      if (seenDirectKeys.has(dedupKey)) continue;
      seenDirectKeys.add(dedupKey);

      const walkFromOriginDist = origStop.distance;
      const walkToDestDist = destStop.distance;
      const busStopsCount = leg1.stopsCount;

      const walkOriginMin = Math.max(1, Math.ceil(walkFromOriginDist / CONFIG.walkingSpeedMeterPerMin));
      const walkDestMin = Math.max(1, Math.ceil(walkToDestDist / CONFIG.walkingSpeedMeterPerMin));
      const busRideMin = Math.max(3, Math.round(busStopsCount * 2.2));
      const totalDurationMin = walkOriginMin + busRideMin + walkDestMin;

      const intermediateStops = leg1.intermediateIds.map(nid => {
        const s = getStopById(nid);
        return {
          id: nid,
          name: s ? s.name : nid,
          lat: s ? s.lat : null,
          lon: s ? s.lon : null
        };
      });

      const busPathCoordinates = [
        [origStop.lat, origStop.lon],
        ...intermediateStops.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon])
      ];

      directPlans.push({
        isDirect: true,
        transferCount: 0,
        originWalk: {
          fromCoords: [fromLat, fromLon],
          toStop: origStop,
          distance: walkFromOriginDist,
          distanceText: origStop.distanceText,
          durationMin: walkOriginMin,
          durationText: `徒歩 約${walkOriginMin}分`
        },
        transitBus: {
          boardingStop: origStop,
          alightingStop: destStop,
          routeId: route.routeId,
          shortName: route.shortName,
          longName: route.longName,
          headsign: pattern.headsign,
          color: route.color,
          textColor: route.textColor,
          stopsCount: busStopsCount,
          durationMin: busRideMin,
          durationText: `乗車 約${busRideMin}分（${busStopsCount}停留所）`,
          intermediateStops: intermediateStops,
          pathCoordinates: busPathCoordinates
        },
        destWalk: {
          fromStop: destStop,
          toCoords: [toLat, toLon],
          distance: walkToDestDist,
          distanceText: destStop.distanceText,
          durationMin: walkDestMin,
          durationText: `徒歩 約${walkDestMin}分`
        },
        totalDurationMin: totalDurationMin,
        totalWalkingDistance: walkFromOriginDist + walkToDestDist,
        totalBusStopsCount: busStopsCount
      });
    }
  }

  // B. 乗換1回ルート探索 (直通が少ない、または直通がない場合に特に有用)
  const destStopIdSet = new Set(destCandidateStops.map(ds => ds.id));
  const destStopMap = new Map(destCandidateStops.map(ds => [ds.id, ds]));

  for (const [xStopId, leg1List] of reachableFromOrigin.entries()) {
    const xStop = getStopById(xStopId);
    if (!xStop) continue;

    const xEntries = stopRouteIndex[xStopId] || [];
    for (const [r2Id, p2Idx, s2Idx] of xEntries) {
      const r2 = routesData[r2Id];
      if (!r2 || !r2.patterns || !r2.patterns[p2Idx]) continue;
      const pattern2 = r2.patterns[p2Idx];
      const allStops2 = pattern2.stops || [];
      const downstreamStops2 = allStops2.slice(s2Idx + 1);

      for (let d2Idx = 0; d2Idx < downstreamStops2.length; d2Idx++) {
        const destId = downstreamStops2[d2Idx];
        if (!destStopIdSet.has(destId)) continue;

        const destStop = destStopMap.get(destId);
        if (!destStop) continue;

        for (const leg1 of leg1List) {
          // 同一系統での乗り継ぎは除外
          if (leg1.route.routeId === r2Id) continue;

          const origStop = leg1.origStop;
          const dedupKey = `${origStop.name}_${leg1.route.shortName}_${xStop.name}_${r2.shortName}_${destStop.name}`;
          if (seenTransferKeys.has(dedupKey) || seenDirectKeys.has(`${origStop.name}_${leg1.route.shortName}_${destStop.name}`)) continue;
          seenTransferKeys.add(dedupKey);

          const walkFromOriginDist = origStop.distance;
          const walkToDestDist = destStop.distance;
          const stops1Count = leg1.stopsCount;
          const stops2Count = d2Idx + 1;

          const walkOriginMin = Math.max(1, Math.ceil(walkFromOriginDist / CONFIG.walkingSpeedMeterPerMin));
          const walkDestMin = Math.max(1, Math.ceil(walkToDestDist / CONFIG.walkingSpeedMeterPerMin));
          const bus1RideMin = Math.max(3, Math.round(stops1Count * 2.2));
          const bus2RideMin = Math.max(3, Math.round(stops2Count * 2.2));
          const transferWaitMin = 6; // 乗り継ぎ待ち時間目安 (約6分)
          const totalDurationMin = walkOriginMin + bus1RideMin + transferWaitMin + bus2RideMin + walkDestMin;

          // Leg 1 経路座標
          const inter1Stops = leg1.intermediateIds.map(nid => getStopById(nid)).filter(Boolean);
          const path1Coords = [[origStop.lat, origStop.lon], ...inter1Stops.map(s => [s.lat, s.lon])];

          // Leg 2 経路座標
          const inter2Ids = downstreamStops2.slice(0, d2Idx + 1);
          const inter2Stops = inter2Ids.map(nid => getStopById(nid)).filter(Boolean);
          const path2Coords = [[xStop.lat, xStop.lon], ...inter2Stops.map(s => [s.lat, s.lon])];

          transferPlans.push({
            isDirect: false,
            transferCount: 1,
            originWalk: {
              fromCoords: [fromLat, fromLon],
              toStop: origStop,
              distance: walkFromOriginDist,
              distanceText: origStop.distanceText,
              durationMin: walkOriginMin,
              durationText: `徒歩 約${walkOriginMin}分`
            },
            transitLeg1: {
              boardingStop: origStop,
              alightingStop: xStop,
              routeId: leg1.route.routeId,
              shortName: leg1.route.shortName,
              longName: leg1.route.longName,
              headsign: leg1.pattern.headsign,
              color: leg1.route.color,
              textColor: leg1.route.textColor,
              stopsCount: stops1Count,
              durationMin: bus1RideMin,
              durationText: `乗車 約${bus1RideMin}分（${stops1Count}停留所）`,
              pathCoordinates: path1Coords
            },
            transferStop: xStop,
            transferWaitMin: transferWaitMin,
            transitLeg2: {
              boardingStop: xStop,
              alightingStop: destStop,
              routeId: r2.routeId,
              shortName: r2.shortName,
              longName: r2.longName,
              headsign: pattern2.headsign,
              color: r2.color,
              textColor: r2.textColor,
              stopsCount: stops2Count,
              durationMin: bus2RideMin,
              durationText: `乗車 約${bus2RideMin}分（${stops2Count}停留所）`,
              pathCoordinates: path2Coords
            },
            destWalk: {
              fromStop: destStop,
              toCoords: [toLat, toLon],
              distance: walkToDestDist,
              distanceText: destStop.distanceText,
              durationMin: walkDestMin,
              durationText: `徒歩 約${walkDestMin}分`
            },
            totalDurationMin: totalDurationMin,
            totalWalkingDistance: walkFromOriginDist + walkToDestDist,
            totalBusStopsCount: stops1Count + stops2Count
          });
        }
      }
    }
  }

  // ソート: 直通ルートは所要時間順、乗換ルートも所要時間順
  directPlans.sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.totalWalkingDistance - b.totalWalkingDistance);
  transferPlans.sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.totalWalkingDistance - b.totalWalkingDistance);

  // 直通ルートを上位に、乗換ルートを直通に次ぐ選択肢としてブレンド
  const combinedPlans = [
    ...directPlans.slice(0, 4),
    ...transferPlans.slice(0, 4)
  ];

  // 最終ソート（直通フラグ優先、同種なら所要時間順）
  combinedPlans.sort((a, b) => {
    if (a.isDirect && !b.isDirect) return -1;
    if (!a.isDirect && b.isDirect) return 1;
    return a.totalDurationMin - b.totalDurationMin;
  });

  return combinedPlans.slice(0, 6);
}


