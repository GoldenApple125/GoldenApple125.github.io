/* ============ 渲染 ============
 * 从 game.js 拆出来（`0.2.0`，在加 BOSS 之前先拆 —— 见 HANDOFF 里
 * "game.js 超过 1000 行，考虑再拆"那条提示）。
 *
 * ⚠️ 本文件是**纯绘制**：不持有任何状态，只读 `Game` / `Save` / `Input` 与各种常量。
 *    所以拆出去不产生新耦合 —— 唯一的约定是**加载顺序**（见 index.html）：
 *      collision -> core -> level -> titlefx -> hud -> ui -> **render -> game**
 *    ⚠️ 但两边都是**函数声明**（会提升），所以只要都赶在 `start()` 之前加载就安全；
 *       render 放在 game 前面只是为了读起来顺。
 *
 * 内容：`snap()`（绘制取整）、`render()`、`drawCollisionDebug()`。
 * ⚠️ `snap()` 同时被 `titlefx.js` 用到，所以**不能**只留在 game.js 里 ——
 *    它是"整个绘制层的取整规则"，跟着渲染走。
 */

/* 绘制取整：把坐标吸到 `ART` 的倍数上（`ART` 的定义与理由见 core.js）。
 * ⚠️ 以前这里按 `PIXEL` 取整 —— 缩格子后 `PIXEL` 变成了 2，两者必须**解耦**：
 *    `PIXEL` 只管 `TILE` 的换算，绘制取整一律走 `ART`，
 *    否则"改格子大小"会连带把实体的像素颗粒度也改掉。
 *
 * ⚠️⚠️ **取整单位永远是逻辑像素**（`ART`），不要动 ——
 *    `0.2.0` 期间的三次画布实验（低分辨率 / 背板跟视口 / 渲染倍率）里，
 *    我一度把它改成"1 个画布像素"，结果实体坐标变成 `639.2` 这种**非整数逻辑坐标**
 *    ⇒ 方块边缘落在半个逻辑像素上、**四周多出一圈极细的杂边**
 *    （用户实测原话："主角和敌人周围都有一圈极细的像素，其他地方也类似"）。
 *    ⚠️ 那三次实验**已全部回退并删除**，这里恢复原样。 */
function snap(v) { return Math.round(v / ART) * ART; }

/* ⭐⭐ **血条厚度**（逻辑像素，`0.3.0` 像素化）。
 *
 * ⚠️ 必须是 `PIXEL`(2) 的整数倍 ⇒ **偶数**：厚度 5 是奇数 ⇒ 一条"半格高"的条，
 *    放大到屏幕上会带一条半像素糊边。用户 2026-10-02 定的：
 *    "**敌人血条高度指其厚度的话从 5 改成 4**"。
 * ⚠️ 厚度**与血量比例无关**（宽度才是 `full × ratio`）⇒ 改它不动任何数值。
 * ⚠️⚠️ 定义在**模块顶部**，不能写在 `drawBar` 附近 —— `drawBar` 是挂在 `render()`
 *    里的嵌套函数，常量写在那个位置会**在它身后**（`var` 提升 ⇒ 调用时是 `undefined`，
 *    实测血条直接画成 `56×undefined`）。 */
var BAR_H = 4;
/* 把 `#rrggbb` 按系数 `k`（0~1）**压暗**，返回同色相的暗色（`0.2.0`，给激光淡出用）。
 *
 * ⚠️ **为什么不直接用 `ctx.globalAlpha`**：半透明叠在深色背景上会**偏灰**
 *    （不是"变暗的橙"），而乘分量得到的是同一色相的暗色 —— 更像"能量在衰减"。
 *    另外 `globalAlpha` 忘了复位会**连累后面所有绘制**，而颜色是每帧现设的、没这个风险。
 * ⚠️ `k` 会夹到 `[0, 1]`；`k = 0` 时返回 `#000000`（纯黑）。
 *    ⚠️ 但**实际不会靠它来"消失"** —— 帧数归零时 `update` 已经把 `P.laser` 置 `null`、
 *      渲染那一段整个跳过。`k = 0` 只是"最后一帧正好全黑"的数学保证。
 * ⚠️ 只认 `#rrggbb` 这一种写法（本项目所有颜色常量都是它，包括 `E.color`）。 */
/* ⭐⭐ **素材绘制的安全入口**（`0.3.0` 像素化）。
 *
 * 为什么不让调用点直接写 `Sprites.draw(...)`：**测试桩的加载清单里不一定有 `sprites.js`**
 *   （20 个套件各自维护一份文件列表）⇒ 直接调会 `ReferenceError`，整套渲染断言全废。
 *   ⇒ 在这里判一次：没有素材层就**退回纯色方块**，而两种路径的**取整与尺寸完全一致**
 *     （都是"snap 中心 ± size/2"）⇒ 那批"方块 = 框 / 四边整数 / 尺寸恒定"的断言
 *     在浏览器（有素材）与测试（没素材）里都成立。
 * ⚠️ `fallback` 必须是**调用点自己的颜色**（敌人用 `E.color`、玩家用 `PAL.player`），
 *    别在这里写死一种色 —— 那就把"每种敌人一个颜色"这条给抹了。 */
function drawSprite(ctx, id, cx, cy, size, fallback) {
    if (typeof Sprites !== 'undefined') return Sprites.draw(ctx, id, cx, cy, size);
    var s = Math.max(1, Math.round(size));
    ctx.fillStyle = fallback;
    ctx.fillRect(snap(cx - s / 2), snap(cy - s / 2), s, s);
    return false;
}

/* ⭐ **冻结期的"换色"覆盖层**（`0.2.1` 的视觉效果，`0.3.0` 起改成"素材 + 覆盖"）。
 * ⚠️ 有素材层时用**半透明覆盖**（素材是每种敌人一张图，不该为冻结再多存一张）；
 *    没有素材层（测试桩）时**退化成整块冰蓝** —— 那个"冻住了"的信号不能丢。
 * ⚠️ `fallback` 只是"没素材时用哪种底色"，有素材时它不参与。 */
/* ⭐ **子弹用哪张素材**（普通 / 大），带兜底。
 *
 * ⚠️⚠️ 为什么要有这个包装：`Sprites` 可能没加载（测试桩的加载清单里不一定有它）。
 *   `drawSprite(ctx, Sprites.bulletId(…), …)` 这种写法**在实参位置上就会 `ReferenceError`**
 *   —— 函数体里的 `typeof` 兜底根本来不及生效。⇒ 取 id 这一步也得包进来。
 *   ⚠️ 返回 `null` 没关系：`drawSprite` 会走"没素材"那条路，用传进来的颜色画方块。
 * `sizeMul` = 这颗子弹的尺寸倍率（`half ÷ 基础半宽`）⇒ `>= 2` 就是大子弹。 */
function bulletSpriteId(mine, sizeMul) {
    if (typeof Sprites === 'undefined') return null;
    return Sprites.bulletId(mine, sizeMul);
}

function tintSprite(ctx, cx, cy, size, fallback) {
    if (typeof Sprites !== 'undefined') return Sprites.tint(ctx, cx, cy, size, PAL.freeze, 0.6);
    var s = Math.max(1, Math.round(size));
    ctx.fillStyle = PAL.freeze;
    ctx.fillRect(snap(cx - s / 2), snap(cy - s / 2), s, s);
    return false;
}

