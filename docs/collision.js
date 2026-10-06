/* Project Two — collision.js
 * 碰撞系统：**轴对齐矩形（AABB）**。
 *
 * 为什么用 AABB 而不是圆：
 *   本作的玩家/敌人/子弹**画出来就是方块**。若用圆做碰撞体，
 *   ① 方块的四角会超出圆 → "还没碰到就被拦住"，观感上碰撞框偏大；
 *   ② 圆贴矩形时角上必然留空隙（最多约 r·(√2−1) ≈ 5.8px）→ 贴墙贴不死。
 *   改用 AABB 后，**碰撞体与看到的方块完全一致**，两个问题同时消失。
 *
 * ⚠️ 坐标系：一律用**逻辑像素**（世界 = LOGICAL_W × LOGICAL_H = 1280×720）。
 *    只有渲染时才乘 PIXEL。单位换算**只允许有一处负责**。
 *
 * 术语：实体用 `half`（半边长）而不是 r，避免和"半径"混淆。
 */
'use strict';

/* 两个 AABB 是否相交 */
function aabbOverlap(a, b) {
    return Math.abs(a.x - b.x) < a.half + b.half &&
           Math.abs(a.y - b.y) < a.half + b.half;
}

/* 两个 AABB 的最小平移向量：返回把 a 推离 b 所需的位移 */
function aabbMTV(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    var ox = (a.half + b.half) - Math.abs(dx);
    var oy = (a.half + b.half) - Math.abs(dy);
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return { x: (dx < 0 ? -1 : 1) * ox, y: 0, pen: ox };
    return { x: 0, y: (dy < 0 ? -1 : 1) * oy, pen: oy };
}

/* AABB 与"障碍矩形"（x,y,w,h，可含边界墙）的最小平移向量。
 * 若实体完全在矩形内部，沿"最短的那条边"推出。 */
function aabbRectMTV(a, rect) {
    var ox = (a.half + rect.w / 2) - Math.abs(a.x - (rect.x + rect.w / 2));
    var oy = (a.half + rect.h / 2) - Math.abs(a.y - (rect.y + rect.h / 2));
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return { x: (a.x < rect.x + rect.w / 2 ? -1 : 1) * ox, y: 0, pen: ox };
    return { x: 0, y: (a.y < rect.y + rect.h / 2 ? -1 : 1) * oy, pen: oy };
}

/* ⭐⭐ **定长线段的 AABB**（`0.2.0` 加，为"激光"这个主动技能）。
 *
 * 激光是一道**长矩形**：从玩家出发、沿固定方向、长 `len`、宽 `2 * half`。
 * 它每帧要做两件事 —— 撞墙截断、命中范围内所有敌人。两者都需要
 * "这条线段占的 AABB 是多少"，所以抽成这个纯函数（**只算、不判碰撞**）。
 *
 * 返回值是 AABB 的 `{x, y, w, h}`（最小角 + 尺寸），**不是**中心 + half
 * —— 因为它是"线段扫过的一片区域"，用角点表达更自然，也方便直接
 * `strokeRect` / 与障碍矩形做比较。
 *
 * ⚠️ **宽度的定义**：垂直于方向的总宽度恒为 `2 * half`。
 *    水平/垂直方向上就是 `2 * half`（例：half=8 ⇒ 水平激光高 16px）；
 *    斜向时 `|cos|` 与 `|sin|` 都不为 0，AABB 会**自然变大**
 *    （45° 时约 `(len + 2h) * √2 / 2` 见方）—— 这是对的：
 *    斜着的长条在轴对齐包围盒里本来就更"胖"。
 *    ⇒ 所以**判定不能直接拿这个 AABB 去和敌人判重叠**（斜向会虚胖、
 *      打到一个"看着不在激光里"的敌人）。判定要走 `laserHits`。
 *
 * ⚠️ 单位是**逻辑像素**，与其余碰撞函数一致。 */
