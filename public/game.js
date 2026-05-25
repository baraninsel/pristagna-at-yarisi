// ═══════════════════════════════════════════════════
// PRISTAGNA AT YARIŞI — MARBLE RACE GAME ENGINE
// Matter.js fizik motoru + Kıvrımlı Parkur Sistemi
// ═══════════════════════════════════════════════════

const socket = io();

// Matter.js alias'ları
const Engine = Matter.Engine,
      Render = Matter.Render,
      Runner = Matter.Runner,
      Bodies = Matter.Bodies,
      Body = Matter.Body,
      Composite = Matter.Composite,
      Events = Matter.Events,
      Vector = Matter.Vector;

// ═══════════════════════════════════
// SABİTLER
// ═══════════════════════════════════

const CHAR_COLORS = {
    A: '#ff3366',
    B: '#33ccff',
    C: '#ffcc00',
    D: '#53fc18'
};

const CHAR_NAMES = ['A', 'B', 'C', 'D'];

// ═══════════════════════════════════
// DİNAMİK OYUN AYARLARI
// ═══════════════════════════════════

let gameSettings = {
    ball_speed_min: 2.0,
    ball_speed_max: 7,
    ball_force: 0.02,
    ball_friction_air: 0.006,
    ball_restitution: 0.85,
    unstuck_force: 0.010,
    race_timeout: 120,
    result_duration: 10,
    countdown_duration: 5,
    bet_duration: 30
};

const width = window.innerWidth;
const height = window.innerHeight;
const scaleFactor = Math.min(width, height);

const CHAR_RADIUS = Math.max(11, Math.min(scaleFactor * 0.018, 18));
const WALL_THICKNESS = Math.max(10, Math.min(scaleFactor * 0.016, 14));
const CORRIDOR_WIDTH = Math.max(55, Math.min(scaleFactor * 0.095, 95));

// ═══════════════════════════════════
// PARKUR TANIMI (Node + Corridor)
// ═══════════════════════════════════

// Parkur düğümleri — büyük daire alanları
// Map'i aşağı kaydırdık ve biraz küçülttük ki ekranda tam görünsün
const mapScale = 0.88; // Harita ölçeği
const mapOffsetY = height * 0.08; // Aşağı kaydırma miktarı
const trackNodes = [
    { x: width * 0.22, y: height * 0.13 * mapScale + mapOffsetY, r: scaleFactor * 0.058, label: 'START' },
    { x: width * 0.38, y: height * 0.10 * mapScale + mapOffsetY, r: scaleFactor * 0.036 },
    { x: width * 0.54, y: height * 0.15 * mapScale + mapOffsetY, r: scaleFactor * 0.050 },
    { x: width * 0.72, y: height * 0.20 * mapScale + mapOffsetY, r: scaleFactor * 0.055 },
    { x: width * 0.76, y: height * 0.40 * mapScale + mapOffsetY, r: scaleFactor * 0.048 },
    { x: width * 0.60, y: height * 0.52 * mapScale + mapOffsetY, r: scaleFactor * 0.060 },
    { x: width * 0.40, y: height * 0.56 * mapScale + mapOffsetY, r: scaleFactor * 0.042 },
    { x: width * 0.24, y: height * 0.52 * mapScale + mapOffsetY, r: scaleFactor * 0.046 },
    { x: width * 0.22, y: height * 0.72 * mapScale + mapOffsetY, r: scaleFactor * 0.044 },
    { x: width * 0.40, y: height * 0.84 * mapScale + mapOffsetY, r: scaleFactor * 0.046 },
    { x: width * 0.60, y: height * 0.76 * mapScale + mapOffsetY, r: scaleFactor * 0.054, label: 'FINISH' }
];

// Parkur kenarları (bağlantılar) — düğümler arası koridorlar
const trackEdges = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]
];

// ═══════════════════════════════════
// MOTOR KURULUMU
// ═══════════════════════════════════

const engine = Engine.create({
    gravity: { x: 0, y: 0 }
});

const render = Render.create({
    element: document.getElementById('game-container'),
    engine: engine,
    options: {
        width: width,
        height: height,
        wireframes: false,
        background: 'transparent',
        pixelRatio: window.devicePixelRatio || 1
    }
});

// ═══════════════════════════════════
// PARKUR DUVAR ÜRETİMİ (Fizik)
// ═══════════════════════════════════

const trackWallStyle = {
    fillStyle: 'rgba(83, 252, 24, 0.03)',
    strokeStyle: 'rgba(83, 252, 24, 0.08)',
    lineWidth: 1
};

