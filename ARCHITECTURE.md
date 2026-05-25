# 🏇 Pristagna At Yarışı — Proje Mimarisi & Geliştirici Rehberi

> **Bu belge**, projeyi ilk kez gören bir geliştirici veya AI agent (Codex, Copilot vb.) için kapsamlı bir bağlam belgesidir.

---

## 📋 Proje Özeti

Kick.com yayıncıları için tasarlanmış **interaktif at yarışı bahis platformu**. İzleyiciler Kick sohbetinden komutlarla bahis yapar, OBS üzerinden canlı yayında görüntülenen bir fizik tabanlı yarış izler.

### Temel Özellikler
- **Kick Chat Entegrasyonu**: Pusher WebSocket üzerinden gerçek zamanlı sohbet bağlantısı
- **Fizik Tabanlı Yarış**: Matter.js ile 2D fizik simülasyonu (frontend)
- **Bahis Sistemi**: `!sp <karakter> <miktar>` komutuyla izleyici bahisleri
- **Admin Paneli**: Yayıncının yarış/bahis/fizik ayarlarını yönettiği arayüz
- **OBS Overlay**: Yayında gösterilmek üzere tasarlanmış saydam arka planlı oyun arayüzü

---

## 🏗️ Mimari Yapı

```
┌─────────────────────────────────────────────────┐
│              FRONTEND (Tarayıcı / OBS)          │
│                                                 │
│  index.html  ← Oyun ekranı (OBS overlay)        │
│  game.js     ← Matter.js fizik + yarış mantığı   │
│  style.css   ← Tüm stiller                      │
│  admin.html  ← Admin panel (yayıncı arayüzü)    │
│                                                 │
│         Socket.IO ↕ HTTP REST API               │
├─────────────────────────────────────────────────┤
│              BACKEND (Node.js)                  │
│                                                 │
│  server.js   ← Express + Socket.IO + Kick WS    │
│  db.js       ← SQLite veritabanı katmanı         │
│                                                 │
│         Pusher WebSocket ↕                      │
├─────────────────────────────────────────────────┤
│           Kick.com Pusher API                   │
│  (chatrooms.{id}.v2 kanalı)                     │
└─────────────────────────────────────────────────┘
```

---

## 📁 Dosya Yapısı ve Sorumlulukları

| Dosya | Satır | Rol |
|-------|-------|-----|
| `server.js` | ~870 | Ana sunucu. Express HTTP, Socket.IO, Kick WebSocket bağlantısı, yarış state yönetimi, admin API |
| `db.js` | ~436 | SQLite veritabanı katmanı. Kullanıcı, yarış, bahis, ayar CRUD işlemleri |
| `public/game.js` | ~1200+ | Matter.js fizik motoru, yarış animasyonu, frontend Socket.IO istemcisi |
| `public/index.html` | ~150 | OBS overlay olarak kullanılan oyun sayfası |
| `public/admin.html` | ~800+ | Admin paneli — yarış kontrolü, ayarlar, Kick bağlantısı |
| `public/style.css` | ~500+ | Tüm CSS stilleri (oyun + admin) |
| `package.json` | 18 | Bağımlılıklar ve scriptler |

---

## 🔄 Yarış Yaşam Döngüsü (State Machine)

```
IDLE → BETTING → COUNTDOWN → RACING → FINISHED → (IDLE veya BETTING)
```

### State Detayları

| State | Açıklama | Süre |
|-------|----------|------|
| `idle` | Bekleme, yarış arasında | Sınırsız (manuel mod) |
| `betting` | Bahisler açık, `!sp` komutları kabul ediliyor | `bet_duration` (varsayılan 30sn) |
| `countdown` | Geri sayım, bahisler kapalı | `countdown_duration` (varsayılan 5sn) |
| `racing` | Fizik simülasyonu çalışıyor, toplar hareket ediyor | Max `race_timeout` (varsayılan 120sn) |
| `finished` | Sonuç ekranı, kazançlar dağıtılıyor | `result_duration` (varsayılan 10sn) |

### Otomatik Mod
- `autoMode: true` olduğunda `FINISHED` → `BETTING` otomatik geçer
- `autoMode: false` olduğunda `FINISHED` → `IDLE` olur, admin manuel başlatır

---

## 🔌 Önemli Socket.IO Eventleri

