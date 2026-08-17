/**
 * app.js - メインアプリケーションエントリーポイント
 */

import { CONFIG } from './config.js';
import {
  initMap,
  updateUserLocation,
  renderBusStopMarkers,
  renderWalkingRoute,
  clearWalkingRoute,
  renderBusRoute,
  clearBusRoute,
  renderTripMultiLeg,
  clearTripMultiLeg,
  setDestinationMarker,
  clearDestinationMarker,
  panTo,
  fitBounds
} from './modules/map.js';
import {
  requestCurrentLocation,
  shouldShowPermissionModal,
  setPermissionAcknowledged,
  startWatchLocation
} from './modules/geolocation.js';
import {
  loadBusStopsData,
  findNearbyStops,
  getStopById
} from './modules/stops.js';
import {
  loadBusRoutesData,
  getRoutePatternGeometry,
  getRoutesForStop,
  findTransitRoutesBetweenPoints
} from './modules/routes.js';
import {
  loadSubwayData,
  findSubwayHybridPlans
} from './modules/subway.js';
import {
  getWalkingRoute
} from './modules/routing.js';
import {
  reverseGeocode
} from './modules/geocoding.js';
import {
  initUI,
  renderNearbyStopsSummary,
  renderStopDetail,
  renderWalkingRouteNavigation,
  renderTripPlanView,
  showModal,
  hideModal,
  showToast
} from './modules/ui.js';

// アプリケーション状態
const state = {
  userLocation: {
    lat: CONFIG.defaultCenter[0],
    lon: CONFIG.defaultCenter[1],
    accuracy: 0,
    isFallback: true
  },
  currentRadius: CONFIG.defaultRadiusMeters,
  activeStop: null,
  nearbyStops: [],
  destination: null
};

/**
 * アプリ起動
 */
async function startApp() {
  console.log(`Starting ${CONFIG.appName} v${CONFIG.version}`);

  // 1. UIの初期化
  initUI({
    onStopSelected: handleStopSelected,
    onRouteHighlighted: handleRouteHighlighted,
    onWalkingRouteRequested: handleWalkingRouteRequested,
    onRadiusChanged: handleRadiusChanged
  });

  // 2. 地図の初期化
  initMap('map-container', handleStopSelected, handleMapDestinationClick);

  // 3. データ読込（並行ロード: バス停 + 系統 + 地下鉄ネットワーク）
  try {
    showLoadingScreen('バス停・系統・地下鉄データを読み込み中...');
    await Promise.all([
      loadBusStopsData(),
      loadBusRoutesData(),
      loadSubwayData()
    ]);
    hideLoadingScreen();
  } catch (err) {
    console.error('データ読み込みエラー:', err);
    hideLoadingScreen();
    showToast('データの読み込みに失敗しました。ページを再読み込みしてください。', 'error', 5000);
    return;
  }

  // 4. グローバルイベントリスナーの登録
  window.addEventListener('app:relocate', () => acquireLocationAndRefresh(true));
  window.addEventListener('app:backToSummary', () => showNearbySummary());
  window.addEventListener('app:destinationSelected', (e) => handleDestinationSelected(e.detail));
  window.addEventListener('app:tripPlanActivated', (e) => handleTripPlanActivated(e.detail));

  // 5. 位置情報の許諾確認モーダルまたは位置取得
  if (shouldShowPermissionModal()) {
    setupPermissionModal();
    showModal('modal-geo-permission');
  } else {
    acquireLocationAndRefresh();
  }
}

/**
 * 位置情報許諾モーダルのボタンイベント
 */
function setupPermissionModal() {
  const allowBtn = document.getElementById('btn-allow-geo');
  const denyBtn = document.getElementById('btn-deny-geo');

  allowBtn?.addEventListener('click', () => {
    setPermissionAcknowledged();
    hideModal('modal-geo-permission');
    acquireLocationAndRefresh(true);
  });

  denyBtn?.addEventListener('click', () => {
    setPermissionAcknowledged();
    hideModal('modal-geo-permission');
    // デフォルト位置で初期化
    state.userLocation = {
      lat: CONFIG.defaultCenter[0],
      lon: CONFIG.defaultCenter[1],
      accuracy: 0,
      isFallback: true
    };
    updateUserLocation(state.userLocation.lat, state.userLocation.lon, 0);
    panTo(state.userLocation.lat, state.userLocation.lon, 16);
    refreshNearbyStops();
    showToast('名古屋駅周辺のバス停を表示しています', 'info');
  });
}

/**
 * 位置情報を取得して周辺バス停を更新
 */
async function acquireLocationAndRefresh(forceHighAccuracy = false) {
  showToast('現在地を取得中...', 'info', 2000);

  const loc = await requestCurrentLocation(forceHighAccuracy);
  state.userLocation = loc;

  updateUserLocation(loc.lat, loc.lon, loc.accuracy);
  panTo(loc.lat, loc.lon, 16);

  if (loc.isFallback) {
    showToast(loc.message || '名古屋駅周辺を表示しています', 'info');
  } else {
    showToast('現在地を取得しました', 'success', 2000);
  }

  refreshNearbyStops();
}

