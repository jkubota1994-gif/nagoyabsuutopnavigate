/**
 * modules/ui.js - UI制御・パネル・アニメーション・イベントハンドラ統括
 */

import { CONFIG } from '../config.js';
import { getRoutesForStop, getRoutePatternGeometry } from './routes.js';
import { getUpcomingBusesForStop, getFullTimetableForStop } from './timetable.js';
import { getWalkingRoute } from './routing.js';
import { searchPlaces } from './geocoding.js';
import { searchStopsByName, getStopById } from './stops.js';

// UI状態
let currentActiveStop = null;
let currentDestination = null; // { lat, lon, name }
let activeRadius = CONFIG.defaultRadiusMeters;
let isSheetExpanded = false;

// コールバック
let onStopSelectedCallback = null;
let onRouteHighlightedCallback = null;
let onWalkingRouteRequestedCallback = null;
let onRadiusChangedCallback = null;

/**
 * UIの初期化
 */
export function initUI(callbacks) {
  onStopSelectedCallback = callbacks.onStopSelected;
  onRouteHighlightedCallback = callbacks.onRouteHighlighted;
  onWalkingRouteRequestedCallback = callbacks.onWalkingRouteRequested;
  onRadiusChangedCallback = callbacks.onRadiusChanged;

  setupBottomSheet();
  setupSearchBar();
  setupRadiusButtons();
  setupActionButtons();
  setupModals();
}

/**
 * ボトムシート（下部パネル）のスワイプ・展開制御
 */
function setupBottomSheet() {
  const sheet = document.getElementById('bottom-sheet');
  const handle = document.getElementById('sheet-drag-handle');
  if (!sheet || !handle) return;

  handle.addEventListener('click', () => {
    toggleSheetState();
  });

  // タッチスワイプ対応
  let startY = 0;
  let currentTranslateY = 0;

  handle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    const deltaY = e.touches[0].clientY - startY;
    if (deltaY < -40 && !sheet.classList.contains('is-expanded')) {
      expandSheet();
    } else if (deltaY > 40 && sheet.classList.contains('is-expanded')) {
      collapseSheet();
    }
  }, { passive: true });
}

export function toggleSheetState() {
  const sheet = document.getElementById('bottom-sheet');
  if (sheet.classList.contains('is-expanded')) {
    collapseSheet();
  } else {
    expandSheet();
  }
}

export function expandSheet() {
  const sheet = document.getElementById('bottom-sheet');
  if (sheet) {
    sheet.classList.remove('is-collapsed');
    sheet.classList.add('is-expanded');
    isSheetExpanded = true;
  }
}

export function collapseSheet() {
  const sheet = document.getElementById('bottom-sheet');
  if (sheet) {
    sheet.classList.remove('is-expanded');
    isSheetExpanded = false;
  }
}

/**
 * 検索バーのセットアップ（バス停名 ＆ 施設名・住所の同時検索）
 */
function setupSearchBar() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  const resultsContainer = document.getElementById('search-results-dropdown');
  if (!input || !resultsContainer) return;

  input.addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      resultsContainer.classList.add('is-hidden');
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    if (clearBtn) clearBtn.style.display = 'block';

    // 1. バス停の検索
    const stopMatches = searchStopsByName(query, null, null, 6);

    // 2. 施設・住所の検索（Nominatim）
    const placeMatches = query.length >= 2 ? await searchPlaces(query) : [];

    renderSearchResults(stopMatches, placeMatches, query);
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      resultsContainer.classList.add('is-hidden');
      input.focus();
    });
  }

  // フォーカスアウト時に閉じる
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-bar-wrapper')) {
      resultsContainer.classList.add('is-hidden');
    }
  });
}

/**
 * 検索ドロップダウンの描画
 */
