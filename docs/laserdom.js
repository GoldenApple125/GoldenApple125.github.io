/* Project Two — laserdom.js
 * 激光的 **DOM 渲染**（`0.2.0` 定稿）。
 *
 * ⚠️⚠️ **为什么不是 canvas**（读这段再改）：
 *   前面试过三条路，全被否：
 *     · 逐行栅格化 `fillRect`（零抗锯齿）—— 1 像素台阶暴露无遗
 *     · canvas 原生 `stroke`（带抗锯齿）—— 还是有明显台阶
 *     · 提高画布分辨率 / 背板跟视口 —— 与"填满屏幕"互斥，还引入半像素杂边
 *   ⇒ 根因：**canvas 的斜线是"自己栅格化"的**，而 `#stage` 又带一个非整数倍缩放
 *      （实测视口 1592 CSS 宽 ⇒ ×1.24），每个像素还要被再切一刀。
 *   ⇒ 换成 DOM：浏览器把**旋转交给合成器**、在**设备像素比**（实测 dpr = 2）
 *      下做抗锯齿 ⇒ 边缘是**设备分辨率级**的柔和（《永恒之途》那种"不刺眼、也不糊"）。
 *
 * ⚠️⚠️ **尺寸一律用 `em`**：`#stage` 的 `font-size` = 缩放倍率（`fitStage()` 设的），
 *    所以这里的数值就是**逻辑像素**，自动换算成 CSS 像素。
 *    ⇒ 改倍率策略或 `LOGICAL_W` 都不用动本文件。
 * ⚠️ 旋转轴是元素左中点（CSS `transform-origin: left center`）⇒ 位置只写 `left/top`。
 * ⚠️ 两层照《永恒之途》`v0.1.4`：**外圈宽 + 内芯窄，宽度独立**（不是等比缩小）。
 *
 * ⚠️⚠️ **导出方式**：必须像 `titlefx.js` / `hud.js` 那样用**顶层 `var`**，
 *    **不能**写 `window.LaserDom = ...` —— 测试跑在 `node:vm` 里，
 *    `window` 是**另一个对象**，挂在它上面的东西在 VM 里 `typeof` 是 `undefined`
 *    （实测踩过：21 条 DOM 断言全报 `undefined`，排查了好一阵）。 */