// Koridor duvarları oluştur
function createCorridorWalls(nodeIdx1, nodeIdx2) {
    const n1 = trackNodes[nodeIdx1];
    const n2 = trackNodes[nodeIdx2];

    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const perpX = Math.cos(angle + Math.PI / 2);
    const perpY = Math.sin(angle + Math.PI / 2);

    const hw = CORRIDOR_WIDTH / 2;

    // Duvarları düğüm dairelerinin içine sokmamak için kısalt
    const startOffset = n1.r * 0.82;
    const endOffset = n2.r * 0.82;
    const wallLen = dist - startOffset - endOffset;

    if (wallLen <= 0) return [];

    const dirX = dx / dist;
    const dirY = dy / dist;
    const wcx = n1.x + dirX * (startOffset + wallLen / 2);
    const wcy = n1.y + dirY * (startOffset + wallLen / 2);

    const walls = [];

    // Sol duvar
    walls.push(Bodies.rectangle(
        wcx + perpX * hw,
        wcy + perpY * hw,
        wallLen, WALL_THICKNESS,
        {
            isStatic: true, angle: angle,
            render: trackWallStyle, label: 'track_wall',
            chamfer: { radius: 3 }
        }
    ));

    // Sağ duvar
    walls.push(Bodies.rectangle(
        wcx - perpX * hw,
        wcy - perpY * hw,
        wallLen, WALL_THICKNESS,
        {
            isStatic: true, angle: angle,
            render: trackWallStyle, label: 'track_wall',
            chamfer: { radius: 3 }
        }
    ));

    return walls;
}

// Düğüm yay duvarları oluştur (koridor açıklıkları hariç)
function createNodeArcWalls(nodeIndex) {
    const node = trackNodes[nodeIndex];
    const walls = [];

    // Bu düğüme bağlı koridorların açılarını bul
    const connectionAngles = [];
    trackEdges.forEach(([i, j]) => {
        if (i === nodeIndex) {
            connectionAngles.push(Math.atan2(trackNodes[j].y - node.y, trackNodes[j].x - node.x));
        } else if (j === nodeIndex) {
            connectionAngles.push(Math.atan2(trackNodes[i].y - node.y, trackNodes[i].x - node.x));
        }
    });

    // Koridor açıklığı — koridor genişliğine göre hesapla
    const gapHalfAngle = Math.asin(Math.min(0.92, (CORRIDOR_WIDTH * 0.58) / node.r));

    // Yay parçaları oluştur
    const numSegments = 28;
    const segmentAngle = (Math.PI * 2) / numSegments;

    for (let i = 0; i < numSegments; i++) {
        const angle = segmentAngle * i - Math.PI;

        // Bu açı bir koridor açıklığına yakın mı?
        let nearCorridor = false;
        for (const connAngle of connectionAngles) {
            let diff = angle - connAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) < gapHalfAngle) {
                nearCorridor = true;
                break;
            }
        }

        if (nearCorridor) continue;

        const arcLen = node.r * segmentAngle * 1.12;
        const sx = node.x + Math.cos(angle) * node.r;
        const sy = node.y + Math.sin(angle) * node.r;

        walls.push(Bodies.rectangle(sx, sy, arcLen, WALL_THICKNESS, {
            isStatic: true,
            angle: angle + Math.PI / 2,
            render: trackWallStyle,
            label: 'node_wall',
            chamfer: { radius: 2 }
        }));
    }

    return walls;
}

// Tüm parkur duvarlarını oluştur
function buildTrackWalls() {
    const allWalls = [];

    // Koridor duvarları
    trackEdges.forEach(([i, j]) => {
        allWalls.push(...createCorridorWalls(i, j));
    });

    // Düğüm yay duvarları
    trackNodes.forEach((node, idx) => {
        allWalls.push(...createNodeArcWalls(idx));
    });

    // Dış sınır duvarları (güvenlik)
    const bw = 40;
    allWalls.push(
        Bodies.rectangle(width / 2, -bw / 2, width + bw * 2, bw, { isStatic: true, render: { visible: false }, label: 'boundary' }),
        Bodies.rectangle(width / 2, height + bw / 2, width + bw * 2, bw, { isStatic: true, render: { visible: false }, label: 'boundary' }),
        Bodies.rectangle(-bw / 2, height / 2, bw, height + bw * 2, { isStatic: true, render: { visible: false }, label: 'boundary' }),
        Bodies.rectangle(width + bw / 2, height / 2, bw, height + bw * 2, { isStatic: true, render: { visible: false }, label: 'boundary' })
    );

    Composite.add(engine.world, allWalls);
    return allWalls;
}

const trackWalls = buildTrackWalls();

// ═══════════════════════════════════
// PARKUR GÖRSEL ÇİZİMİ (Canvas)
// ═══════════════════════════════════