### Server → Client
| Event | Açıklama |
|-------|----------|
| `game_state` | Tüm state bilgisi (status, bets, betSummary, characters) |
| `bet_timer` | Bahis süre geri sayımı `{ remaining }` |
| `countdown` | Yarış geri sayımı `{ count }` |
| `race_start` | Yarış başladı `{ characters, raceTimeout }` |
| `race_result` | Sonuçlar `{ winner, totalPool, payouts }` |
| `race_force_finish` | Timeout — en yakın top kazanır |
| `new_bet` | Yeni bahis bildirimi `{ username, target, amount, betSummary }` |
| `kick_status` | Kick bağlantı durumu `{ connected, error?, retrying? }` |
| `background_changed` | Arka plan resmi değişti |
| `game_settings_changed` | Fizik ayarları değişti |

### Client → Server
| Event | Açıklama |
|-------|----------|
| `race_winner` | Frontend kazananı bildiriyor `{ winner: 'A' }` |
| `get_balance` | Bakiye sorgulama `{ username }` |
| `get_leaderboard` | Sıralama listesi isteği |
| `admin_start_race` | Admin: yarış başlat |
| `admin_stop_race` | Admin: yarışı durdur/resetle |
| `admin_toggle_auto` | Admin: otomatik mod `{ enabled }` |
| `admin_instant_start` | Admin: bahis süresini atlayıp geri sayıma geç |
| `admin_skip_countdown` | Admin: geri sayımı atlayıp yarışı başlat |

---

## 🗄️ Veritabanı Şeması (SQLite)

### `users` Tablosu
```sql
username TEXT PRIMARY KEY,
balance INTEGER DEFAULT 100,
total_wins INTEGER DEFAULT 0,
total_losses INTEGER DEFAULT 0,
total_wagered INTEGER DEFAULT 0,
created_at DATETIME,
last_active DATETIME
```

### `races` Tablosu
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
winner TEXT,
total_pool INTEGER DEFAULT 0,
character_count INTEGER DEFAULT 4,
status TEXT DEFAULT 'pending',
created_at DATETIME,
finished_at DATETIME
```

### `bets` Tablosu
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
race_id INTEGER (FK → races.id),
username TEXT (FK → users.username),
target TEXT,          -- 'A', 'B', 'C', 'D'
amount INTEGER,
won INTEGER DEFAULT 0,
payout INTEGER DEFAULT 0,
created_at DATETIME
```

### `settings` Tablosu (Key-Value)
```sql
key TEXT PRIMARY KEY,
value TEXT
```

#### Önemli Ayar Anahtarları
| Key | Varsayılan | Açıklama |
|-----|-----------|----------|
| `starting_balance` | 100 | Yeni kullanıcı başlangıç bakiyesi |
| `max_bet` | 1000 | Maksimum bahis miktarı |
| `min_bet` | 1 | Minimum bahis miktarı |
| `bet_duration` | 30 | Bahis süresi (saniye) |
| `payout_multiplier` | 2 | Ödeme çarpanı |
| `kick_channel` | PrisTagna | Kick kanal adı |
| `kick_chatroom_id` | (boş) | Manuel chatroom ID |
| `ball_speed_min` | 2.5 | Top minimum hızı |
| `ball_speed_max` | 10 | Top maksimum hızı |
| `ball_force` | 0.03 | Top itme kuvveti |
| `ball_friction_air` | 0.004 | Hava sürtünmesi |
| `ball_restitution` | 1.05 | Zıplama katsayısı |
| `unstuck_force` | 0.012 | Sıkışan top kurtarma kuvveti |
| `race_timeout` | 120 | Yarış max süresi (saniye) |
| `result_duration` | 10 | Sonuç gösterim süresi |
| `countdown_duration` | 5 | Geri sayım süresi |

---

