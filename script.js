const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// プレイヤー：下部に固定し左右のみ移動
const player = { x: 300, y: 0, size: 15, speed: 3, life: 3 };
player.y = canvas.height - player.size - 10; // 下側に固定

// 敵リスト
const enemies = [];

// 入力状態
const keys = {};
// 弾リスト
const bullets = [];
// スペース押下の単発発射用ロック
let shootLock = false;
// パーティクル（演出）
const particles = [];
// 被弾シェイク制御
let shakeUntil = 0;
// ゲームオーバーフラグ
let gameOver = false;
// 攻撃力とアイテム
let attackPower = 15;           // デフォルト与ダメ
const items = [];               // 落下アイテム
// ボス管理
let spawnCount = 0;
// 連射機能
let autoFire = false;
let spaceHeld = false;
let lastFire = 0;
const fireInterval = 140; // ms
// フラッシュ演出（白フェード→黒戻り）
let flashStart = null; // performance.now() を記録

// 敵生成：右上から固定で出現
function spawnEnemy() {
  const size = 10;
  const x = canvas.width - size - 2;
  const y = size + 2; // 右上付近
  // スネークのような左右往復＋わずかに下方向ドリフト
  spawnCount++;
  const isBoss = (spawnCount % 50 === 0);
  const isElite = !isBoss && Math.random() < 0.2; // 少し強い敵
  enemies.push({
    x, y, size,
    speed: 2.0,
    dirX: -1,           // まず左へ
    drift: 0.2,         // 水平移動中の下方向ドリフト
    turnDrop: 20,       // 端でのUターン時に下げる量
    hp: isBoss ? 1000 : (isElite ? Math.floor(400 + Math.random() * 800) : 100),
    elite: isElite,
    boss: isBoss
  });
}

// 弾発射（単発／連射の両方から呼ぶ）
function fireBullet() {
  bullets.push({
    x: player.x,
    y: player.y - player.size,
    size: 3,
    speed: 8
  });
  lastFire = performance.now();
}

// 星形描画
function drawStar(cx, cy, r) {
  const spikes = 5;
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.5;
    ctx.lineTo(cx + Math.cos(rot) * rr, cy + Math.sin(rot) * rr);
    rot += step;
  }
  ctx.closePath();
}

// 爆散パーティクル生成
function createExplosion(x, y, opts = {}) {
  const {
    count = 30,
    speedMin = 1.5,
    speedMax = 4,
    gravity = 0.35,
    lifeMin = 30,
    lifeMax = 60,
    sizeMin = 2,
    sizeMax = 5,
    colors = ["#fff", "#ffd166", "#ef476f", "#06d6a0", "#118ab2"],
    faint = false
  } = opts;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speedMin + Math.random() * (speedMax - speedMin);
    const vx = Math.cos(a) * sp;
    const vy = Math.sin(a) * sp - Math.random() * 1.5; // 一部は上向きに
    particles.push({
      x, y, vx, vy,
      g: gravity,
      life: lifeMin + Math.floor(Math.random() * (lifeMax - lifeMin + 1)),
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: ["circle", "square", "star"][Math.floor(Math.random() * 3)],
      fill: Math.random() < 0.6,
      faint
    });
  }
}