function renderTrackCanvas() {
    const canvas = document.getElementById('track-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // === Katman 1: Dış glow (border efekti) ===
    ctx.save();
    ctx.lineWidth = CORRIDOR_WIDTH + 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(83, 252, 24, 0.04)';
    ctx.shadowColor = 'rgba(83, 252, 24, 0.12)';
    ctx.shadowBlur = 25;

    // Koridor glow
    trackEdges.forEach(([i, j]) => {
        ctx.beginPath();
        ctx.moveTo(trackNodes[i].x, trackNodes[i].y);
        ctx.lineTo(trackNodes[j].x, trackNodes[j].y);
        ctx.stroke();
    });

    // Düğüm glow
    trackNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 4, 0, Math.PI * 2);
        ctx.stroke();
    });

    ctx.restore();

    // === Katman 2: Parkur yolu (ana dolgu) ===
    ctx.save();
    ctx.lineWidth = CORRIDOR_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20, 40, 25, 0.65)';

    trackEdges.forEach(([i, j]) => {
        ctx.beginPath();
        ctx.moveTo(trackNodes[i].x, trackNodes[i].y);
        ctx.lineTo(trackNodes[j].x, trackNodes[j].y);
        ctx.stroke();
    });

    // Düğüm daireleri
    trackNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20, 40, 25, 0.65)';
        ctx.fill();
    });

    ctx.restore();

    // === Katman 3: İç detaylar ===
    ctx.save();

    // Koridor kenar çizgileri (neon yeşil)
    ctx.lineWidth = CORRIDOR_WIDTH + 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(83, 252, 24, 0.08)';

    trackEdges.forEach(([i, j]) => {
        ctx.beginPath();
        ctx.moveTo(trackNodes[i].x, trackNodes[i].y);
        ctx.lineTo(trackNodes[j].x, trackNodes[j].y);
        ctx.stroke();
    });

    // Düğüm kenar çizgileri
    trackNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(83, 252, 24, 0.10)';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    ctx.restore();

    // === Katman 4: İç parkur yüzeyi (daha açık) ===
    ctx.save();
    ctx.lineWidth = CORRIDOR_WIDTH - 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(30, 55, 35, 0.45)';

    trackEdges.forEach(([i, j]) => {
        ctx.beginPath();
        ctx.moveTo(trackNodes[i].x, trackNodes[i].y);
        ctx.lineTo(trackNodes[j].x, trackNodes[j].y);
        ctx.stroke();
    });

    trackNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r - 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30, 55, 35, 0.45)';
        ctx.fill();
    });

    ctx.restore();

    // === Yön okları (subtle) ===
    ctx.save();
    trackEdges.forEach(([i, j]) => {
        const n1 = trackNodes[i];
        const n2 = trackNodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const angle = Math.atan2(dy, dx);

        for (let t = 0.35; t <= 0.65; t += 0.30) {
            const ax = n1.x + dx * t;
            const ay = n1.y + dy * t;

            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(angle);

            ctx.beginPath();
            ctx.moveTo(-7, -4);
            ctx.lineTo(7, 0);
            ctx.lineTo(-7, 4);
            ctx.closePath();
            ctx.fillStyle = 'rgba(83, 252, 24, 0.06)';
            ctx.fill();

            ctx.restore();
        }
    });
    ctx.restore();

    // === START işareti ===
    const startNode = trackNodes[0];
    ctx.save();
    ctx.font = `800 ${Math.max(10, scaleFactor * 0.013)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(83, 252, 24, 0.5)';
    ctx.fillText('START', startNode.x, startNode.y - startNode.r - 8);

    // Start çizgisi
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(startNode.x - startNode.r * 0.7, startNode.y + startNode.r * 0.5);
    ctx.lineTo(startNode.x + startNode.r * 0.7, startNode.y + startNode.r * 0.5);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // === FINISH işareti ===
    const finishNode = trackNodes[trackNodes.length - 1];
    ctx.save();
    ctx.font = `800 ${Math.max(10, scaleFactor * 0.013)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 204, 0, 0.6)';
    ctx.fillText('🏁 HEDEF', finishNode.x, finishNode.y - finishNode.r - 8);
    ctx.restore();
}

// Parkur çizimini başlat
setTimeout(renderTrackCanvas, 100);

// ═══════════════════════════════════
// HEDEF (Bitiş noktası — sensör)
// ═══════════════════════════════════

const finishNode = trackNodes[trackNodes.length - 1];
const TARGET_RADIUS = finishNode.r * 0.55;

