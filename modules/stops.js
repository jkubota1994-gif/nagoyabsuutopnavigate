/**
 * modules/stops.js - バス停データ読込・検索・近傍判定モジュール
 */

import { CONFIG } from '../config.js';

let stopsData = []; // 全標柱（のりば）データ
let parentsData = []; // 親停留所データ
let stopMap = new Map(); // id -> stop

/**
 * バス停データのロード
 */
export async function loadBusStopsData() {
  if (stopsData.length > 0) return stopsData;

  const response = await fetch(CONFIG.data.stops);
  if (!response.ok) {
    throw new Error(`バス停データの取得に失敗しました (HTTP ${response.status})`);
  }

  const json = await response.json();
  stopsData = json.stops || [];
  parentsData = json.parents || [];

  stopMap.clear();
  stopsData.forEach(stop => {
    stopMap.set(stop.id, stop);
  });

  return stopsData;
}

/**
 * IDからバス停を取得
 * @param {string} stopId 
 */
export function getStopById(stopId) {
  return stopMap.get(stopId) || null;
}

/**
 * 全バス停リストを取得
 */
export function getAllStops() {
  return stopsData;
}

/**
 * 2地点間の距離を計算 (Haversine公式, メートル単位)
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径 (m)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * 距離と徒歩時間の表示テキストを生成
 * @param {number} distanceMeters 
 */
export function formatDistanceAndWalkingTime(distanceMeters) {
  const mins = Math.max(1, Math.ceil(distanceMeters / CONFIG.walkingSpeedMeterPerMin));
  if (distanceMeters < 1000) {
    return {
      distanceText: `${distanceMeters}m`,
      walkingTimeText: `徒歩 約${mins}分`,
      combinedText: `${distanceMeters}m (徒歩約${mins}分)`
    };
  }
  const km = (distanceMeters / 1000).toFixed(1);
  return {
    distanceText: `${km}km`,
    walkingTimeText: `徒歩 約${mins}分`,
    combinedText: `${km}km (徒歩約${mins}分)`
  };
}

/**
 * 指定地点から半径内の最寄りバス停を検索・距離順ソート
 * @param {number} centerLat 
 * @param {number} centerLon 
 * @param {number} radiusMeters 
 * @param {number} maxResults 
 * @returns {Array} 距離・徒歩時間付きのバス停配列
 */
export function findNearbyStops(centerLat, centerLon, radiusMeters = CONFIG.defaultRadiusMeters, maxResults = 30) {
  if (stopsData.length === 0) return [];

  const nearby = [];

  for (const stop of stopsData) {
    const distance = calculateDistance(centerLat, centerLon, stop.lat, stop.lon);
    if (distance <= radiusMeters) {
      const { distanceText, walkingTimeText, combinedText } = formatDistanceAndWalkingTime(distance);
      nearby.push({
        ...stop,
        distance,
        distanceText,
        walkingTimeText,
        combinedText,
        isNearby: true
      });
    }
  }

  // 距離昇順ソート
  nearby.sort((a, b) => a.distance - b.distance);

  // もし指定半径内にバス停が1件もない場合は、最も近い上位5件を特別に返す
  if (nearby.length === 0) {
    const allWithDist = stopsData.map(stop => {
      const distance = calculateDistance(centerLat, centerLon, stop.lat, stop.lon);
      const { distanceText, walkingTimeText, combinedText } = formatDistanceAndWalkingTime(distance);
      return {
        ...stop,
        distance,
        distanceText,
        walkingTimeText,
        combinedText,
        isNearby: false
      };
    });
    allWithDist.sort((a, b) => a.distance - b.distance);
    return allWithDist.slice(0, 5);
  }

  return nearby.slice(0, maxResults);
}

/**
 * ひらがな・カタカナの正規化（あいまい検索用）
 */
function normalizeKana(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (match) => {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
    })
    .trim();
}

/**
 * バス停名でテキスト検索
 * @param {string} query 
 * @param {number|null} userLat 
 * @param {number|null} userLon 
 * @param {number} maxResults 
 */
export function searchStopsByName(query, userLat = null, userLon = null, maxResults = 20) {
  if (!query || query.trim() === '') return [];

  const normalizedQuery = normalizeKana(query);
  const matched = [];
  const seenNames = new Set();

  for (const stop of stopsData) {
    const normName = normalizeKana(stop.name);
    if (normName.includes(normalizedQuery)) {
      let distance = 0;
      let distanceText = '';
      let walkingTimeText = '';
      if (userLat !== null && userLon !== null) {
        distance = calculateDistance(userLat, userLon, stop.lat, stop.lon);
        const fmt = formatDistanceAndWalkingTime(distance);
        distanceText = fmt.distanceText;
        walkingTimeText = fmt.walkingTimeText;
      }

      matched.push({
        ...stop,
        distance,
        distanceText,
        walkingTimeText
      });
    }
  }

  // 距離があれば距離順、なければ名前一致度順
  if (userLat !== null && userLon !== null) {
    matched.sort((a, b) => a.distance - b.distance);
  } else {
    matched.sort((a, b) => {
      // 完全一致優先
      const aExact = a.name === query ? 1 : 0;
      const bExact = b.name === query ? 1 : 0;
      return bExact - aExact;
    });
  }

  return matched.slice(0, maxResults);
}