function laserAABB(x, y, angle, len, half) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var nx = x + c * len, ny = y + s * len;          // 远端
    /* 沿方向撑 `half`、沿垂线也撑 `half` ⇒ 覆盖整条带子 */
    var ex = Math.abs(c) * half + Math.abs(s) * half;
    var ey = Math.abs(s) * half + Math.abs(c) * half;
    var x0 = Math.min(x, nx) - ex, x1 = Math.max(x, nx) + ex;
    var y0 = Math.min(y, ny) - ey, y1 = Math.max(y, ny) + ey;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* 目标 AABB 是否**真的**被激光带子覆盖（不是只看包围盒）。
 *
 * 做法：把目标中心**投影到激光的坐标系** —— 沿方向的投影落在 `[0, len]`、
 * 垂直方向的投影绝对值 <= `half + target.half` ⇒ 命中。
 * ⚠️ 这是"OBB vs AABB"的**近似**（把目标当成方形、用它的 `half` 撑宽度），
 *    对角上会有极小的误差（最多 `half * (√2 - 1)` 量级），但对激光这种
 *    又长又细的东西完全够用，而且**不会出现"看着没打中却掉血"**的虚胖。
 * ⚠️ `target.half` 必须传**目标的**半边长（不是激光的）。 */
function laserHits(x, y, angle, len, half, target) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var dx = target.x - x, dy = target.y - y;
    var along = dx * c + dy * s;          // 沿激光方向的投影
    var perp = -dx * s + dy * c;          // 垂直方向的投影（带符号）
    var reach = half + target.half;
    return along >= -reach && along <= len + reach && Math.abs(perp) <= reach;
}

/* 量的"最坏重叠深度"（越大越糟）。用于判断一次移动是改善还是恶化。 */
function worstPenetration(c, obs) {
    var worst = 0, i, m;
    for (i = 0; i < obs.length; i++) {
        m = aabbRectMTV(c, obs[i]);
        if (m && m.pen > worst) worst = m.pen;
    }
    return worst;
}

/* 把一个实体从所有障碍里推出去（多轮：被 A 推出后可能落进 B） */
function separateFromRects(c, obs, bounce) {
    var any = false, round, i, m;
    for (round = 0; round < 4; round++) {
        var moved = false;
        for (i = 0; i < obs.length; i++) {
            m = aabbRectMTV(c, obs[i]);
            if (!m) continue;
            c.x += m.x;
            c.y += m.y;
            moved = true;
            if (bounce) {
                if (m.x !== 0 && c.vx * m.x < 0) c.vx = 0;
                if (m.y !== 0 && c.vy * m.y < 0) c.vy = 0;
            }
        }
        if (moved) any = true; else break;
    }
    /* 推到"刚好相切"后，用极小量保证浮点下判定为不相交
     * （0.01 逻辑像素 = 0.05 画布像素，肉眼不可见）。
     * ⚠️ 不要用 0.5 之类的缓冲：那会让实体永远停在离墙 0.5px 处，
     *    下一步压进去又被弹回 → **贴墙贴不紧**（实测踩过）。 */
    for (i = 0; i < obs.length; i++) {
        m = aabbRectMTV(c, obs[i]);
        if (m) { c.x += m.x * 1.001 + (m.x === 0 ? 0 : (m.x > 0 ? 0.01 : -0.01)); break; }
    }
    return any;
}