const target = Bodies.circle(finishNode.x, finishNode.y, TARGET_RADIUS, {
    isStatic: true,
    isSensor: true,
    render: {
        fillStyle: 'rgba(255, 204, 0, 0.08)',
        strokeStyle: 'rgba(255, 204, 0, 0.25)',
        lineWidth: 2
    },
    label: 'Target'
});
Composite.add(engine.world, target);

// ═══════════════════════════════════
// KARAKTERLER
// ═══════════════════════════════════

const characters = {};
const startNode = trackNodes[0];

// Başlangıç pozisyonları — hepsi START düğümünde
const startPositions = [
    { x: startNode.x - CHAR_RADIUS * 1.4, y: startNode.y - CHAR_RADIUS * 1.4 },
    { x: startNode.x + CHAR_RADIUS * 1.4, y: startNode.y - CHAR_RADIUS * 1.4 },
    { x: startNode.x - CHAR_RADIUS * 1.4, y: startNode.y + CHAR_RADIUS * 1.4 },
    { x: startNode.x + CHAR_RADIUS * 1.4, y: startNode.y + CHAR_RADIUS * 1.4 }
];

CHAR_NAMES.forEach((name, index) => {
    const pos = startPositions[index];
    const color = CHAR_COLORS[name];

    const body = Bodies.circle(pos.x, pos.y, CHAR_RADIUS, {
        restitution: gameSettings.ball_restitution,
        friction: 0,
        frictionAir: gameSettings.ball_friction_air,
        frictionStatic: 0,
        density: 0.002,
        render: {
            fillStyle: color,
            strokeStyle: 'rgba(255, 255, 255, 0.6)',
            lineWidth: 2
        },
        label: `Char_${name}`
    });

    characters[name] = { body, color, name };
    Composite.add(engine.world, body);
});

// ═══════════════════════════════════
// YARIŞ DURUMU
// ═══════════════════════════════════

let isRacing = false;
let raceFinished = false;
let gameStatus = 'idle';

// ═══════════════════════════════════
// YARIŞ BAŞLATMA
// ═══════════════════════════════════

let raceStartTime = 0;
let raceTimeoutDuration = 120;

function startRace() {
    if (isRacing) return;
    isRacing = true;
    raceFinished = false;
    raceStartTime = Date.now();

    // İlk koridorun yönüne doğru rastgele itme
    const firstTarget = trackNodes[1];

    CHAR_NAMES.forEach(name => {
        const char = characters[name];
        const dx = firstTarget.x - char.body.position.x;
        const dy = firstTarget.y - char.body.position.y;
        const baseAngle = Math.atan2(dy, dx);
        const angle = baseAngle + (Math.random() - 0.5) * 0.8;
        const forceMagnitude = gameSettings.ball_force + Math.random() * (gameSettings.ball_force * 0.8);

        Body.applyForce(char.body, char.body.position, {
            x: Math.cos(angle) * forceMagnitude,
            y: Math.sin(angle) * forceMagnitude
        });
    });
}

// ═══════════════════════════════════
// ÇARPIŞMA MEKANİĞİ
// ═══════════════════════════════════

// Bitiş algılama
Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;

        if (isRacing && !raceFinished) {
            if (bodyA.label === 'Target' || bodyB.label === 'Target') {
                const winnerBody = bodyA.label === 'Target' ? bodyB : bodyA;
                if (winnerBody.label.startsWith('Char_')) {
                    const winnerId = winnerBody.label.split('_')[1];
                    finishRace(winnerId);
                }
            }
        }
    });
});

// Duvarlara çarpınca kaos — rastgele hız/yön değişimi
Events.on(engine, 'collisionEnd', (event) => {
    if (!isRacing) return;

    event.pairs.forEach(pair => {
        const isWall = (b) => b.isStatic && (
            b.label === 'track_wall' ||
            b.label === 'node_wall' ||
            b.label === 'boundary'
        );

        let movingBody = null;
        if (isWall(pair.bodyA) && !pair.bodyB.isStatic) {
            movingBody = pair.bodyB;
        } else if (isWall(pair.bodyB) && !pair.bodyA.isStatic) {
            movingBody = pair.bodyA;
        }

        if (movingBody && movingBody.label.startsWith('Char_')) {
            const vel = movingBody.velocity;
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

            // Rastgele yön sapması
            const angleDeviation = (Math.random() - 0.5) * 0.5;
            const currentAngle = Math.atan2(vel.y, vel.x);
            const newAngle = currentAngle + angleDeviation;

            const newSpeed = Math.max(gameSettings.ball_speed_min, Math.min(gameSettings.ball_speed_max,
                speed * (0.80 + Math.random() * 0.25)
            ));

            Body.setVelocity(movingBody, {
                x: Math.cos(newAngle) * newSpeed,
                y: Math.sin(newAngle) * newSpeed
            });

            Body.setAngularVelocity(movingBody, (Math.random() - 0.5) * 0.08);
        }
    });
});

