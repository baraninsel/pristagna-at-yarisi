const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const WebSocket = require('ws');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ═══════════════════════════════════
// GRACEFUL SHUTDOWN — Port çakışmasını önle
// ═══════════════════════════════════
function gracefulShutdown(signal) {
    console.log(`\n[SHUTDOWN] ${signal} sinyali alındı, kapatılıyor...`);
    disconnectKick();
    server.close(() => {
        console.log('[SHUTDOWN] HTTP sunucusu kapatıldı.');
        process.exit(0);
    });
    // 5 saniye bekle, zorla kapat
    setTimeout(() => {
        console.log('[SHUTDOWN] Zorla kapatılıyor...');
        process.exit(1);
    }, 5000);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Yakalanmamış hata:', err.message);
    gracefulShutdown('uncaughtException');
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Uploads klasörü oluştur
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer - arka plan resmi yükleme
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, 'background' + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
    }
});

// ═══════════════════════════════════
// YARIŞ STATE YÖNETİMİ
// ═══════════════════════════════════

const CHARACTERS = ['A', 'B', 'C', 'D'];
const GAME_STATES = {
    IDLE: 'idle',           // Bekleme — yarış arasında
    BETTING: 'betting',     // Bahisler açık
    COUNTDOWN: 'countdown', // Geri sayım
    RACING: 'racing',       // Yarış devam ediyor
    FINISHED: 'finished'    // Sonuç gösteriliyor
};

let gameState = {
    status: GAME_STATES.IDLE,
    currentRaceId: null,
    betDuration: 30,       // Saniye
    countdownDuration: 5,  // Saniye
    resultDuration: 10,    // Sonuç gösterim süresi
    autoMode: true,        // Otomatik döngü
    bets: [],              // Mevcut turda yapılan bahisler
    betSummary: {},        // Karakter bazlı bahis özeti
    raceTimeout: 120       // Yarış max süresi (saniye)
};

// State değiştir ve tüm clientlara bildir
function setState(newStatus, extra = {}) {
    gameState.status = newStatus;
    Object.assign(gameState, extra);
    io.emit('game_state', getPublicGameState());
    console.log(`[STATE] → ${newStatus}`, extra.currentRaceId ? `(Race #${extra.currentRaceId})` : '');
}

function getPublicGameState() {
    return {
        status: gameState.status,
        currentRaceId: gameState.currentRaceId,
        betDuration: gameState.betDuration,
        countdownDuration: gameState.countdownDuration,
        bets: gameState.bets,
        betSummary: gameState.betSummary,
        characters: CHARACTERS,
        autoMode: gameState.autoMode
    };
}

// ═══════════════════════════════════
// YARIŞ DÖNGÜSÜ
// ═══════════════════════════════════

let raceTimeout = null;
let betTimerInterval = null; // Bahis süre sayacı (clearable)
let countdownTimerInterval = null; // Geri sayım sayacı (clearable)

async function startBettingPhase() {
    try {
        // Eski DB'yi sıfırlayıp yeni yarış oluştur
        const raceId = await db.createRace();

        gameState.bets = [];
        gameState.betSummary = {};

        // Zamanlama ayarlarını DB'den oku
        const betDuration = parseInt(await db.getSetting('bet_duration')) || 30;
        const countdownDuration = parseInt(await db.getSetting('countdown_duration')) || 5;
        const resultDuration = parseInt(await db.getSetting('result_duration')) || 10;
        const raceTimeoutSec = parseInt(await db.getSetting('race_timeout')) || 120;
        gameState.betDuration = betDuration;
        gameState.countdownDuration = countdownDuration;
        gameState.resultDuration = resultDuration;
        gameState.raceTimeout = raceTimeoutSec;

        setState(GAME_STATES.BETTING, {
            currentRaceId: raceId
        });

        // Her saniye geri sayım yayınla
        let remaining = betDuration;
        betTimerInterval = setInterval(() => {
            remaining--;
            io.emit('bet_timer', { remaining });
            if (remaining <= 0) {
                clearInterval(betTimerInterval);
                betTimerInterval = null;
            }
        }, 1000);

        raceTimeout = setTimeout(() => {
            if (betTimerInterval) { clearInterval(betTimerInterval); betTimerInterval = null; }
            startCountdown();
        }, betDuration * 1000);

    } catch (err) {
        console.error('[HATA] Bahis aşaması başlatılamadı:', err);
    }
}