var LaserDom = (function () {
    'use strict';

    /* ⭐⭐ **光束池**（`0.2.1`）：0 号 = 玩家的激光（`#laser`，与 `0.2.0` 逐位一样），
     *    1~3 号 = **BOSS2 的三道激光**（`#elaser1..3`，用户："三道激光"）。
     *
     * ⚠️⚠️ **为什么是池而不是"再写一个模块"**：光束的 DOM 画法（em 单位、
     *    旋转轴在左中点、外圈宽内芯窄、颜色只在变了才写）全都是同一套 ——
     *    复制一份必然出现"改了一处忘了另一处"（本项目踩过很多次的坑）。
     * ⚠️ **每个槽位的元素用 id 抓**（不靠 `children[i]` / `querySelector`）：
     *    测试桩按 id 造元素（见 `test-logic` 的 `makeEl`），`querySelector` 在桩里不存在。
     * ⚠️ 槽位**长期存在、按需显示**（`hideAt` 只改 `display`），不做增删元素 ——
     *    每帧增删 DOM 会让合成器一直重建图层。 */
    /* ⭐ **内芯宽度**（逻辑像素，用户 2026-10-02："现在把内芯都改成 12 逻辑像素"）。
 *    ⚠️ 只有"**粗束**"档用它（外圈 16）；**警示期**那条 2px 细线的内芯不能比外圈还宽
 *      ⇒ 那一档退回 `halfWidth`（见 `drawAt` 里的判断 ✔）。 */
var LASER_CORE_W = 12;

        var SLOTS = 18;      /* ⚠️⚠️ 槽位 0 = 玩家激光 ⇒ **光束最多同时画 SLOTS-1 = 9 道** ✗。
                              *  ⚠️ 原来是 4（只能画 3 道 ✗）⇒ 用户实测："**有两只 boss2 时其警示只显示前 3 条激光的**" ✔
                              *     —— 两只 BOSS2 各 3 道 = 6 道 ⇒ 第 4~6 道**看不见却照样判定伤人** ✔。
                              *  ⚠️ 现在 9 道：够 2 只 BOSS2（6 ✗）+ 若干小怪 6 ✔；再多仍会"超标不画" ✗
                              *     （DOM 元素数是固定池 ✗ ⇒ 想彻底无上限得改成动态增删 ✔，暂不做 ✗）。 */
    var slots = [];
    /* ⚠️ 记住上次设过的颜色：颜色不随帧变，只在**真的变了**时才写 DOM。 */
    var coreC = null;

    /* ⚠️⚠️ **容器 id 从 `core.js` 的 `beamLayerIds()` 取**（"有哪些光束容器"的唯一来源）——
     *    那个列表同时被 `fitStage()` 用（给容器设 `font-size` 与宽高）。
     *    两处各写一份的话，加容器时漏改一处 ⇒ 新光束**一条都看不见**
     *    （实测踩过：`fitStage` 没给新容器设字号/宽高 ⇒ `em` 全错 + 容器 0×0 被 `overflow` 裁掉）。 */
    var IDS = (typeof beamLayerIds === 'function') ? beamLayerIds() : ['laser'];

    function slotEls(i) {
        if (slots[i]) return slots[i];
        /* 0 号 = 玩家的（`laser` / `laser-outer` / `laser-core`）；
         * 1 号起 = BOSS2 的（`elaser1` / `elaser1-outer` / `elaser1-core` …）。 */
        var base = IDS[i];
        if (!base) return null;
        var r = document.getElementById(base),
            o = document.getElementById(base + '-outer'),
            c = document.getElementById(base + '-core');
        if (!r || !o || !c) return null;
        slots[i] = { root: r, outer: o, core: c, on: null, lastOuter: null, lastCore: null };
        return slots[i];
    }

    function setBeam(el, x, y, len, w, deg) {
        el.style.left = x + 'em';
        el.style.top = (y - w / 2) + 'em';      /* 让柱子的中轴正好落在 y 上 */
        el.style.width = len + 'em';            /* ⚠️ width 是**长度** */
        el.style.height = w + 'em';             /* ⚠️ height 是**线宽** —— 别写反（写反过一次） */
        el.style.transform = 'rotate(' + deg + 'deg)';
    }

    /* 画**第 i 条**光束。参数全是**逻辑坐标/逻辑像素**。
     * ⚠️ `ox/oy` 是**放出那一帧定死的源头**（不是当前位置）——
     *    与判定用的是同一组坐标（玩家的见 game.js 的 `castSkill`，BOSS2 的见 `Game.beams`）。
     * ⚠️ `outerC` / `coreC` = **两层的颜色，都由调用方传进来**
     *    （玩家那边：内芯 `LASER_CORE`、外圈由它 `dimHex` 算；BOSS2 那边：警示红 / 生效粉红）。
     * ⚠️⚠️ 颜色**有两个来源**曾经是个真 bug：外圈色 CSS 写死一份、canvas 兜底一份，
     *    改配色时必然漏一个（改淡蓝就会留个橙色外圈）⇒ 现在只有调用方这一个来源。
     * ⚠️ 返回 `false` 表示 DOM 不可用（测试桩 / 加载失败）⇒ 调用方自己决定退不退 canvas。 */
    function drawAt(i, ox, oy, angle, len, halfWidth, alpha, outerC, coreC2) {
        var s = slotEls(i);
        if (!s) return false;
        var L = Math.max(0, len);
        /* ⭐⭐ **内外圈的宽度**（逻辑像素）。`halfWidth` = **判定带的半宽**（玩家 `LASER.halfWidth` = 8、
         *    BOSS2 `beamHalfFire` = 8）⇒ 外圈 = `× 2` = **16** ✔、内芯 = `× 1` = **8** ✔。
         *
         * ⚠️⚠️ **内芯原来写的是 `halfWidth * 0.8` = 6.4** —— 那是个**小数**，与"每个部件自身尺寸
         *    都是美术像素（`PIXEL` = 2）的整数倍"冲突（`0.3.0` 像素化审计抓出来的唯一一处）。
         *    用户 2026-10-02 定："**改成 8×1=8**"。
         * ⚠️ **改这里不影响任何判定**：宽度只是拿给 DOM 画柱子用的**表现参数**；
         *    伤害判定在 `game.js` 里另取 `LASER.halfWidth` / `BOSS2.beamHalfFire`（逻辑层），
         *    而本文件**从头到尾没碰过 `Game` / 伤害**（它只管画）—— `audit-pixel` 与
         *    `test-balance` 的激光数值断言都取自逻辑层那两处。
         * ⚠️ 两层比例从 0.4 变成 0.5（16 外 / 8 内）：内芯仍比外圈细一档，两层观感不变。 */
        /* ⭐⭐ **两层宽度**（逻辑像素）：外圈 = `halfWidth × 2`（= 16 ✔）、
         *    **内芯 = `LASER_CORE_W`（12）** ✔ ⇒ 内芯两侧各留 **2 逻辑像素（1 美术像素）** 的暗边 ✔。
         * ⚠️ **警示期例外**：那一档外圈只有 2px（细红线），内芯不能比外圈还宽 ✗
         *    ⇒ `halfWidth < 6` 时退回 `halfWidth`（= 1，维持原来的两层观感 ✔）。
         * ⚠️ 改这里**不影响任何判定**：宽度只是给 DOM 画柱子用的**表现参数** ✔
         *    （伤害判定另取 `LASER.halfWidth` / `BOSS2.beamHalfFire` ✔）。 */
        var wO = halfWidth * 2;
        var wC = (halfWidth >= 6) ? LASER_CORE_W : halfWidth;
        var x = Math.round(ox), y = Math.round(oy);
        var deg = angle * 180 / Math.PI;
        /* ⚠️ 颜色只在**真的变了**时写 DOM（颜色不随帧变，每帧写是白写）。 */
        if (outerC && outerC !== s.lastOuter) { s.outer.style.background = outerC; s.lastOuter = outerC; }
        if (coreC2 && coreC2 !== s.lastCore) { s.core.style.background = coreC2; s.lastCore = coreC2; }
        setBeam(s.outer, x, y, L, wO, deg);
        setBeam(s.core, x, y, L, wC, deg);
        s.root.style.opacity = (alpha === undefined || alpha === null) ? '1' : String(alpha);
        if (s.on !== true) { s.root.style.display = 'block'; s.on = true; }
        return true;
    }

    function hideAt(i) {
        var s = slotEls(i);
        if (!s) return;
        if (s.on !== false) { s.root.style.display = 'none'; s.on = false; }
    }

    return {
        SLOTS: SLOTS,
        /* ⚠️ 挂出来给 `render.js` 的**画布兜底**用 —— 两条路径必须同宽 ✔ */
        CORE_W: LASER_CORE_W,
        /* ⚠️ 让测试能核对"池子里的槽位数 = `fitStage()` 遍历的容器数"（见 core.js 的 beamLayerIds）。 */
        IDS: IDS,

        /* 0 号（玩家激光）的专用入口 —— `render.js` 那边一行都不用改。 */
        draw: function (ox, oy, angle, len, halfWidth, alpha, outerC, coreC2) {
            return drawAt(0, ox, oy, angle, len, halfWidth, alpha, outerC, coreC2);
        },
        hide: function () { hideAt(0); },

        /* 指定槽位（BOSS2 的光束用 1~3）。 */
        drawAt: drawAt,
        hideAt: hideAt,

        /* ⭐ 把 **1 号之后的所有槽位**全部藏掉（BOSS2 的光束数量是变的：
         *    这一帧可能只有 2 道 —— 上一帧的第 3 道必须消失，否则会**留在画面上**）。
         *    ⚠️ 不碰 0 号（那是玩家的激光，由 `render.js` 自己管）。 */
        hideExtra: function () {
            for (var i = 1; i < SLOTS; i++) hideAt(i);
        }
    };
})();