// Sıkışma önleme — yavaşlayan karakterlere hedefe doğru itme
setInterval(() => {
    if (!isRacing) return;

    CHAR_NAMES.forEach(name => {
        const char = characters[name];
        const vel = char.body.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

        if (speed < 1.5) {
            // Hedefe doğru itme (biraz rastgelelik ile)
            const dx = finishNode.x - char.body.position.x;
            const dy = finishNode.y - char.body.position.y;
            const toFinish = Math.atan2(dy, dx);
            const angle = toFinish + (Math.random() - 0.5) * Math.PI * 0.7;
            const force = gameSettings.unstuck_force + Math.random() * (gameSettings.unstuck_force * 1.2);

            Body.applyForce(char.body, char.body.position, {
                x: Math.cos(angle) * force,
                y: Math.sin(angle) * force
            });
        }
    });
}, 2000);

// Yarış force-finish (en yakın top kazanır)
function forceFinishRace() {
    if (raceFinished || !isRacing) return;

    let closestChar = null;
    let closestDist = Infinity;

    CHAR_NAMES.forEach(name => {
        const char = characters[name];
        const pos = char.body.position;
        const dx = finishNode.x - pos.x;
        const dy = finishNode.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < closestDist) {
            closestDist = dist;
            closestChar = name;
        }
    });

    if (closestChar) {
        console.log(`[TIMEOUT] En yakın karakter: ${closestChar} (${Math.round(closestDist)}px)`);
        finishRace(closestChar);
    }
}

// ═══════════════════════════════════
// YARIŞ BİTİRME
// ═══════════════════════════════════

function finishRace(winnerId) {
    if (raceFinished) return;
    raceFinished = true;
    isRacing = false;

    // Tüm karakterleri yavaşlat
    CHAR_NAMES.forEach(name => {
        const vel = characters[name].body.velocity;
        Body.setVelocity(characters[name].body, {
            x: vel.x * 0.2,
            y: vel.y * 0.2
        });
    });

    socket.emit('race_winner', { winner: winnerId });
}

function resetCharacters() {
    CHAR_NAMES.forEach((name, index) => {
        const pos = startPositions[index];
        const body = characters[name].body;
        Body.setPosition(body, { x: pos.x, y: pos.y });
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        Body.setAngle(body, 0);

        // Dinamik fizik ayarlarını uygula
        body.restitution = gameSettings.ball_restitution;
        body.frictionAir = gameSettings.ball_friction_air;
    });
    isRacing = false;
    raceFinished = false;
}

// ═══════════════════════════════════
// UI GÜNCELLEME FONKSİYONLARI
// ═══════════════════════════════════

const betListEl = document.getElementById('bet-list');
const raceStatusEl = document.getElementById('race-status');
const statusTextEl = raceStatusEl.querySelector('.status-text');
const timerDisplayEl = document.getElementById('timer-display');
const timerValueEl = document.getElementById('timer-value');
const totalPoolEl = document.getElementById('total-pool');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerCharEl = document.getElementById('winner-char');
const winnerDetailsEl = document.getElementById('winner-details');
const commandInfoEl = document.getElementById('command-info');

function updateStatus(status, text) {
    gameStatus = status;
    raceStatusEl.className = 'race-status ' + status;
    statusTextEl.textContent = text;
}

function updateOdds(betSummary) {
    if (!betSummary || !betSummary.summary) return;
    const { summary, totalPool } = betSummary;

    CHAR_NAMES.forEach(name => {
        const bar = document.getElementById(`odds-bar-${name}`);
        const pct = document.getElementById(`odds-pct-${name}`);

        if (summary[name]) {
            bar.style.width = summary[name].percentage + '%';
            pct.textContent = summary[name].percentage + '%';
        } else {
            bar.style.width = '0%';
            pct.textContent = '0%';
        }
    });

    totalPoolEl.textContent = totalPool || 0;
}

function addBetToList(data) {
    const li = document.createElement('li');

    const badge = document.createElement('span');
    badge.className = 'bet-char-badge';
    badge.style.background = CHAR_COLORS[data.target] || '#888';
    badge.textContent = data.target;

    const username = document.createElement('span');
    username.className = 'bet-username';
    username.textContent = data.username;

    const amount = document.createElement('span');
    amount.className = 'bet-amount';
    amount.textContent = '+' + data.amount;

    li.appendChild(badge);
    li.appendChild(username);
    li.appendChild(amount);

    betListEl.prepend(li);

    while (betListEl.children.length > 15) {
        betListEl.removeChild(betListEl.lastChild);
    }
}