function dimHex(hex, k) {
    var f = Math.max(0, Math.min(1, k));
    var n = parseInt(hex.slice(1), 16);
    var r = Math.round(((n >> 16) & 255) * f);
    var g = Math.round(((n >> 8) & 255) * f);
    var b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/* 激光淡出的**不透明度** `a ∈ (0, 1]`（`0.2.0`，给 render 用，同时也是**可单测的纯函数**）。
 *
 * 规则：**最后 `LASER.fadeFrames` 帧**线性变透明，其余时间恒为 1（完全不透明）。
 *   · `frames >  fadeFrames` ⇒ 1（不淡）
 *   · `frames <= fadeFrames` ⇒ `frames / fadeFrames`（线性）
 *   · `frames === 0`         ⇒ 0（**完全透明** —— 而那一刻 `update` 已经把它置 `null` 了）
 *
 * ⚠️ 返回值直接喂给 `ctx.globalAlpha`（**不是**颜色系数）。
 *    第一版返回的是"压暗系数"、乘在颜色分量上（观感 = 能量衰减）；
 *    用户看过之后要求**改成透明**（观感 = 光束淡化消散）⇒ 现在返回不透明度。
 *    ⚠️ 数值曲线**一模一样**，变的是**它被用在哪** —— 所以这个函数本身没动，
 *      只有 `render` 里那一行从 `dimHex(color, k)` 变成 `ctx.globalAlpha = a`。
 *
 * ⚠️⚠️ 边界必须是 `>` 不能是 `>=`。写 `>=` 时 `frames === 窗口` 会让 `a` 恰好等于 1
 *    ⇒ **实际只有 `窗口 - 1` 帧真的在变淡**，与承诺的帧数差一格
 *    （实测：`a(6)=1.00, a(5)=0.83, a(4)=0.67, …` ⇒ 只有 5 帧在淡）。
 *
 * ⚠️⚠️ **窗口是 `fadeFrames + 1`**（`0.2.0` 修，用户报过"消失得比设置的帧数快"）。
 *    为什么：倒计时降到 **1** 那一帧**必须 `alpha > 0`**（那是光束的最后一帧，
 *    还得看得见）；而 `1 / fadeFrames = 1/6 ≈ 0.17` 时"淡出"只剩 6/20 的行程、
 *    且再降一格就是 `0`（画了却全透明）⇒ **看起来比实际早没一帧**。
 *    ⇒ 窗口取 `fadeFrames + 1 = 7`：倒计时 `20..1` 映射到 `20/7 … 1/7`
 *      ⇒ **末帧 alpha ≈ 0.14（看得见）**、满亮 14 帧、淡出 6 帧。
 *    ⚠️ 对照：`frameCount = 20` 时 满亮 = `20 - (7-1) = 14` 帧、淡出 = 7 帧里最后 6 帧
 *      （第 7 格 `7/7 = 1` 还算满亮）—— 与 `fadeFrames = 6` 的承诺一致。
 *
 * ⚠️ 这就是"**彻底消失时对应帧数结束**"的实现：变淡是线性的、终点正好落在最后一帧。
 * ⚠️ 它是**纯函数**（只读传入的帧数），所以测试可以直接喂 0/1/6/20 这些值来验边界。 */
function laserFade(frames) {
    if (!(frames > 0)) return 0;
    if (frames > LASER.fadeFrames + 1) return 1;
    return frames / (LASER.fadeFrames + 1);
}

/* ============ 倾斜矩形的像素化（0.2.0）============
 *
 * ⭐ **为什么要自己栅格化**。用户原话："我知道画布分辨率有限，但还是尽量想个办法让斜的激光不糊"：
 * 原来是把旋转过的矩形交给 `ctx.fillRect`（先 `rotate` 再填）——
 * canvas 对**斜边**做**抗锯齿**：边缘像素按覆盖率混色 ⇒ 斜着打时整条边都是半透明过渡色。
 * ⚠️ 这与画布分辨率**无关**（画布内部就是 1280×720、`ART = 1`）：是旋转绘制本身带来的。
 *    轴对齐（0°/90°）完全不糊，正好印证这一点。
 * ⇒ 改成逐扫描线求区间、每行/列画一个**坐标全整数**的 `fillRect` ⇒ **零抗锯齿**。
 *
 * ⭐⭐ **为什么拆成两个函数**（我在这里连续写错好几版之后才改的）：
 *    · `rotSpans()` —— **纯函数**：只推导"该画哪些条"，返回数组，不碰 `ctx`。
 *    · `fillRotRect()` —— 把条合并成更高的矩形再画。
 *    ⚠️ 合并会让"一条覆盖到哪"变得**从输出上看不出来**（`a0` 单独看只是起点），
 *      于是测试没法直接验、我因此绕了好几轮。
 *      拆开之后测试直接调 `rotSpans()` 验几何，不用反推合并结果。
 *
 * ⚠️⚠️ **四个把我绊倒过的点**（都留在这里，别再犯）：
 *  1. **不要混用绝对坐标和"相对原点"的量**。第一版把原点先代成常数再用它解另一维
 *     （重复代入）；第二版写成 `a·v + b·k`，可 `k` 是绝对坐标、约束却是相对原点的，
 *     少了 `b·原点` 那一项。
 *  2. **`solve` 的第一个参数必须是"被求变量"的系数**。我第二次把"沿方向"那条传成了
 *     另一维的系数 ⇒ 它被判成"与该变量无关"而**整条丢掉** ⇒ 无论 `len` 多大，
 *     画出来都只是 `2·half` 宽的一个方块。**症状极难发现**（45° 时"碰巧"看着正常）。
 *  3. **扫描范围要用精确 AABB**。用 `|s|·half + |c|·len` 这种凑的界，轴对齐时那两个
 *     系数正好把另一项归零 ⇒ 扫不到整条光束。
 *  4. **画的时候"哪一维是区间"别弄反**。竖直为主 ⇒ 条是横向的
 *     `fillRect(x_lo, y, 宽, 高)`；水平为主 ⇒ 条是纵向的 `fillRect(x, y_lo, 宽, 高)`。
 *
 * ⚠️ 取整规则：**只画完全落在矩形内的像素**（起点 `ceil`、终点 `floor`）。
 *    代价是边缘最多各让掉 1px（宽 16 → 15），换来**完全不含半透明像素**。
 *    `EPS` 不能省：`cos/sin` 在 0°/90° 会算出 `6.1e-17` 这类值。
 */

/* 推导"要画哪些条"。返回 `{ vertical, spans }`，每条是 `{ a0, a1, lo, hi }`：
 *   · `vertical` 为真：`a0..a1` 是**行号 y** 的连续区间，`lo..hi` 是 **x 区间**
 *   · `vertical` 为假：`a0..a1` 是**列号 x** 的连续区间，`lo..hi` 是 **y 区间**
 * ⚠️ 等宽的相邻条**在这里已经合并**（`a0..a1` 就是真实的连续范围）。
 * ⚠️ 纯函数：只读参数、只写返回值，不碰 `ctx`。 */
function rotSpans(x, y, angle, len, half) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var p = -s, q = c;                       /* N = (-s, c) */
    var EPS = 1e-6;
    var INSET = 0;         /* 0 = 保留贴边像素（见 solveIn 的说明）；0.5 = 两侧内缩 */
    var out = [], vertical = Math.abs(s) >= Math.abs(c);
    var k, k0, k1, lo, hi, cur = null, A, B, L, H;

    /* 每条约束写成 `a·v + b·(k - 原点分量) ∈ [lo2, hi2]`。
     * ⚠️ 括号里是**差**（`k - y` 这样传进来），绝不是"已经代过原点的常数"。
     * `a ≈ 0` ⇒ 该约束与 v 无关：成立返回 null（无约束），不成立返回 false。 */
    function solve(a, b, d, lo2, hi2) {
        if (Math.abs(a) < 1e-12) return (b * d >= lo2 - EPS && b * d <= hi2 + EPS) ? null : false;
        var r0 = (lo2 - b * d) / a, r1 = (hi2 - b * d) / a;
        return a > 0 ? [r0, r1] : [r1, r0];
    }
    /* ⚠️⚠️ **贴边像素：留还是让？最后选了「留」**（`INSET = 0`）。
     *    闭区间 `|perp| <= half` 会把"**恰好贴边**"那一行/列也判进来 ——
     *    它与矩形**只相切于一条线、面重叠是 0**（实测 0° 时多出 `y = 368` 一整行）。
     *    ⚠️ 试过两侧各内缩 0.5（把 `INSET` 设成 0.5 即可），结果光束宽度**掉到 15**，
     *      而 `halfWidth: 8` 的设计意图是 **16** ⇒ 光束明显变细，不划算；
     *      内缩还让覆盖率掉到 ~94%。
     *    ⇒ **保留闭区间**：宽度对（16），而那些贴边像素**仍然是纯色**
     *      （全整数坐标 ⇒ 不存在半透明混色），只是"多画了正好贴边的一圈"。
     *      **零抗锯齿这个核心目标仍然达成**（实测 45° 覆盖率 99.9%）。
     *    ⚠️ 想改成内缩：`INSET = 0.5`，并接受宽度变成 `2·half - 1`。
     * ⚠️ 沿方向那条**始终是闭区间**（起点那一格 `along = 0` 必须包含，否则源头缺一格）。 */
    function solveIn(a, b, d, lo2, hi2) {
        return solve(a, b, d, lo2 + INSET, hi2 - INSET);
    }
    function join(u, v) {                    /* 两个区间求交；null = 无约束 */
        if (!u) return v; if (!v) return u;
        return [Math.max(u[0], v[0]), Math.min(u[1], v[1])];
    }

    if (vertical) {
        /* 逐行（行号 y = k），求 x 区间。
         * 沿方向：`c·(xx-x) + s·(k-y) ∈ [0, len]`  ⇒ xx 的系数是 **c**
         * 垂直  ：`-s·(xx-x) + c·(k-y) ∈ [-half, half]` ⇒ xx 的系数是 **p = -s** */
        /* ⚠️⚠️ **扫描范围的两端要"各让半格"**（下界 `ceil`、上界 `floor`），
         *    不能用 `round(y ± half)` —— 那是"含两端"，会**多画一行**：
         *    实测 0° 时光束高 **17** 而 `halfWidth: 8` 的设计意图是 **16**。
         *    ⚠️ 被多带出来的那些行正是"与矩形只相切、面重叠为 0"的像素。
         *    ⇒ 这里先用几何算出 ±half 的极限偏移，再 `ceil`/`floor` 各收半格。 */
        var ey = half * (Math.abs(s) + Math.abs(c));   /* 极端情况下的 y 偏移上界（两个角取最大） */
        k0 = Math.ceil(Math.min(y, y + s * len) - ey - 0.5);
        k1 = Math.floor(Math.max(y, y + s * len) + ey - 0.5);
        for (k = k0; k <= k1; k++) {
            A = solve(c, s, k - y, 0, len);       if (A === false) continue;
            B = solveIn(p, q, k - y, -half, half); if (B === false) continue;
            var I = join(A, B);
            lo = Math.ceil(I[0] - 0.5); hi = Math.floor(I[1] - 0.5);   /* 中心约定 */
            if (hi < lo) continue;
            if (cur && k === cur.a1 + 1 && lo === cur.lo && hi === cur.hi) { cur.a1 = k; continue; }
            if (cur) out.push(cur);
            cur = { a0: k, a1: k, lo: lo, hi: hi };
        }
    } else {
        /* 逐列（列号 x = k），求 y 区间。
         * 沿方向：`c·(k-x) + s·(yy-y) ∈ [0, len]`  ⇒ yy 的系数是 **s**
         * 垂直  ：`-s·(k-x) + c·(yy-y) ∈ [-half, half]` ⇒ yy 的系数是 **q = c** */
        var ex = half * (Math.abs(c) + Math.abs(s));   /* 同上：x 偏移的上界 */
        k0 = Math.ceil(Math.min(x, x + c * len) - ex - 0.5);
        k1 = Math.floor(Math.max(x, x + c * len) + ex - 0.5);
        for (k = k0; k <= k1; k++) {
            A = solve(s, c, k - x, 0, len);       if (A === false) continue;
            B = solveIn(q, p, k - x, -half, half); if (B === false) continue;
            var J = join(A, B);
            lo = Math.ceil(J[0] - 0.5); hi = Math.floor(J[1] - 0.5);   /* 中心约定 */
            if (hi < lo) continue;
            if (cur && k === cur.a1 + 1 && lo === cur.lo && hi === cur.hi) { cur.a1 = k; continue; }
            if (cur) out.push(cur);
            cur = { a0: k, a1: k, lo: lo, hi: hi };
        }
    }
    if (cur) out.push(cur);
    return { vertical: vertical, spans: out };
}

/* 把 `rotSpans()` 的结果画出来（每一条一个 `fillRect`，坐标全整数）。
 *
 * ⚠️⚠️ **`lo/hi` 要加回原点，`a0/a1` 不要**：
 *    · `a0..a1` 是**绝对**的扫描坐标（`k` 本身就是绝对行号/列号）
 *    · `lo..hi` 是**相对原点**的偏移（因为约束是拿 `k - y` 这类**差**算出来的）
 *    ⇒ 画的时候 `lo/hi` 必须 `+ x` / `+ y`。
 *    ⚠️ 忘了加就会画到画面外面去（实测发出过 `fillRect(640, -8, 201, 17)`）。
 * ⚠️⚠️ **哪一段对应 x、哪一段对应 y 别弄反**（第 4 个坑）：
 *    竖直为主 ⇒ 扫描轴是 y、`lo..hi` 是 x；水平为主 ⇒ 扫描轴是 x、`lo..hi` 是 y。 */
function fillRotRect(x, y, angle, len, half) {
    var r = rotSpans(x, y, angle, len, half), i, sp;
    for (i = 0; i < r.spans.length; i++) {
        sp = r.spans[i];
        if (r.vertical) {
            ctx.fillRect(x + sp.lo, sp.a0, sp.hi - sp.lo + 1, sp.a1 - sp.a0 + 1);
        } else {
            ctx.fillRect(sp.a0, y + sp.lo, sp.a1 - sp.a0 + 1, sp.hi - sp.lo + 1);
        }
    }
}

/* ══════════ 以下是"每关不变的东西"的绘制（`0.3.0`）══════════
 * ⚠️⚠️ 这几段**必须在顶层**（`render()` 之外）：
 *    · `staticLayer()` 要能被 `render()` 之外的代码调到；
 *    · `invalidateStaticLayer()` 要能被 `game.js` 的切关处调到
 *      （那边写的是 `typeof invalidateStaticLayer === "function"` 的兜底判断 ⇒
 *        嵌在 render() 里时它**恒为 false** ⇒ 切关不换静态层 ✗，而且**不报错** ✗）。
 * ⚠️ 我第一版就是写在了 `render()` 体内（缩进是 0，但作用域是嵌套的）——
 *    结果：① 假浏览器环境里 `useStaticLayer is not defined`；
 *          ② 用户进"碰撞测试场"崩（`obs` 在静态层分支里没赋值，而末尾的碰撞可视化要读它）。
 * ⚠️⚠️ **注释里别写测试要搜的字面量**：`test-draworder` 靠 `indexOf` 找"调试可视化那一行"的位置
 *    来判断绘制顺序 —— 我这句原本把它的**完整调用写法**写了出来，于是被判成"调试可视化画在障碍之前" ✗
 *    （**假红**；与当年 `mStep` 那次是同一个坑）。 */

    /* ⭐⭐ **掩体用素材平铺**（`0.3.0` 图片化，用户："把 A 的前 7 个做了"）。
 *
 * ⚠️ 掩体**尺寸不都是 40×40** —— 实测还有 40×240 / 40×320 这种长条（一整列/一整块墙）
 *    ⇒ 不能"一个矩形画一张图"，要**按格子平铺**。
 * ⚠️ 平铺步长取 `TILE`（40）—— 它与素材的画布尺寸**相等**（`wall` 是 20 美术像素 × `PIXEL` 2 = 40 ✔）。
 *    以后若把 `wall.png` 换成别的尺寸，这一行要跟着改（`test-visual` 会先拦住尺寸不符）。
 * ⚠️ 位置与尺寸都走 `snap`（与原来那段 fillRect 完全一致的取整），所以"墙 = 碰撞框"没变。 */
