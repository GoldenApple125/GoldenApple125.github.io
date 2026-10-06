/* Project Two — titlefx.js
 * 标题屏背景：**像素风星场**（全部画在 `#game` 这块 canvas 上）。
 *
 * 为什么是 canvas 而不是 DOM/CSS：
 *   ① 关卡画面本来就画在这块 canvas 上，标题屏复用它 = 观感是同一种
 *      （`image-rendering: pixelated` + 逻辑像素 1280×720 + `snap()` 网格取整）
 *   ② 视差、闪烁、流星这类"每帧随鼠标变"的东西，用 DOM 元素做要靠 CSS 动画 + JS 改
 *      transform 混着来；在 canvas 里就是一个函数、可预测、也不产生/销毁节点
 *   ③ 之前那版 DOM + CSS 关键帧的光柱方向就是错的 —— 见 CHANGELOG 的记载
 *
 * 三层视差（远 → 近）：层越近，格子越大、颜色越亮、跟鼠标偏移越多。
 * 每层各自用**固定格**撒星（一格至多一颗），于是随镜头移动时不会挤成一团；
 * 格子横向多留 8 个（逻辑像素）余量，移动时从边缘补进来。
 *
 * ⚠️ 这里用 `Math.random()` 是**故意的**：它只影响观感，不影响任何判定，
 *    也没有测试依赖它的序列（项目里要求"自检确定性"的是**玩法与刷怪**）。
 */
'use strict';