function startCountdown() {
    setState(GAME_STATES.COUNTDOWN);
    db.updateRaceStatus(gameState.currentRaceId, 'countdown');

    let count = gameState.countdownDuration;
    countdownTimerInterval = setInterval(() => {
        io.emit('countdown', { count });
        count--;
        if (count < 0) {
            clearInterval(countdownTimerInterval);
            countdownTimerInterval = null;
            startRacing();
        }
    }, 1000);
}

let raceTimeoutTimer = null;

function startRacing() {
    setState(GAME_STATES.RACING);
    db.updateRaceStatus(gameState.currentRaceId, 'racing');

    // Fizik hesaplaması frontend'de yapılacak
    // Kazananı frontend bildirecek
    io.emit('race_start', { characters: CHARACTERS, raceTimeout: gameState.raceTimeout });

    // Yarış timeout — belirli sürede bitmezse frontend'den en yakın topu sor
    if (raceTimeoutTimer) clearTimeout(raceTimeoutTimer);
    raceTimeoutTimer = setTimeout(() => {
        if (gameState.status === GAME_STATES.RACING) {
            console.log(`[YARIŞ] Timeout! ${gameState.raceTimeout}sn doldu, en yakın karakter kazanacak.`);
            io.emit('race_force_finish');
        }
    }, gameState.raceTimeout * 1000);
}

async function handleRaceFinish(winnerId) {
    if (gameState.status !== GAME_STATES.RACING) return;
    if (raceTimeoutTimer) { clearTimeout(raceTimeoutTimer); raceTimeoutTimer = null; }

    try {
        // Yarışı DB'de bitir
        await db.finishRace(gameState.currentRaceId, winnerId);

        // Kazançları dağıt
        const results = await db.distributeWinnings(gameState.currentRaceId, winnerId);

        setState(GAME_STATES.FINISHED);

        // Sonuçları yayınla
        io.emit('race_result', {
            winner: winnerId,
            totalPool: results.totalPool,
            winnerCount: results.winnerCount,
            loserCount: results.loserCount,
            payouts: results.payouts
        });

        console.log(`[YARIŞ] Kazanan: ${winnerId} | Havuz: ${results.totalPool} | Kazananlar: ${results.winnerCount}`);

        // Otomatik modda yeni tura geç
        if (gameState.autoMode) {
            raceTimeout = setTimeout(() => {
                startBettingPhase();
            }, gameState.resultDuration * 1000);
        } else {
            setState(GAME_STATES.IDLE);
        }

    } catch (err) {
        console.error('[HATA] Yarış bitirme hatası:', err);
    }
}

// ═══════════════════════════════════
// SOCKET.IO BAĞ LANTILARI
// ═══════════════════════════════════