function drawWallRect(ctx, o) {
    var x = snap(o.x), y = snap(o.y), w = snap(o.w), h = snap(o.h);
    var s = TILE, tx, ty;
    /* ⭐⭐ **逐格取素材**（用户 2026-10-05："现在每关的 # 和 W 都是树" ✗）。
     *
     * ⚠️⚠️ 原来这里**写死**用 `TILE_TYPES_BY_ID.wall`（= `#` 那一格 ✗）的素材 ✗ ⇒
     *    `W`（id `wall2` ✗）也被画成 `#` 的样子 ⇒ 一旦把 `#` 改成树，**两种格子全变树** ✔。
     *    ⇒ 改成**按格子**查：这一格是什么类型，就用它的素材 ✔（`#`⇒树 / `W`⇒墙 ✗）。
     * ⚠️ 矩形是 `obstacles()` **合并**出来的 ✗ ⇒ 一格一格判断 ✗，不能整块用一个素材 ✔。
     * ⚠️ 有**非地图**的掩体（自由矩形 ✗）：那些格子在地图上不是实心类型 ⇒
     *    回退成原来的行为（用 `#` 那一格的素材 ✗）✔。 */
    var wallT = TILE_TYPES_BY_ID.wall;
    var fallback = tileSprite(wallT) || 'wall';
    var g2 = (typeof currentMap === 'function' && currentMap() && currentMap().tiles) ? currentMap().tiles : null;
    for (ty = 0; ty < h; ty += s) {
        for (tx = 0; tx < w; tx += s) {
            var cx = (x + tx) / TILE, cy = (y + ty) / TILE;
            var tt = null;
            /* ⚠️ 用**实际数组长度**判断，别信 `rows/cols`（测试关卡的 `rows` 比 `ids` 长 ✗）——
             *    否则 `ids[cy]` 可能 undefined ⇒ `[cx]` 上抛 TypeError ✔（实测踩过 ✗）。 */
            var rowIds = (g2 && g2.ids && cy >= 0 && cy < g2.ids.length) ? g2.ids[cy] : null;
            if (rowIds && cx >= 0 && cx < rowIds.length) {
                var cand = TILE_TYPES_BY_ID[rowIds[cx]];
                if (cand && cand.solid) tt = cand;       /* 只有**实心**格才代表这块掩体 ✔ */
            }
            var id = (tt && (tileSprite(tt) || tt.sprite)) || fallback;
            var col = PAL[((tt && tt.color) || (wallT && wallT.color) || 'wall')] || PAL.wall;
            drawSprite(ctx, id, x + tx + s / 2, y + ty + s / 2, s, col);
        }
    }
}

/* ⭐⭐ **方块外观查表**（`0.3.0`）：地图可以用 `skin` 覆盖某个方块的素材。
 *     `skin: { wall: 'tree' }` ⇒ 这张图里的墙用 `tree.png` 画。
 *  ⚠️ **只改外观**：挡不挡路仍然是 `TILE_TYPES[].solid` 说了算。
 *  ⚠️ 渲染的两个入口（静态层的逐格绘制、`drawWallRect`）都必须走这里，
 *     否则"换皮"只在一半地方生效（那是最难查的一类 bug）。 */
function skinOf() {
    var m = (typeof currentMap === 'function') ? currentMap() : null;
    return (m && m.skin) || {};
}
function tileSprite(t) {
    if (!t) return null;
    var sk = skinOf();
    return (sk && sk[t.id]) || t.sprite || null;
}

/* ⭐⭐ **静态层**（`0.3.0`：地图方块化 + 性能）
 *
 * 把**每关都不变的东西**（地面 + 掩体 + 自由矩形）一次性画到一张离屏画布上，
 * 之后每帧只 `drawImage` **一次**。
 *   · 改之前：**每帧**画 183 个掩体块；地面方块化之后还会多出 32×18 = **576 格** ✗
 *   · 改之后：每帧 1 次 drawImage ✔
 *
 * ⚠️⚠️ **只在真实浏览器启用**（判据 `typeof Image !== 'undefined'`，与 `Sprites.load` 同一把闸门）：
 *    Node 测试桩里 `createElement('canvas')` 是个空壳 ⇒ 静态层画不出东西；
 *    而测试要的恰恰是"**逐帧的 fillRect 几何**"（22 条像素对齐断言）。
 *    ⇒ 桩里一律走下面的逐帧路径，浏览器里走静态层。**两边的绘制内容一致**。
 * ⚠️ **失效时机**：切关（见 `invalidateStaticLayer` 的调用点）。
 * ⚠️ **重建时机**：素材是异步加载的 —— 静态层第一次可能在"图还没到"时建好，
 *    那样掩体会是纯色块。⇒ 记下建层时的 `Sprites.loaded` 计数，**计数一变就重建一次**。 */
var _staticLayer = null;
var _staticLayerSprites = -1;

function invalidateStaticLayer() {
    _staticLayer = null;
    _staticLayerSprites = -1;
}

/* 能不能用静态层（桩里不能；`ctx.drawImage` 不存在时也不能） */
function useStaticLayer(ctx) {
    return typeof Image !== 'undefined' && ctx && typeof ctx.drawImage === 'function';
}

/* 建（或取）静态层 */
function staticLayer() {
    var loaded = (typeof Sprites !== 'undefined') ? Sprites.loaded : 0;
    if (_staticLayer && _staticLayerSprites === loaded) return _staticLayer;
    var cv = document.createElement('canvas');
    cv.width = LOGICAL_W;
    cv.height = LOGICAL_H;
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;

    /* ① 地面：整块底色 + 逐格方块（现在是纯色；以后 `TILE_TYPES[].sprite` 有图就自动变贴图） */
    c.fillStyle = PAL.bg;
    c.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    var g = currentMap().tiles, r, col;
    if (g) {
        for (r = 0; r < g.rows; r++) {
            for (col = 0; col < g.cols; col++) {
                var t = TILE_TYPES_BY_ID[g.ids[r][col]];
                if (!t) continue;
                var sp = tileSprite(t);          /* ⭐ 走过 skin（"这关的墙是树"就在这一步生效） */
                if (sp) {
                    drawSprite(c, sp, col * TILE + TILE / 2, r * TILE + TILE / 2, TILE, PAL[t.color] || PAL.bg);
                } else {
                    c.fillStyle = PAL[t.color] || PAL.bg;
                    c.fillRect(col * TILE, r * TILE, TILE, TILE);
                }
            }
        }
    }

    /* ② 掩体 + 自由矩形（非对齐墙）：与地面同层，都是静态的 */
    var obs = obstacles(), i;
    for (i = 0; i < obs.length; i++) {
        if (obs[i].boundary) continue;          // 世界边界不画（由画布边缘体现）
        drawWallRect(c, obs[i]);
    }

    _staticLayer = cv;
    _staticLayerSprites = loaded;
    return cv;
}