function clearBets() {
    betListEl.innerHTML = '';
    CHAR_NAMES.forEach(name => {
        document.getElementById(`odds-bar-${name}`).style.width = '0%';
        document.getElementById(`odds-pct-${name}`).textContent = '0%';
    });
    totalPoolEl.textContent = '0';
}

function showCountdown(count) {
    countdownOverlay.style.display = 'flex';
    countdownNumber.textContent = count;
    countdownNumber.style.animation = 'none';
    countdownNumber.offsetHeight;
    countdownNumber.style.animation = 'countdownPop 1s ease-out';

    if (count <= 0) {
        countdownNumber.textContent = 'BAŞLA!';
        setTimeout(() => {
            countdownOverlay.style.display = 'none';
        }, 800);
    }
}

function showWinner(data) {
    winnerOverlay.style.display = 'flex';
    winnerCharEl.textContent = data.winner;
    winnerCharEl.className = 'winner-char char-' + data.winner;

    let detailsHTML = `<div style="margin-bottom: 8px;">Toplam Havuz: <strong>${data.totalPool || 0}</strong> puan</div>`;

    if (data.payouts && data.payouts.length > 0) {
        data.payouts.forEach(p => {
            detailsHTML += `<span class="payout-line">${p.username}: +${p.profit} → ${p.newBalance}</span>`;
        });
    } else {
        detailsHTML += `<div style="color: rgba(255,255,255,0.4);">Kimse doğru tahmin edemedi!</div>`;
    }

    winnerDetailsEl.innerHTML = detailsHTML;
}

function hideWinner() {
    winnerOverlay.style.display = 'none';
}

// ═══════════════════════════════════
// SOCKET.IO OLAYLARI
// ═══════════════════════════════════

socket.on('game_state', (state) => {
    switch (state.status) {
        case 'idle':
            updateStatus('idle', 'Bekleniyor...');
            timerDisplayEl.style.display = 'none';
            hideWinner();
            break;
        case 'betting':
            updateStatus('betting', 'BAHİSLER AÇIK');
            timerDisplayEl.style.display = 'flex';
            hideWinner();
            clearBets();
            resetCharacters();
            break;
        case 'countdown':
            updateStatus('countdown', 'BAŞLIYOR...');
            timerDisplayEl.style.display = 'none';
            break;
        case 'racing':
            updateStatus('racing', 'YARIŞ DEVAM EDİYOR');
            break;
        case 'finished':
            updateStatus('finished', 'YARIŞ BİTTİ');
            break;
    }
});

socket.on('bet_timer', (data) => {
    timerValueEl.textContent = data.remaining;

    if (data.remaining <= 5) {
        timerValueEl.style.color = '#ff3366';
        timerValueEl.style.textShadow = '0 0 12px rgba(255, 51, 102, 0.5)';
    } else {
        timerValueEl.style.color = 'var(--kick-green)';
        timerValueEl.style.textShadow = '0 0 12px var(--kick-green-glow)';
    }
});

socket.on('countdown', (data) => {
    showCountdown(data.count);
});

socket.on('race_start', (data) => {
    countdownOverlay.style.display = 'none';
    if (data && data.raceTimeout) {
        raceTimeoutDuration = data.raceTimeout;
    }
    startRace();
});

// Force finish — yarış timeout'u dolduğunda en yakın top kazanır
socket.on('race_force_finish', () => {
    forceFinishRace();
});

socket.on('new_bet', (data) => {
    addBetToList(data);
    if (data.betSummary) {
        updateOdds(data.betSummary);
    }
});

socket.on('race_result', (data) => {
    showWinner(data);
});

socket.on('kick_status', (data) => {
    const kickDot = document.querySelector('.kick-dot');
    const kickText = document.querySelector('.kick-text');

    if (data.connected) {
        kickDot.classList.remove('offline');
        kickText.textContent = 'Kick Bağlı ✓';
    } else if (data.disabled) {
        kickDot.classList.add('offline');
        kickText.textContent = 'Kick Devre Dışı';
    } else if (data.connecting) {
        kickDot.classList.add('offline');
        kickText.textContent = 'Kick Bağlanıyor...';
    } else {
        kickDot.classList.add('offline');
        kickText.textContent = data.error ? `Kick: ${data.error}` : 'Kick Bağlanıyor...';
    }
});

socket.on('background_changed', (data) => {
    if (data.image) {
        const bgLayer = document.getElementById('bg-layer');
        bgLayer.style.backgroundImage = `url(${data.image})`;
        bgLayer.classList.add('custom-bg');
    }
});