io.on('connection', (socket) => {
    console.log(`[BAĞLANTI] ${socket.id}`);

    // Mevcut durumu gönder
    socket.emit('game_state', getPublicGameState());

    // Kick bağlantı durumunu gönder
    if (kickConnected) {
        socket.emit('kick_status', { connected: true });
    } else {
        socket.emit('kick_status', { connected: false, connecting: kickRetryCount > 0 });
    }

    // Kazananı frontend'den al
    socket.on('race_winner', (data) => {
        if (data && data.winner && CHARACTERS.includes(data.winner)) {
            handleRaceFinish(data.winner);
        }
    });

    // Bakiye sorgulama
    socket.on('get_balance', async (data) => {
        try {
            if (data && data.username) {
                const user = await db.getOrCreateUser(data.username);
                socket.emit('balance_update', { username: data.username, balance: user.balance });
            }
        } catch (err) {
            console.error('[HATA] Bakiye sorgulanamadı:', err);
        }
    });

    // Admin: Yarışı başlat
    socket.on('admin_start_race', () => {
        if (gameState.status === GAME_STATES.IDLE) {
            startBettingPhase();
        }
    });

    // Admin: Yarışı durdur/resetle
    socket.on('admin_stop_race', () => {
        if (raceTimeout) { clearTimeout(raceTimeout); raceTimeout = null; }
        if (betTimerInterval) { clearInterval(betTimerInterval); betTimerInterval = null; }
        if (countdownTimerInterval) { clearInterval(countdownTimerInterval); countdownTimerInterval = null; }
        if (raceTimeoutTimer) { clearTimeout(raceTimeoutTimer); raceTimeoutTimer = null; }
        gameState.bets = [];
        gameState.betSummary = {};
        setState(GAME_STATES.IDLE, { currentRaceId: null });
    });

    // Admin: Otomatik mod aç/kapat
    socket.on('admin_toggle_auto', (data) => {
        gameState.autoMode = !!data.enabled;
        io.emit('game_state', getPublicGameState());
    });

    // Admin: Anında başlat — bahis süresini atlayıp direkt geri sayıma geç
    socket.on('admin_instant_start', () => {
        if (gameState.status === GAME_STATES.BETTING) {
            console.log('[ADMIN] Anında başlat — bahis süresi atlanıyor');
            if (raceTimeout) { clearTimeout(raceTimeout); raceTimeout = null; }
            if (betTimerInterval) { clearInterval(betTimerInterval); betTimerInterval = null; }
            startCountdown();
        } else if (gameState.status === GAME_STATES.IDLE) {
            // Idle durumundaysa önce bahis aşamasını başlat, sonra anında geri sayıma geç
            console.log('[ADMIN] Anında başlat — idle durumundan direkt geri sayıma geçiliyor');
            startBettingPhase().then(() => {
                setTimeout(() => {
                    if (gameState.status === GAME_STATES.BETTING) {
                        if (raceTimeout) { clearTimeout(raceTimeout); raceTimeout = null; }
                        if (betTimerInterval) { clearInterval(betTimerInterval); betTimerInterval = null; }
                        startCountdown();
                    }
                }, 500);
            });
        }
    });

    // Admin: Geri sayımı atla — direkt yarışı başlat
    socket.on('admin_skip_countdown', () => {
        if (gameState.status === GAME_STATES.COUNTDOWN) {
            console.log('[ADMIN] Geri sayım atlanıyor — yarış başlıyor');
            if (countdownTimerInterval) { clearInterval(countdownTimerInterval); countdownTimerInterval = null; }
            startRacing();
        }
    });

    // Leaderboard
    socket.on('get_leaderboard', async () => {
        try {
            const top = await db.getTopUsers(10);
            socket.emit('leaderboard', top);
        } catch (err) {
            console.error('[HATA] Leaderboard alınamadı:', err);
        }
    });

    socket.on('disconnect', () => {
        // Sessiz disconnect
    });
});

// ═══════════════════════════════════
// KICK CHAT ENTEGRASYONU (Doğrudan WebSocket)
// Playwright bağımlılığı kaldırıldı — doğrudan
// Kick API + Pusher WebSocket kullanılıyor
// ═══════════════════════════════════

let kickConnected = false;
let kickRetryCount = 0;
const MAX_KICK_RETRIES = 10;
let kickWs = null;
let kickPingInterval = null;
let kickDebugMode = true; // İlk bağlantıda debug açık, başarılı olunca kapanır

const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

