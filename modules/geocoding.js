/**
 * modules/geocoding.js - 住所・施設名検索モジュール (OpenStreetMap Nominatim)
 */

import { CONFIG } from '../config.js';

let debounceTimer = null;
const geocodeCache = new Map();

/**
 * 施設名・住所の検索（ジオコーディング）
 * @param {string} query 
 * @returns {Promise<Array<{name: string, displayName: string, lat: number, lon: number, type: string}>>}
 */
export function searchPlaces(query) {
  if (!query || query.trim().length < 2) {
    return Promise.resolve([]);
  }

  const cleanQuery = query.trim();
  if (geocodeCache.has(cleanQuery)) {
    return Promise.resolve(geocodeCache.get(cleanQuery));
  }

  return new Promise((resolve) => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: cleanQuery,
          format: 'json',
          addressdetails: '1',
          limit: '8',
          viewbox: CONFIG.geocoding.viewbox,
          bounded: CONFIG.geocoding.bounded.toString(),
          countrycodes: CONFIG.geocoding.countrycodes,
          'accept-language': 'ja'
        });

        const url = `${CONFIG.geocoding.endpoint}?${params.toString()}`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'NagoyaBusStopNavigator/1.0 (WebClient)'
          }
        });

        if (!resp.ok) {
          throw new Error(`Nominatim error: ${resp.status}`);
        }

        const data = await resp.json();
        const results = (data || []).map(item => {
          const address = item.address || {};
          // 分かりやすい表示名の生成
          const mainName = item.name || address.amenity || address.shop || address.tourism || address.building || cleanQuery;
          const subInfo = [
            address.province || address.state || '',
            address.city || address.ward || address.suburb || '',
            address.road || address.neighbourhood || ''
          ].filter(Boolean).join(' ');

          return {
            name: mainName,
            displayName: item.display_name,
            subInfo: subInfo,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            type: item.type || 'place'
          };
        });

        geocodeCache.set(cleanQuery, results);
        resolve(results);

      } catch (err) {
        console.warn('ジオコーディング失敗:', err);
        resolve([]);
      }
    }, CONFIG.geocoding.debounceMs);
  });
}

/**
 * 逆ジオコーディング（座標から地名を取得）
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<string>}
 */
export async function reverseGeocode(lat, lon) {
  const cacheKey = `rev:${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: 'json',
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'ja'
    });

    const url = `${CONFIG.geocoding.reverseEndpoint}?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'NagoyaBusStopNavigator/1.0 (WebClient)'
      }
    });

    if (!resp.ok) throw new Error('Reverse geocode failed');
    const data = await resp.json();

    const address = data.address || {};
    const name = data.name || address.amenity || address.building || address.road || address.suburb || '指定地点';
    const sub = [address.city || address.ward || '', address.road || ''].filter(Boolean).join(' ');
    const label = sub ? `${name} (${sub})` : name;

    geocodeCache.set(cacheKey, label);
    return label;

  } catch (err) {
    return `指定地点 (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  }
}