/**
 * 周辺バス停の再計算と描画
 */
function refreshNearbyStops() {
  clearBusRoute();
  clearWalkingRoute();

  const stops = findNearbyStops(
    state.userLocation.lat,
    state.userLocation.lon,
    state.currentRadius
  );
  state.nearbyStops = stops;

  renderBusStopMarkers(stops, handleStopSelected, state.activeStop?.id);
  renderNearbyStopsSummary(stops, state.userLocation.lat, state.userLocation.lon);
}

/**
 * 周辺サマリー画面に戻る
 */
function showNearbySummary() {
  state.activeStop = null;
  clearBusRoute();
  clearWalkingRoute();
  renderBusStopMarkers(state.nearbyStops, handleStopSelected, null);
  renderNearbyStopsSummary(state.nearbyStops, state.userLocation.lat, state.userLocation.lon);
}

/**
 * バス停が選択されたときのハンドラ
 */
function handleStopSelected(stop) {
  state.activeStop = stop;
  clearBusRoute();

  // マーカーハイライト
  renderBusStopMarkers(state.nearbyStops, handleStopSelected, stop.id);
  panTo(stop.lat, stop.lon, 17);

  // 詳細パネルを表示
  renderStopDetail(stop, state.userLocation.lat, state.userLocation.lon);
}

/**
 * 系統が選択されて地図上にハイライトされたときのハンドラ
 */
function handleRouteHighlighted(routeId, patternIdx) {
  const geom = getRoutePatternGeometry(routeId, patternIdx);
  if (geom.coordinates.length > 0) {
    renderBusRoute(geom.coordinates, geom.color, geom.stops);
    showToast(`「${geom.shortName} → ${geom.headsign}」の運行経路を表示中`, 'info', 3000);
  }
}

/**
 * 徒歩ルート案内がリクエストされたときのハンドラ
 */
async function handleWalkingRouteRequested(fromLat, fromLon, toLat, toLon, destinationName) {
  try {
    showLoadingScreen('徒歩ルートを計算中 (OSRM)...');
    const result = await getWalkingRoute(fromLat, fromLon, toLat, toLon);
    hideLoadingScreen();

    renderWalkingRoute(result.coordinates);
    renderWalkingRouteNavigation(result, destinationName);
  } catch (err) {
    hideLoadingScreen();
    showToast('ルート計算に失敗しました', 'error');
  }
}

/**
 * 地図上で地点がクリックされたときのハンドラ（目的地設定）
 */
async function handleMapDestinationClick(lat, lon) {
  showToast('指定地点の地名を照会中...', 'info', 1500);
  const placeName = await reverseGeocode(lat, lon);
  handleDestinationSelected({ lat, lon, name: placeName });
}

/**
 * 目的地が決定されたときのハンドラ
 */
async function handleDestinationSelected(dest) {
  try {
    state.destination = dest;
    setDestinationMarker(dest.lat, dest.lon, dest.name);
    clearBusRoute();
    clearWalkingRoute();
    clearTripMultiLeg();

    showToast(`目的地: ${dest.name} へのルートを検索中...`, 'info', 2500);

    // 1. 市バス直通 ＆ 乗換1回ルートを探索 (探索半径1000m)
    const busPlans = findTransitRoutesBetweenPoints(
      state.userLocation.lat,
      state.userLocation.lon,
      dest.lat,
      dest.lon,
      1000
    );

    // 2. 地下鉄を活用したハイブリッドルートを探索
    const subwayPlans = findSubwayHybridPlans(
      state.userLocation.lat,
      state.userLocation.lon,
      dest.lat,
      dest.lon
    );

    // 3. ルート候補の統合 (直通バス → 地下鉄利用 → 乗換バス)
    const directBus = busPlans.filter(p => p.isDirect);
    const transferBus = busPlans.filter(p => !p.isDirect);
    
    const combinedPlans = [
      ...directBus.slice(0, 3),
      ...subwayPlans.slice(0, 2),
      ...transferBus.slice(0, 3)
    ];

    // 所要時間順で再ソート（直通バスは最優先）
    combinedPlans.sort((a, b) => {
      if (a.isDirect && !b.isDirect) return -1;
      if (!a.isDirect && b.isDirect) return 1;
      return a.totalDurationMin - b.totalDurationMin;
    });

    const finalPlans = combinedPlans.slice(0, 6);

    // 行き方案内ビューを表示
    renderTripPlanView(
      finalPlans,
      dest.name,
      state.userLocation.lat,
      state.userLocation.lon,
      dest.lat,
      dest.lon
    );

    if (finalPlans.length > 0) {
      // おすすめ第1案を地図上にプレビュー描画
      const bestPlan = finalPlans[0];
      handleTripPlanActivated(bestPlan, false);
      showToast(`おすすめルート（約${bestPlan.totalDurationMin}分）を表示しました`, 'success', 3000);
    } else {
      // 直通バスが見つからない場合、目的地周辺の最寄り降車バス停を検索
      const destStops = findNearbyStops(dest.lat, dest.lon, 600, 3);
      if (destStops.length > 0) {
        showToast(`目的地最寄りバス停: ${destStops[0].name}（徒歩約${destStops[0].walkingTimeText}）`, 'info', 4000);
      }
    }
  } catch (err) {
    console.error('ルート検索エラー:', err);
    showToast('ルート検索中にエラーが発生しました', 'error');
  }
}