// ═══════════════════════════════════
// PARTİCLE EFEKTİ (Arkaplan)
// ═══════════════════════════════════

function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    const particles = [];
    const particleCount = 35;

    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            radius: Math.random() * 1.5 + 0.5,
            alpha: Math.random() * 0.2 + 0.05
        });
    }

    function drawParticles() {
        ctx.clearRect(0, 0, width, height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(83, 252, 24, ${p.alpha})`;
            ctx.fill();
        });

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 130) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(83, 252, 24, ${0.04 * (1 - dist / 130)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(drawParticles);
    }

    drawParticles();
}

// ═══════════════════════════════════
// RENDER ÜZERİ ÇİZİMLER
// ═══════════════════════════════════

Events.on(render, 'afterRender', () => {
    const ctx = render.context;
    const time = Date.now() / 1000;

    // === Hedef pulse animasyonu ===
    const tx = target.position.x;
    const ty = target.position.y;
    const pulseRadius = TARGET_RADIUS + Math.sin(time * 3) * 5;

    ctx.beginPath();
    ctx.arc(tx, ty, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 204, 0, ${0.25 + Math.sin(time * 3) * 0.12})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // İç hedef noktası
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 204, 0, 0.6)';
    ctx.fill();

    // Hedef ikonu (yıldız)
    const starSize = 12 + Math.sin(time * 2) * 2;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(time * 0.5);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const outerX = Math.cos(angle) * starSize;
        const outerY = Math.sin(angle) * starSize;
        const innerAngle = angle + Math.PI / 5;
        const innerX = Math.cos(innerAngle) * (starSize * 0.4);
        const innerY = Math.sin(innerAngle) * (starSize * 0.4);
        if (i === 0) ctx.moveTo(outerX, outerY);
        else ctx.lineTo(outerX, outerY);
        ctx.lineTo(innerX, innerY);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 204, 0, 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 204, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // === Karakter etiketleri ve trail efekti ===
    CHAR_NAMES.forEach(name => {
        const char = characters[name];
        const pos = char.body.position;

        // İsim etiketi
        ctx.font = `800 ${Math.max(9, CHAR_RADIUS * 0.7)}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = char.color;
        ctx.shadowBlur = 8;
        ctx.fillText(name, pos.x, pos.y - CHAR_RADIUS - 5);
        ctx.shadowBlur = 0;

        // Hareket izi (trail)
        if (isRacing) {
            const vel = char.body.velocity;
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

            if (speed > 2) {
                const trailLen = Math.min(speed * 3, 25);
                const angle = Math.atan2(vel.y, vel.x);

                const gradient = ctx.createLinearGradient(
                    pos.x, pos.y,
                    pos.x - Math.cos(angle) * trailLen,
                    pos.y - Math.sin(angle) * trailLen
                );
                gradient.addColorStop(0, char.color + '50');
                gradient.addColorStop(1, char.color + '00');

                ctx.beginPath();
                ctx.moveTo(
                    pos.x - Math.cos(angle + 0.3) * CHAR_RADIUS,
                    pos.y - Math.sin(angle + 0.3) * CHAR_RADIUS
                );
                ctx.lineTo(
                    pos.x - Math.cos(angle) * (CHAR_RADIUS + trailLen),
                    pos.y - Math.sin(angle) * (CHAR_RADIUS + trailLen)
                );
                ctx.lineTo(
                    pos.x - Math.cos(angle - 0.3) * CHAR_RADIUS,
                    pos.y - Math.sin(angle - 0.3) * CHAR_RADIUS
                );
                ctx.fillStyle = gradient;
                ctx.fill();
            }
        }
    });

    // === İlerleme göstergesi (mini-map) ===
    if (isRacing) {
        drawProgressIndicator(ctx);
    }
});

