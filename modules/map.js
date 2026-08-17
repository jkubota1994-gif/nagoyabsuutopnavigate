/**
 * modules/map.js - 地図表示・レイヤー管理モジュール (Leaflet)
 */

import { CONFIG } from '../config.js';

let map = null;
let markerClusterGroup = null;
let userMarker = null;
let userAccuracyCircle = null;
let destinationMarker = null;
let walkingPolyline = null;
let busRoutePolyline = null;
let activeStopMarkers = new Map(); // stopId -> Marker
let onMapClickCallback = null;

/**
 * 地図の初期化
 * @param {string} containerId - 地図を描画する要素のID
 * @param {Function} onStopClick - バス停マーカークリック時のコールバック
 * @param {Function} onMapDestinationClick - 地図上の地点タップ時のコールバック
 */
export function initMap(containerId, onStopClick, onMapDestinationClick) {
  onMapClickCallback = onMapDestinationClick;

  map = L.map(containerId, {
    center: CONFIG.defaultCenter,
    zoom: CONFIG.defaultZoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    zoomControl: false // コントロールは独自配置
  });

  // ズームコントロールを右上に追加
  L.control.zoom({ position: 'topright' }).addTo(map);

  // ベースタイルレイヤー
  L.tileLayer(CONFIG.tile.url, {
    attribution: CONFIG.tile.attribution,
    maxZoom: CONFIG.tile.maxZoom
  }).addTo(map);

  // マーカークラスターグループ
  markerClusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="custom-cluster-icon"><span>${count}</span></div>`,
        className: 'marker-cluster-custom',
        iconSize: L.point(36, 36)
      });
    }
  });
  map.addLayer(markerClusterGroup);

  // 地図クリック（目的地設定イベント）
  map.on('click', (e) => {
    if (onMapClickCallback) {
      onMapClickCallback(e.latlng.lat, e.latlng.lng);
    }
  });

  return map;
}

/**
 * 現在地マーカーと精度円の更新
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} accuracy (meters)
 */
export function updateUserLocation(lat, lon, accuracy = 0) {
  if (!map) return;

  const latlng = [lat, lon];

  // 精度円
  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(latlng);
    userAccuracyCircle.setRadius(accuracy);
  } else if (accuracy > 0) {
    userAccuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#1a73e8',
      fillColor: '#1a73e8',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);
  }

  // 現在地パルスマーカー
  if (userMarker) {
    userMarker.setLatLng(latlng);
  } else {
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div class="user-pulse-ring"></div>
        <div class="user-location-dot"></div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    userMarker = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
  }
}

/**
 * 目的地マーカーの設定
 * @param {number} lat 
 * @param {number} lon 
 * @param {string} label 
 */
export function setDestinationMarker(lat, lon, label = '目的地') {
  if (!map) return;

  const latlng = [lat, lon];

  if (destinationMarker) {
    destinationMarker.setLatLng(latlng);
  } else {
    const destIcon = L.divIcon({
      className: 'destination-marker',
      html: `
        <div class="dest-pin">
          <i class="fa-solid fa-location-dot"></i>
        </div>
      `,
      iconSize: [32, 38],
      iconAnchor: [16, 36],
      popupAnchor: [0, -32]
    });
    destinationMarker = L.marker(latlng, { icon: destIcon, zIndexOffset: 900 }).addTo(map);
  }

  destinationMarker.bindPopup(`<b>🎯 ${label}</b><br><small>緯度: ${lat.toFixed(4)}, 経度: ${lon.toFixed(4)}</small>`);
}

/**
 * 目的地マーカーの削除
 */
export function clearDestinationMarker() {
  if (destinationMarker && map) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
}

/**
 * バス停マーカーの描画
 * @param {Array} stops - バス停オブジェクトの配列
 * @param {Function} onStopClick - クリックハンドラ
 * @param {string|null} activeStopId - 現在選択中のバス停ID
 */
export function renderBusStopMarkers(stops, onStopClick, activeStopId = null) {
  if (!markerClusterGroup) return;

  markerClusterGroup.clearLayers();
  activeStopMarkers.clear();

  stops.forEach(stop => {
    const isSelected = activeStopId && stop.id === activeStopId;
    const platform = stop.platformCode ? `${stop.platformCode}番` : '';

    const icon = L.divIcon({
      className: `bus-stop-marker ${isSelected ? 'is-selected' : ''}`,
      html: `
        <div class="bus-stop-pin ${stop.isNearby ? 'is-nearby' : ''}">
          <i class="fa-solid fa-bus"></i>
          ${platform ? `<span class="platform-badge">${platform}</span>` : ''}
        </div>
      `,
      iconSize: [38, 46],
      iconAnchor: [19, 44],
      popupAnchor: [0, -40]
    });

    const marker = L.marker([stop.lat, stop.lon], { icon });

    marker.on('click', () => {
      if (onStopClick) onStopClick(stop);
    });

    marker.bindTooltip(`
      <div class="stop-tooltip">
        <strong>${stop.name}</strong>
        ${platform ? `<span class="badge">${platform}のりば</span>` : ''}
        ${stop.distanceText ? `<div class="dist">現在地から ${stop.distanceText}</div>` : ''}
      </div>
    `, { direction: 'top', offset: [0, -36] });

    markerClusterGroup.addLayer(marker);
    activeStopMarkers.set(stop.id, marker);
  });
}

/**
 * 特定のバス停をハイライト表示
 * @param {string} stopId 
 */
export function highlightStopMarker(stopId) {
  const marker = activeStopMarkers.get(stopId);
  if (marker) {
    markerClusterGroup.zoomToShowLayer(marker, () => {
      marker.openTooltip();
    });
  }
}

/**
 * 徒歩ルートのポリラインを描画
 * @param {Array} coordinates - [[lat, lon], ...]
 */
export function renderWalkingRoute(coordinates) {
  if (!map) return;
  clearWalkingRoute();

  if (!coordinates || coordinates.length === 0) return;

  walkingPolyline = L.polyline(coordinates, {
    color: '#00897b',
    weight: 6,
    opacity: 0.9,
    dashArray: '8, 8',
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);

  map.fitBounds(walkingPolyline.getBounds(), { padding: [50, 50], maxZoom: 18 });
}

/**
 * 徒歩ルートの消去
 */
export function clearWalkingRoute() {
  if (walkingPolyline && map) {
    map.removeLayer(walkingPolyline);
    walkingPolyline = null;
  }
}

let busRouteLayerGroup = null;

/**
 * バス系統ルート（停車バス停を結ぶライン ＆ 各停車バス停の大判ピン）を描画
 * @param {Array} stopCoordinates - [[lat, lon], ...]
 * @param {string} color 
 * @param {Array<Object>} stopsList - 停車バス停リスト
 */
export function renderBusRoute(stopCoordinates, color = '#1976d2', stopsList = []) {
  if (!map) return;
  clearBusRoute();

  if (!stopCoordinates || stopCoordinates.length < 2) return;

  busRouteLayerGroup = L.featureGroup().addTo(map);

  // 1. 運行ルートライン
  const polyline = L.polyline(stopCoordinates, {
    color: color,
    weight: 6,
    opacity: 0.9,
    lineJoin: 'round'
  });
  busRouteLayerGroup.addLayer(polyline);

  // 2. 停車バス停を大きめのバッジ・ピンとしてマッピング
  stopsList.forEach((stop, idx) => {
    if (!stop.lat || !stop.lon) return;

    const isFirst = idx === 0;
    const isLast = idx === stopsList.length - 1;
    const platform = stop.platformCode ? ` (${stop.platformCode}番)` : '';

    let pinHtml = '';
    let pinClass = 'route-stop-node';
    let iconSize = [26, 26];
    let iconAnchor = [13, 13];

    if (isFirst) {
      pinClass = 'route-stop-endpoint is-start';
      iconSize = [34, 34];
      iconAnchor = [17, 17];
      pinHtml = `<div class="endpoint-pin start-pin" style="background-color: ${color};"><i class="fa-solid fa-play"></i></div>`;
    } else if (isLast) {
      pinClass = 'route-stop-endpoint is-terminal';
      iconSize = [34, 34];
      iconAnchor = [17, 17];
      pinHtml = `<div class="endpoint-pin terminal-pin" style="background-color: ${color};"><i class="fa-solid fa-flag-checkered"></i></div>`;
    } else {
      pinHtml = `<div class="node-pin" style="background-color: ${color};"><span class="node-seq">${idx + 1}</span></div>`;
    }

    const icon = L.divIcon({
      className: pinClass,
      html: pinHtml,
      iconSize: iconSize,
      iconAnchor: iconAnchor
    });

    const marker = L.marker([stop.lat, stop.lon], { icon: icon, zIndexOffset: isFirst || isLast ? 900 : 750 });
    marker.bindTooltip(`
      <div class="route-stop-tooltip">
        <strong>${idx + 1}. ${stop.name}${platform}</strong>
        ${isFirst ? '<span class="status-tag is-start">乗車・始発</span>' : ''}
        ${isLast ? '<span class="status-tag is-term">終点</span>' : ''}
      </div>
    `, { direction: 'top', offset: [0, -14] });

    busRouteLayerGroup.addLayer(marker);
  });

  map.fitBounds(busRouteLayerGroup.getBounds(), { padding: [60, 60], maxZoom: 17 });
}

/**
 * バス系統ルートの消去
 */
export function clearBusRoute() {
  if (busRouteLayerGroup && map) {
    map.removeLayer(busRouteLayerGroup);
    busRouteLayerGroup = null;
  }
}

let tripLayersGroup = null;

/**
 * 全行程（出発地徒歩 → バス乗車(直通または乗換) → 目的地徒歩）のマルチレグマップ描画
 * 各停車・乗換バス停を大きく分かりやすくマッピング
 * @param {Object} param
 */
export function renderTripMultiLeg({
  originWalkCoords,
  busCoords,
  busColor = '#1976d2',
  boardingStop,
  alightingStop,
  intermediateStops = [],
  busLeg1Coords,
  busLeg1Color = '#1976d2',
  transferStop,
  busLeg2Coords,
  busLeg2Color = '#f57c00',
  destWalkCoords
}) {
  if (!map) return;
  clearTripMultiLeg();
  clearWalkingRoute();
  clearBusRoute();

  tripLayersGroup = L.featureGroup().addTo(map);

  // 1. 出発徒歩ライン (エメラルド点線)
  if (originWalkCoords && originWalkCoords.length >= 2) {
    const p1 = L.polyline(originWalkCoords, {
      color: '#00897b',
      weight: 6,
      opacity: 0.9,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    });
    tripLayersGroup.addLayer(p1);
  }

  // 2-A. 直通バス乗車ライン (単一系統)
  if (busCoords && busCoords.length >= 2) {
    const p2 = L.polyline(busCoords, {
      color: busColor,
      weight: 7,
      opacity: 0.95,
      lineJoin: 'round'
    });
    tripLayersGroup.addLayer(p2);
  }

  // 2-B. 乗換ルート: 第1区間バス
  if (busLeg1Coords && busLeg1Coords.length >= 2) {
    const pLeg1 = L.polyline(busLeg1Coords, {
      color: busLeg1Color,
      weight: 7,
      opacity: 0.95,
      lineJoin: 'round'
    });
    tripLayersGroup.addLayer(pLeg1);
  }

  // 2-C. 乗車バス停の大型ピン (Boarding Stop Pin)
  if (boardingStop && boardingStop.lat && boardingStop.lon) {
    const bIcon = L.divIcon({
      className: 'journey-stop-marker is-board',
      html: `
        <div class="journey-pin board-pin" style="background-color: ${busColor};">
          <i class="fa-solid fa-bus"></i>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const bMarker = L.marker([boardingStop.lat, boardingStop.lon], { icon: bIcon, zIndexOffset: 920 });
    bMarker.bindTooltip(`<b>🟢 乗車: ${boardingStop.name}</b>`, { direction: 'top', offset: [0, -18] });
    tripLayersGroup.addLayer(bMarker);
  }

  // 2-D. 途中停車バス停のノード表示
  if (intermediateStops && intermediateStops.length > 0) {
    intermediateStops.forEach((st, idx) => {
      if (!st.lat || !st.lon) return;
      const nIcon = L.divIcon({
        className: 'journey-intermediate-node',
        html: `<div class="journey-node-dot" style="background-color: ${busColor};"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      const nMarker = L.marker([st.lat, st.lon], { icon: nIcon, zIndexOffset: 700 });
      nMarker.bindTooltip(`🚏 ${st.name}`, { direction: 'top', offset: [0, -10] });
      tripLayersGroup.addLayer(nMarker);
    });
  }

  // 2-E. 乗換バス停マーカー (Transfer Stop Pin)
  if (transferStop && transferStop.lat && transferStop.lon) {
    const transferIcon = L.divIcon({
      className: 'journey-stop-marker is-transfer',
      html: `
        <div class="journey-pin transfer-pin">
          <i class="fa-solid fa-arrows-rotate"></i>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const tMarker = L.marker([transferStop.lat, transferStop.lon], { icon: transferIcon, zIndexOffset: 930 });
    tMarker.bindTooltip(`<b>🔄 乗り換え: ${transferStop.name}</b>`, { direction: 'top', offset: [0, -18] });
    tripLayersGroup.addLayer(tMarker);
  }

  // 2-F. 乗換ルート: 第2区間バス
  if (busLeg2Coords && busLeg2Coords.length >= 2) {
    const pLeg2 = L.polyline(busLeg2Coords, {
      color: busLeg2Color,
      weight: 7,
      opacity: 0.95,
      lineJoin: 'round'
    });
    tripLayersGroup.addLayer(pLeg2);
  }

  // 2-G. 降車バス停の大型ピン (Alighting Stop Pin)
  if (alightingStop && alightingStop.lat && alightingStop.lon) {
    const aIcon = L.divIcon({
      className: 'journey-stop-marker is-alight',
      html: `
        <div class="journey-pin alight-pin">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const aMarker = L.marker([alightingStop.lat, alightingStop.lon], { icon: aIcon, zIndexOffset: 920 });
    aMarker.bindTooltip(`<b>🏁 下車: ${alightingStop.name}</b>`, { direction: 'top', offset: [0, -18] });
    tripLayersGroup.addLayer(aMarker);
  }

  // 3. 到着徒歩ライン (エメラルド点線)
  if (destWalkCoords && destWalkCoords.length >= 2) {
    const p3 = L.polyline(destWalkCoords, {
      color: '#00897b',
      weight: 6,
      opacity: 0.9,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round'
    });
    tripLayersGroup.addLayer(p3);
  }

  if (tripLayersGroup.getLayers().length > 0) {
    map.fitBounds(tripLayersGroup.getBounds(), { padding: [60, 60], maxZoom: 17 });
  }
}

/**
 * 全行程マルチレグ描画の消去
 */
export function clearTripMultiLeg() {
  if (tripLayersGroup && map) {
    map.removeLayer(tripLayersGroup);
    tripLayersGroup = null;
  }
}

/**
 * 地図の中心を指定座標へ移動
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} zoom 
 */
export function panTo(lat, lon, zoom = 17) {
  if (map) {
    map.setView([lat, lon], zoom, { animate: true, duration: 0.6 });
  }
}

/**
 * 地図のバウンディングボックスを調整
 * @param {Array} bounds - [[lat1, lon1], [lat2, lon2]]
 */
export function fitBounds(bounds, padding = [40, 40]) {
  if (map && bounds && bounds.length > 0) {
    map.fitBounds(bounds, { padding });
  }
}