/* 带"接受检查"的位移 —— **分轴处理（先 X 后 Y）**。
 *
 * ⚠️⚠️ 这是被用户实测抓出来的关键设计，改动前务必读完。
 *
 * 【错误做法（曾经）】把 (dx, dy) **一起加上**再统一分离。
 *   后果：一个轴被挡住时，**另一个轴的分量也被一起吃掉**。
 *   实测场景（贴着"水平二连墙"上表面向左下移动）：
 *     每帧想走 (-2.97, +2.97) → 分离沿 Y 推回 2.97 → 实际位移 (-2.97, **0.00**)
 *     ⇒ 表现成"能向左滑，但永远沉不下去"，**走到两块的缝上就卡住**。
 *   根因：X 与 Y 耦合在同一次判定里，"撤回"也是整体的
 *         ⇒ 结果**依赖障碍的遍历顺序**（同样的几何，换顺序就卡住）。
 *
 * 【正确做法】先只移动 X、只在 X 上分离；再只移动 Y、只在 Y 上分离。
 *   "向下被墙挡住"只会取消 Y 分量，X 分量照常生效 ⇒ **天然的贴墙滑行**。
 *   副作用也是想要的：分轴后"只沿该轴推出"，两个相邻方块共享一条边时
 *   不会再互相把对方往回推（**顺序依赖消失**）。
 *
 * 每轴：移动 → 若碰撞，只沿该轴退到刚好相切（并清零该轴速度）。
 * 既不会穿过障碍，也不会把另一个轴的运动牵连进来。
 */
function moveWithCollision(c, dx, dy, obs) {
    /* 记下"本帧想走的位移"，供幽灵碰撞哨兵判断
     * "是正常的被墙挡住，还是位置合法却动不了"。 */
    c.intentDx = dx;
    c.intentDy = dy;

    /* ⚠️ **静止分离**：dx=dy=0 时也要把实体推出障碍。
     *    敌人就是这样用的（`moveWithCollision(E, 0, 0, obs)`）：
     *    它靠速度移动，移动后调用一次做分离。
     *    若这里直接返回，敌人被挤进墙里后就永远出不来
     *    （fuzz 实测报 enemyBad=1）。 */
    if (dx === 0 && dy === 0) {
        if (worstPenetration(c, obs) > 0) separateFromRects(c, obs, false);
        return true;
    }

    /* --- X 轴 --- */
    if (dx !== 0) {
        var ox = c.x;
        c.x = ox + dx;
        if (worstPenetration(c, obs) > 0) {
            /* ⚠️ **不要在这里先撤回！** moveAxis 需要"已经移动过去"的位置
             *    才能算出该沿哪个面停下。曾经写成"先撤回再调 moveAxis"，
             *    结果 moveAxis 在**没有重叠**的位置上找不到任何障碍 → 返回 false
             *    → 位移被静默丢弃 → 表现成"离墙 1.2px 就停住"（实测踩过）。 */
            if (!moveAxis(c, dx, 0, obs)) c.x = ox;
            else if (dx > 0) { if (c.vx > 0) c.vx = 0; } else { if (c.vx < 0) c.vx = 0; }
        }
    }

    /* --- Y 轴 --- */
    if (dy !== 0) {
        var oy = c.y;
        c.y = oy + dy;
        if (worstPenetration(c, obs) > 0) {
            /* 同上：必须在"已移动"的位置上算，不能先撤回 */
            if (!moveAxis(c, 0, dy, obs)) c.y = oy;
            else if (dy > 0) { if (c.vy > 0) c.vy = 0; } else { if (c.vy < 0) c.vy = 0; }
        }
    }
}

/* 只沿**一个轴**推到"刚好相切"的位置。返回是否真被挡住。
 *
 * 为什么需要它（而不是直接调 separateFromRects）：
 *   实体边长通常 14，而一帧位移只有 4.2。
 *   若交给"最小平移向量"决定推出量，它会选**重叠更小的那条轴**——
 *   而只要实体还嵌在方块里一点，那条"最小轴"往往不是我们正在走的这条，
 *   于是会被沿**侧面**推开（在同一个方块上反复推来推去）→ 卡住。
 *   所以这里改成：**只沿当前轴**推到刚好相切，绝不改动另一个轴。 */
var EPS = 0.001;      // 分离后的微余量：1/1000 逻辑像素 = 0.005 画布像素，肉眼绝不可见