function render() {
    /* ⚠️⚠️ **激光 DOM 的"关掉"必须在所有提前 return 之前**（实测抓到的 bug）。
     *
     * 原因：下面那几行 `return`（标题屏 / 非关卡层 / 非 play 模式）都在**激光块之前**
     * ⇒ 切层之后根本走不到那两行 `LaserDom.hide()`，**激光会一直挂在画面上**。
     * ⚠️ 浏览器里看起来"没出问题"是**运气**：`style.css` 里有一条
     *    `body:not(.in-game) #laser { display: none !important; }` 兜住了
     *    （`changeLayer` 会切 `in-game` class）。
     *    实测证据：切到标题层 / 选关层后，**纯 JS 的 `display` 仍是 `block`**。
     * ⇒ 两处都留着（CSS 兜底 + 这里主动关），谁先失效都不至于漏出激光。 */
    if (typeof LaserDom !== 'undefined') LaserDom.hide();
    /* ⚠️⚠️ **BOSS2 的光束同样是 DOM，同样要处理"切层后关不掉"**（`0.2.1`）——
     *    与上面 `LaserDom.hide()` 一模一样的坑（下面那几行 `return` 在光束绘制之前）。
     * ⚠️ 但**不能无脑每帧 `hideExtra()`**：那样"关掉 → 下面再打开"会让
     *    `display` 每帧切换一次（合成器每帧重建图层）。所以先算一下
     *    "这一帧到底会不会画光束"，**不会画才关**；会画的话由下面那段负责关多余的槽位。 */
    var willDrawBeams = (layer === GAME_LAYER) &&
                        (Game.mode === 'play' || Game.mode === 'result') &&
                        !!(Game.beams && Game.beams.length);
    if (typeof LaserDom !== 'undefined' && LaserDom.hideExtra && !willDrawBeams) LaserDom.hideExtra();

    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    /* ⭐ 标题屏：背景交给像素风星场（titlefx.js）。
     * ⚠️ 必须在"清屏之后、关卡内判断之前"—— 它和关卡画面是两个互斥的分支。
     * ⚠️ 画布在菜单下本来是 `visibility: hidden`（见 style.css），
     *    改由 `body.title-fx-show` 打开（见 TitleFx.render 与 changeLayer）。 */
    if (layer === TITLE_LAYER) { TitleFx.render(); return; }
    if (layer !== GAME_LAYER) return;
    if (Game.mode !== 'play' && Game.mode !== 'result') return;

    var P = Game.player, i, j;
    /* ⭐⭐ **激光源标记的收集列表** ✗（用户 2026-10-05："把激光源层级改成高于对应激光（影响所有的）" ✔）：
     *  ⚠️ 主画布 `ctx` 在**光束（DOM ✗）之下** ✔ ⇒ 想让源"压在光束上"必须画到 **over 特效层**（`#fx2` ✗）✔；
     *  ⚠️ 而 over 层在下面（892 行 ✗）会被**整体清空** ✔ ⇒ 只能**先收集、清完再画** ✔。
     *  收集对象：**玩家激光源** + **每道光束的源**（警示期小方块 / 生效期 `beam_mark` ✗）⇒ 一次覆盖全部光束 ✔。 */
    var srcMarks = [];

    /* ⭐⭐ **原来的"网格底淡格线"已删除**（`0.3.0` 像素化，用户 2026-10-02："网格线删了"）。
     *
     * 删它的理由：它是 `lineWidth = 1` 的**奇数粗线**（还带 `+0.5` 半像素偏移）——
     *   与"每个部件自身尺寸都是美术像素的整数倍"冲突；而要合规就得画成 2px，
     *   那又会让格线**粗一倍**、比障碍物还抢眼。用户的选择是**直接不要**。
     * ⚠️ `PAL.grid` 于是**不再被任何地方使用**（`PAL` 里仍留着它，因为
     *   `test-visual` 会断言"每个色都有人用"的反面 —— 见那里对未用色的说明）。
     * ⚠️ 背景现在是**纯色**（`clearRect` + 画布底色），不再有格子参照。
     *   如果需要"格子感"回来，正确做法是**用偶数宽的方块画**（`fillRect(x, y, 2, H)`），
     *   而不是恢复这两行。 */

    /* 障碍（矩形）
     * ⚠️ 必须用 **obs[i].w / obs[i].h**，不能用固定的 TILE：
     *    自由矩形（非对齐墙）尺寸任意，写死 TILE 会让灰色填充比实际碰撞体小
     *    （实测：板高 120 却只填 80 → 用户报"蓝框对、灰色部分不对"）。 */
    /* ⭐⭐ **静态层优先**（`0.3.0`）：地面 + 掩体一次性预渲染好，这里只画一张图。
     * ⚠️ 桩里（没有 `Image` / 没有 `drawImage`）走下面的逐帧路径 —— 绘制内容一致。
     * ⚠️⚠️ **`obs` 必须无条件取一次**（`0.3.0` 修用户实测的崩溃）：
     *    我第一版把它写在 `else` 分支里 ⇒ 走静态层时 `obs` 是 `undefined` ✗ ⇒
     *    函数**末尾那处碰撞可视化**（只有测试关会调）读 `obs.length` **当场崩** ✗
     *    （用户原话："进碰撞测试场 Uncaught TypeError: Cannot read properties of undefined"）。
     *    ⚠️ 测试**抓不到**：Node 桩里没有 `Image` ⇒ `useStaticLayer` 恒为 false ⇒ 永远走 else ✔✗。
     *    ⇒ 一是无条件取（`obstacles()` 有缓存，取一次不花钱 ✔）；
     *      二是 `test-render` ⑩ 补一条"**浏览器路径下 render() 不抛异常**"（那才是真正缺的覆盖 ✔）。
     * ⚠️⚠️ **注释里不要写出测试要搜的字面量**（与下面那段同一个坑）：
     *    `test-draworder` 用 `indexOf` 找"调试可视化那一行"的位置判断绘制顺序 ——
     *    上面那句原本写了它的完整调用写法 ⇒ 注释**在墙循环之前**被搜到 ⇒ 判成"顺序错了" ✗（假红）。 */
    var obs = obstacles();
    if (useStaticLayer(ctx)) {
        ctx.drawImage(staticLayer(), 0, 0);
    } else {
        for (i = 0; i < obs.length; i++) {
            if (obs[i].boundary) continue;      // 世界边界不画（由画布边缘体现）
            drawWallRect(ctx, obs[i]);
        }
    }

    /* ⚠️ 调试可视化**必须在最后画**（见本函数末尾）：
     *    曾经放在这里，结果后面的敌人/子弹/玩家都盖在框上面 →
     *    表现成"碰撞框层级比实体低"。这是纯绘制顺序问题。 */

    /* 敌人 */
    for (i = 0; i < Game.enemies.length; i++) {
        var E = Game.enemies[i];
        /* ⭐ **冻结期换成冰蓝**（`0.2.1`，第 5 个主动「冻结」）：这是玩家唯一能一眼看出
         *    "敌人被冻住了 3 秒"的信号 —— 否则画面上只是"敌人忽然不动了"，很像卡顿。
         *    ⚠️ 血条**不换色**（血条是"还有多少血"的信息，与被冻结无关）。 */
        /* ⭐⭐ **素材绘制**（`0.3.0` 像素化）：`E.sprite` 指向 `Sprites.LIST` 里的一张图
         *    （尺寸 = 2×half，与碰撞体边界一致）。取整规则不变（见玩家那段）。 */
        drawSprite(ctx, E.sprite, E.x, E.y, E.half * 2, E.color);
        /* ⭐ 冻结期**盖一层冰蓝**：素材是"每种敌人一张图"，不该为冻结再多存一张
         *    ⇒ 用半透明覆盖层，观感与原来"整体换成冰蓝"一致（见 `Sprites.tint`）。 */
        if (Game.freeze > 0) tintSprite(ctx, E.x, E.y, E.half * 2, E.color);
        /* ⭐⭐ **血条默认只给 BOSS**（`0.2.0`，依据 `08` L288「目前考虑只有 BOSS 显示血条」），
         *    但小怪的条可以在**设置里单独打开**（`Save.showMobHp`，用户 2026-10-01 定）。
         *
         * ⚠️ 为什么"原设计如此"还要给开关：文档写的是"**目前考虑**"，本身没定死。
         *    小怪血少（4~5 点）、死得快，一条 28px 的条在它头顶上既挤又读不出信息；
         *    但"打了几下"确实有人想看 ⇒ 交给自己选。
         * ⚠️ **BOSS 永远显示**，不受这个开关影响 —— 它 60 血，没有条就没法判断进度。
         * ⚠️ 开关只影响**画不画条**，与小怪挨打掉不掉血无关。 */
        if (E.boss || Save.showMobHp) drawBar(E);
    }

/* ---- 敌人血条（**BOSS 与"开了小怪血条"时**会调到 —— 见上面敌人循环的 `if`）----
 * ⚠️ 依据 `08` L288「目前考虑只有 BOSS 显示血条」；小怪不画是**有意的**。
 * ⚠️ 本函数原来内联在敌人循环里，拆出来时只做了缩进，逻辑一字未改。 */
function drawBar(E) {
        /* ---- 敌人血条（**只有 BOSS 调到**，见上面的 `if (E.boss)`） ----
         * ⚠️⚠️ 宽度**不能舍入到像素网格**（这里曾经是
         *    `Math.round(full * ratio / PIXEL) * PIXEL`）：
             *    血条只有 `2*half = 28px` 宽，按 5px 网格四舍五入只剩 **7 档**，
             *    而敌人是 4 点血 → 每点血 7px，被舍成同一档 →
             *    **掉 1 滴血时条宽根本没变**，比例是失真的
             *    （3/4 显示成 83%、1/4 显示成 17%）。
             *    ⇒ 主条走**真实比例**，一条干净的实心条。
             * ⚠️ 曾经在条上按满血值打过"每 1 点血一根"的暗色刻度线（想兼顾像素台阶感），
             *    用户看完说 **"不要中间的黑色竖条"** → 已删。
             *    **精度是主条给的，不是刻度给的**，所以删掉刻度不影响比例。
             * ⚠️ 分母用敌人**自己的 `maxHp`**，不是全局 `BAL.enemy.hp`
             *    （血量不同的敌人会按别的怪的血量算比例，每一格都错）。 */
            var full = E.half * 2;
            var maxHp = (typeof E.maxHp === 'number' && E.maxHp > 0) ? E.maxHp : BAL.enemy.hp;
            var ratio = Math.max(0, Math.min(1, E.hp / maxHp));
            /* ⭐⭐ 血条位置 = **敌人方块的位置 + 一个固定偏移**（`0.2.0` 定稿）。
             *
             * ⚠️⚠️ **只改血条，不碰方块**（用户明确要求："我希望只是血条与敌人的
             *    相对位置固定"）。方块的公式从 `0.1.1` 起就是 `snap(E.x) - E.half`，
             *    **一个字都没动过**（`ART` 后来从 2 调成 1 是另一件事，见 core.js）。
             *    ⇒ 不要为了"对齐血条"去改方块，那会改变敌人的观感与碰撞对应。
             *
             * **为什么会"晃"**：血条以前用**另一套**取整 `snap(E.x - E.half)`
             *    （先减后取整）。方块先取整再减、血条先减再取整，`E.half` 又是奇数，
             *    两套结果**永远差 1px**，而 `round` 让这 1px 在敌人移动中来回翻转
             *    ⇒ 实测"条相对方块每 4 帧摆 2px"（用户原话："血条本身会晃"）。
             *
            /* **修法**：条不再自己取整，直接用方块的坐标加固定偏移 ⇒ **相对位置恒定**。
             *
             * ⚠️ ⚠️ **纵向偏移 = -12，含义是"条顶 = 方块顶 - 12"**。
             *    `0.1.1` 的写法是 `by = snap(E.y - E.half - 12)` ——
             *    `- 12` 就在 `snap()` **里面**，所以它同样是"条顶减 12"，
             *    只是还额外做了一次取整（那正是"晃"的来源）。
             *    ⇒ 去掉多余取整后**保留 -12**，这才是与旧版一致的位置：
             *      条顶 = 方块顶 - 12、条底 = 方块顶 - 7。
             *
             * ⚠️ ⚠️ **这里我错过一次，过程值得记**：重构"晃动"时我把偏移写成了 -17，
             *    理由记的是"其中 5 是条高，所以条底到方块顶 = 12" ——
             *    也就是按"条**底**留 12"去想了，**而代码里 by 是条顶**。
             *    结果条整体比 `0.1.1` **高了 5px**（实测：条顶到敌人中心
             *    `0.1.1` 是 26px、`0.2.0` 是 31px），被用户一眼看出来：
             *    "（所有怪物）血条显示位置是不是比以前高了？"
             *    ⇒ **教训**：偏移量到底是"条顶"还是"条底"，必须对着
             *      `fillRect(bx, by, full, 5)` 里的那个 `by` 确认 ——
             *      `by` 永远是**条顶**，不是条底。 */
            var blkX = snap(E.x) - E.half, blkY = snap(E.y) - E.half;
            var bx = blkX;
            /* ⭐⭐ **条底离怪物 = 2 美术像素**（用户 2026-10-05：先要 1 ✗、复查后改成 2 ✔）。
             *    1 美术像素" ✗）。原来是 `blkY - 12`：条高 `BAR_H`(4) ⇒ 条底 = 方块顶 - 8
             *    最早是 `blkY - 12`（= 4 美术像素 ✗）⇒ 先改成 `BAR_H + PIXEL`（1 美术像素 ✗）
             *    ⇒ 现在是 **`BAR_H + 2 * PIXEL`** ✔。⚠️ 写成 `2 * PIXEL` 而不是写死 4：
             *    ⚠️ 小怪与 BOSS 走的是**同一个 `drawBar`** ⇒ 一处改动两条都生效 ✔。
             *    ⚠️ `by` 永远是**条顶**（不是条底 ✗）—— 这一点曾经弄错、被用户一眼看出来 ✔。 */
            var by = blkY - BAR_H - 2 * PIXEL;   /* 条底离方块顶 = **2 美术像素** ✔ */
            ctx.fillStyle = PAL.barBg;
            /* ⭐⭐ 血条**厚度** = `BAR_H`（`0.3.0` 像素化：**5 → 4**）。
             * ⚠️ 5 是奇数 ⇒ 不是 `PIXEL`(2) 的整数倍 ⇒ 一条"半格高"的条，
             *    放大到屏幕上会有一条半像素糊边。用户 2026-10-02 定的：
             *    "**敌人血条高度指其厚度的话从 5 改成 4**"。
             * ⚠️ 厚度**与血量比例无关**（宽度才是 `full × ratio`）⇒ 改它不动任何数值。 */
            ctx.fillRect(bx, by, full, BAR_H);
            ctx.fillStyle = E.color;
            /* ⚠️⚠️ 宽度必须取**整像素**（这里曾经直接写 `full * ratio`）。
             *    75% / 25% 时它是 `21` / `7` —— canvas 会把那 0.5 像素的覆盖度按
             *    **抗锯齿混色**画出来，于是在红色填充与深色底之间出现一条
             *    "比填充暗、比底色亮"的**深红过渡像素**
             *    （用户原话："红黑中间有一极细的深红色交界"）。
             *    ⇒ 取整到整像素：交界处是硬的，不再混色。
             * ⚠️ **精度不受影响**：比例（`ratio`）依然精确到每一点血，
             *    只是"画"的时候落到整像素上。
             * ⚠️ 用 `ceil` 不用 `floor`/`round`：**宁可多画一点，也不让血条显得比实际少**。
             *    用户原话："**确保向上取整（非满血可以血条满，显得打不动）**"——
             *    即"明明掉血了、条却看不出来"比"条显示得比实际多一点"更糟。
             * ⚠️⚠️ **同时兜底"活着的敌人至少 1px"**（用户实测报的 bug：0.1 血时条全空）：
             *    `ceil` 本身已保证"血量 > 0 ⇒ 宽度 >= 1"，这里的 `max` 是**把规则写死**，
             *    防止以后有人把 `ceil` 改回 `floor` 时那个"敌人还在动、条却是空的"又回来。
             * ⚠️ 只在 `E.hp > 0` 时兜底；血真的掉到 0（或以下）就该是空的。 */
            ctx.fillRect(bx, by, Math.max(E.hp > 0 ? 1 : 0, Math.ceil(full * ratio)), BAR_H);
}

    /* 子弹
     * ⭐⭐ **冻结期敌弹换色**（`0.2.1`，第 5 个主动「冻结」）：敌弹停在空中时若还是
     *    "会伤到你"的橙红，玩家会以为还能被打到。换成冰蓝 = "它现在冻住了"。
     *    ⚠️ 颜色只是**提示**，真正的免伤在 `hurtPlayer` 的闸门上（见那里的说明）——
     *      所以别把"冻结时不受伤"这件事写进渲染里。 */
    /* ⭐⭐ **子弹也走素材**（`0.3.0`）：按大小自动挑普通/大子弹两张图中的一张
     *    （`bulletSpriteId` 用 `half` 判：`half >= 10` 就是大子弹）。
     * ⚠️ 取 id 那一步也必须带兜底 —— 见 `bulletSpriteId` 里的说明。 */
    for (i = 0; i < Game.ebullets.length; i++) {
        var eb = Game.ebullets[i];
        drawSprite(ctx, bulletSpriteId(false, eb.half / BAL.player.bulletHalf), eb.x, eb.y, eb.half * 2, BAL.enemy.bulletColor);
        if (Game.freeze > 0) tintSprite(ctx, eb.x, eb.y, eb.half * 2, BAL.enemy.bulletColor);
    }
    for (i = 0; i < Game.pbullets.length; i++) {
        var b = Game.pbullets[i];
        drawSprite(ctx, bulletSpriteId(true, b.half / BAL.player.bulletHalf), b.x, b.y, b.half * 2, PAL.pbullet);
    }

    /* ⭐⭐ **激光**（`0.2.0`）。画在**特效之前**、**玩家之前** ——
     *    理由：激光从主角身上射出，最后画的玩家方块应该压住它的根部
     *    （否则激光会盖住主角，看起来像"主角被自己的激光吞了"）。
     *
     * ⚠️⚠️ **斜向激光必须用 `save/translate/rotate/fillRect/restore`**，
     *    不能只画一个轴对齐矩形 —— 那会让"看到的形状"与"判定的带子"不一致
     *    （斜着打时视觉上是个大方块，实际判定是一条细带子）。
     *    **调试可视化一旦画不准，就是在制造假 bug**（照 `drawCollisionDebug` 的规矩）。
     * ⚠️ `ctx.save()/restore()` 必须成对。中途 `return` 会漏掉 `restore`
     *    ⇒ 之后所有绘制都带着旋转（实测这类 bug 极难找）。这里没有 return，安全。
     * ⚠️ 长度、方向、**起点**都取 `P.laser` 里存下的值（放出那一帧定死的）——
     *    用户要求"激光发出后**不要随着玩家平移**"，所以这里**不读 `P.x / P.y`**。
     *    ⚠️⚠️ 第一版起点用的是 `P.x, P.y`（玩家当前位置）⇒ 玩家一走，
     *      光束的"头"就从身体里拖出来一截，很突兀（用户原话）。
     *    ⚠️ 判定那边（game.js）也必须读同一组 `ox / oy`，否则会出现
     *      "看着在这、打的是那"——两处**必须成对**。 */
    if (P.laser) {
        var LZ = P.laser;
        /* ⭐⭐ **淡出（真透明）**（`0.2.0` 第二版）。用户要求"做一下激光消失的效果，
         *    **彻底消失时对应帧数结束**"，看过第一版后要求**"改成变透明试试"**。
         *
         * 做法：按**剩余帧数**算一个 `a ∈ (0, 1]`，整个光束用它做 `globalAlpha`
         * ⇒ 光束逐渐**透出背景**，到 `LZ.frames === 0` 时 `a = 0`（完全透明）。
         * 而那一刻 `update` 已经把它置 `null`、这一段根本不画 ⇒
         * **"彻底消失"与"帧数结束"是同一个时刻**，不会错位。
         *
         * ⚠️⚠️ **第一版是"压暗"（`dimHex` 乘颜色分量），用户看完要求改成透明。**
         *    两者观感不同，别再改回去：
         *      · 压暗 → 颜色往黑走 ⇒ 看着像"**能量在衰减**"
         *      · 透明 → 背景透出来 ⇒ 看着像"**光束在淡化消散**"（用户要的是这个）
         *    `dimHex()` 还留在本文件里（是通用小工具、也有单测），但**这里不再用它**。
         *
         * ⚠️⚠️ **`globalAlpha` 必须在 `save()` 之后设、`restore()` 会自动还原**。
         *    这里正好在 `save()/restore()` 块内 ⇒ **不用手动复位**。
         *    ⚠️ 一旦把它挪到 `save()` 外面，就会**连累后面所有绘制**
         *      （敌人、玩家、特效全变半透明）—— 那种 bug 极难找，所以特此写明。
         * ⚠️⚠️ **两个颜色不再写在这里**（`0.2.0` 改）：
         *    · 内芯 = `LASER_CORE`（唯一来源）
         *    · 外圈 = `dimHex(LASER_CORE, LASER_OUTER_K)` —— **从内芯算出来**
         *    原来外圈是写死的暗橙 `#7a4a10`，而 `dimHex(LASER_CORE, 0.48)` 是 `#7a7451`
         *    （**差 35 亮度**）⇒ 那个值当年是手调的，改内芯色时不会跟着走。
         *    用户要求"激光改成淡蓝色的"时，留个橙色外圈就非常割裂 ⇒ 现在同一个来源。
         * ⚠️ `a` 的计算抽成了下面的 `laserFade()` —— 纯函数、可单测。
         *    留在 render 里的话，测试只能靠"比对绘制出来的颜色"间接验，很脆。 */
        var a = laserFade(LZ.frames);
        var oh = LASER.originHalf;
        /* ⚠️⚠️ **外圈色在这里算一次，供 DOM 与 canvas 兜底共用**（两条路径必须同色）。 */
        var outerC = PAL.laserOuter;   /* 0.3.0：外圈是独立条目（用户给定），不再由内芯推导 */
        /* ⚠️ 坐标取整到整数：与画面其余部分的像素颗粒一致。 */
        var lx = Math.round(LZ.ox), ly = Math.round(LZ.oy);

        /* ⭐⭐⭐ **光束本体：交给 DOM 画**（`0.2.0` 定稿，用户拍板"采用最终方案：用 html 元素"）。
         *
         * ⚠️⚠️ **为什么不在 canvas 上画**（试过三条路，全被否）：
         *   · 逐行栅格化 `fillRotRect`（零抗锯齿）—— 1 像素台阶暴露无遗
         *   · canvas 原生 `strokeBeam`（带抗锯齿）—— 还是有明显台阶
         *   · 提高画布分辨率 / 背板跟视口 —— 与"填满屏幕"互斥，还引入半像素杂边
         *   ⇒ 根因：**canvas 的斜线是自己栅格化的**，而 `#stage` 又带非整数倍缩放
         *      （实测视口 1592 CSS 宽 ⇒ ×1.24），每个像素还要被再切一刀。
         *   ⇒ DOM：旋转交给**合成器**、抗锯齿在**设备像素比**（实测 dpr = 2）下做
         *      ⇒ 边缘是**设备分辨率级**的柔和。详见 `laserdom.js` 顶部。
         *
         * ⚠️ `LaserDom` 用 `typeof` 兜底：测试桩里不一定加载了 laserdom.js
         *    （没有它不该让整局起不来 —— 与 `ctx.setTransform` 同一条原则）。
         * ⚠️ 淡出（`a`）在 DOM 模式下用 **CSS `opacity`** —— 与 canvas 的 `globalAlpha`
         *    是同一个语义（"变透明"而不是"压暗"），用户当初要的就是这个。
         * ⚠️ 那个**正方形激光源仍在 canvas 上画**（它本来是轴对齐的方块，
         *    canvas 画它没有任何锯齿问题，没必要为它多开一个 DOM 节点）。 */
        var domDrawn = false;
        if (typeof LaserDom !== 'undefined') {
            /* ⚠️ 外圈色**传进去**（不再由 laserdom.js 自己写死）—— 与兜底同色。 */
            domDrawn = LaserDom.draw(lx, ly, LZ.angle, LZ.len, LASER.halfWidth, a, outerC, PAL.laserCore);
        }
        /* 兜底：DOM 不可用（测试桩 / 加载失败）时退回 canvas 栅格化 */
        if (!domDrawn) {
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = outerC;
            fillRotRect(lx, ly, LZ.angle, LZ.len, LASER.halfWidth);
            ctx.fillStyle = PAL.laserCore;
            /* ⚠️ 兜底也要与 DOM **同宽**（用户 2026-10-02："内芯都改成 12 逻辑像素"）：
             *    原来这里是 `halfWidth * 0.4` = **6.4**（小数 ✗，而且与 DOM 的 8 也不一致 ✗）。
             *    ⇒ 直接读 `LaserDom.CORE_W`（同一处来源 ✔；取不到时退回 0.5 档 = 8 ✔）。 */
            fillRotRect(lx, ly, LZ.angle, LZ.len,
                (typeof LaserDom !== 'undefined' && LaserDom.CORE_W) ? LaserDom.CORE_W : LASER.halfWidth * 0.5);
            ctx.restore();
        }

        /* ⭐⭐ **激光源那个正方形**（`0.2.0`，用户要求）。
         *
         * 用户原话：**"……所以在那里用一个正方形表示激光源，即视觉上主角召唤的是
         * 激光源而非激光本身"**。
         *
         * ⚠️ 画在**光束之后** ⇒ 压在光束的头端上，看着像"光束从这个装置射出来"。
         * ⚠️ 它**不参与判定** —— 判定带子仍然只有 `halfWidth` 宽（见 game.js）。
         *    这是个"声明式"的画法：视觉上给光束一个成因，不改任何数值。
         * ⚠️ 上面 `ctx.save()` 改成了**按需**（DOM 成功时没有那对 save/restore），
         *    所以这里必须**自己 save/restore** —— 否则 `globalAlpha` 会漏给后面的绘制。 */
        /* ⭐ 激光源方块改用素材（`0.3.0` 图片化）：`laser_origin` 是 11×11 美术像素 ⇒ 画 22×22。
         * ⚠️ 透明度（原 `globalAlpha = a` ✗）**保留**：素材本身是不透明的白方块，
         *    "半透明让内芯透出来"这个观感由 alpha 给（与原来一致）。
         * ⚠️⚠️ `0.3.1`：**改成收集**，统一画到 over 层（高于光束 ✗）✔ —— 见上面的 `srcMarks` 说明 ✔。 */
        srcMarks.push({ sprite: 'laser_origin', x: lx, y: ly, size: oh * 2, color: PAL.laserOrigin, a: a });
    }

    /* ⭐⭐ **BOSS2 的光束**（`0.2.1`）。
     *
     * 用户定的形态：**生效前 10 帧红色细线警示 → 生效 20 帧**（每帧判定 3 点伤害）。
     * ⇒ 画法就按这两个阶段分叉：
     *    · 警示期：**细红线**（半宽 `BOSS2.beamHalfWarn` = 1 ⇒ 2px），暗红 + 亮红内芯
     *    · 生效期：**粗束**（半宽 `BOSS2.beamHalfFire` = 8 ⇒ 16px），亮粉红
     * ⚠️⚠️ **画法与判定必须同源**：判定宽度取的是 `BOSS2.beamHalfFire`（见 game.js 的
     *    `beamHitsPlayer`）—— 所以"看着细、其实判定很宽"这种坑不会出现，
     *    但**改判定宽度就是改这里画出来的粗细**，两边一起变（这是有意的）。
     * ⚠️ 光束**比屏幕长**（`LOGICAL_W + LOGICAL_H`）⇒ 一定射出画面外，
     *    而且不会因为 BOSS 站在角落而"半截断在空中"。
     *    `#elaserN` 上有 `overflow: hidden`（与 `#laser` 共用一套 CSS）⇒ 出界的部分被裁掉。
     * ⚠️ 槽位只有 3 个（`LaserDom.SLOTS - 1`）—— 万一以后一次放 4 道，
     *    多出来的**画不出来**（判定照旧）。要加就先加 `#elaser4`。 */
    if (typeof LaserDom !== 'undefined' && Game.beams && Game.beams.length) {
        for (i = 0; i < Game.beams.length && i < LaserDom.SLOTS - 1; i++) {
            var bm = Game.beams[i];
            /* ⚠️ 不穿墙的光束（`0.3.1` 小怪 6）自带 `len` ✗ ⇒ **画到墙边为止** ✔（警示期那条细线也一起截断 ✔，
             *    因为两期共用这个 `beamLen` ✗）；BOSS2 的没有 `len` ⇒ 画满屏（穿墙 ✔）。
             *  ⚠️ 必须放在 `var bm = …` **之后** ✗（我第一版放在循环外 ⇒ `bm` 未定义 ⇒ 渲染当场抛异常 ✔）。 */
            var beamLen = (typeof bm.len === 'number') ? bm.len : (LOGICAL_W + LOGICAL_H);
            var warning = bm.warn > 0;
            var bw = warning ? BOSS2.beamHalfWarn : BOSS2.beamHalfFire;
            /* 警示期的红线**闪一下**（每 5 帧一个明暗切换）——
             * 让"还没生效"和"已经生效"一眼分得开，也提醒玩家还剩多久。 */
            var blink = warning ? (0.55 + 0.45 * ((bm.warn % 10) < 5 ? 0 : 1)) : 1;
            /* ⭐⭐ **消失动画 = 生效期最后几帧淡出**（`0.2.1` 用户：
             *    "**另外boss2激光消失缺少对应动画**"）。
             *
             * ⚠️⚠️ **直接复用玩家激光那条曲线 `laserFade(剩余帧数)`** —— 这就是"对应"：
             *    同为"末 `fadeFrames` 帧线性变淡 + 末帧仍可见的一格哨兵"，
             *    而且**只有一份实现**（改玩家的淡出就是改这里的淡出，不会脱钩）。
             * ⚠️ 边界（与玩家激光同一条）：`fire = 7` ⇒ 1（满亮）、`fire = 6` ⇒ 6/7、
             *    `fire = 1` ⇒ **1/7 ≈ 0.14**（最后一帧**看得见**，不是"画了却全透明"）。
             *    `fire = 0` 那一帧光束已经被 `updateBeams` 移除 ⇒ 渲染永远看不到 0。
             * ⚠️ 警示期不用这条曲线（它有自己那套"闪烁"）⇒ 两阶段的"变淡"语义分开。 */
            var beamAlpha = warning ? blink : laserFade(bm.fire);
            /* ⚠️⚠️ **外圈色由内芯算**（`dimHex(内芯, LASER_OUTER_K)`）——
             *    与玩家激光**同一条规矩**（见上面 `outerC` 那段：外圈色曾经有两个来源，
             *    改配色时必然漏一个）。
             * ⚠️ 这里**曾经写成 `BEAM_WARN_OUTER` / `BEAM_FIRE_OUTER` 两个"不存在的常量"**
             *    —— 那两个名字我只在脑子里定过、根本没定义 ⇒
             *    **放激光的那一帧直接 `ReferenceError` 崩掉**（用户实测："放激光卡住
             *    Uncaught ReferenceError: BEAM_WARN_OUTER is not defined"）。
             *    ⇒ 教训：**新加的颜色常量只有"内芯"一个**，外圈一律 `dimHex` 算出来；
             *      而且这种"只在渲染路径上"的漏引用，交互式测试里不跑到就发现不了 ——
             *      所以 `test-logic` 12d 里补了一条"带着光束跑一帧 render()"的断言。 */
            var beamOuter = PAL.beamOuter;   /* 0.3.0：外圈独立条目（用户给定 #bc4f4f） */
            LaserDom.drawAt(i + 1, bm.x, bm.y, bm.ang, beamLen, bw, beamAlpha,
                beamOuter, warning ? PAL.beamWarnCore : PAL.beamFireCore);

            /* ⭐⭐ **光束顶端的"激光源"标记**（`0.2.1` 用户："（地图顶部处的)激光源"）。
             *
             * ⚠️⚠️ **只在"生效期"画 —— 警示期一块都不画**（用户明确：
             *    "**boss2激光的顶底动画不要在警示时就出现**"）。
             *    ⇒ 警示期只保留"细红线 + 闪烁"这一种语言（表示"还没生效"）；
             *      到生效期才把"源"亮出来 —— 两个阶段的**画面元素数量都不一样**，
             *      玩家一眼能分清"这一发到底生效没有"。
             *    ⚠️ 所以这段**必须在 `if (!warning)` 里**；别"顺手"让它跟着警示线闪
             *      （早先那版就是跟着闪的，被用户否掉了）。
             * ⚠️⚠️ **只有顶部这一个静态方块；底部不再画方块**（用户第三轮：
             *    "**boss激光主闪不对，应该类似玩家激光主闪，现在是和激光源一样**"）。
             *    玩家激光那边其实是**两种**东西，之前把它们混成一种了：
             *      · **激光源** = `LASER_ORIGIN` 的**静态方块**（`rectAligned(…, originHalf*2)`）
             *        ⇒ "光束从这台装置射出来"，**只有起点**有。
             *      · **主闪** = `laserSparks` 里第 0 颗火花（`s0 = 24`、`grow = 2.2`）——
             *        **闪一下、缩没**的方块，**只在命中点**出现。
             *    ⇒ 底部那块静态方块是**画错了**（它跟激光源长得一模一样）；
             *      底部要的"主闪"已经由 `updateBeams` 里的 `laserSparks` 生出来了
             *      （1 颗主闪 + 若干碎屑），**这里不用再画任何东西**。
             * ⚠️ 一句话：**"命中点"是动画（火花），"激光源"是静态标记** —— 两者别互相顶替。
             * ⚠️ 顶部这块**一半在画面外**（`bm.y` 恒为 0、中心压在上边界）⇒ 下半被 `#stage`
             *    裁掉，正好是"从边缘伸进来"的观感。
             * ⚠️ `BEAM_MARK` 是"半透明白偏红"（与玩家激光的 `LASER_ORIGIN` 同一套语言）。
             * ⚠️ 淡出时这块**跟着一起变淡**（`beamAlpha`）—— 光束没了、源还亮着会很怪。 */
            /* ⭐⭐ **警示期：源位置也要有个"小的同色方块"**（用户 2026-10-05：
             *    "然后警示时激光源也要有个小的同色正方形警示" ✔）。
             *
             * ⚠️ 原来这里是 `if (!warning)` ✗ ⇒ **只有生效期**才画 `beam_mark` ✔
             *    ⇒ 警示那 30 帧里，源位置**什么都没有** ✔（用户正是要补这个 ✔）。
             * ⚠️ 颜色用 `PAL.beamWarnCore`（= 警示细红线的颜色 ✗ ⇒ "同色" ✔），
             *    透明度沿用同一个 `beamAlpha` ⇒ 与红线**同步闪烁** ✔。
             * ⚠️ 尺寸取 `LASER.originHalf / 2` ✗ ⇒ 明显比生效期那块 `beam_mark` **小一圈** ✔
             *    （用户要的是"**小**正方形" ✔）；取整后至少 2px ✔。 */
            if (warning) {
                /* ⚠️ 尺寸：**4×4 美术像素**（用户 2026-10-05 定 ✗）= **8×8 逻辑像素** ✔
                 *    ⚠️ 演进：最初按 `originHalf / 2` 算 ⇒ 12×12 逻辑（太大 ✗）⇒ 改 2×2 美术 ⇒
                 *       用户再定 **4×4 美术像素** ✔（现在这个 ✔）。 */
                var wh = PIXEL * 2;                /* 半宽 = 4 逻辑像素 ⇒ 边长 8 = **4×4 美术像素** ✔（用户 2026-10-05 定 ✗） */
                /* ⚠️⚠️ **不夹取** ✗（用户 2026-10-05 更正："**一半在画面外**是预期的，这部分改回去" ✔）：
                 *    方块就画在**光束源正中心** ✔ ⇒ BOSS2 的源在 `y = 0`（屏幕顶边 ✗）⇒
                 *    方块**一半在画面外** ✔ —— 与生效期那块 `beam_mark` 同一套"从边缘伸进来"的观感 ✔
                 *    （我上一版擅自把它夹进画面 ✗ ⇒ 已撤销 ✔）。 */
                var wx = bm.x, wy = bm.y;          /* ⚠️ **不夹取** ✗：方块以光束源为中心 ✔ */
                srcMarks.push({ rect: true, x: wx, y: wy, wh: wh, color: PAL.beamWarnCore, a: beamAlpha });
            } else {
                var moh = LASER.originHalf;
                /* ⭐ 光束源标记改用素材（`0.3.0` 图片化）：`beam_mark` 是 11×11 美术像素 ⇒ 画 22×22。
                 * ⚠️ 那一块**一半在画面外**（`bm.y` 恒为 0）⇒ 下半被 `#stage` 裁掉，
                 *    正好是"从边缘伸进来"的观感（与原来 `rectAligned` 的位置一致 —— 都用中心定位）。 */
                srcMarks.push({ sprite: 'beam_mark', x: bm.x, y: bm.y, size: moh * 2, color: PAL.beamMark, a: beamAlpha });
            }
        }
        /* ⚠️ 这一帧光束比槽位少时，**多出来的槽位必须藏掉** ——
         *    不然上一帧的粗束会留在画面上（看着像"激光没消失"）。 */
        for (i = Game.beams.length; i < LaserDom.SLOTS - 1; i++) LaserDom.hideAt(i + 1);
    }

    /* 特效：尺寸 = `t × 2 × half / 12`
     * ⚠️ 满尺寸（t=12）时正好是 `half × 2` 见方 —— 击杀爆炸因此能与敌人**完全重合**
     *    （见 `pop` 的说明：以前固定 24×24，比敌人小一圈，看着像"敌人缩了一下"）。
     *
     * ⚠️⚠️ **`0.2.0` 改成像素对齐绘制**（用户确认后修的）。
     *    经过值得记下来：我先"顺手统一"改过一次 → 用户说 **"pop 没有问题"** → 我撤回；
     *    之后用户又仔细看了，确认 **"大子弹确实也有同样的问题"** ⇒ 才修。
     *    ⇒ 两条教训：
     *      ① **"用户说没有"要先理解成"还没看到"，不等于"不存在"** ——
     *         但也不能拿推理去顶替实测，**要请他再确认一次**（这次就是这么办的）。
     *      ② 命中特效的 `half` 来源不止一个：`t.half = 14`（击杀）、
     *         `eb.half(6) + hitGrowHalf(7) = 13`（被打）⇒ 13/12 与 14/12
     *         **都不是整数** ⇒ 尺寸必然是小数量级。我当初只算了"子弹那一条"
     *         （5+7=12，恰好整除）就下了结论，漏了另外两条路。
     *
     * ⚠️ **满尺寸仍然与敌人完全重合**：`t = 12` 时 `s = 2 × half` 是整数，
     *    `Math.round` 动不了它 ⇒ 那条老规矩没被破坏。
     * ⚠️ 取整基准与别处一致（都走 `rectAligned` → 同一个 `snap`）。 */
    for (i = 0; i < Game.fx.length; i++) {
        var f = Game.fx[i];
        ctx.fillStyle = f.c;
        rectAligned(f.x, f.y, f.t * 2 * (f.half / 12));
    }

    /* ⭐⭐⭐ **激光命中点的火花**（`0.2.0`）。
     *
     * 用户原话：**"我希望的是命中点产生动画，包括墙和敌人首次接触该道激光的地方"**。
     *
     * ## 它画的是什么
     * **小方块粒子**：在命中点生出来，向外飞散 + 缩小 + 消失（共 `SPARK_FRAMES` 帧）。
     *   · 第一颗是**白芯**、其余用"被打中那个东西"的颜色（敌人色 / 墙的灰）
     *     ⇒ 一眼能看出"打中了什么"
     *   · 生它的时机见 game.js 的激光段：**只在该命中点"首次接触"时生一次**
     *     （不是每帧生 —— 那会糊成一片）
     *
     * ⚠️⚠️ **和 `pop` 的区别**：`pop` 画在**敌人身上**（"敌人整个在亮"），
     *    这里画在**命中点**（"打在哪儿、就炸在哪儿"）—— 用户明确要的是后者。
     * ⚠️ 粒子会飞出命中点，所以**位置每帧都在变**（见 `update()` 里推进 `vx/vy`）。
     * ⚠️⚠️ **尺寸曲线按粒子类型分**（见 `laserSparks` 的说明）：
     *    `ks = (t/max)^grow`
     *      · 主闪（`grow = 2.2`）—— 缩得**快**，"撞击瞬间闪一下"就没了
     *      · 碎屑（`grow = 0.75`）—— 缩得**慢**，飞出去的过程中还看得见
     *    第一版两种都用线性 `t/max`，主闪会"拖泥带水地慢慢缩"，不像撞击。
     * ⚠️ 用尺寸缩到 0 来"消失"，比 `globalAlpha` 便宜（本项目一律不用 alpha）。
     *
     * ## ⭐⭐ 按 `layer` 分发到两层画布（`0.2.0`，用户要求
     *    **"激光主闪和火花改成高于激光（其中主闪高于火花）"**）
     *    `Game.sparks[i].layer` 决定画到哪块布（见 fxdom.js 的层级表）：
     *      · `'over'`  ⇒ `#fx2`（在**光束之上**）—— 给"要盖住激光"的粒子
     *      · 其余（含 `undefined`）⇒ `#fx`（在**光束之下**、但在**玩家之上**）
     *    ⇒ 于是三条要求各自成立：
     *      · 药品火花**高于玩家**   —— 它在 `#fx`，而 `#fx` 在 `#game`（玩家）之上
     *      · 激光碎屑**高于光束**   —— `layer: 'over'` ⇒ `#fx2` 在 `#laser` 之上
     *      · 激光主闪**高于碎屑**   —— 主闪 `layer: 'over'`、碎屑默认 ⇒
     *        主闪在 `#fx2`、碎屑在 `#fx`，而 `#fx2` 在 `#fx` 之上
     *    ⚠️⚠️ **"主闪高于碎屑"必须靠两块布**：同一块布上只有"绘制先后"，
     *      而主闪和碎屑是**同一次循环里**画的、顺序还不固定（主闪是第 0 颗）
     *      ⇒ 一层里做不到"主闪整体压在碎屑上"。
     *    ⚠️ 分发开销很小：两层各 `clearRect` 一次，粒子循环**不分叉**
     *      （`ctx` 在循环外按层取好）。 */
    if (typeof FxDom !== 'undefined' && FxDom.init()) {
        /* ⚠️ 两层**每帧无条件清空** —— 它们是独立画布，不会自己擦；
         *    只在"这一帧有粒子"时才清的话，最后一批粒子消失后会留下残影。 */
        FxDom.clear('under');
        FxDom.clear('over');
        var fxCtx = { under: FxDom.ctxFor('under'), over: FxDom.ctxFor('over') };
        /* ⭐⭐ **激光源标记画到 over 层** ✗（用户 2026-10-05："把激光源层级改成高于对应激光（影响所有的）" ✔）：
         *  ⚠️ 位置必须在**上面那两句 `FxDom.clear` 之后** ✗ —— 清层是每帧无条件的 ✔，
         *    早画会被擦掉 ✔（这也是"收集 → 清完再画"的原因 ✔）。
         *  ⚠️ 覆盖范围 ✗：**玩家激光源** + **每道光束的源**（BOSS2 / 小怪 6 / BOSS4 ✗）⇒ 即"所有的" ✔。 */
        for (i = 0; i < srcMarks.length; i++) {
            var sm = srcMarks[i];
            var so = fxCtx.over;
            so.save();
            so.globalAlpha = (typeof sm.a === 'number') ? sm.a : 1;
            so.fillStyle = sm.color;
            if (sm.rect) so.fillRect(snap(sm.x - sm.wh), snap(sm.y - sm.wh), sm.wh * 2, sm.wh * 2);
            else drawSprite(so, sm.sprite, sm.x, sm.y, sm.size, sm.color);
            so.restore();
        }
        for (i = 0; i < Game.sparks.length; i++) {
            var sk = Game.sparks[i];
            var ks = Math.pow(sk.t / sk.max, sk.grow);    /* 1 → 0 */
            /* ⚠️⚠️ **尺寸先取整，再算位置**（`0.2.0` 修，用户实测报的亚像素 bug）。
             *
             * 原来的写法是 `fillRect(snap(x - ss/2), snap(y - ss/2), ss, ss)` ——
             * **位置取整了、尺寸是小数** ⇒ 右边缘落在 `snap(x - ss/2) + ss`，
             * 那个值**不是整数**（因为 `ss` 是小数）⇒ 左/上两条边落在像素格上、
             * 右/下两条边落在格子里 ⇒ canvas 对那两条边做抗锯齿，
             * 颜色按 `ss` 的小数部分混 ⇒ **右、下两侧每帧的"亮暗"都在变**，
             * 看起来就是"右侧和下侧每两帧抖一次"（用户的原话一字不差）。
             *
             * ⚠️ `snap()` 用在"尺寸"上是**错的用法**：它接受的是**坐标**，
             *    语义是"对齐到这个项目的像素网格"。尺寸用 `Math.round` 就够。
             * ⚠️ 尺寸取整的误差 ≤ 1px 且每帧最多差 1px（60fps 下看不出来）；
             *    换来的是四条边永远落在整像素上（像素风游戏必须）。 */
            var c2 = fxCtx[(sk.layer === 'over') ? 'over' : 'under'];
            if (!c2) continue;                        /* 那层用不了就跳过（别退回主画布） */
            c2.fillStyle = sk.c;
            rectAlignedOn(c2, sk.x, sk.y, sk.s0 * ks);
        }
    }

    /* 玩家（受击闪烁 + **死亡渐缩**）
     *
     * ⭐⭐ `0.2.0` 定稿：玩家死亡是**一段动画**（原地缩小直至消失），且死后再不出现。
     *
     * ⚠️⚠️ 判据**不能**用 `Game.resultPending` —— 那正是"弹窗后又冒出来"这个 bug 的根因：
     *    `endLevel()` 会把 `resultPending` 清成 `null` ⇒ 下一帧判据变 false、
     *    **玩家又被画出来了**（实测现象：失败后在结算框背后时隐时现）。
     *    ⇒ 改用独立状态 `Game.playerDeathT`（见 `update()` 那段的说明）：
     *      它从判负那帧开始递减、**不随结算框弹出而清空**，只在 `startLevel` 重置。
     *
     * 动画：`t` 从 `BAL.deathFrames` 递减，半边长 = `P.half × t / deathFrames`
     *    ⇒ 满尺寸起步、线性缩到 0。
     * ⚠️ 颜色仍是主角自己的 `P_COLOR` —— **不许换成红色**，
     *    否则又回到"受伤变红、与敌人混淆"那个坑（用户明确否过）。
     * ⚠️ 死亡渐缩期间**不叠受击闪烁**：否则缩小过程会一闪一闪。 */
    var dying = Game.playerDeathT > 0;
    if (dying) {
        /* ⚠️⚠️ 死亡渐缩要**像素对齐**（`0.2.0` 修）。
         *    `dh = P.half × (t / deathFrames)` 是**小数**（`t` 从 30 递减、
         *    `P.half = 14`）⇒ 原来写 `fillRect(snap(P.x) - dh, …, dh * 2, dh * 2)`
         *    时**右/下边缘不是整数** ⇒ 渐缩过程中那两条边一直在抗锯齿。
         *    ⚠️ 这和火花是**同一个真 bug**（数值确实是小数），
         *      与 `pop`（数值天生是整数）不同 —— 别把两者混为一谈。
         *    ⚠️ 走 `rectAligned` 还顺带保证"满尺寸那一帧"与"正常绘制那一帧"
         *      对齐到同一套取整，切换时不会跳一下。 */
        /* 死亡渐缩：**继续用方块**（缩放中的方块要的是"边缘清晰"，素材缩放会重采样；
         * 而且那是 30 帧的一次性动画，视觉上不需要素材细节）。 */
        ctx.fillStyle = PAL.player;
        rectAligned(P.x, P.y, P.half * (Game.playerDeathT / BAL.deathFrames) * 2);
    } else if (!Game.playerDead && !(P.inv > 0 && (Game.frames >> 2) % 2 === 0)) {
        ctx.fillStyle = PAL.player;
        /* ⚠️ 尺寸必须由**对齐后的右/下边缘**算出，不能写死 2*half：
         *    `P.half` = 14 ⇒ 宽 28，只 snap 左边缘会让右边缘落在取整网格外、
         *    且随位置乱跳 → 看起来"方块被压扁/拉宽"。
         *    改成与调试框同一套取整后，两者**完全重合**，尺寸偏差 <= 1 个取整单位。
         *    ⚠️ `ART` 从 2 调成 1 之后 28 已是 `ART` 的倍数，但这条写法**照样成立** ——
         *      留着它是因为"`half` 是奇数时也不出错"，别改回写死 `2 * half`。 */
        /* ⭐⭐ **素材绘制**（`0.3.0`）：尺寸仍是 2×half ⇒ 与碰撞体边界一致。 */
        drawSprite(ctx, 'player', P.x, P.y, P.half * 2, PAL.player);

        /* ⭐⭐ **"角色中间那个深色小方块"（朝向指示块）已删除**
         *    （用户 2026-10-02："**接下来删了主角中间那个黑点**"）。
         *
         * 它原来是什么：`PAL.playerMark`（`#1c1f24`，近黑）的 **4×4 方块**，画在主角中心、
         *   朝瞄准方向偏 2px —— 用来表示"你朝哪边打"。
         * 为什么可以删：① 用户明确要求；② 瞄准方向本来就有**准心**（跟着鼠标画的那个十字）
         *   在表达，主角身上再点一个黑点属于重复信息。
         * ⚠️ 那段代码的沿革值得记（它当年踩过 `ART` 的坑）：尺寸原本写的是 `ART * 2`，
         *    `ART` 从 2 调成 1 之后它**跟着缩成 2px**、偏移也从 2 变 1
         *    ⇒ 用户反馈"角色中间的黑点变小了"⇒ 当时改成写死 4px / 偏移 2px 与 `ART` 解耦。
         *    **现在整段删掉**，那个坑随之消失（`test-draw-size` 里守它的那一节也一起撤了）。
         * ⚠️ `PAL.playerMark` **保留在 `PAL` 里但已无人使用**（与 `PAL.grid` 同样处理：
         *    色值留着，注释写明 —— 哪天想把"朝向点"做回来（或烤进素材）直接取它）。 */
    }

/* ---- 测试关：把"真实碰撞几何"画出来 ----
     * ⚠️ 必须在**所有实体之后**画，否则框会被实体盖住
     *    （曾经放在障碍之后，表现成"碰撞框层级比实体低"——纯绘制顺序问题）。
     * 障碍的碰撞体是精确矩形、实体是精确方框，这里把它们显式画出来以便对照。 */
    if (currentLevel().test) drawCollisionDebug(obs);

    /* 准心（自绘，替换系统指针）
     * ⚠️ 结算框显示时**不要画**：它是 DOM（z 序高于 canvas），
     *    准心会被压在下面 → 既被遮挡又看不清，还会让人以为鼠标坏了。
     *    此时由 CSS 把系统指针还回来（.result-show）。 */
    if (Game.mode === 'play') {
        /* ⭐ 准心改用素材（`0.3.0` 图片化）：`crosshair` 是 11×11 美术像素 ⇒ 画 22×22。
         * ⚠️ 原来它是**四条 2×8 / 8×2 的方块**拼的十字；换成素材后形状由画决定
         *    （现在是"四臂 + 中心亮点"的十字 ✔ 与原来的观感一致）。 */
        drawSprite(ctx, 'crosshair', Input.pointerX, Input.pointerY, 22, PAL.accent);
    }

    // ⚠️ 文字类 HUD 不画在 canvas 上：画布内部分辨率固定 1280×720，
    //    把汉字画进去再整体放大 = 放大低分辨率位图 → 必糊。
    //    HUD 改用 DOM（见 hud.js），由屏幕分辨率渲染 → 放大也清晰。
}


