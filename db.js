const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// DB hazır olduğunda çözülecek promise
let _resolveReady;
const ready = new Promise((resolve) => { _resolveReady = resolve; });

db.on('open', () => {
    console.log('SQLite veritabanına bağlanıldı.');
    initializeDatabase();
});

db.on('error', (err) => {
    console.error('Veritabanı hatası:', err.message);
});

function initializeDatabase() {
    db.serialize(() => {
        // Kullanıcılar tablosu
        db.run(`CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 100,
            total_wins INTEGER DEFAULT 0,
            total_losses INTEGER DEFAULT 0,
            total_wagered INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Yarış geçmişi tablosu
        db.run(`CREATE TABLE IF NOT EXISTS races (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            winner TEXT,
            total_pool INTEGER DEFAULT 0,
            character_count INTEGER DEFAULT 4,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            finished_at DATETIME
        )`);

        // Bahisler tablosu
        db.run(`CREATE TABLE IF NOT EXISTS bets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            race_id INTEGER,
            username TEXT,
            target TEXT,
            amount INTEGER,
            won INTEGER DEFAULT 0,
            payout INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (race_id) REFERENCES races(id),
            FOREIGN KEY (username) REFERENCES users(username)
        )`);

        // Ayarlar tablosu (yayıncı özelleştirme)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Varsayılan ayarları ekle
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('starting_balance', '100')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('max_bet', '1000')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('min_bet', '1')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bet_duration', '30')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('payout_multiplier', '2')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('background_image', '')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('kick_channel', 'PrisTagna')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('kick_chatroom_id', '')`);

        // Oyun fiziği ayarları
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_speed_min', '2.5')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_density', '0.002')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('angle_deviation', '0.7')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('unstuck_interval', '2000')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('unstuck_speed_threshold', '1.5')`);

        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_speed_max', '10')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_force', '0.03')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_friction_air', '0.004')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('ball_restitution', '1.05')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('unstuck_force', '0.012')`);

        // Zamanlama ayarları
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('race_timeout', '120')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('result_duration', '10')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('countdown_duration', '5')`, () => {
            console.log('Veritabanı tabloları hazır.');
            _resolveReady();
        });
    });
}

// ═══════════════════════════════════
// KULLANICI İŞLEMLERİ
// ═══════════════════════════════════

function getOrCreateUser(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) return reject(err);
            if (row) {
                // Son aktif zamanını güncelle
                db.run('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE username = ?', [username]);
                return resolve(row);
            }
            // Yeni kullanıcı oluştur
            getSetting('starting_balance').then(startBal => {
                const balance = parseInt(startBal) || 100;
                db.run('INSERT INTO users (username, balance) VALUES (?, ?)', [username, balance], function(err) {
                    if (err) return reject(err);
                    resolve({ username, balance, total_wins: 0, total_losses: 0, total_wagered: 0 });
                });
            }).catch(reject);
        });
    });
}

function getUserBalance(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT balance FROM users WHERE username = ?', [username], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.balance : null);
        });
    });
}

function updateUserBalance(username, amount) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET balance = balance + ? WHERE username = ?', [amount, username], function(err) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

function getTopUsers(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all('SELECT username, balance, total_wins FROM users ORDER BY balance DESC LIMIT ?', [limit], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

// ═══════════════════════════════════
// YARIŞ İŞLEMLERİ
// ═══════════════════════════════════

function createRace() {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO races (status) VALUES (?)', ['betting'], function(err) {
            if (err) return reject(err);
            resolve(this.lastID);
        });
    });
}

function finishRace(raceId, winner) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE races SET winner = ?, status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?',
            [winner, 'finished', raceId],
            function(err) {
                if (err) return reject(err);
                resolve(this.changes);
            }
        );
    });
}

function updateRaceStatus(raceId, status) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE races SET status = ? WHERE id = ?', [status, raceId], function(err) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

// ═══════════════════════════════════
// BAHİS İŞLEMLERİ
// ═══════════════════════════════════

function placeBet(raceId, username, target, amount) {
    return new Promise(async (resolve, reject) => {
        try {
            // Kullanıcıyı al veya oluştur
            const user = await getOrCreateUser(username);

            // Ayarları al
            const maxBet = parseInt(await getSetting('max_bet')) || 1000;
            const minBet = parseInt(await getSetting('min_bet')) || 1;

            // Validasyonlar
            if (amount < minBet) {
                return resolve({ success: false, message: `Minimum bahis: ${minBet}` });
            }
            if (amount > maxBet) {
                return resolve({ success: false, message: `Maksimum bahis: ${maxBet}` });
            }
            if (user.balance < amount) {
                return resolve({ success: false, message: `Yetersiz bakiye (${user.balance})` });
            }

            // Aynı turda aynı kullanıcının toplam bahsini kontrol et
            const existingBets = await getUserBetsForRace(raceId, username);
            const totalExisting = existingBets.reduce((sum, b) => sum + b.amount, 0);
            if (totalExisting + amount > user.balance) {
                return resolve({ success: false, message: `Yetersiz bakiye (toplam bahis: ${totalExisting + amount}, bakiye: ${user.balance})` });
            }

            // Transaction ile bakiye düşür ve bahis ekle
            db.serialize(() => {
                db.run('UPDATE users SET balance = balance - ?, total_wagered = total_wagered + ? WHERE username = ?',
                    [amount, amount, username]);

                db.run('INSERT INTO bets (race_id, username, target, amount) VALUES (?, ?, ?, ?)',
                    [raceId, username, target, amount], function(err) {
                        if (err) return reject(err);

                        // Yeni bakiyeyi al
                        db.get('SELECT balance FROM users WHERE username = ?', [username], (err, row) => {
                            if (err) return reject(err);
                            resolve({
                                success: true,
                                betId: this.lastID,
                                newBalance: row.balance,
                                message: `${target}'ye ${amount} bahis yapıldı!`
                            });
                        });
                    });
            });
        } catch (err) {
            reject(err);
        }
    });
}