// 移動処理
function update() {
  const now = performance.now();
  // 画面フラッシュの生存管理
  if (flashStart && now - flashStart > 250) flashStart = null;

  if (gameOver) {
    // パーティクルのみ更新
    for (let p of particles) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    return;
  }

  // 左右のみ移動
  if (keys["ArrowLeft"]) player.x -= player.speed;
  if (keys["ArrowRight"]) player.x += player.speed;
  // 下側に固定（上下入力は無効）
  player.x = Math.max(player.size, Math.min(canvas.width - player.size, player.x));
  player.y = canvas.height - player.size - 10;

  // 敵移動：左右往復＋少しずつ下げる。端でUターン時に余分に下げる
  for (let e of enemies) {
    // 水平移動
    e.x += e.speed * e.dirX;
    // わずかに下げる
    e.y += e.drift;
    // 左端または右端でUターンし、下方向に大きめに移動
    if (e.dirX < 0 && e.x <= e.size) {
      e.dirX = 1;
      e.y += e.turnDrop;
    } else if (e.dirX > 0 && e.x >= canvas.width - e.size) {
      e.dirX = -1;
      e.y += e.turnDrop;
    }
  }

  // 弾移動（上方向へ高速）
  for (let b of bullets) {
    b.y -= b.speed;
  }
  // 連射：スペース押下中かつ連射取得済み
  if (spaceHeld && autoFire && now - lastFire >= fireInterval) {
    fireBullet();
  }

  // 弾の画面外除去
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].y + bullets[i].size < 0) bullets.splice(i, 1);
  }

  // 当たり判定：弾 vs 敵（円同士）
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      const d = Math.hypot(e.x - b.x, e.y - b.y);
      if (d < e.size + b.size) {
        bullets.splice(j, 1);
        e.hp -= attackPower; // ダメージ適用
        if (e.hp <= 0) {
          if (e.boss) {
            createExplosion(e.x, e.y, {
              count: 90,
              speedMin: 2.5,
              speedMax: 6,
              gravity: 0.4,
              lifeMin: 45,
              lifeMax: 90,
              sizeMin: 2,
              sizeMax: 6,
              colors: ["#cce8ff", "#99d0ff", "#66b8ff", "#ffffff"]
            });
            flashStart = now;
            items.push({ x: e.x, y: e.y, vy: 2.0, size: 9, type: "auto" });
          } else {
            createExplosion(e.x, e.y, {
              count: e.elite ? 22 : 16,
              speedMin: 1.2,
              speedMax: 3,
              gravity: 0.35,
              lifeMin: 25,
              lifeMax: 45,
              sizeMin: 1.5,
              sizeMax: 3.5,
              colors: ["#ff5a5a", "#ff9a9a", "#aa2e2e"],
              faint: true
            });
            if (Math.random() < 0.15) {
              items.push({ x: e.x, y: e.y, vy: 1.8, size: 7, type: "atkUp" });
            }
          }
          enemies.splice(i, 1);
        }
        break;
      }
    }
  }

  // 当たり判定：敵 vs プレイヤー（円同士）
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < e.size + player.size) {
      enemies.splice(i, 1); // ぶつかった敵は消す
      player.life -= 1; // ライフ減少
      if (player.life <= 0) {
        // プレイヤー大爆散（派手）
        createExplosion(player.x, player.y, {
          count: 80,
          speedMin: 2,
          speedMax: 6,
          gravity: 0.4,
          lifeMin: 40,
          lifeMax: 80,
          sizeMin: 2,
          sizeMax: 6,
          colors: ["#ffffff", "#ffd166", "#06d6a0", "#118ab2", "#ef476f"]
        });
        gameOver = true;
        setTimeout(() => document.location.reload(), 1200);
        return;
      } else {
        // 軽い爆ぜ＋プレイヤー微小シェイク
        createExplosion(e.x, e.y, {
          count: 12,
          speedMin: 1,
          speedMax: 2.5,
          gravity: 0.35,
          lifeMin: 18,
          lifeMax: 30,
          sizeMin: 1.5,
          sizeMax: 3,
          colors: ["#ff7b7b", "#ffb3b3"],
          faint: true
        });
        shakeUntil = performance.now() + 160; // 約0.16秒
      }
    }
  }

  // アイテム移動と取得判定
  for (let it of items) it.y += it.vy;
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    // プレイヤー接触
    const dist = Math.hypot(it.x - player.x, it.y - player.y);
    if (dist < player.size + it.size) {
      if (it.type === "atkUp") attackPower += 3; // 攻撃力+3
      if (it.type === "auto") autoFire = true;   // 連射獲得
      createExplosion(it.x, it.y, {
        count: 10,
        speedMin: 1,
        speedMax: 2.5,
        gravity: 0.3,
        lifeMin: 18,
        lifeMax: 30,
        sizeMin: 1.5,
        sizeMax: 3,
        colors: it.type === "auto" ? ["#bcdcff", "#e1f0ff"] : ["#bbe67f", "#d7ff9a"],
        faint: true
      });
      items.splice(k, 1);
    } else if (it.y - it.size > canvas.height) {
      items.splice(k, 1);
    }
  }

  // 画面外の敵を除去（下へ抜けたら）
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].y - enemies[i].size > canvas.height) enemies.splice(i, 1);
  }

  // パーティクル更新
  for (let p of particles) {
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

// 描画
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // プレイヤー（被弾時は横シェイク）
  let px = player.x;
  const t = performance.now();
  if (t < shakeUntil) {
    const k = (shakeUntil - t) / 160; // 減衰
    px += Math.sin(t * 80) * 3 * k; // 数px・高速
  }
  ctx.fillStyle = "lime";
  ctx.beginPath();
  ctx.arc(px, player.y, player.size, 0, Math.PI * 2);
  ctx.fill();

  // 弾
  ctx.fillStyle = "white";
  for (let b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敵
  for (let e of enemies) {
    // 本体
    ctx.fillStyle = e.boss ? "#3399ff" : (e.elite ? "#cc3333" : "red");
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
    ctx.fill();
    // HP数値（白文字／黒縁取り＋軽いブラー）
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "12px sans-serif";
    ctx.shadowColor = "black";
    ctx.shadowBlur = 3;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "black";
    ctx.fillStyle = "white";
    const hpText = `${e.hp}`;
    ctx.strokeText(hpText, e.x, e.y);
    ctx.fillText(hpText, e.x, e.y);
    ctx.restore();
  }

  // アイテム描画（ダミー記号：菱形）
  for (let it of items) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = it.type === "auto" ? "#99ccff" : "#bbee66";
    ctx.fillRect(-it.size / 2, -it.size / 2, it.size, it.size);
    ctx.restore();
  }

  // パーティクル描画（塗りあり/なし混在）
  for (let p of particles) {
    const alpha = p.faint
      ? Math.max(0, Math.min(1, p.life / 30))
      : Math.max(0, Math.min(1, p.life / 50));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = p.color;
    ctx.fillStyle = p.color;
    switch (p.shape) {
      case "square":
        if (p.fill) ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        else ctx.strokeRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        break;
      case "star":
        drawStar(p.x, p.y, p.size);
        if (p.fill) ctx.fill(); else ctx.stroke();
        break;
      default: // circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        if (p.fill) ctx.fill(); else ctx.stroke();
    }
    ctx.restore();
  }

  // HUD（ライフ表示＋攻撃力）
  ctx.fillStyle = "#ddd";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`LIFE: ${player.life}   ATK: ${attackPower}   AUTO: ${autoFire ? "ON" : "OFF"}`, 10, 22);

  // ボス撃破時の画面フラッシュ（白→黒フェード）
  if (flashStart) {
    const dt = t - flashStart;
    let alpha = 0;
    if (dt <= 50) {
      alpha = Math.min(1, dt / 50);
    } else if (dt <= 250) {
      alpha = Math.max(0, 1 - (dt - 50) / 200);
    }
    if (alpha > 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }
}

// メインループ
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// 入力検知
document.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  // デバッグ：7で攻撃力+10、6で攻撃力-10（下限0）
  if (e.key === "7") attackPower += 10;
  if (e.key === "6") attackPower = Math.max(0, attackPower - 10);

  // スペース押下瞬間に発射（オートリピート抑止）
  if (e.code === "Space") {
    spaceHeld = true;
    if (!shootLock) {
      shootLock = true;
      fireBullet();
    }
  }
});
document.addEventListener("keyup", (e) => {
  keys[e.key] = false;
  if (e.code === "Space") {
    shootLock = false;
    spaceHeld = false;
  }
});

// 敵を継続生成：0.5秒ごと
setInterval(spawnEnemy, 500);

// 実行
loop();