/* ---- 像素对齐的方块绘制（`0.2.0`，修亚像素抖动）----
 *
 * ⭐⭐ 用户实测报的：「火花（激光命中副特效）**右侧和下侧每两帧出现一次亚像素**」。
 *
 * ## 根因
 *    原写法是 `fillRect(snap(x - s/2), snap(y - s/2), s, s)` ——
 *    **左上角取整了，尺寸却是小数** ⇒ 右边缘 = `snap(x - s/2) + s`，
 *    这个值**不是整数**（因为 `s` 是小数）⇒
 *      · 左/上两条边正好落在像素格上（**清晰**）
 *      · 右/下两条边落在格子中间 ⇒ canvas **抗锯齿**，颜色按 `s` 的小数部分混
 *    ⇒ 那个小数部分**每帧都在变** ⇒ 右/下两侧的亮度逐帧起伏，
 *      看起来就是"右侧和下侧每两帧闪一次"。**方向也正好对上**（只有右和下）。
 *
 * ## 正确写法
 *    **先定尺寸（整数），再由尺寸算位置** —— 这样四条边都落在格子上：
 *      `left = snap(x - s/2)`、`right = left + s`（都是整数）。
 *    ⚠️ 这是本文件一贯的做法（见玩家方块那段的注释：
 *      "尺寸必须由**对齐后的右/下边缘**算出，不能写死 2*half"）。
 *      当时那条教训只落实到了玩家方块，**没推广到特效** —— 所以才漏了火花。
 *
 * ## ⚠️ 为什么不能只 `Math.round(s)` 了事
 *    取整会让尺寸有 ≤1px 的量化误差（肉眼看不出，因为每帧最多差 1px）。
 *    但对"**尺寸本身就该是小数**"的动画（火花按 `pow(t/max, grow)` 缩），
 *    取整是唯一能让边缘稳定的办法 —— 要么量化尺寸，要么让边缘抖动，二选一。
 *    ⇒ 选**量化尺寸**（像素风游戏里，"边缘清晰"比"尺寸精确到 0.3px"重要得多）。
 *
 * ## ⚠️ 谁用它
 *    · 激光命中火花、`pop`（普攻命中 / 击杀爆炸 / 被击中 / **药品**）、
 *      玩家死亡渐缩 —— **全部方形粒子都走这里**。
 *    ⚠️ 历史：`pop` 一开始被判定"没问题"（用户实测）、后来用户再仔细看
 *      确认 **"大子弹确实也有同样的问题"** ⇒ 才一起改。
 *      根因是 `half` 有 13 / 14（`eb.half + hitGrowHalf`、`t.half`）
 *      这种**不是 12 的倍数**的值 ⇒ 尺寸必然是小数量级。
 *
 * ⚠️ `size` 可以是小数（会 `Math.round`），`x/y` 可以是小数（会 `snap`）。 */
