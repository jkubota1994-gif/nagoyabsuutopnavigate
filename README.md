# 名古屋市営バス停ナビ＆行き先案内 (Nagoya City Bus Navigator)

名古屋市交通局が公開するGTFS-JPオープンデータ（CC BY 4.0）を活用し、現在地から最寄りバス停（標柱・のりば単位の正確な位置）の検索、乗車可能な運行系統・行先・この先の停車バス停一覧、次のバスの発車案内、およびOSRM（Open Source Routing Machine）を活用した徒歩道案内を提供するWebアプリケーションです。

---

## 🌟 主な機能

1. **最寄りバス停（のりば）検索＆マップ表示**
   - GPS位置情報をもとに、半径250m（初期値）〜1km以内のバス停を距離順で一覧表示
   - 親停留所ではなく「1番のりば」「2番のりば」といった**標柱単位の正確な位置**にピンを配置
   - 大量マーカーの自動クラスタリング表示（Leaflet.markercluster）

2. **目的地を入力して「どのバス停からどの系統に乗ればいいか」総合行き方案内**
   - 施設名・住所（例：「名古屋城」「栄」「熱田神宮」など）や地図タップで目的地を指定
   - 現在地周辺の乗車バス停から目的地周辺の降車バス停を結ぶ**直通市バス路線を自動探索・最適提案**
   - **全行程タイムライン表示**: 🚶現在地から乗車バス停へ徒歩 → 🚌市バス乗車（系統・行先・停車数） → 🚏降車 → 🚶目的地へ徒歩
   - 地図上に全行程（徒歩エメラルド点線＋バス路線カラー実線＋目的地ピン）をまとめて可視化

3. **「どこに行けるか」系統・行先・停車バス停案内**
   - 選択したバス停から**乗車可能なすべての運行系統と行先（方面）**を一覧表示
   - 系統を選択すると、**終点までの全停車バス停リスト**と**地図上の運行ルートライン**をハイライト描画

4. **リアルタイム「次のバスは何分後？」案内**
   - 現在時刻と曜日（平日/土曜/休日）に応じた**直近の発車便をリアルタイム計算**
   - 🟢 **10分以内** / 🟡 **30分以内** / 🔵 **31分以上** のカラーバッジで直感表示

5. **平日・土曜・休日の発車時刻表マトリクス**
   - 各バス停・系統ごとの時間別（5時〜24時）発車時刻表を完備

6. **現在地からバス停への徒歩道案内（OSRM）**
   - OSRM（Open Source Routing Machine）歩行者プロファイル（`routed-foot`）による徒歩ルート計算
   - 所要時間（徒歩約○分）・距離・ターンバイターン（右折・左折・直進）の詳細案内

7. **プライバシー保護設計**
   - 位置情報はブラウザ内（メモリ上）でのみ処理され、**サーバーへの送信・保存は一切行いません**。

---

## 🛠️ 技術スタック

| 分野 | 技術 |
|:---|:---|
| **フロントエンド** | HTML5 / Vanilla CSS / Vanilla JS (ES Modules) |
| **地図表示** | [Leaflet 1.9.4](https://leafletjs.com/) + OpenStreetMap タイル |
| **マーカー制御** | [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) |
| **歩行者道案内** | [OSRM](http://project-osrm.org/) (FOSSGIS e.V. 公開サーバー) |
| **施設・住所検索** | [OpenStreetMap Nominatim](https://nominatim.org/) |
| **データ処理** | Python 3（標準ライブラリ `csv`, `json`, `zipfile`, `urllib` のみ） |
| **フォント・アイコン** | Google Fonts (Noto Sans JP, Inter), Font Awesome Free 6 |

---

## 📁 プロジェクト構成

```
busstopnavigate/
├── index.html                  # メインHTML（SPA）
├── index.css                   # デザインシステム・レスポンシブスタイル
├── config.js                   # サーバーURL・設定パラメータ（環境切替用）
├── app.js                      # アプリケーション初期化・モジュール統括
├── modules/
│   ├── map.js                  # Leaflet 地図初期化・レイヤー管理
│   ├── geolocation.js          # 現在地取得・プライバシー管理
│   ├── stops.js                # バス停データ読込・最寄り検索
│   ├── routes.js               # 系統・行先・停車バス停一覧
│   ├── routing.js              # OSRM 徒歩ルーティング
│   ├── geocoding.js            # Nominatim 住所・施設名検索
│   ├── timetable.js            # 時刻表・次バス案内
│   └── ui.js                   # UI制御・ボトムシート・イベント
├── data/
│   ├── bus_stops.json          # バス停マスタ（標柱・親停留所） (約486KB)
│   ├── bus_routes.json         # 系統・行先・停車パターン・逆引きインデックス (約394KB)
│   └── bus_timetables.json     # 全停留所の時刻表データ（遅延読込） (約5.1MB)
├── scripts/
│   └── convert_gtfs.py         # BODIK CKAN API から GTFS ZIP 自動DL＆JSON変換
├── legal/
│   ├── privacy-policy.html     # プライバシーポリシー
│   ├── terms.html              # 利用規約・免責事項
│   └── about.html              # このアプリについて・帰属表示
└── README.md
```

---

## 🚀 ローカルでの実行方法

本アプリはビルドツール不要の純粋な HTML/CSS/ES Modules で構成されています。任意の静的Webサーバーで実行できます。

### 方法 1: Python を使用する場合 (推奨)

```bash
# プロジェクトルートで以下を実行
python -m http.server 8000
```
ブラウザで `http://localhost:8000` を開きます。

### 方法 2: Node.js (npx serve) を使用する場合

```bash
npx serve .
```

---

## 🔄 GTFS データの更新方法

ダイヤ改正等で最新のGTFSデータを取り込む場合：

```bash
python scripts/convert_gtfs.py
```
スクリプトが BODIK CKAN API を自動照会し、最新の ZIP ファイルをダウンロードして `data/` 配下の JSON ファイルを再生成します。

---

## ⚖️ ライセンス・データ出典

- **バス運行データ**: 名古屋市「[市バスGTFS-JPデータ](https://data.bodik.jp/dataset/231002_7109030000_bus-gtfs-jp)」（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)）を加工して作成
- **地図データ**: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) ([ODbL](https://opendatacommons.org/licenses/odbl/))
- **ルーティング**: OSRM (BSD-2-Clause) / FOSSGIS e.V.
- **ソースコード**: MIT License