function moveAxis(c, dx, dy, obs) {
    var idx = -1, extreme = 0, i, m;
    for (i = 0; i < obs.length; i++) {
        m = aabbRectMTV(c, obs[i]);
        if (!m) continue;
        if (idx < 0 || m.pen > extreme) { idx = i; extreme = m.pen; }   // 取嵌得最深的那个
    }
    if (idx < 0) return false;
    var o = obs[idx];
    var bx = c.x, by = c.y, origPen = extreme;
    if (dx > 0)      c.x = o.x - c.half - EPS;              // 向右靠近 ⇒ 停在左面外
    else if (dx < 0) c.x = o.x + o.w + c.half + EPS;        // 向左靠近 ⇒ 停在右面外
    else if (dy > 0) c.y = o.y - c.half - EPS;              // 向下靠近 ⇒ 停在上方外
    else             c.y = o.y + o.h + c.half + EPS;        // 向上靠近 ⇒ 停在下方外

    /* ⚠️ 贴到 A 的面之后，可能**正好落进紧邻的 B**（两块相邻时尤其容易）。
     *    所以必须校验：若贴完反而嵌得比原来更深，就放弃这次贴面（由调用方撤回位移）。
     *    （实测踩过：敌人被推出去后卡在相邻方块里，fuzz 报 enemyBad=1。） */
    if (worstPenetration(c, obs) > origPen + EPS) { c.x = bx; c.y = by; return false; }
    return true;
}

/* 兜底"脱离"：实体若已深陷（例如被外力挤进墙里），
 * 最小平移在相邻墙的缝里只会"左右互推"，永远出不来。
 * 这里改用**逐级加大的距离**朝"最后一次确认合法的位置"回拉。 */
var ESCAPE_STEPS = [4, 12, 28, 56, 120, 240];

function escapeIfInside(c, fallback, obs) {
    if (worstPenetration(c, obs) <= EPS) return false;
    var sx = c.x, sy = c.y, i, t;
    for (i = 0; i < ESCAPE_STEPS.length; i++) {
        t = ESCAPE_STEPS[i] / 240;
        c.x = sx + (fallback.x - sx) * t;
        c.y = sy + (fallback.y - sy) * t;
        if (worstPenetration(c, obs) <= EPS) {
            separateFromRects(c, obs, false);
            return true;
        }
    }
    c.x = fallback.x;
    c.y = fallback.y;
    return true;
}

/* 实体 ↔ 实体（AABB）分离。
 *
 * `passiveFirst` 的取法很重要（实测踩过）：
 *   · **各退一半**：敌人每帧又挤回来，会留下约 0.8px 的稳定残留 → 不好。
 *   · **只推被动方**：多个敌人同时挤压时会**层层叠加**，
 *     玩家被压进墙里/重叠飙到 17px（理论最大 29）→ fuzz 报 crush 超阈。
 *   · **正确做法**：把 a 完全推出去，同时**让 b 也让开一点点**
 *     （只让 b 承担"超过 BUFFER 的那部分"），这样不会叠加、也不会残留。
 *     于是"贴住 = 刚好相切 + BUFFER"，敌人不会一直往玩家身上叠。 */
var PAIR_BUFFER = 0.5;     // 实体之间保留的最小间隙（逻辑像素）

function pushApart(a, b) {
    var m = aabbMTV(a, b);
    if (!m) return false;
    /* a 推到"刚好相切 + 缓冲" */
    var push = m.pen + PAIR_BUFFER;
    var dirX = m.x !== 0 ? (m.x > 0 ? 1 : -1) : 0;
    var dirY = m.y !== 0 ? (m.y > 0 ? 1 : -1) : 0;
    a.x += dirX * push;
    a.y += dirY * push;
    /* b 反向让开"超缓冲的那部分"，避免多体叠加把 a 顶穿 */
    var share = m.pen > PAIR_BUFFER ? (m.pen - PAIR_BUFFER) * 0.5 : 0;
    if (share > 0) {
        b.x -= dirX * share;
        b.y -= dirY * share;
    }
    return true;
}

/* 注：实体↔子弹直接用 aabbOverlap，不再包一层别名（曾有 aabbHit，从未被调用已删）。 */