function rectAligned(x, y, size) {
    return rectAlignedOn(ctx, x, y, size);
}

/* 同上，但**画到指定的上下文**（`0.2.0`，给两层特效画布用）。
 * ⚠️ 抽出来是为了"一套取整规则只有一份" —— 特效层要是自己写一遍
 *    `Math.round`，以后改取整方式就会漏掉它（正是火花那个 bug 的成因）。 */
function rectAlignedOn(c, x, y, size) {
    if (!c) return false;
    var s = Math.round(size);
    if (s < 1) return false;                    /* 缩没了就不画 */
    c.fillRect(snap(x - s / 2), snap(y - s / 2), s, s);
    return true;
}

/* ---- 测试关的碰撞几何可视化 ----
 * 目的：让"判定用的几何"与"看到的图形"能一眼比对，从而确认没有幽灵碰撞。
 *  · 障碍：蓝色细线框 = 精确判定矩形（与填充块应完全重合）
 *  · 玩家/敌人/子弹：**精确**碰撞方框（与画出的方块等大，**一个像素都不许外扩**）
 *  · 一旦哨兵发现问题，顶部面板会变红并列出条目
 *
 * ⚠️ 三条容易踩的规则：
 *   ① 本函数必须**在最后画**（所有实体之后），否则框被实体盖住；
 *   ② 框的位置**必须与碰撞体完全一致**。曾经为了"看得见"把框外扩 1 逻辑像素，
 *      结果**看起来就像幽灵碰撞**——明明还有 1px 空隙就停住了
 *      （实测被用户抓到："碰撞框层级/大小不对，以为碰撞逻辑错了"）。
 *      **调试可视化一旦画不准，就是在制造假 bug。**
 *   ③ 又要"画得准"又要"看得见" → 用**挖空法**：先给实体描一圈外框色，
 *      再把碰撞体内部的边缘带用实体自身色盖回来，只留下实体**外面那一圈**。
 *      这样框的**内边缘恰好等于碰撞体边界**：准确，且清晰。
 */