function getUserBetsForRace(raceId, username) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bets WHERE race_id = ? AND username = ?', [raceId, username], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function getRaceBets(raceId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bets WHERE race_id = ?', [raceId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function getRaceBetSummary(raceId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT target, COUNT(*) as bet_count, SUM(amount) as total_amount 
             FROM bets WHERE race_id = ? GROUP BY target`,
            [raceId],
            (err, rows) => {
                if (err) return reject(err);
                const summary = {};
                const totalPool = (rows || []).reduce((sum, r) => sum + r.total_amount, 0);
                (rows || []).forEach(r => {
                    summary[r.target] = {
                        count: r.bet_count,
                        total: r.total_amount,
                        percentage: totalPool > 0 ? Math.round((r.total_amount / totalPool) * 100) : 0
                    };
                });
                resolve({ summary, totalPool });
            }
        );
    });
}

// Kazananları ödüllendir
function distributeWinnings(raceId, winner) {
    return new Promise(async (resolve, reject) => {
        try {
            const allBets = await getRaceBets(raceId);
            const { totalPool } = await getRaceBetSummary(raceId);

            const winningBets = allBets.filter(b => b.target === winner);
            const losingBets = allBets.filter(b => b.target !== winner);
            const totalWinningAmount = winningBets.reduce((sum, b) => sum + b.amount, 0);

            const results = {
                winner,
                totalPool,
                winnerCount: winningBets.length,
                loserCount: losingBets.length,
                payouts: []
            };

            if (winningBets.length === 0) {
                // Kimse kazananı bilmediyse, bahisler kaybolur
                // Kaybedenlerin istatistiklerini güncelle
                for (const bet of losingBets) {
                    await new Promise((res, rej) => {
                        db.run('UPDATE users SET total_losses = total_losses + 1 WHERE username = ?',
                            [bet.username], (err) => err ? rej(err) : res());
                    });
                    await new Promise((res, rej) => {
                        db.run('UPDATE bets SET won = 0 WHERE id = ?', [bet.id], (err) => err ? rej(err) : res());
                    });
                }
                resolve(results);
                return;
            }

            // Havuz oranı: Toplam havuz / Kazananların toplam bahsi
            const poolMultiplier = totalPool / totalWinningAmount;

            // Kazananlara ödeme yap
            for (const bet of winningBets) {
                const payout = Math.floor(bet.amount * poolMultiplier);

                await updateUserBalance(bet.username, payout);

                await new Promise((res, rej) => {
                    db.run('UPDATE bets SET won = 1, payout = ? WHERE id = ?', [payout, bet.id], (err) => err ? rej(err) : res());
                });

                await new Promise((res, rej) => {
                    db.run('UPDATE users SET total_wins = total_wins + 1 WHERE username = ?',
                        [bet.username], (err) => err ? rej(err) : res());
                });

                const newBalance = await getUserBalance(bet.username);
                results.payouts.push({
                    username: bet.username,
                    betAmount: bet.amount,
                    payout,
                    profit: payout - bet.amount,
                    newBalance
                });
            }

            // Kaybedenlerin istatistiklerini güncelle
            for (const bet of losingBets) {
                await new Promise((res, rej) => {
                    db.run('UPDATE users SET total_losses = total_losses + 1 WHERE username = ?',
                        [bet.username], (err) => err ? rej(err) : res());
                });
                await new Promise((res, rej) => {
                    db.run('UPDATE bets SET won = 0 WHERE id = ?', [bet.id], (err) => err ? rej(err) : res());
                });
            }

            // Yarışın toplam havuzunu güncelle
            await new Promise((res, rej) => {
                db.run('UPDATE races SET total_pool = ? WHERE id = ?', [totalPool, raceId], (err) => err ? rej(err) : res());
            });

            resolve(results);
        } catch (err) {
            reject(err);
        }
    });
}

// ═══════════════════════════════════
// AYARLAR
// ═══════════════════════════════════

function getSetting(key) {
    return new Promise((resolve, reject) => {
        db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.value : null);
        });
    });
}

function setSetting(key, value) {
    return new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], function(err) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

function getAllSettings() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM settings', [], (err, rows) => {
            if (err) return reject(err);
            const settings = {};
            (rows || []).forEach(r => { settings[r.key] = r.value; });
            resolve(settings);
        });
    });
}

// ═══════════════════════════════════
// İSTATİSTİKLER
// ═══════════════════════════════════

function getRecentRaces(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM races WHERE status = ? ORDER BY finished_at DESC LIMIT ?',
            ['finished', limit], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
    });
}

module.exports = {
    getOrCreateUser,
    getUserBalance,
    updateUserBalance,
    getTopUsers,
    createRace,
    finishRace,
    updateRaceStatus,
    placeBet,
    getUserBetsForRace,
    getRaceBets,
    getRaceBetSummary,
    distributeWinnings,
    getSetting,
    setSetting,
    getAllSettings,
    getRecentRaces,
    ready
};
