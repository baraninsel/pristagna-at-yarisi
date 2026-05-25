# 🤖 Codex Sistem Promptu — Kopyala & Yapıştır

> Aşağıdaki metni Codex'e ilk prompt olarak ver. Bu, Codex'in projeyi tamamen anlamasını sağlar.

---

## ✂️ BURADAN KOPYALAMAYA BAŞLA ✂️

---

Sen bu projede geliştirici olarak çalışacaksın. Herhangi bir değişiklik yapmadan önce bu bağlam belgesini dikkatlice oku ve anla. Ayrıca repo'daki `ARCHITECTURE.md` dosyasını da mutlaka oku — orada veritabanı şeması, API endpoint'leri, Socket.IO eventleri ve fizik motoru hakkında detaylı teknik bilgi var.

## Projenin Amacı

Bu proje, **Kick.com** platformundaki yayıncılar için tasarlanmış interaktif bir **at yarışı bahis oyunu**. Amaç şu: yayıncı OBS üzerinden bu oyunu yayına ekler, izleyiciler Kick sohbetinden bahis komutları yazarak yarışa katılır.

### Nasıl Çalışıyor (Kullanıcı Perspektifi)

1. Yayıncı sunucuyu başlatır (`npm start`), OBS'ye `http://localhost:3005` adresini browser source olarak ekler
2. Oyun otomatik olarak döngüye girer: **bahis aç → geri sayım → yarış → sonuç → tekrar**
3. İzleyiciler Kick sohbetine `!sp A 100` yazarak A karakterine 100 puan bahis yapar
4. Fizik tabanlı yarış başlar — 4 renkli top (A, B, C, D) engelli bir parkurda yarışır
5. Kazanan top bitiş çizgisine ulaştığında, doğru tahmin edenler ödüllendirilir
6. Yayıncı `/admin` panelinden tüm ayarları (süre, fizik, Kick bağlantısı) yönetir

### Hedef Kitle
- **Kick.com yayıncıları** (özellikle Türk yayıncılar — bu yüzden UI ve yorumlar Türkçe)
- **İzleyiciler** sohbet üzerinden etkileşim kurar

## Teknik Mimari

### Dosya Yapısı ve Sorumluluklar

```
├── server.js          → ANA SUNUCU (Express + Socket.IO + Kick WebSocket)
│                         - Yarış state machine yönetimi (IDLE→BETTING→COUNTDOWN→RACING→FINISHED)
│                         - Kick Pusher WebSocket bağlantısı (chat mesajları)
│                         - REST API (admin ayarları, leaderboard, yarış geçmişi)
│                         - Socket.IO event yönetimi
│
├── db.js              → VERİTABANI KATMANI (SQLite)
│                         - 4 tablo: users, races, bets, settings
│                         - Promise tabanlı CRUD işlemleri
│                         - Bahis validasyonu ve kazanç dağıtımı
│
├── public/
│   ├── index.html     → OYUN SAYFASI (OBS overlay olarak kullanılır)
│   ├── game.js        → FİZİK MOTORU (Matter.js)
│   │                     - 2D fizik simülasyonu
│   │                     - Parkur oluşturma (engeller, rampalar, bumperlar)
│   │                     - Kazanan tespiti (bitiş çizgisi)
│   │                     - Sıkışma tespiti ve kurtarma
│   │                     - Socket.IO ile sunucu iletişimi
│   │
│   ├── admin.html     → ADMİN PANELİ
│   │                     - Yarış kontrolü (başlat/durdur/anında başlat)
│   │                     - Zamanlama ayarları
│   │                     - Fizik parametreleri
│   │                     - Kick bağlantı yönetimi
│   │                     - Kullanıcı/bahis istatistikleri
│   │
│   └── style.css      → TÜM STİLLER
│                         - Oyun arayüzü + admin panel stilleri
│                         - OBS overlay için saydam arka plan desteği
```

### Kritik Mimari Kararlar