function renderSearchResults(stopMatches, placeMatches, query) {
  const container = document.getElementById('search-results-dropdown');
  if (!container) return;

  if (stopMatches.length === 0 && placeMatches.length === 0) {
    container.innerHTML = `<div class="search-no-results">「${query}」に一致するバス停・施設は見つかりませんでした</div>`;
    container.classList.remove('is-hidden');
    return;
  }

  let html = '';

  if (stopMatches.length > 0) {
    html += `<div class="search-category-title"><i class="fa-solid fa-bus"></i> バス停</div>`;
    stopMatches.forEach(stop => {
      const platform = stop.platformCode ? `${stop.platformCode}番のりば` : '';
      html += `
        <div class="search-result-item" data-type="stop" data-id="${stop.id}">
          <div class="result-icon stop-icon"><i class="fa-solid fa-location-dot"></i></div>
          <div class="result-info">
            <div class="result-name">${stop.name} <span class="result-badge">${platform}</span></div>
            <div class="result-sub">${stop.distanceText ? `現在地から ${stop.distanceText}` : '名古屋市営バス'}</div>
          </div>
        </div>
      `;
    });
  }

  if (placeMatches.length > 0) {
    html += `<div class="search-category-title"><i class="fa-solid fa-map-pin"></i> 目的地・施設・住所</div>`;
    placeMatches.forEach((place, idx) => {
      html += `
        <div class="search-result-item" data-type="place" data-idx="${idx}">
          <div class="result-icon place-icon"><i class="fa-solid fa-bullseye"></i></div>
          <div class="result-info">
            <div class="result-name">${place.name}</div>
            <div class="result-sub">${place.subInfo || place.displayName}</div>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = html;
  container.classList.remove('is-hidden');

  // アイテムクリックイベント
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      if (type === 'stop') {
        const stopId = item.dataset.id;
        const stop = getStopById(stopId);
        if (stop && onStopSelectedCallback) {
          onStopSelectedCallback(stop);
        }
      } else if (type === 'place') {
        const idx = parseInt(item.dataset.idx, 10);
        const place = placeMatches[idx];
        if (place) {
          setCustomDestination(place.lat, place.lon, place.name);
        }
      }
      container.classList.add('is-hidden');
    });
  });
}

/**
 * 検索半径フィルターボタンのセットアップ
 */
function setupRadiusButtons() {
  const buttons = document.querySelectorAll('.radius-chip');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      activeRadius = parseInt(btn.dataset.radius, 10);
      if (onRadiusChangedCallback) {
        onRadiusChangedCallback(activeRadius);
      }
    });
  });
}

/**
 * フローティングアクションボタンのセットアップ
 */
function setupActionButtons() {
  const locateBtn = document.getElementById('btn-re-locate');
  const aboutBtn = document.getElementById('btn-show-about');

  if (locateBtn) {
    locateBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('app:relocate'));
    });
  }

  if (aboutBtn) {
    aboutBtn.addEventListener('click', () => {
      showModal('modal-about');
    });
  }
}

/**
 * モーダルのセットアップ
 */
function setupModals() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.modal-close-btn')) {
        modal.classList.add('is-hidden');
      }
    });
  });
}

export function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('is-hidden');
  }
}

export function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('is-hidden');
  }
}

/**
 * 周辺バス停サマリーリストの描画
 * @param {Array} nearbyStops 
 * @param {number} userLat 
 * @param {number} userLon 
 */
export function renderNearbyStopsSummary(nearbyStops, userLat, userLon) {
  const container = document.getElementById('sheet-content-body');
  if (!container) return;

  if (nearbyStops.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-ban"></i></div>
        <h3>半径 ${activeRadius}m 以内にバス停がありません</h3>
        <p>検索範囲を 500m または 1km に広げてみてください。</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="nearby-summary-header">
      <div class="header-title">
        <h4><i class="fa-solid fa-location-arrow"></i> あなたの周辺のバス停</h4>
        <span class="count-badge">${nearbyStops.length}件</span>
      </div>
      <p class="header-hint">バス停をタップすると乗車可能な系統・行先・発車時刻を確認できます</p>
    </div>
    <div class="nearby-cards-list">
  `;

  nearbyStops.forEach(stop => {
    const routes = getRoutesForStop(stop.id);
    const platform = stop.platformCode ? `${stop.platformCode}番のりば` : 'のりば';

    // 主要行先の集約（重複排除して上位3行先）
    const headsigns = Array.from(new Set(routes.map(r => `${r.shortName} → ${r.headsign}`))).slice(0, 3);

    html += `
      <div class="stop-summary-card" data-stop-id="${stop.id}">
        <div class="card-top-row">
          <div class="stop-title-group">
            <span class="stop-name">${stop.name}</span>
            <span class="platform-tag">${platform}</span>
          </div>
          <div class="distance-badge">
            <i class="fa-solid fa-person-walking"></i> ${stop.distanceText}
          </div>
        </div>
        <div class="walking-estimate">
          <i class="fa-regular fa-clock"></i> ${stop.walkingTimeText}
        </div>
        <div class="destinations-preview">
          ${headsigns.length > 0
            ? headsigns.map(h => `<span class="headsign-chip"><i class="fa-solid fa-route"></i> ${h}</span>`).join('')
            : '<span class="text-muted">運行系統情報を読み込み中</span>'}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;

  // カードクリックイベント
  container.querySelectorAll('.stop-summary-card').forEach(card => {
    card.addEventListener('click', () => {
      const stopId = card.dataset.stopId;
      const stop = getStopById(stopId);
      if (stop && onStopSelectedCallback) {
        onStopSelectedCallback(stop);
      }
    });
  });
}

/**
 * バス停詳細ビューの表示（系統一覧・次バス・時刻表）
 * @param {Object} stop 
 * @param {number|null} userLat 
 * @param {number|null} userLon 
 */
export async function renderStopDetail(stop, userLat = null, userLon = null) {
  currentActiveStop = stop;
  const container = document.getElementById('sheet-content-body');
  if (!container) return;

  const routes = getRoutesForStop(stop.id);
  const platform = stop.platformCode ? `${stop.platformCode}番のりば` : 'のりば';
  const distText = stop.distanceText ? `現在地から ${stop.distanceText}（${stop.walkingTimeText}）` : '';

  // ローディング枠を用意
  container.innerHTML = `
    <div class="stop-detail-header">
      <button class="btn-back" id="btn-back-to-summary"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
      <div class="stop-detail-title">
        <h2>${stop.name}</h2>
        <span class="platform-tag is-large">${platform}</span>
      </div>
      ${distText ? `<div class="stop-dist-info"><i class="fa-solid fa-person-walking"></i> ${distText}</div>` : ''}
      
      <div class="detail-actions">
        <button class="btn-primary action-walk-btn" id="btn-walk-to-stop">
          <i class="fa-solid fa-diamond-turn-right"></i> このバス停への徒歩ルート案内
        </button>
      </div>
    </div>

    <!-- 次のバス案内セクション -->
    <div class="detail-section">
      <div class="section-title">
        <h3><i class="fa-solid fa-clock"></i> 次のバス案内</h3>
        <span class="live-badge"><span class="pulse-dot"></span> リアルタイム目安</span>
      </div>
      <div id="upcoming-buses-container" class="upcoming-container">
        <div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 時刻表を計算中...</div>
      </div>
    </div>

    <!-- 運行系統・行先一覧セクション -->
    <div class="detail-section">
      <div class="section-title">
        <h3><i class="fa-solid fa-bus"></i> このバス停から乗れる系統・行先</h3>
      </div>
      <div class="routes-cards-list">
        ${routes.length > 0 ? routes.map((r, rIdx) => `
          <div class="route-item-card" data-route-id="${r.routeId}" data-pattern-idx="${r.patternIdx}">
            <div class="route-header-row">
              <span class="route-badge" style="background-color: ${r.color}; color: ${r.textColor};">
                ${r.shortName}
              </span>
              <span class="route-headsign-arrow">▶</span>
              <span class="route-headsign-text">${r.headsign} 行き</span>
            </div>
            <div class="route-body">
              <div class="stops-count"><i class="fa-solid fa-arrow-down-short-wide"></i> 終点まで残り ${r.remainingStopsCount} 停留所</div>
              <div class="next-stops-inline">
                主な停車駅: ${r.nextStops.slice(0, 4).map(ns => ns.name).join(' → ')}${r.nextStops.length > 4 ? '…' : ''}
              </div>
            </div>
            <div class="route-footer">
              <button class="btn-text btn-view-route" data-route-id="${r.routeId}" data-pattern-idx="${r.patternIdx}">
                <i class="fa-solid fa-map-location-dot"></i> 停車駅を地図に表示
              </button>
            </div>
          </div>
        `).join('') : '<p class="text-muted">乗車可能な系統情報がありません</p>'}
      </div>
    </div>

    <!-- 時刻表展開セクション -->
    <div class="detail-section">
      <div class="section-title">
        <h3><i class="fa-solid fa-table-list"></i> 発車時刻表（平日・土曜・休日）</h3>
      </div>
      <div id="timetable-matrix-container">
        <button class="btn-secondary" id="btn-load-timetable">
          <i class="fa-solid fa-calendar-days"></i> 全時刻表を表示する
        </button>
      </div>
    </div>
  `;

  // 戻るボタン
  document.getElementById('btn-back-to-summary')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:backToSummary'));
  });

  // 徒歩ルート案内ボタン
  document.getElementById('btn-walk-to-stop')?.addEventListener('click', () => {
    if (onWalkingRouteRequestedCallback && userLat && userLon) {
      onWalkingRouteRequestedCallback(userLat, userLon, stop.lat, stop.lon, stop.name);
    }
  });

  // 系統ハイライトボタン
  container.querySelectorAll('.btn-view-route').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rId = btn.dataset.routeId;
      const pIdx = parseInt(btn.dataset.patternIdx, 10);
      if (onRouteHighlightedCallback) {
        onRouteHighlightedCallback(rId, pIdx);
      }
    });
  });

  // 次バスデータのロード
  loadAndRenderUpcomingBuses(stop.id);

  // 時刻表ボタン
  document.getElementById('btn-load-timetable')?.addEventListener('click', () => {
    loadAndRenderTimetableMatrix(stop.id);
  });

  expandSheet();
}

/**
 * 次バス案内の読み込みと表示
 */
async function loadAndRenderUpcomingBuses(stopId) {
  const container = document.getElementById('upcoming-buses-container');
  if (!container) return;

  try {
    const upcoming = await getUpcomingBusesForStop(stopId);
    if (upcoming.length === 0) {
      container.innerHTML = `<div class="upcoming-empty">本日の直近の運行便はありません</div>`;
      return;
    }

    let html = `<div class="upcoming-cards-grid">`;
    upcoming.forEach(bus => {
      html += `
        <div class="upcoming-card ${bus.badgeClass}">
          <div class="upcoming-top">
            <span class="upcoming-headsign">${bus.headsign} 行き</span>
            <span class="time-diff-badge ${bus.badgeClass}">${bus.badgeLabel}</span>
          </div>
          <div class="upcoming-dep-time">
            <i class="fa-regular fa-clock"></i> <strong>${bus.depTime}</strong> 発
          </div>
        </div>
      `;
    });
    html += `</div>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="text-muted">次バス情報の取得に失敗しました</div>`;
  }
}

/**
 * 全時刻表マトリクスの読み込みと表示
 */
async function loadAndRenderTimetableMatrix(stopId) {
  const container = document.getElementById('timetable-matrix-container');
  if (!container) return;

  container.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> 時刻表データを読込中...</div>`;

  try {
    const fullTable = await getFullTimetableForStop(stopId);
    if (!fullTable || Object.keys(fullTable).length === 0) {
      container.innerHTML = `<p class="text-muted">時刻表データが見つかりませんでした。</p>`;
      return;
    }

    let html = `
      <div class="timetable-tabs">
        <button class="tt-tab-btn is-active" data-day="w">平日</button>
        <button class="tt-tab-btn" data-day="s">土曜</button>
        <button class="tt-tab-btn" data-day="h">休日・日曜</button>
      </div>
      <div class="timetable-body">
    `;

    for (const [key, tData] of Object.entries(fullTable)) {
      html += `
        <div class="timetable-route-block">
          <div class="tt-route-title">${tData.headsign} 行き</div>
          <div class="tt-matrix-table-wrap">
            <table class="tt-matrix-table">
              <thead>
                <tr>
                  <th style="width: 50px;">時</th>
                  <th>発車時刻 (分)</th>
                </tr>
              </thead>
              <tbody class="tt-tbody-w">
                ${renderHoursRows(tData.days.w)}
              </tbody>
              <tbody class="tt-tbody-s is-hidden">
                ${renderHoursRows(tData.days.s)}
              </tbody>
              <tbody class="tt-tbody-h is-hidden">
                ${renderHoursRows(tData.days.h)}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;

    // タブ切替イベント
    container.querySelectorAll('.tt-tab-btn').forEach(tBtn => {
      tBtn.addEventListener('click', () => {
        container.querySelectorAll('.tt-tab-btn').forEach(b => b.classList.remove('is-active'));
        tBtn.classList.add('is-active');
        const day = tBtn.dataset.day;

        container.querySelectorAll('.tt-tbody-w, .tt-tbody-s, .tt-tbody-h').forEach(tb => tb.classList.add('is-hidden'));
        container.querySelectorAll(`.tt-tbody-${day}`).forEach(tb => tb.classList.remove('is-hidden'));
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="text-muted">時刻表の読込に失敗しました。</p>`;
  }
}

function renderHoursRows(hoursMap) {
  let rows = '';
  for (let h = 5; h <= 24; h++) {
    const minutes = hoursMap[h] || [];
    if (minutes.length === 0) continue;
    rows += `
      <tr>
        <td class="tt-hour-cell">${h}</td>
        <td class="tt-minutes-cell">
          ${minutes.map(m => `<span class="tt-minute-badge">${m.toString().padStart(2, '0')}</span>`).join('')}
        </td>
      </tr>
    `;
  }
  return rows || '<tr><td colspan="2" class="text-center text-muted">運行便なし</td></tr>';
}

/**
 * 徒歩ルート案内パネルの表示
 * @param {Object} routeResult - OSRM ルーティング結果
 * @param {string} destinationName 
 */
export function renderWalkingRouteNavigation(routeResult, destinationName) {
  const container = document.getElementById('sheet-content-body');
  if (!container) return;

  let html = `
    <div class="navigation-panel">
      <button class="btn-back" id="btn-back-to-detail"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
      
      <div class="nav-summary-card">
        <div class="nav-dest-title">
          <i class="fa-solid fa-flag-checkered"></i> ${destinationName} への道案内
        </div>
        <div class="nav-stats-row">
          <div class="nav-stat-item">
            <span class="stat-label">所要時間</span>
            <span class="stat-value highlight">${routeResult.durationText}</span>
          </div>
          <div class="nav-stat-item">
            <span class="stat-label">総距離</span>
            <span class="stat-value">${routeResult.distanceText}</span>
          </div>
        </div>
        ${routeResult.isStraightLineFallback ? `
          <div class="alert-box"><i class="fa-solid fa-triangle-exclamation"></i> 経路サーバー応答待機中のため直線距離を表示しています</div>
        ` : ''}
      </div>

      <div class="turn-by-turn-list">
        <h4><i class="fa-solid fa-list-ol"></i> 徒歩ルートの案内手順</h4>
  `;

  routeResult.steps.forEach((step, idx) => {
    html += `
      <div class="step-item">
        <div class="step-icon-col">
          <div class="step-icon"><i class="fa-solid ${step.icon}"></i></div>
          ${idx < routeResult.steps.length - 1 ? '<div class="step-line"></div>' : ''}
        </div>
        <div class="step-content">
          <div class="step-instruction">${step.instruction}</div>
          ${step.distanceText ? `<div class="step-distance"><i class="fa-solid fa-arrow-down"></i> ${step.distanceText}</div>` : ''}
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;

  document.getElementById('btn-back-to-detail')?.addEventListener('click', () => {
    if (currentActiveStop) {
      renderStopDetail(currentActiveStop);
    } else {
      window.dispatchEvent(new CustomEvent('app:backToSummary'));
    }
  });

  expandSheet();
}

/**
 * 目的地までの行き方案内（マルチレグ交通ルート）ビューの表示
 * @param {Array<Object>} transitPlans 
 * @param {string} destinationName 
 * @param {number} userLat 
 * @param {number} userLon 
 * @param {number} destLat 
 * @param {number} destLon 
 */
export function renderTripPlanView(transitPlans, destinationName, userLat, userLon, destLat, destLon) {
  const container = document.getElementById('sheet-content-body');
  if (!container) return;

  let html = `
    <div class="trip-planner-view">
      <button class="btn-back" id="btn-back-to-summary-from-trip"><i class="fa-solid fa-arrow-left"></i> バス停一覧に戻る</button>

      <div class="trip-header-card">
        <div class="trip-endpoints">
          <div class="endpoint-row">
            <span class="endpoint-dot is-origin"><i class="fa-solid fa-person-walking"></i></span>
            <span class="endpoint-label">出発地:</span>
            <span class="endpoint-val">現在地</span>
          </div>
          <div class="endpoint-connector"></div>
          <div class="endpoint-row">
            <span class="endpoint-dot is-dest"><i class="fa-solid fa-flag-checkered"></i></span>
            <span class="endpoint-label">目的地:</span>
            <span class="endpoint-val"><strong>${destinationName}</strong></span>
          </div>
        </div>
      </div>
  `;

  if (!transitPlans || transitPlans.length === 0) {
    html += `
      <div class="empty-state" style="padding: 20px 0;">
        <div class="empty-icon"><i class="fa-solid fa-route"></i></div>
        <h3>直通の市バス路線が見つかりませんでした</h3>
        <p>目的地周辺または現在地周辺の検索範囲を広げるか、最寄りバス停までの徒歩案内をご利用ください。</p>
        
        <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px;">
          <button class="btn-primary" id="btn-direct-walk-to-dest">
            <i class="fa-solid fa-person-walking"></i> 目的地へ直接歩く（徒歩ルート計算）
          </button>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="trip-options-header">
        <h4><i class="fa-solid fa-signs-post"></i> おすすめルート案 (${transitPlans.length}件)</h4>
        <span class="header-hint">タップすると全行程の地図と詳細手順を表示します</span>
      </div>
      <div class="trip-plans-list">
    `;

    transitPlans.forEach((plan, idx) => {
      const isBest = idx === 0;
      const isSubway = plan.type === 'subway_hybrid';
      const isDirect = plan.isDirect;

      let badgeHtml = '';
      if (isSubway) {
        badgeHtml = '<span class="route-type-badge is-subway"><i class="fa-solid fa-train-subway"></i> 地下鉄利用</span>';
      } else if (isDirect) {
        badgeHtml = '<span class="route-type-badge is-direct"><i class="fa-solid fa-bolt"></i> 市バス直通</span>';
      } else {
        badgeHtml = '<span class="route-type-badge is-transfer"><i class="fa-solid fa-arrows-rotate"></i> 市バス乗換 1回</span>';
      }

      html += `
        <div class="trip-plan-card ${isBest ? 'is-recommended' : ''}" data-plan-idx="${idx}">
          <div class="plan-badge-row">
            ${isBest ? '<span class="recommend-badge"><i class="fa-solid fa-star"></i> おすすめ</span>' : ''}
            ${badgeHtml}
          </div>
          
          <div class="plan-summary-row">
            <div class="plan-total-time">
              <span class="time-num">約${plan.totalDurationMin}</span><span class="time-unit">分</span>
            </div>
            <div class="plan-stats-tags">
              ${isSubway
                ? `<span class="tag-chip"><i class="fa-solid fa-train-subway"></i> 地下鉄 ${plan.subway.isDirect ? `${plan.subway.lineName} (${plan.subway.stationsCount}駅)` : '乗換あり'}</span>`
                : `<span class="tag-chip"><i class="fa-solid fa-bus"></i> バス計 ${plan.totalBusStopsCount}駅</span>`}
              <span class="tag-chip"><i class="fa-solid fa-person-walking"></i> 徒歩計 ${(plan.totalWalkingDistance < 1000 ? `${plan.totalWalkingDistance}m` : `${(plan.totalWalkingDistance/1000).toFixed(1)}km`)}</span>
            </div>
          </div>

          <!-- 行程タイムライン -->
          <div class="plan-timeline">
      `;

      if (isSubway) {
        // 地下鉄ハイブリッドプランの場合
        const oSt = plan.originWalk.toStation;
        const sub = plan.subway;
        const dSt = plan.destWalk.fromStation;

        html += `
            <!-- 出発徒歩 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.originWalk.durationMin}分 (${plan.originWalk.distanceText})</span>
                <span class="tl-sub">地下鉄 ${oSt.name}駅へ移動</span>
              </div>
            </div>

            <!-- 地下鉄乗車駅 -->
            <div class="tl-step is-station">
              <div class="tl-icon subway-icon"><i class="fa-solid fa-train-subway"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">地下鉄 ${oSt.name}駅</div>
        `;

        if (sub.isDirect) {
          html += `
                <div class="tl-bus-badge" style="background-color: ${sub.color}; color: ${sub.textColor};">
                  ${sub.lineName} ▶ ${sub.headsign}
                </div>
                <div class="tl-bus-sub">${sub.stationsCount}駅乗車 (約${sub.rideMinutes}分)</div>
              </div>
            </div>
          `;
        } else {
          // 地下鉄内1回乗換
          html += `
                <div class="tl-bus-badge" style="background-color: ${sub.leg1.color}; color: ${sub.leg1.textColor};">
                  ${sub.leg1.lineName} ▶ ${sub.leg1.headsign}
                </div>
                <div class="tl-bus-sub">${sub.leg1.stationsCount}駅乗車 (約${sub.leg1.rideMinutes}分)</div>
              </div>
            </div>

            <!-- 地下鉄乗換駅 -->
            <div class="tl-step is-transfer-point">
              <div class="tl-icon transfer-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">🔄 ${sub.transferStation.name}駅で乗り換え</div>
                <div class="tl-bus-badge" style="background-color: ${sub.leg2.color}; color: ${sub.leg2.textColor};">
                  ${sub.leg2.lineName} ▶ ${sub.leg2.headsign}
                </div>
                <div class="tl-bus-sub">${sub.leg2.stationsCount}駅乗車 (約${sub.leg2.rideMinutes}分)</div>
              </div>
            </div>
          `;
        }

        html += `
            <!-- 地下鉄降車駅 -->
            <div class="tl-step is-station">
              <div class="tl-icon subway-icon"><i class="fa-solid fa-arrow-right-from-bracket"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">地下鉄 ${dSt.name}駅 で下車</div>
              </div>
            </div>

            <!-- 到着徒歩 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.destWalk.durationMin}分 (${plan.destWalk.distanceText})</span>
                <span class="tl-sub">${destinationName} に到着</span>
              </div>
            </div>
        `;

      } else if (isDirect) {
        // 直通バスプランの場合
        const bStop = plan.transitBus.boardingStop;
        const aStop = plan.transitBus.alightingStop;
        const bus = plan.transitBus;
        const bPlatform = bStop.platformCode ? ` (${bStop.platformCode}番)` : '';
        const aPlatform = aStop.platformCode ? ` (${aStop.platformCode}番)` : '';

        html += `
            <!-- 1. 徒歩出発 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.originWalk.durationMin}分 (${plan.originWalk.distanceText})</span>
                <span class="tl-sub">乗車バス停へ移動</span>
              </div>
            </div>

            <!-- 乗車バス停 -->
            <div class="tl-step is-station">
              <div class="tl-icon stop-icon"><i class="fa-solid fa-bus"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">${bStop.name}${bPlatform}</div>
                <div class="tl-bus-badge" style="background-color: ${bus.color}; color: ${bus.textColor};">
                  ${bus.shortName} ▶ ${bus.headsign} 行き
                </div>
                <div class="tl-bus-sub">${bus.stopsCount}停留所乗車 (約${bus.durationMin}分)</div>
              </div>
            </div>

            <!-- 降車バス停 -->
            <div class="tl-step is-station">
              <div class="tl-icon stop-icon alighting-icon"><i class="fa-solid fa-arrow-right-from-bracket"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">${aStop.name}${aPlatform} で下車</div>
              </div>
            </div>

            <!-- 到着徒歩 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.destWalk.durationMin}分 (${plan.destWalk.distanceText})</span>
                <span class="tl-sub">${destinationName} に到着</span>
              </div>
            </div>
        `;
      } else {
        // 市バス乗換1回プランの場合
        const leg1 = plan.transitLeg1;
        const xStop = plan.transferStop;
        const leg2 = plan.transitLeg2;

        html += `
            <!-- 1. 徒歩出発 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.originWalk.durationMin}分 (${plan.originWalk.distanceText})</span>
                <span class="tl-sub">乗車バス停へ移動</span>
              </div>
            </div>

            <!-- 1本目バス乗車 -->
            <div class="tl-step is-station">
              <div class="tl-icon stop-icon"><i class="fa-solid fa-bus"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">${leg1.boardingStop.name}</div>
                <div class="tl-bus-badge" style="background-color: ${leg1.color}; color: ${leg1.textColor};">
                  ${leg1.shortName} ▶ ${leg1.headsign} 行き
                </div>
                <div class="tl-bus-sub">${leg1.stopsCount}停留所乗車 (約${leg1.durationMin}分)</div>
              </div>
            </div>

            <!-- 乗換ポイント -->
            <div class="tl-step is-transfer-point">
              <div class="tl-icon transfer-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">🔄 ${xStop.name} で乗り換え</div>
                <div class="tl-sub">乗り継ぎ目安 約${plan.transferWaitMin}分</div>
              </div>
            </div>

            <!-- 2本目バス乗車 -->
            <div class="tl-step is-station">
              <div class="tl-icon stop-icon"><i class="fa-solid fa-bus"></i></div>
              <div class="tl-info">
                <div class="tl-bus-badge" style="background-color: ${leg2.color}; color: ${leg2.textColor};">
                  ${leg2.shortName} ▶ ${leg2.headsign} 行き
                </div>
                <div class="tl-bus-sub">${leg2.stopsCount}停留所乗車 (約${leg2.durationMin}分)</div>
              </div>
            </div>

            <!-- 降車バス停 -->
            <div class="tl-step is-station">
              <div class="tl-icon stop-icon alighting-icon"><i class="fa-solid fa-arrow-right-from-bracket"></i></div>
              <div class="tl-info">
                <div class="tl-station-name">${leg2.alightingStop.name} で下車</div>
              </div>
            </div>

            <!-- 到着徒歩 -->
            <div class="tl-step">
              <div class="tl-icon walk-icon"><i class="fa-solid fa-person-walking"></i></div>
              <div class="tl-info">
                <span class="tl-action">徒歩 ${plan.destWalk.durationMin}分 (${plan.destWalk.distanceText})</span>
                <span class="tl-sub">${destinationName} に到着</span>
              </div>
            </div>
        `;
      }

      html += `
          </div>

          <div class="plan-card-actions">
            <button class="btn-primary btn-select-trip-plan" data-plan-idx="${idx}">
              <i class="fa-solid fa-map-location-dot"></i> このルートの全行程を地図で見る
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  // 戻るボタン
  document.getElementById('btn-back-to-summary-from-trip')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:backToSummary'));
  });

  // 直接徒歩ボタン
  document.getElementById('btn-direct-walk-to-dest')?.addEventListener('click', () => {
    if (onWalkingRouteRequestedCallback) {
      onWalkingRouteRequestedCallback(userLat, userLon, destLat, destLon, destinationName);
    }
  });

  // ルート選択ボタン
  container.querySelectorAll('.btn-select-trip-plan').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.planIdx, 10);
      const selectedPlan = transitPlans[idx];
      if (selectedPlan) {
        window.dispatchEvent(new CustomEvent('app:tripPlanActivated', {
          detail: selectedPlan
        }));
      }
    });
  });

  expandSheet();
}

/**
 * 目的地（ピン）が設定されたときの処理
 */
export function setCustomDestination(lat, lon, name = '目的地') {
  currentDestination = { lat, lon, name };
  window.dispatchEvent(new CustomEvent('app:destinationSelected', {
    detail: currentDestination
  }));
}

/**
 * トースト通知の表示
 */
export function showToast(message, type = 'info', durationMs = 3000) {
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast-message is-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-fade-out');
    setTimeout(() => toast.remove(), 400);
  }, durationMs);
}

