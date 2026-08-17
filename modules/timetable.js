/**
 * modules/timetable.js - 時刻表・次発バス案内モジュール
 * 遅延読込に対応し、現在時刻から「次のバスは何分後？」をリアルタイム算出
 */

import { CONFIG } from '../config.js';

let timetablesData = null; // 全時刻表キャッシュ

/**
 * 時刻表データの遅延ロード
 */
export async function loadTimetablesData() {
  if (timetablesData !== null) return timetablesData;

  const resp = await fetch(CONFIG.data.timetables);
  if (!resp.ok) {
    throw new Error(`時刻表データの取得に失敗しました (HTTP ${resp.status})`);
  }

  const json = await resp.json();
  timetablesData = json.timetables || {};
  return timetablesData;
}

/**
 * 現在の曜日種別を取得 ('w': 平日, 's': 土曜, 'h': 休日)
 */
export function getCurrentDayType(date = new Date()) {
  const day = date.getDay(); // 0: 日曜, 6: 土曜
  if (day === 0) return 'h';
  if (day === 6) return 's';
  return 'w';
}

/**
 * 時刻文字列 (HH:MM) を今日の総経過分 (0:00からの分) に変換
 */
function timeStrToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 分数を HH:MM 形式に変換
 */
function minutesToTimeStr(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * 指定したバス停の「次に出るバス一覧」を算出
 * @param {string} stopId 
 * @param {Date} now 
 * @returns {Promise<Array<{routeId: string, shortName: string, headsign: string, color: string, depTime: string, diffMinutes: number, badgeClass: string}>>}
 */
export async function getUpcomingBusesForStop(stopId, now = new Date()) {
  const tables = await loadTimetablesData();
  const stopTimetables = tables[stopId];
  if (!stopTimetables) return [];

  const dayType = getCurrentDayType(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const upcomingList = [];

  for (const [key, tObj] of Object.entries(stopTimetables)) {
    const times = tObj[dayType] || [];
    // key形式: routeId_dirId_headsign
    const parts = key.split('_');
    const routeId = parts[0];
    const headsign = parts.slice(2).join('_') || parts[1] || '';

    for (const timeStr of times) {
      const depMinutes = timeStrToMinutes(timeStr);
      const diff = depMinutes - currentMinutes;

      // 今後の便（0分後〜180分後以内の直近便を対象）
      if (diff >= 0 && diff <= 180) {
        let badgeClass = 'badge-later'; // 🔵 30分以上
        let badgeLabel = `${diff}分後`;

        if (diff <= 10) {
          badgeClass = 'badge-imminent'; // 🟢 10分以内
          badgeLabel = diff === 0 ? 'まもなく発車' : `${diff}分後`;
        } else if (diff <= 30) {
          badgeClass = 'badge-soon'; // 🟡 30分以内
        }

        upcomingList.push({
          routeId: routeId,
          headsign: headsign,
          depTime: timeStr,
          diffMinutes: diff,
          badgeClass: badgeClass,
          badgeLabel: badgeLabel
        });
        // 各系統・行先ごとに直近2便まで取得
        break;
      }
    }
  }

  // 発車時刻が早い順にソート
  upcomingList.sort((a, b) => a.diffMinutes - b.diffMinutes);
  return upcomingList;
}

/**
 * 指定したバス停・系統の全時刻表マトリクスを取得（平日・土曜・休日別）
 * @param {string} stopId 
 */
export async function getFullTimetableForStop(stopId) {
  const tables = await loadTimetablesData();
  const stopTimetables = tables[stopId];
  if (!stopTimetables) return null;

  // 系統ごとの時間別マトリクスを構築 (05時〜24時)
  const result = {};

  for (const [key, tObj] of Object.entries(stopTimetables)) {
    const parts = key.split('_');
    const routeId = parts[0];
    const headsign = parts.slice(2).join('_') || parts[1] || '';

    result[key] = {
      routeId,
      headsign,
      days: {
        w: groupTimesByHour(tObj.w || []),
        s: groupTimesByHour(tObj.s || []),
        h: groupTimesByHour(tObj.h || [])
      }
    };
  }

  return result;
}

/**
 * ["07:05", "07:20", "08:15", ...] を { 7: [5, 20], 8: [15] } にグループ化
 */
function groupTimesByHour(timesList) {
  const hoursMap = {};
  for (let h = 5; h <= 24; h++) {
    hoursMap[h] = [];
  }

  for (const t of timesList) {
    const [h, m] = t.split(':').map(Number);
    if (!hoursMap[h]) hoursMap[h] = [];
    hoursMap[h].push(m);
  }

  return hoursMap;
}
