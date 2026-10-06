/* 特效画布的句柄（`0.2.0`）—— 两层：光束**之下** / **之上**。
 *
 * ## 为什么要单独一个文件
 * 与 `laserdom.js` 同一个理由：`render.js` 负责"画什么"，这里负责"画到哪块布上"。
 * `render.js` 里不该出现 `getElementById('fx2')` 这种字眼
 * （`check-hygiene` 也会盯"谁引用了不存在的元素"）。
 *
 * ## 层级（DOM 顺序，见 index.html 顶部那张表）
 *     ① `#game`  背景 / 障碍 / 敌人 / 子弹 / `pop` / **玩家**
 *     ② `#fx`    **光束之下**的命中特效（激光主闪、药品火花）
 *     ③ `#laser` 激光光束（DOM 元素）
 *     ④ `#fx2`   **光束之上**的命中特效（激光碎屑）
 *     ⑤ `#ui`    HUD
 *
 * ⚠️⚠️ 用户原话：**"喝药火花层级应高于玩家，激光主闪和火花也改成高于激光
 *    （其中主闪高于火花）"**。拆开就是三条：
 *      · 药品火花 > 玩家        ⇒ 画到 `#fx`（在 `#game` 之上）
 *      · 激光碎屑 > 光束        ⇒ 画到 `#fx2`（在 `#laser` 之上）
 *      · 激光主闪 > 激光碎屑    ⇒ 主闪画到 `#fx`、碎屑画到 `#fx2`
 *        ⚠️ 这一条**必须靠两块布**：同一块布上只有"绘制先后"、没有"分帧穿插"，
 *          画不出"主闪在火花之上、火花又各自在光束之上"。
 *
 * ⚠️ 两块布的**像素尺寸与 `#game` 完全一致**（都是 1280×720 逻辑像素，
 *    由 `core.js` 的 `fitStage()` 统一设）⇒ 坐标**可以直接照搬**，不用换算。
 *    这也是为什么它俩的 CSS 与 `#game` 一模一样（`left/top:0` + `100%×100%`）。
 */
'use strict';   /* 与 laserdom.js 保持一致的写法（该文件也是 'use strict'） */

var FxDom = {
    /* 两块布的 canvas 与 2d 上下文，`init()` 里抓一次 */
    base: null, over: null,
    bctx: null, octx: null,
    _inited: false,

    /* 抓元素、建上下文。
     * ⚠️ 幂等：`start()` 里调一次就行；重复调不会重建（免得把已画的清掉）。 */
    init: function () {
        if (FxDom._inited) return true;
        var b = document.getElementById('fx');
        var o = document.getElementById('fx2');
        if (!b || !o) return false;
        FxDom.base = b; FxDom.over = o;
        FxDom.bctx = b.getContext ? b.getContext('2d') : null;
        FxDom.octx = o.getContext ? o.getContext('2d') : null;
        FxDom._inited = true;
        return true;
    },

    /* 取某一层的 2d 上下文。
     * ⚠️ 返回 `null` 表示"这层用不了"（元素缺失 / 测试桩没建）⇒
     *    调用方要**直接跳过**，不要退回主画布 ——
     *    那样会出现"测试里看着对、真机上层级错"的假象。 */
    ctxFor: function (layer) {
        if (!FxDom._inited) FxDom.init();
        return (layer === 'over') ? FxDom.octx : FxDom.bctx;
    },

    /* 清空某一层（每帧渲染前调一次）。
     * ⚠️ `clearRect` 而不是 `width = width`（后者会重置整个上下文状态、
     *    而且**慢得多**）。 */
    clear: function (layer) {
        var c = FxDom.ctxFor(layer);
        if (c) c.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
        return !!c;
    }
};