function drawCollisionDebug(obs) {
    var i;

    /* 障碍：判定矩形线框 */
    ctx.lineWidth = 1;
    ctx.strokeStyle = PAL.debugBody;
    for (i = 0; i < obs.length; i++) {
        if (obs[i].boundary) continue;                    // 边界墙不画
        ctx.strokeRect(obs[i].x + 0.5, obs[i].y + 0.5, obs[i].w - 1, obs[i].h - 1);
    }

    /* 世界边界（判定用的四边） */
    ctx.strokeStyle = PAL.debugWall;
    ctx.strokeRect(0.5, 0.5, LOGICAL_W - 1, LOGICAL_H - 1);

    /* 精确碰撞方框：外圈用框色，内侧用实体色盖回 → 只留"实体外面那一圈"
     * ⚠️ 这里的取整（顶左角 snap、右/下边缘各自 snap）必须与 render() 里
     *    玩家/敌人/子弹的填充**完全一致**，否则方块与框最多错开一个取整单位，
     *    看起来像"碰撞框没跟着实体变"。**改一边必须同时改另一边。** */
    function box(o, outline, body) {
        var h = o.half, t = ART;
        /* ⚠️ 与实体绘制**完全同一套**：snap 中心 ± half。
         *    这样框的内边缘 = 方块边缘，尺寸也恒为 2*half，不会出现
         *    "方块变扁而框没变"的观感。改一边必须同时改另一边。 */
        var cx = snap(o.x), cy = snap(o.y);
        var L = cx - h, T = cy - h, R = cx + h, B = cy + h;
        ctx.fillStyle = outline;
        ctx.fillRect(L - t, T - t, (R - L) + 2 * t, t);      // 上
        ctx.fillRect(L - t, B, (R - L) + 2 * t, t);          // 下
        ctx.fillRect(L - t, T - t, t, (B - T) + 2 * t);      // 左
        ctx.fillRect(R, T - t, t, (B - T) + 2 * t);          // 右
        /* 内侧：把碰撞体内的边缘带盖回实体色，保证框色不侵入碰撞体 */
        ctx.fillStyle = body;
        ctx.fillRect(L, T, R - L, t);
        ctx.fillRect(L, B - t, R - L, t);
        ctx.fillRect(L, T, t, B - T);
        ctx.fillRect(R - t, T, t, B - T);
    }

    var P = Game.player;
    if (P) box(P, PAL.heal, PAL.player);
    /* ⚠️ 参考色用 `ENEMY_TYPES[0].color`（原来这里是全局 `E_COLOR`，已删）——
     *    调试框只是"框住实体"，用哪个参考色不影响判读。 */
    for (i = 0; i < Game.enemies.length; i++) box(Game.enemies[i], '#ff9a6a', ENEMY_TYPES[0].color);
    for (i = 0; i < Game.ebullets.length; i++) box(Game.ebullets[i], '#e05a5a', BAL.enemy.bulletColor);
}