1. **Fizik frontend'de çalışır**: Matter.js simülasyonu tamamen `game.js`'de (tarayıcıda) çalışır. Sunucu fizik hesabı yapmaz. Kazanan tespiti de frontend'de yapılır ve `race_winner` socket event'i ile sunucuya bildirilir.

2. **State machine sunucuda**: Yarış durumu (`idle`, `betting`, `countdown`, `racing`, `finished`) sunucuda yönetilir. `setState()` fonksiyonu her değişiklikte tüm bağlı istemcilere `game_state` event'i gönderir.

3. **Kick bağlantısı opsiyonel**: Kick WebSocket bağlantısı başarısız olsa bile oyun çalışır. Exponential backoff ile yeniden bağlanma mekanizması var.

4. **SQLite dosya tabanlı**: `database.sqlite` dosyası otomatik oluşturulur. Tablolar yoksa `initializeDatabase()` ile oluşturulur, ayarlar `INSERT OR IGNORE` ile varsayılan değerlerle eklenir.

5. **Settings tablosu key-value**: Tüm yapılandırma `settings` tablosunda key-value olarak tutulur. Yeni ayar eklemek için `db.js`'deki `initializeDatabase()`'e bir `INSERT OR IGNORE` satırı eklemek yeterli.

### Yarış Döngüsü (State Machine)

```
IDLE ──(admin_start_race veya autoMode)──→ BETTING
  │                                           │
  │                                     bet_duration sn
  │                                           │
  │                                           ▼
  │                                       COUNTDOWN
  │                                           │
  │                                    countdown_duration sn
  │                                           │
  │                                           ▼
  │                                        RACING
  │                                           │
  │                              (frontend kazananı bildirir)
  │                                           │
  │                                           ▼
  │                                       FINISHED
  │                                           │
  │              autoMode=true: result_duration sonra BETTING'e dön
  └──────────── autoMode=false: IDLE'a dön
```

### İletişim Protokolü

- **Sunucu ↔ İstemci**: Socket.IO (gerçek zamanlı, iki yönlü)
- **Admin API**: REST (Express routes)
- **Kick Chat**: Pusher WebSocket (tek yönlü dinleme)
- **Bahis komutu**: `!sp <A|B|C|D> <miktar>` (Kick sohbetinden)

## Kodlama Kuralları

Bu projede şu kurallara uy:

1. **Yorumlar Türkçe**: Tüm kod yorumları, console logları ve hata mesajları Türkçe
2. **Console log formatı**: Kategori etiketleri kullan → `[KICK]`, `[BAHİS]`, `[STATE]`, `[ADMIN]`, `[HATA]`, `[INIT]`
3. **Promise tabanlı DB**: `db.js`'deki tüm fonksiyonlar Promise döner, `async/await` ile kullanılır
4. **Mevcut yapıyı koru**: Yeni özellik eklerken mevcut state machine yapısını boz**ma**
5. **Frontend-backend ayrımı**: Fizik hesaplamaları frontend'de kalmalı, sunucuya taşınmamalı
6. **Ayarlar DB'den**: Hardcoded değer yerine `settings` tablosundan oku
7. **Socket event isimlendirme**: snake_case kullan (örn: `game_state`, `bet_timer`, `race_winner`)

## Detaylı Teknik Referans

Veritabanı şeması, tüm REST API endpoint'leri, tüm Socket.IO eventleri, fizik motoru parametreleri ve Kick entegrasyonu hakkında tam detay için repo'daki **`ARCHITECTURE.md`** dosyasını oku.

## Değişiklik Yaparken

1. Önce ilgili dosyaları oku ve mevcut kodu anla
2. State machine akışını bozmamaya dikkat et
3. Yeni socket event ekliyorsan hem `server.js`'deki handler'a hem `game.js`'deki dinleyiciye ekle
4. Yeni ayar ekliyorsan `db.js` → `initializeDatabase()`'e varsayılan değer ekle
5. Admin paneline yeni kontrol ekliyorsan `admin.html`'deki ilgili sekmeye ekle
6. Test için `npm run dev` (hot-reload) kullan, port 3005

---

## ✂️ KOPYALAMA BURADA BİTER ✂️