// Mini ilerleme göstergesi
function drawProgressIndicator(ctx) {
    const indicatorX = width - 60;
    const indicatorY = height / 2 - 100;
    const indicatorH = 200;

    // Arka plan
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    const rx = indicatorX - 18, ry = indicatorY - 10, rw = 36, rh = indicatorH + 20, rr = 8;
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + rw - rr, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
    ctx.lineTo(rx + rw, ry + rh - rr);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
    ctx.lineTo(rx + rr, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Başlangıç ve bitiş işaretleri
    ctx.font = '600 8px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(83, 252, 24, 0.5)';
    ctx.fillText('S', indicatorX, indicatorY - 2);
    ctx.fillStyle = 'rgba(255, 204, 0, 0.5)';
    ctx.fillText('🏁', indicatorX, indicatorY + indicatorH + 14);

    // Parkur çizgisi
    ctx.beginPath();
    ctx.moveTo(indicatorX, indicatorY + 5);
    ctx.lineTo(indicatorX, indicatorY + indicatorH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Her karakter için konum
    const sn = trackNodes[0];
    const fn = trackNodes[trackNodes.length - 1];
    const totalDist = Math.sqrt((fn.x - sn.x) ** 2 + (fn.y - sn.y) ** 2);

    CHAR_NAMES.forEach(name => {
        const char = characters[name];
        const pos = char.body.position;

        // Hedefe olan mesafe üzerinden ilerleme
        const distToFinish = Math.sqrt((fn.x - pos.x) ** 2 + (fn.y - pos.y) ** 2);
        const distFromStart = Math.sqrt((pos.x - sn.x) ** 2 + (pos.y - sn.y) ** 2);
        const progress = Math.max(0, Math.min(1, distFromStart / (distFromStart + distToFinish)));
        const dotY = indicatorY + 5 + progress * (indicatorH - 5);

        ctx.beginPath();
        ctx.arc(indicatorX, dotY, 5, 0, Math.PI * 2);
        ctx.fillStyle = char.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });

    ctx.restore();
}

// ═══════════════════════════════════
// MOTOR BAŞLAT
// ═══════════════════════════════════

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// ═══════════════════════════════════
// HIZ SINIRLANDIRMA + SINIR KONTROLÜ (her frame)
// Topların mapten çıkmasını kesinlikle engelle
// ═══════════════════════════════════

const BOUNDARY_PADDING = 50; // Ekran kenarından minimum mesafe

Events.on(engine, 'beforeUpdate', () => {
    CHAR_NAMES.forEach(name => {
        const body = characters[name].body;
        const pos = body.position;
        const vel = body.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        const maxSpeed = gameSettings.ball_speed_max;

        // 1. Hız sınırlandırma — her frame'de topun max hızını aşmasını engelle
        if (speed > maxSpeed) {
            const ratio = maxSpeed / speed;
            Body.setVelocity(body, {
                x: vel.x * ratio,
                y: vel.y * ratio
            });
        }

        // 2. Sınır kontrolü — top ekran dışına çıktıysa geri çek
        let clamped = false;
        let newX = pos.x;
        let newY = pos.y;
        let newVelX = vel.x;
        let newVelY = vel.y;

        if (pos.x < BOUNDARY_PADDING) {
            newX = BOUNDARY_PADDING;
            newVelX = Math.abs(vel.x) * 0.5; // İçe doğru sektir
            clamped = true;
        } else if (pos.x > width - BOUNDARY_PADDING) {
            newX = width - BOUNDARY_PADDING;
            newVelX = -Math.abs(vel.x) * 0.5;
            clamped = true;
        }

        if (pos.y < BOUNDARY_PADDING) {
            newY = BOUNDARY_PADDING;
            newVelY = Math.abs(vel.y) * 0.5;
            clamped = true;
        } else if (pos.y > height - BOUNDARY_PADDING) {
            newY = height - BOUNDARY_PADDING;
            newVelY = -Math.abs(vel.y) * 0.5;
            clamped = true;
        }

        if (clamped) {
            Body.setPosition(body, { x: newX, y: newY });
            Body.setVelocity(body, { x: newVelX, y: newVelY });
        }
    });
});

// Parçacık efekti başlat
initParticles();

// Ayarlardan arka planı yükle + oyun ayarlarını çek
Promise.all([
    fetch('/api/settings').then(r => r.json()).catch(() => null),
    fetch('/api/game-settings').then(r => r.json()).catch(() => null)
]).then(([settingsData, gameSettingsData]) => {
    if (settingsData && settingsData.settings && settingsData.settings.background_image) {
        const bgLayer = document.getElementById('bg-layer');
        bgLayer.style.backgroundImage = `url(${settingsData.settings.background_image})`;
        bgLayer.classList.add('custom-bg');
    }
    if (gameSettingsData && gameSettingsData.settings) {
        Object.assign(gameSettings, gameSettingsData.settings);
        console.log('🎮 Oyun ayarları yüklendi:', gameSettings);
    }
});

// Oyun ayarları değiştiğinde güncelle (admin panelden)
socket.on('game_settings_changed', (newSettings) => {
    Object.assign(gameSettings, newSettings);
    console.log('🔄 Oyun ayarları güncellendi:', gameSettings);
});

// Space ile yarış başlatma (test modu)
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && gameStatus === 'idle') {
        e.preventDefault();
        socket.emit('admin_start_race');
    }
});

console.log('🏇 Pristagna At Yarışı — Marble Race Edition yüklendi!');
