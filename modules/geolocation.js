/**
 * modules/geolocation.js - 位置情報取得・プライバシー管理モジュール
 * 位置情報はブラウザ内のみで処理し、サーバーへ送信しない設計
 */

import { CONFIG } from '../config.js';

let currentLocation = null; // { lat, lon, accuracy, timestamp }
let watchId = null;

/**
 * 現在地が既に取得されているか確認
 */
export function getCurrentPositionData() {
  return currentLocation;
}

/**
 * 位置情報の利用許諾ダイアログ（初回案内モーダル）を表示するか確認
 */
export function shouldShowPermissionModal() {
  return !localStorage.getItem('nagoya_bus_geo_permission_acknowledged');
}

/**
 * 位置情報の許諾済みフラグを保存
 */
export function setPermissionAcknowledged() {
  localStorage.setItem('nagoya_bus_geo_permission_acknowledged', 'true');
}

/**
 * 現在地を取得する（Promise）
 * @param {boolean} highAccuracy 
 * @returns {Promise<{lat: number, lon: number, accuracy: number}>}
 */
export function requestCurrentLocation(highAccuracy = true) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      const errorMsg = 'お使いのブラウザは位置情報機能に対応していません。デフォルト位置（名古屋駅）を表示します。';
      resolve({
        lat: CONFIG.defaultCenter[0],
        lon: CONFIG.defaultCenter[1],
        accuracy: 0,
        isFallback: true,
        message: errorMsg
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        currentLocation = {
          lat: latitude,
          lon: longitude,
          accuracy: Math.round(accuracy),
          timestamp: position.timestamp,
          isFallback: false
        };
        resolve(currentLocation);
      },
      (error) => {
        let msg = '現在地の取得に失敗しました。';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = '位置情報の利用が拒否されました。名古屋駅周辺を表示します。';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = '位置情報を取得できませんでした。';
            break;
          case error.TIMEOUT:
            msg = '位置情報の取得がタイムアウトしました。';
            break;
        }
        // フォールバック（名古屋駅）
        currentLocation = {
          lat: CONFIG.defaultCenter[0],
          lon: CONFIG.defaultCenter[1],
          accuracy: 0,
          isFallback: true,
          message: msg
        };
        resolve(currentLocation);
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  });
}

/**
 * リアルタイム位置監視の開始
 * @param {Function} onUpdate - 位置更新時のコールバック ({lat, lon, accuracy})
 * @param {Function} onError - エラー時コールバック
 */
export function startWatchLocation(onUpdate, onError) {
  if (!('geolocation' in navigator)) return null;

  if (watchId !== null) {
    stopWatchLocation();
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      currentLocation = {
        lat: latitude,
        lon: longitude,
        accuracy: Math.round(accuracy),
        timestamp: position.timestamp,
        isFallback: false
      };
      if (onUpdate) onUpdate(currentLocation);
    },
    (error) => {
      if (onError) onError(error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000
    }
  );

  return watchId;
}

/**
 * リアルタイム位置監視の停止
 */
export function stopWatchLocation() {
  if (watchId !== null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}
