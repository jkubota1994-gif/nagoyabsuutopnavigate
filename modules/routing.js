/**
 * modules/routing.js - OSRM 歩行者道案内（ルーティング）モジュール
 * FOSSGIS routed-foot エンドポイントを使用し、日本語のターンバイターン案内を提供
 */

import { CONFIG } from '../config.js';
import { calculateDistance, formatDistanceAndWalkingTime } from './stops.js';

let lastRequestTime = 0;
const routeCache = new Map(); // "lat1,lon1->lat2,lon2" -> routeData

/**
 * 日本語マニューバ案内テキストの生成
 */
function translateManeuver(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || '';
  const modifier = maneuver.modifier || '';
  const street = step.name ? `「${step.name}」` : '道路';
  const dist = step.distance < 1000 ? `${Math.round(step.distance)}m` : `${(step.distance / 1000).toFixed(1)}km`;

  let action = '';
  let icon = 'fa-arrow-up';

  switch (type) {
    case 'depart':
      action = `${street}を出発`;
      icon = 'fa-person-walking';
      break;
    case 'arrive':
      action = '目的地に到着';
      icon = 'fa-flag-checkered';
      break;
    case 'turn':
    case 'end of road':
    case 'fork':
      if (modifier.includes('right')) {
        action = `${street}へ右折`;
        icon = 'fa-arrow-turn-right';
      } else if (modifier.includes('left')) {
        action = `${street}へ左折`;
        icon = 'fa-arrow-turn-left';
      } else if (modifier.includes('slight right')) {
        action = `${street}へ斜め右方向`;
        icon = 'fa-arrow-trend-up';
      } else if (modifier.includes('slight left')) {
        action = `${street}へ斜め左方向`;
        icon = 'fa-arrow-trend-up';
      } else {
        action = `${street}を進む`;
        icon = 'fa-arrow-up';
      }
      break;
    case 'continue':
    case 'new name':
      action = `${street}を直進`;
      icon = 'fa-arrow-up';
      break;
    case 'roundabout':
    case 'rotary':
      action = `ロータリーを通過`;
      icon = 'fa-rotate';
      break;
    case 'crosswalk':
      action = `横断歩道を渡る`;
      icon = 'fa-person-walking-dashed-line-arrow-right';
      break;
    default:
      action = `${street}を進む`;
      icon = 'fa-arrow-up';
  }

  return {
    instruction: action,
    distanceText: dist,
    rawDistance: step.distance,
    durationSeconds: step.duration,
    icon: icon,
    street: step.name || ''
  };
}

/**
 * 徒歩ルートを計算する
 * @param {number} fromLat 
 * @param {number} fromLon 
 * @param {number} toLat 
 * @param {number} toLon 
 * @returns {Promise<{distance: number, duration: number, distanceText: string, durationText: string, coordinates: Array<[number, number]>, steps: Array<Object>}>}
 */
export async function getWalkingRoute(fromLat, fromLon, toLat, toLon) {
  const cacheKey = `${fromLat.toFixed(5)},${fromLon.toFixed(5)}->${toLat.toFixed(5)},${toLon.toFixed(5)}`;
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }

  // FOSSGIS レート制限保護（最小1.1秒間隔）
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < CONFIG.routing.minRequestIntervalMs) {
    await new Promise(r => setTimeout(r, CONFIG.routing.minRequestIntervalMs - timeSinceLast));
  }
  lastRequestTime = Date.now();

  const url = `${CONFIG.routing.endpoint}/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.routing.timeoutMs);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`OSRM API エラー: HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('ルートが見つかりませんでした。');
    }

    const route = data.routes[0];
    const totalDistance = Math.round(route.distance);
    const totalDurationSeconds = Math.round(route.duration);
    const durationMinutes = Math.max(1, Math.ceil(totalDistance / CONFIG.walkingSpeedMeterPerMin));

    // GeoJSON [lon, lat] -> Leaflet [lat, lon]
    const coordinates = (route.geometry.coordinates || []).map(coord => [coord[1], coord[0]]);

    // ターンバイターン案内
    const steps = [];
    if (route.legs && route.legs[0] && route.legs[0].steps) {
      for (const step of route.legs[0].steps) {
        if (step.distance > 0 || step.maneuver.type === 'arrive') {
          steps.push(translateManeuver(step));
        }
      }
    }

    const result = {
      distance: totalDistance,
      duration: durationMinutes,
      distanceText: totalDistance < 1000 ? `${totalDistance}m` : `${(totalDistance / 1000).toFixed(1)}km`,
      durationText: `徒歩 約${durationMinutes}分`,
      coordinates: coordinates,
      steps: steps,
      isStraightLineFallback: false
    };

    routeCache.set(cacheKey, result);
    return result;

  } catch (error) {
    console.warn('OSRM 徒歩ルート取得失敗。直線フォールバックを適用します:', error);

    // 直線フォールバック
    const straightDist = calculateDistance(fromLat, fromLon, toLat, toLon);
    const fmt = formatDistanceAndWalkingTime(straightDist);

    const fallbackResult = {
      distance: straightDist,
      duration: Math.max(1, Math.ceil(straightDist / CONFIG.walkingSpeedMeterPerMin)),
      distanceText: fmt.distanceText,
      durationText: fmt.walkingTimeText,
      coordinates: [[fromLat, fromLon], [toLat, toLon]],
      steps: [
        {
          instruction: '目的地へ向かって歩く',
          distanceText: fmt.distanceText,
          rawDistance: straightDist,
          icon: 'fa-person-walking'
        },
        {
          instruction: '目的地に到着',
          distanceText: '',
          rawDistance: 0,
          icon: 'fa-flag-checkered'
        }
      ],
      isStraightLineFallback: true
    };

    return fallbackResult;
  }
}