## 🌐 REST API Endpoints

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/api/settings` | Tüm ayarları getir |
| POST | `/api/settings` | Tek ayar güncelle `{ key, value }` |
| GET | `/api/game-settings` | Oyun fiziği ayarlarını getir |
| POST | `/api/game-settings` | Fizik ayarlarını toplu güncelle `{ settings: {...} }` |
| GET | `/api/state` | Mevcut oyun durumu |
| GET | `/api/leaderboard` | Sıralama listesi |
| GET | `/api/races` | Son 20 yarış geçmişi |
| GET | `/api/kick-status` | Kick bağlantı durumu |
| POST | `/api/kick-reconnect` | Kick'e yeniden bağlan |
| POST | `/api/kick-debug` | Debug modu aç/kapat |
| POST | `/api/upload-background` | Arka plan resmi yükle (multipart) |
| GET | `/admin` | Admin panel HTML |

---

## 🎮 Fizik Motoru (game.js — Frontend)

- **Motor**: Matter.js 2D fizik
- **Karakterler**: 4 top (A, B, C, D) — renkli toplar
- **Parkur**: Engeller, rampalar, bumperlar ile oluşturulmuş piste
- **Kazanan Tespiti**: Bitiş çizgisine ilk ulaşan top
- **Timeout Mekanizması**: `race_timeout` süresinde bitmezse `race_force_finish` event'i tetiklenir, bitiş çizgisine en yakın top kazanır
- **Sıkışma Tespiti**: Toplar belirli süre hareket etmezse `unstuck_force` ile itilir
- **Fizik ayarları sunucudan** `/api/game-settings` ile çekilir ve hot-reload yapılır

---

## 🔗 Kick Chat Entegrasyonu

### Bağlantı Akışı
1. `kick_channel` ayarından kanal adını oku
2. `https://kick.com/api/v2/channels/{name}` → chatroom ID al
3. Pusher WebSocket'e bağlan: `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679...`
4. `chatrooms.{id}.v2` kanalına subscribe ol
5. `ChatMessageEvent` eventlerini dinle

### Bahis Komutu
```
!sp <karakter> <miktar>
Örnek: !sp D 250
```

### Bakiye Sorgulama
```
!bakiye  veya  !balance
```

### Yeniden Bağlanma
- Exponential backoff: 5s, 10s, 20s, 40s... max 60s
- Maksimum 10 deneme
- Admin panelinden manuel yeniden bağlanma mümkün

---

## 🚀 Çalıştırma

```bash
npm install
npm start          # node server.js (port 3005)
npm run dev        # node --watch server.js (hot-reload)
```

- **Oyun**: `http://localhost:3005`
- **Admin**: `http://localhost:3005/admin`

### Port
- Varsayılan: `3005` (env `PORT` ile değiştirilebilir)
- Port çakışması durumunda otomatik olarak eski process'i temizler (Windows)

---

## ⚠️ Bilinen Sorunlar / Dikkat Edilecekler

1. **WebSocket (ws) modülü**: `kick-live-connector` yüklü ama doğrudan `ws` modülü kullanılıyor. `ws` modülü `kick-live-connector`'ın bağımlılığı olarak mevcut.
2. **Fizik hesaplaması frontend'de**: Yarışın fizik simülasyonu tamamen `game.js`'de çalışır. Kazanan frontend tarafından `race_winner` event'i ile sunucuya bildirilir.
3. **SQLite**: Dosya tabanlı veritabanı (`database.sqlite`). `.gitignore`'da olmalı çünkü her ortamda sıfırdan oluşturulur.
4. **Graceful shutdown**: `SIGINT`, `SIGTERM` ve `uncaughtException` yakalanır. Port çakışması önleme mekanizması var.
5. **Otomatik mod**: Sunucu başlangıcında 3 saniye bekledikten sonra ilk yarışı otomatik başlatır.

---

## 🛠️ Geliştirme Notları

### Yeni Özellik Eklerken
- **Backend state**: `gameState` objesi ve `setState()` fonksiyonu merkezi state yönetimi sağlar
- **Veritabanı**: Yeni tablo/alan eklemek için `db.js` → `initializeDatabase()` fonksiyonunu güncelle
- **Socket event**: Yeni event eklerken hem `server.js`'deki `io.on('connection')` bloğuna hem de `game.js`'deki socket handler'lara ekle
- **Ayar ekleme**: `settings` tablosuna `INSERT OR IGNORE` ile varsayılan değer ekle, `server.js`'de `/api/game-settings`'e ekle

### Kod Stili
- Yorumlar **Türkçe** yazılmış
- Console logları kategori etiketli: `[KICK]`, `[BAHİS]`, `[STATE]`, `[ADMIN]`, `[HATA]`
- Promise tabanlı veritabanı işlemleri (`db.js`)
- Express middleware sırası: `json()` → `static()` → routes

---

## 📦 Bağımlılıklar

| Paket | Versiyon | Kullanım |
|-------|----------|----------|
| `express` | ^4.21.1 | HTTP sunucusu |
| `socket.io` | ^4.8.1 | Gerçek zamanlı iletişim |
| `sqlite3` | ^5.1.7 | Veritabanı |
| `multer` | ^1.4.5-lts.2 | Dosya yükleme (arka plan resmi) |
| `kick-live-connector` | ^1.0.0 | Kick API (dolaylı — ws bağımlılığı) |
