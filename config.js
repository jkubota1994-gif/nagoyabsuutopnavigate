/**
 * config.js - アプリケーション全体設定
 * サーバーエンドポイント・動作パラメータ・帰属表示等の設定
 */

export const CONFIG = {
  // アプリ基本情報
  appName: '名古屋市営バス停ナビ＆行き先案内',
  version: '1.0.0',

  // 地図初期位置（名古屋駅中心）
  defaultCenter: [35.170915, 136.881537],
  defaultZoom: 16,
  minZoom: 11,
  maxZoom: 19,

  // バス停検索設定
  defaultRadiusMeters: 250, // 初期検索半径 (250m)
  radiusOptions: [250, 500, 1000], // 選択可能半径 (m)
  walkingSpeedMeterPerMin: 80, // 徒歩速度目安 (80m/分)

  // 地図タイルサーバー設定（切替可能）
  tile: {
    // 開発・非商用向け: OpenStreetMap 公式
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    
    // 【将来の商用・スケール時】Geoapify / MapTiler 例
    // url: 'https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=YOUR_KEY',
    // url: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY',
  },

  // 歩行者ルーティング（OSRM FOSSGIS 公開サーバー）
  routing: {
    // FOSSGIS routed-foot エンドポイント（歩行者プロファイル）
    endpoint: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
    // レート制限防止用の最小リクエスト間隔 (ms)
    minRequestIntervalMs: 1100,
    // タイムアウト (ms)
    timeoutMs: 10000
  },

  // 住所・施設名検索（OpenStreetMap Nominatim）
  geocoding: {
    endpoint: 'https://nominatim.openstreetmap.org/search',
    reverseEndpoint: 'https://nominatim.openstreetmap.org/reverse',
    // 名古屋市域バウンディングボックス [南, 西, 北, 東] で優先検索
    viewbox: '136.78,35.05,137.05,35.26',
    bounded: 0,
    countrycodes: 'jp',
    debounceMs: 400
  },

  // データファイルパス
  data: {
    stops: './data/bus_stops.json',
    routes: './data/bus_routes.json',
    timetables: './data/bus_timetables.json'
  }
};