// Kick API'sinden chatroom ID'sini al
async function getKickChatroomId(channelName) {
    // Önce DB'den manuel girilen chatroom ID'sini kontrol et
    const manualId = await db.getSetting('kick_chatroom_id');
    if (manualId && manualId.trim() !== '') {
        console.log(`[KICK] Manuel chatroom ID kullanılıyor: ${manualId}`);
        return { chatroomId: parseInt(manualId), channelId: null };
    }

    // Dinamik import for node-fetch (ESM) — Node 18+ has built-in fetch
    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;

    // v2/channels endpoint'i çalışıyor (chatroom bilgisi dahil)
    const channelUrl = `https://kick.com/api/v2/channels/${channelName.toLowerCase()}`;
    console.log(`[KICK] Kanal bilgisi alınıyor: ${channelUrl}`);

    const response = await fetchFn(channelUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
        throw new Error(`Kick API yanıt vermedi: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Chatroom bilgisi channel response'unda nested geliyor
    if (data.chatroom && data.chatroom.id) {
        // Chatroom ID'yi DB'ye kaydet (sonraki başlatmalarda daha hızlı)
        await db.setSetting('kick_chatroom_id', String(data.chatroom.id));
        return {
            chatroomId: data.chatroom.id,
            channelId: data.chatroom.channel_id || data.id || null
        };
    }

    throw new Error('Chatroom bilgisi alınamadı — kanal bulunamadı olabilir');
}

async function connectToKick() {
    try {
        const channelName = await db.getSetting('kick_channel') || 'PrisTagna';

        if (!channelName || channelName.trim() === '') {
            console.log('[KICK] Kanal adı ayarlanmamış, Kick atlanıyor.');
            io.emit('kick_status', { connected: false, error: 'Kanal adı ayarlanmamış' });
            return;
        }

        console.log(`[KICK] ${channelName} kanalına bağlanılıyor...`);
        io.emit('kick_status', { connected: false, connecting: true, channel: channelName });

        // Önceki bağlantıyı temizle
        disconnectKick();

        // 1. Chatroom ID'yi al
        let chatroomId, channelId;
        try {
            const info = await getKickChatroomId(channelName);
            chatroomId = info.chatroomId;
            channelId = info.channelId;
            console.log(`[KICK] Chatroom ID: ${chatroomId}, Channel ID: ${channelId || 'N/A'}`);
        } catch (apiErr) {
            console.error('[KICK] API hatası:', apiErr.message);
            io.emit('kick_status', { connected: false, error: apiErr.message });
            handleKickRetry();
            return;
        }

        // 2. Pusher WebSocket bağlantısı
        kickWs = new WebSocket(PUSHER_URL);

        // Bağlantı timeout
        const connectTimeout = setTimeout(() => {
            if (!kickConnected) {
                console.log('[KICK] WebSocket bağlantı zaman aşımı (15s).');
                disconnectKick();
                io.emit('kick_status', { connected: false, error: 'WebSocket zaman aşımı' });
                handleKickRetry();
            }
        }, 15000);

        kickWs.on('open', () => {
            console.log('[KICK] Pusher WebSocket bağlandı, kanallara subscribe olunuyor...');

            // Chatroom kanalına subscribe ol
            const subscribeMsg = JSON.stringify({
                event: 'pusher:subscribe',
                data: { channel: `chatrooms.${chatroomId}.v2` }
            });
            kickWs.send(subscribeMsg);

            // Channel kanalına da subscribe ol (opsiyonel)
            if (channelId) {
                kickWs.send(JSON.stringify({
                    event: 'pusher:subscribe',
                    data: { channel: `channel.${channelId}` }
                }));
            }

            clearTimeout(connectTimeout);
            kickConnected = true;
            kickRetryCount = 0;
            io.emit('kick_status', { connected: true, channel: channelName });
            console.log(`[KICK] ✓ ${channelName} sohbetine başarıyla bağlanıldı!`);

            // Pusher ping/pong (bağlantıyı canlı tut)
            kickPingInterval = setInterval(() => {
                if (kickWs && kickWs.readyState === WebSocket.OPEN) {
                    kickWs.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
                }
            }, 30000);
        });

        kickWs.on('message', async (raw) => {
            try {
                const rawStr = raw.toString();
                const msg = JSON.parse(rawStr);

                // Pusher subscription başarılı
                if (msg.event === 'pusher_internal:subscription_succeeded') {
                    console.log(`[KICK] Kanal subscribe başarılı: ${msg.channel}`);
                    return;
                }

                // Pusher pong
                if (msg.event === 'pusher:pong') return;

                // Pusher connection established
                if (msg.event === 'pusher:connection_established') {
                    if (kickDebugMode) console.log('[KICK] Pusher bağlantı kuruldu.');
                    return;
                }

                // Debug: Gelen tüm eventleri logla (ilk bağlantıda)
                if (kickDebugMode) {
                    console.log(`[KICK-DEBUG] Event: "${msg.event}" | Channel: ${msg.channel || 'N/A'}`);
                }

                // Chat mesajı — Kick/Pusher event formatı:
                // "App\\Events\\ChatMessageEvent" (JSON'da escaped backslash)
                // JSON.parse sonrası: "App\Events\ChatMessageEvent"
                // Bu yüzden tek backslash ile split yapmamız gerekiyor
                const eventName = msg.event || '';
                const isChatMessage = 
                    eventName === 'App\\Events\\ChatMessageEvent' ||
                    eventName.includes('ChatMessageEvent') ||
                    eventName.endsWith('ChatMessageEvent');

                if (isChatMessage) {
                    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
                    if (kickDebugMode) {
                        console.log(`[KICK-DEBUG] Chat mesajı alındı: ${data?.sender?.username}: ${(data?.content || '').substring(0, 50)}`);
                        // İlk başarılı mesajdan sonra debug'ı kapat
                        kickDebugMode = false;
                        console.log('[KICK] Debug modu kapatıldı — mesajlar başarıyla alınıyor.');
                    }
                    await handleKickChatMessage(data);
                    return;
                }

                // Diğer eventler (gifted sub, follow vb.) — şimdilik logla
                if (kickDebugMode && msg.event && !msg.event.startsWith('pusher')) {
                    console.log(`[KICK-DEBUG] Bilinmeyen event: ${msg.event}`);
                    // Data'nın ilk 200 karakterini göster
                    const dataPreview = typeof msg.data === 'string' ? msg.data.substring(0, 200) : JSON.stringify(msg.data).substring(0, 200);
                    console.log(`[KICK-DEBUG] Data önizleme: ${dataPreview}`);
                }

            } catch (err) {
                // JSON parse hatalarını sessizce geç
                if (!(err instanceof SyntaxError)) {
                    console.error('[KICK] Mesaj işleme hatası:', err.message);
                    if (kickDebugMode) {
                        console.error('[KICK-DEBUG] Hata detay:', err.stack);
                    }
                }
            }
        });

        kickWs.on('close', (code, reason) => {
            console.log(`[KICK] WebSocket kapandı (code: ${code}).`);
            clearTimeout(connectTimeout);
            kickConnected = false;
            if (kickPingInterval) { clearInterval(kickPingInterval); kickPingInterval = null; }
            io.emit('kick_status', { connected: false });
            handleKickRetry();
        });

        kickWs.on('error', (err) => {
            console.error('[KICK] WebSocket hatası:', err.message);
        });

    } catch (err) {
        const errMsg = err?.message || String(err) || 'Bilinmeyen hata';
        console.error('[KICK] Bağlantı hatası:', errMsg);
        kickConnected = false;
        io.emit('kick_status', { connected: false, error: errMsg });
        handleKickRetry();
    }
}

// Kick chat mesajını işle
async function handleKickChatMessage(message) {
    try {
        const username = message.sender?.username;
        const content = (message.content || '').trim();

        if (!username || !content) return;

        // Bahis komutu: !sp D 250
        if (content.startsWith('!sp ') && gameState.status === GAME_STATES.BETTING) {
            const parts = content.split(' ');
            if (parts.length >= 3) {
                const target = parts[1].toUpperCase();
                const amount = parseInt(parts[2], 10);

                if (CHARACTERS.includes(target) && amount > 0 && !isNaN(amount)) {
                    const result = await db.placeBet(gameState.currentRaceId, username, target, amount);

                    if (result.success) {
                        gameState.bets.push({
                            username,
                            target,
                            amount,
                            newBalance: result.newBalance
                        });

                        const summary = await db.getRaceBetSummary(gameState.currentRaceId);
                        gameState.betSummary = summary;

                        io.emit('new_bet', {
                            username,
                            target,
                            amount,
                            newBalance: result.newBalance,
                            betSummary: summary
                        });

                        console.log(`[BAHİS] ${username} → ${target} = ${amount} (bakiye: ${result.newBalance})`);
                    } else {
                        console.log(`[BAHİS RED] ${username}: ${result.message}`);
                    }
                }
            }
        }

        // Bakiye sorgulama: !bakiye
        if (content === '!bakiye' || content === '!balance') {
            const user = await db.getOrCreateUser(username);
            console.log(`[BAKİYE] ${username}: ${user.balance}`);
        }

    } catch (err) {
        console.error('[HATA] Chat mesajı işlenemedi:', err.message);
    }
}

function disconnectKick() {
    if (kickPingInterval) { clearInterval(kickPingInterval); kickPingInterval = null; }
    if (kickWs) {
        try { kickWs.close(); } catch(e) {}
        kickWs = null;
    }
    kickConnected = false;
}

function handleKickRetry() {
    kickRetryCount++;
    if (kickRetryCount <= MAX_KICK_RETRIES) {
        // Exponential backoff: 5s, 10s, 20s, 40s... max 60s
        const delay = Math.min(5000 * Math.pow(2, kickRetryCount - 1), 60000);
        console.log(`[KICK] ${Math.round(delay/1000)}sn sonra tekrar denenecek (${kickRetryCount}/${MAX_KICK_RETRIES})...`);
        io.emit('kick_status', { 
            connected: false, 
            retrying: true, 
            retryCount: kickRetryCount, 
            maxRetries: MAX_KICK_RETRIES,
            nextRetryIn: Math.round(delay/1000)
        });
        setTimeout(connectToKick, delay);
    } else {
        console.log('[KICK] Maksimum deneme aşıldı. Kick olmadan devam ediliyor.');
        console.log('[KICK] Admin panelinden tekrar bağlanmayı deneyebilirsiniz.');
        io.emit('kick_status', { connected: false, error: 'Maksimum deneme aşıldı', canRetry: true });
    }
}

// ═══════════════════════════════════
// ADMIN API
// ═══════════════════════════════════

// Ayarları al
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await db.getAllSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ayar güncelle
app.post('/api/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ success: false, error: 'Key gerekli' });
        await db.setSetting(key, String(value));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Arka plan yükle
app.post('/api/upload-background', upload.single('background'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Dosya yüklenmedi' });
        const imagePath = '/uploads/' + req.file.filename;
        await db.setSetting('background_image', imagePath);
        io.emit('background_changed', { image: imagePath });
        res.json({ success: true, image: imagePath });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Game state
app.get('/api/state', (req, res) => {
    res.json(getPublicGameState());
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const top = await db.getTopUsers(10);
        res.json({ success: true, leaderboard: top });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Yarış geçmişi
app.get('/api/races', async (req, res) => {
    try {
        const races = await db.getRecentRaces(20);
        res.json({ success: true, races });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin sayfası
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Kick durumu
app.get('/api/kick-status', (req, res) => {
    res.json({ connected: kickConnected });
});

// Kick yeniden bağlanma
app.post('/api/kick-reconnect', (req, res) => {
    kickRetryCount = 0;
    kickDebugMode = true; // Debug modunu tekrar aç
    connectToKick();
    res.json({ success: true, message: 'Kick yeniden bağlanma başlatıldı' });
});

// Kick debug modu aç/kapat
app.post('/api/kick-debug', (req, res) => {
    kickDebugMode = !kickDebugMode;
    console.log(`[KICK] Debug modu: ${kickDebugMode ? 'AÇIK' : 'KAPALI'}`);
    res.json({ success: true, debug: kickDebugMode });
});

// ═══════════════════════════════════
// OYUN AYARLARI API
// ═══════════════════════════════════

// Oyun fiziği ayarlarını getir
app.get('/api/game-settings', async (req, res) => {
    try {
        const allSettings = await db.getAllSettings();
        const gameSettings = {
            ball_speed_min: parseFloat(allSettings.ball_speed_min) || 2.0,
            ball_speed_max: parseFloat(allSettings.ball_speed_max) || 7,
            ball_force: parseFloat(allSettings.ball_force) || 0.02,
            ball_friction_air: parseFloat(allSettings.ball_friction_air) || 0.006,
            ball_restitution: parseFloat(allSettings.ball_restitution) || 0.85,
            unstuck_force: parseFloat(allSettings.unstuck_force) || 0.010,
            race_timeout: parseInt(allSettings.race_timeout) || 120,
            result_duration: parseInt(allSettings.result_duration) || 10,
            countdown_duration: parseInt(allSettings.countdown_duration) || 5,
            bet_duration: parseInt(allSettings.bet_duration) || 30
        };
        res.json({ success: true, settings: gameSettings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Oyun fiziği ayarlarını toplu güncelle
app.post('/api/game-settings', async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, error: 'Settings objesi gerekli' });
        }

        const validKeys = [
            'ball_speed_min', 'ball_speed_max', 'ball_force', 'ball_friction_air',
            'ball_restitution', 'unstuck_force', 'race_timeout', 'result_duration',
            'countdown_duration', 'bet_duration'
        ];

        for (const [key, value] of Object.entries(settings)) {
            if (validKeys.includes(key)) {
                await db.setSetting(key, String(value));
            }
        }

        // Sunucu tarafı state'i güncelle
        if (settings.countdown_duration) gameState.countdownDuration = parseInt(settings.countdown_duration);
        if (settings.result_duration) gameState.resultDuration = parseInt(settings.result_duration);
        if (settings.race_timeout) gameState.raceTimeout = parseInt(settings.race_timeout);
        if (settings.bet_duration) gameState.betDuration = parseInt(settings.bet_duration);

        // Frontend'e ayar değişikliğini bildir
        io.emit('game_settings_changed', settings);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════
// SUNUCUYU BAŞLAT
// ═══════════════════════════════════

const PORT = process.env.PORT || 3005;

// Port çakışmasını kontrol et ve varsa eski process'i öldür
const net = require('net');
const testServer = net.createServer();
testServer.once('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[INIT] Port ${PORT} kullanımda, eski process temizleniyor...`);
        try {
            const { execSync } = require('child_process');
            // Windows'ta port kullanan PID'i bul ve öldür
            const result = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`).toString();
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                    console.log(`[INIT] PID ${pid} sonlandırıldı.`);
                } catch(e) { /* zaten kapanmış olabilir */ }
            }
            // Biraz bekle ve tekrar dene
            setTimeout(() => startServer(), 2000);
        } catch (e) {
            console.error(`[INIT] Port ${PORT} temizlenemedi. Lütfen manuel olarak kapatın.`);
            console.error(`  Komut: taskkill /F /PID <PID_NUMARASI>`);
            process.exit(1);
        }
    }
});
testServer.once('listening', () => {
    testServer.close();
    startServer();
});
testServer.listen(PORT);

async function startServer() {
    server.listen(PORT, async () => {
        console.log(`\n╔══════════════════════════════════════════╗`);
        console.log(`║  🏇 Pristagna At Yarışı Sunucusu         ║`);
        console.log(`║  http://localhost:${PORT}                  ║`);
        console.log(`║  Admin: http://localhost:${PORT}/admin      ║`);
        console.log(`╚══════════════════════════════════════════╝\n`);

        // Veritabanı hazır olana kadar bekle
        await db.ready;
        console.log('[INIT] Veritabanı hazır, servisler başlatılıyor...');

        // Kick'e bağlan (opsiyonel — başarısız olsa da oyun çalışır)
        console.log('[INIT] Kick bağlantısı deneniyor (doğrudan WebSocket)...');
        connectToKick();

        // Otomatik mod açıksa ilk yarışı başlat (3 saniye bekle)
        // Kick bağlantısını BEKLEME — oyun hemen başlar
        setTimeout(() => {
            if (gameState.autoMode) {
                console.log('[OTO] İlk yarış döngüsü başlatılıyor...');
                startBettingPhase();
            }
        }, 3000);
    });
}