/**
 * ユーザーが特定のルート案を選択・有効化したときのハンドラ
 * @param {Object} plan 
 * @param {boolean} showNotification
 */
async function handleTripPlanActivated(plan, showNotification = true) {
  try {
    if (plan.type === 'subway_hybrid') {
      // 地下鉄ルートの描画
      const oSt = plan.originWalk.toStation;
      const sub = plan.subway;
      const dSt = plan.destWalk.fromStation;

      if (sub.isDirect) {
        renderTripMultiLeg({
          originWalkCoords: [
            [state.userLocation.lat, state.userLocation.lon],
            [oSt.lat, oSt.lon]
          ],
          busCoords: sub.pathCoordinates,
          busColor: sub.color,
          boardingStop: oSt,
          alightingStop: dSt,
          destWalkCoords: [
            [dSt.lat, dSt.lon],
            [state.destination.lat, state.destination.lon]
          ]
        });
        if (showNotification) {
          showToast(`地下鉄「${oSt.name}駅」から「${sub.lineName}」に乗車します`, 'info', 3500);
        }
      } else {
        // 地下鉄乗換あり
        renderTripMultiLeg({
          originWalkCoords: [
            [state.userLocation.lat, state.userLocation.lon],
            [oSt.lat, oSt.lon]
          ],
          busLeg1Coords: sub.leg1.pathCoordinates,
          busLeg1Color: sub.leg1.color,
          boardingStop: oSt,
          transferStop: sub.transferStation,
          busLeg2Coords: sub.leg2.pathCoordinates,
          busLeg2Color: sub.leg2.color,
          alightingStop: dSt,
          destWalkCoords: [
            [dSt.lat, dSt.lon],
            [state.destination.lat, state.destination.lon]
          ]
        });
        if (showNotification) {
          showToast(`地下鉄「${oSt.name}駅」乗車、${sub.transferStation.name}駅で乗り換えます`, 'info', 3500);
        }
      }

    } else if (plan.isDirect) {
      // 市バス直通ルートの描画
      const bStop = plan.transitBus.boardingStop;
      const aStop = plan.transitBus.alightingStop;
      const bus = plan.transitBus;

      renderTripMultiLeg({
        originWalkCoords: [
          [state.userLocation.lat, state.userLocation.lon],
          [bStop.lat, bStop.lon]
        ],
        busCoords: bus.pathCoordinates,
        busColor: bus.color,
        boardingStop: bStop,
        alightingStop: aStop,
        intermediateStops: bus.intermediateStops,
        destWalkCoords: [
          [aStop.lat, aStop.lon],
          [state.destination.lat, state.destination.lon]
        ]
      });

      if (showNotification) {
        showToast(`「${bStop.name}」から「${bus.shortName}」に乗車します`, 'info', 3000);
      }
    } else {
      // 市バス乗換1回ルートの描画
      const origStop = plan.originWalk.toStop;
      const leg1 = plan.transitLeg1;
      const xStop = plan.transferStop;
      const leg2 = plan.transitLeg2;
      const destStop = plan.destWalk.fromStop;

      renderTripMultiLeg({
        originWalkCoords: [
          [state.userLocation.lat, state.userLocation.lon],
          [origStop.lat, origStop.lon]
        ],
        busLeg1Coords: leg1.pathCoordinates,
        busLeg1Color: leg1.color,
        boardingStop: origStop,
        transferStop: xStop,
        busLeg2Coords: leg2.pathCoordinates,
        busLeg2Color: leg2.color,
        alightingStop: destStop,
        destWalkCoords: [
          [destStop.lat, destStop.lon],
          [state.destination.lat, state.destination.lon]
        ]
      });

      if (showNotification) {
        showToast(`「${origStop.name}」から乗車、${xStop.name}で乗り換えます`, 'info', 3500);
      }
    }
  } catch (err) {
    console.error('ルート有効化エラー:', err);
  }
}

/**
 * 検索半径が変更されたときのハンドラ
 */
function handleRadiusChanged(radiusMeters) {
  state.currentRadius = radiusMeters;
  refreshNearbyStops();
  showToast(`検索範囲を ${radiusMeters}m に設定しました`, 'info', 2000);
}

/**
 * ローディング画面表示
 */
function showLoadingScreen(msg = '読み込み中...') {
  const loader = document.getElementById('app-loading-overlay');
  const msgEl = document.getElementById('loading-message');
  if (loader) {
    if (msgEl) msgEl.textContent = msg;
    loader.classList.remove('is-hidden');
  }
}

function hideLoadingScreen() {
  const loader = document.getElementById('app-loading-overlay');
  if (loader) {
    loader.classList.add('is-hidden');
  }
}

// DOM読み込み完了後に起動
document.addEventListener('DOMContentLoaded', startApp);