var TitleFx = {
    ready: false,
    seed: 1,                       // 每次进标题屏换一颗种子 → 星图不重复
    stars: [[], [], []],           // 三层
    /** 每层参数：远处小而暗、近处大而亮（漂移速度按层递增，深度感来自这里）
     *  ⭐⭐ `0.3.0` 像素化：**星块尺寸必须是 `PIXEL`(2) 的整数倍**（偶数）。
     *     远/中两层原来都是 5（奇数 ✗）⇒ 放大后带半像素糊边。
     *     用户 2026-10-02 定："**远的改 4，中的改 6**"（近处那层本来就是 10 ✔）。 */
    layers: [
        { cell: 40, size: 4, inset: 3, color: PAL.titleFar, count: 0 },
        { cell: 64, size: 6, inset: 7, color: PAL.titleMid, count: 0 },
        { cell: 96, size: 10, inset: 15, color: PAL.titleNear, count: 0 }
    ],
    /* ⚠️ 星场**只有横向漂移这一种运动**。
     *    以前还有"鼠标视差"（鼠标位置给一个偏移），和漂移加在同一通道上、
     *    方向还相反 → 互相抵消，看着像在抖。用户要求二选一 ⇒ **删视差、留漂移**
     *    （漂移是持续在动的那个，删了背景就完全静止了）。
     *    深度感靠三层速度比 1:2:3，与鼠标无关。 */
    driftSpeed: 0.18,              // 漂移速度（逻辑像素/帧）
    /* 最亮的那些用**界面主题色**点缀（`PAL.accent`，金黄），像"会发光的星"。
     * ⚠️ 这里**不能**用 `PAL.player` —— 那是**主角本体的颜色**（用户 2026-10-02 把主角改成蓝色后，
     *    标题屏出现"蓝色星星"✗）；标题屏属于**界面**，该跟主题色走。 */
    accent: PAL.accent,
    /* 按颜色分批画的桶：`buckets[i]` 是一串 [x, y, size, x, y, size, ...]
     * ⚠️ 每帧只 `length = 0` 复用，**不要**每帧新建数组（那等于每帧给 GC 塞垃圾）。 */
    buckets: [[], [], [], [], [], []],
    bucketColor: [PAL.titleFar, PAL.titleMid, PAL.titleNear, '#8a7a1e', PAL.accent, '#2b313b'],
    shoot: null,                   // 流星（同一时刻至多一颗）
    shootCd: 240,                  // 下一次流星的倒计时（帧）
    drift: 0,                      // 星星整体横向位置（逻辑像素）——**唯一的横向运动来源**
    t: 0,                          // 帧计数（闪烁用）

    /* 小整数伪随机：保证同一颗种子生成同一片星图（重进标题屏不闪变） */
    rnd: function () {
        TitleFx.seed = (TitleFx.seed * 1103515245 + 12345) & 0x7fffffff;
        return TitleFx.seed / 0x7fffffff;
    },

    /* 生成三层星。**只在进标题屏时调一次**（不是每帧）。
     * ⚠️ 必须清空重铺：不然反复进出标题屏会越堆越多（这是本项目踩过的老坑，
     *    见 ui.js 的 buildLevelList 说明）。 */
    build: function () {
        var L = TitleFx.layers, x, y;
        TitleFx.stars = [[], [], []];
        /* ⚠️ 密度实测过：按 0.42 撒点会得到 **579 颗** —— 太密，像"星汤"而不是背景。
         *    改成下面这组，并让**越近的层越稀疏**（近处星大，密了就吵）。 */
        var density = [0.26, 0.20, 0.13];
        for (var li = 0; li < L.length; li++) {
            var cfg = L[li], arr = TitleFx.stars[li];
            var cols = Math.floor(LOGICAL_W / cfg.cell) + 8;
            var rows = Math.floor(LOGICAL_H / cfg.cell) + 2;
            for (var cx = 0; cx < cols; cx++) {
                for (var cy = 0; cy < rows; cy++) {
                    if (TitleFx.rnd() > density[li]) continue;       // 空格子：星是撒的，不是网格
                    x = cx * cfg.cell - 8 * cfg.cell + TitleFx.rnd() * (cfg.cell - cfg.inset);
                    y = cy * cfg.cell - cfg.cell + TitleFx.rnd() * (cfg.cell - cfg.inset);
                    arr.push({
                        x: x, y: y, off: cfg.cell - cfg.inset,
                        w: cfg.cell + cfg.cell,
                        /* 每颗自己的闪烁相位；`slow` 的那批不闪（否则整屏一起眨眼很吵） */
                        phase: Math.floor(TitleFx.rnd() * 90),
                        slow: TitleFx.rnd() < 0.55,
                        accent: TitleFx.rnd() < 0.06
                    });
                }
            }
            cfg.count = arr.length;
        }
        TitleFx.ready = true;
    },

    /* 每帧画一次。⚠️ 由 `render()` 在标题屏时调用（见 game.js）。 */
    render: function () {
        if (!TitleFx.ready) TitleFx.build();
        TitleFx.t++;

        /* ① 底：**纯色**（`0.3.0` 画风统一）。
         *
         * ⚠️⚠️ 这里原来是**竖直线性渐变**（`createLinearGradient(0,0,0,720)`，
         *    `#12141a → #181c22`，两色差只有 +6/+8/+8、摊在 720 行上 ⇒ 平均**每 90 行才变 1 级**）。
         *    用户 2026-10-02 问："**你是指标题界面背景有渐变色？我都没看出来**" —— 确实看不出来，
         *    但它仍是**全项目最后一处"平滑"绘制**（像素风里不该有连续过渡）。
         *    ⚠️ 用户看不出 ⇒ 换成硬色带反而会出现两条**看得见**的横线（更糟）⇒ 直接改**纯色**。
         * ⭐ 用的就是 `PAL.bg` —— **与关卡内同一个底色** ⇒ 标题屏和关卡内"同一个世界"，
         *    这也正是当初那条格线想表达的意思（那条已按用户要求删除）。 */
        ctx.fillStyle = PAL.bg;
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

        /* ⭐⭐ **② 原来的"稀疏像素网格"已删除**（`0.3.0` 像素化，用户 2026-10-02："网格线删了"）。
         * 与关卡内那条同因：`lineWidth = 1` 是**奇数粗线** + `+0.5` 半像素偏移，
         * 与"每个部件自身尺寸都是美术像素的整数倍"冲突；而改成 2px 会明显变粗。
         * ⚠️ 它与关卡内格线本来是**互相呼应**的一对（"标题屏也算同一个世界"）⇒ 一起删，
         *    标题屏现在是纯渐变夜空 + 星场。 */

        /* ③ 三层星
         * ⚠️ **按颜色分批画**：若每颗都改一次 `fillStyle`，一颗星就是一次状态切换 ——
         *    几百颗 × 60 帧会白烧不少时间。这里先把位置按颜色分桶，再一桶一桶画：
         *    状态切换从"每颗一次"降到"每桶一次"（约 10 次/帧）。
         * ⚠️ 桶必须**每帧清空**（`bucket.length = 0`），不是重建数组。 */
        /* ⚠️ 横向漂移是星场**唯一的运动来源**。
         *    以前这里还有"鼠标视差"（鼠标位置直接给一个横向/纵向偏移），
         *    和漂移加在同一个通道上、方向还相反 → 互相抵消，看着像在抖。
         *    用户要求二选一 ⇒ **删掉视差，只留漂移**（漂移是持续在动的那个，
         *    删了背景就静止了）。三层速度 1:2:3 就是深度感，不靠鼠标。
         *    ⚠️ 于是 `mouseX` / `mouseY` / 各层的 `mouse` 参数全项目都不再需要了。 */
        TitleFx.drift += TitleFx.driftSpeed;
        if (TitleFx.drift > 10000) TitleFx.drift -= 10000;
        var L = TitleFx.layers, bk = TitleFx.buckets;
        for (var bi = 0; bi < bk.length; bi++) bk[bi].length = 0;
        for (var li = 0; li < L.length; li++) {
            var cfg = L[li], arr = TitleFx.stars[li];
            for (var k = 0; k < arr.length; k++) {
                var s = arr[k];
                var sx = s.x + TitleFx.drift * (li + 1) * 0.5;   // 横向：唯一的运动来源
                /* 环绕：漂出右边就绕回左边（只有横向环绕，纵向保持构图） */
                sx = ((sx % (LOGICAL_W + s.w)) + (LOGICAL_W + s.w)) % (LOGICAL_W + s.w) - s.w;
                var sy = s.y;
                if (sx < -s.w || sx > LOGICAL_W + s.w || sy < -s.w || sy > LOGICAL_H + s.w) continue;
                /* 闪烁：亮/暗两态按相位切换（像素风不搞透明度渐变，改用"跳"） */
                var on = s.slow || ((TitleFx.t + s.phase) % 96) < 78;
                /* 颜色分档：0 远暗 1 中灰 2 近亮 3 强调(灭) 4 强调(亮) */
                var slot = s.accent ? (on ? 4 : 3) : (on ? (li === 2 ? 2 : (li === 1 ? 1 : 0)) : 5);
                bk[slot].push(snap(sx), snap(sy), cfg.size);
            }
        }
        for (var ci = 0; ci < TitleFx.bucketColor.length; ci++) {
            var one = bk[ci];
            if (!one.length) continue;
            ctx.fillStyle = TitleFx.bucketColor[ci];
            for (var q2 = 0; q2 < one.length; q2 += 3) {
                /* ⚠️ 必须 `snap()` 到像素网格：否则小方块会糊成灰点（项目老规矩） */
                ctx.fillRect(one[q2], one[q2 + 1], one[q2 + 2], one[q2 + 2]);
            }
        }

        /* ④ 流星：偶尔来一颗（同一时刻至多一颗，避免满屏乱窜）
         * ⚠️⚠️ **只在"整条尾巴都出屏"之后才回收**（用户要求：高速移动的流星要飞出去再消失）。
         *    以前还有一个 `life > max`（150 帧 ≈ 2.5 秒）的兜底 —— 那会让流星在**半路**被掐掉，
         *    高速移动时看起来就是"飞到一半凭空没了"。已去掉：现在唯一的回收条件是**出屏**。
         *    出屏判定留 80 的余量，且要连**尾迹**一起算进去
         *    （尾迹沿 -vx/-vy 方向拉出 `len × 1.4` 的距离，所以尾巴比头部落后得多）。 */
        TitleFx.shootCd--;
        if (!TitleFx.shoot && TitleFx.shootCd <= 0) {
            var dir = Math.random() < 0.5 ? 1 : -1;                 // 左→右 或 右→左
            TitleFx.shoot = {
                x: dir > 0 ? -40 : LOGICAL_W + 40,
                y: 40 + Math.random() * (LOGICAL_H * 0.45),
                vx: dir * (7 + Math.random() * 4),
                vy: 1.6 + Math.random() * 1.4,
                len: 9,
                dir: dir
            };
        }
        if (TitleFx.shoot) {
            var sh = TitleFx.shoot;
            sh.x += sh.vx; sh.y += sh.vy;
            /* 尾迹：一串递减的小方块，越长越淡（用颜色分档，不用 alpha） */
            var tail = [PAL.accent, '#c9ae0c', '#8a7a1e', '#54502c', '#33352c'];
            for (var q = 0; q < sh.len; q++) {
                ctx.fillStyle = tail[Math.min(tail.length - 1, Math.floor(q / 2))];
                ctx.fillRect(snap(sh.x - sh.vx * q * 1.4), snap(sh.y - sh.vy * q * 1.4), 6, 6);
            }
            /* 尾巴最末端的位置：整条尾巴都出屏了才算"飞出去了" */
            var tailX = sh.x - sh.vx * sh.len * 1.4;
            var tailY = sh.y - sh.vy * sh.len * 1.4;
            var margin = 60;
            var gone = (sh.dir > 0)
                ? (tailX > LOGICAL_W + margin)          // 向右飞：尾巴也出了右边
                : (tailX < -margin);                   // 向左飞：尾巴也出了左边
            /* 纵向兜底（斜向下飞的，整体出下边也算出屏） */
            if (tailY > LOGICAL_H + margin) gone = true;
            if (gone) {
                TitleFx.shoot = null;
                TitleFx.shootCd = 300 + Math.floor(Math.random() * 420);   // 5~12 秒后再来
            }
        }
    },

    /* 进标题屏时调：换种子重铺星图，并复位鼠标视差 */
    reset: function () {
        TitleFx.seed = (Date.now() % 100000) + 7;
        TitleFx.ready = false;
        TitleFx.shoot = null;
        TitleFx.shootCd = 180;
        TitleFx.drift = 0;
            TitleFx.build();
    }
};
