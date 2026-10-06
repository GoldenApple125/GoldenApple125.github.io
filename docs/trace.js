/* Project Two — trace.js
 * ⭐ **事件追踪（诊断用）**：把"输入操作 / 层与状态变化"记进一个环形缓冲，
 *    异常发生时可以回看**出事前发生了什么**。
 *
 * ⚠️ 起因：用户报告"点关卡按钮（如 1），闪一下又回到选关界面"，**偶发两次**。
 *    我在 Node 里复现不出来（200 次进关 + 30×200 帧全正常），而这是**浏览器特有**
 *    的现象 ⇒ 需要把现场记下来，而不是继续猜。
 *
 * 用法：
 *   · `window.__trace()`        —— 在浏览器控制台调，打出全部记录
 *   · `window.__trace(30)`      —— 只看最近 30 条
 *   · 按 **F1** 两次（开面板）—— 面板底部会附上最近几条追踪（见 core.js 的 updateDebug）
 *   · ⚠️ 它**同时**在 `console` 里打一份，所以直接开着控制台也行
 *
 * ⚠️⚠️ **它不该影响玩法**：
 *   · 只 push 进数组、不读写任何游戏状态
 *   · 环形缓冲有上限（`TRACE_MAX`），跑多久都不会吃内存
 *   · 每条只有几个字段，没有 JSON.stringify（那会在大对象上很慢）
 *
 * ⚠️ 这是**临时诊断设施**，定位完可以删（删的时候记得去掉 3 处 `Trace.add` 调用
 *    与 index.html 的 script 标签、hud 面板那段）。
 */
'use strict';

var Trace = {
    /* 环形缓冲：只留最近 `TRACE_MAX` 条 */
    TRACE_MAX: 240,
    buf: [],
    /* 上一帧的层/模式，用来记"变化"而不是每帧都记（否则缓冲瞬间被刷满） */
    lastLayer: null,
    lastMode: null,
    lastExit: false,
    /* 上一次「切换前的层」，用来判「来回切」（见 tick 里的闪检测）。
     * ⚠️ 与 `lastLayer` 不同：`lastLayer` 是"当前所在层"，
     *    `prevLayer` 是"再上一个层"，两者配合才能认出 A→B→A。 */
    prevLayer: null,
    /* ⭐ **闪的判定窗口**（帧）。`0.2.0` 用户定："实际发生时应在 **1s** 内"。
     *
     * ⚠️⚠️ 这个窗口是**必需的**，第一版漏了它、结果太敏感：
     *    只判 "A→B→A" 而不看隔了多久 ⇒ 正常的"出关卡再进去"（隔几秒、
     *    是两次独立操作）也会报"闪"，而那种情况**根本看不出闪**。
     * ⚠️ 帧率固定 60（见 core.js 的 `STEP_MS`）⇒ **60 帧 = 1.0 秒**。
     *    用**帧**而不是 `Date.now()`：与游戏逻辑同一套刻度，且不受
     *    "页面在后台被 rAF 节流"影响（那种情况下墙上时间会失真）。
     *
     * ⚠️ **语义说清楚**（我一开始按"空转次数"数，误以为边界差了 1 帧）：
     *    这里量的是"**离开原层到回到原层之间隔了多少帧**"，
     *    `<= 60` 就是"**1 秒以内**来回切"。实测
     *    `tick#2 在 f2 切走 → tick#3 在 f62 切回 ⇒ 间隔 60 帧 ⇒ 报` ✅，
     *    而间隔 61 帧（1.016 秒）就不报 —— 与"1s 内"这个要求一致。
     *    ⇒ 别再拿"空转了几次"去对它，那个数会差 1（检测本身也占一次 tick）。 */
    FLASH_FRAMES: 60,
    /* 闪检测用的帧计数与"上一次切换发生在第几帧" */
    frames: 0,
    prevLayerFrame: 0,

    /* 记一条。`tag` 短、便于扫；`extra` 可选，**只放短字符串**。 */
    add: function (tag, extra) {
        var t = {
            /* 用**帧数**当时间戳而不是 Date.now()：与游戏逻辑同一套刻度，便于对照。
             * ⚠️ `Game.frames` 在进入关卡时才累加，菜单里可能不变 ——
             *    所以**同时**记一个自增序号，保证"先后顺序"永远可读。 */
            n: Trace.buf.length ? Trace.buf[Trace.buf.length - 1].n + 1 : 0,
            f: (typeof Game !== 'undefined' && Game.frames) ? Game.frames : 0,
            tag: tag,
            info: extra === undefined ? '' : String(extra)
        };
        Trace.buf.push(t);
        if (Trace.buf.length > Trace.TRACE_MAX) Trace.buf.shift();
        /* ⚠️ 控制台也打一份：这样用户**不用做任何操作**，出事后直接看控制台即可。
         *    加 `[T]` 前缀便于过滤。 */
        try { console.log('[T] ' + t.tag + (t.info ? '  ' + t.info : '')); } catch (e) { /* 忽略 */ }
    },

    /* ⭐ 每帧扫一遍"层 / 模式 / 退出请求"，**只在变化时**记一条。
     *    ⚠️ 这就是抓这个 bug 的关键：如果界面自己跳回选关，
     *      这里会留下 `layer 3→2` 与"当时 mode 是什么"。 */
    tick: function () {
        if (typeof layer === 'undefined') return;
        /* 当前帧号（`Game.frames` 在菜单里可能不涨，所以用 tick 自己的计数器） */
        Trace.frames++;

        var m = (typeof Game !== 'undefined') ? Game.mode : '-';
        if (layer !== Trace.lastLayer || m !== Trace.lastMode) {
            Trace.add('画面 ' + Trace.lastLayer + '/' + Trace.lastMode + ' → ' + layer + '/' + m);

            /* ⭐⭐ **「闪一下」检测**：用户报告过**两个方向**的闪烁 ——
             *      · 点关卡 → 闪一下**回到选关**（最终停在选关）
             *      · 点关卡 → 先正常进关，选关界面又**闪了一瞬间**（最终仍在关内）
             *    两者都是"层在**极短时间内**来回切"。
             *
             * ⚠️⚠️ **必须加时间窗口**（用户指出："实际发生时应在 1s 内"）。
             *    第一版只判"A→B→A"、**不看多久** ⇒ 太敏感：
             *    用户正常的来回切（进出关卡、切页签再回来）也会报，
             *    而那种情况**根本看不出闪**（隔了几秒，是两次独立操作）。
             *    ⇒ 现在要求"回到原层"与"离开原层"之间 **<= `FLASH_FRAMES`**。
             *
             * ⚠️ 判据是"**来回**切"（A→B 后回到 A），不是"切了两次" ——
             *    连续同向切换（1→2→3）是正常的（标题→主界面→关卡）。 */
            if (Trace.prevLayer !== null && layer === Trace.prevLayer) {
                var dt = Trace.frames - Trace.prevLayerFrame;
                if (dt <= Trace.FLASH_FRAMES) {
                    Trace.add('⚠⚠ 层来回切了一下（' + Trace.prevLayer + ' → ' + Trace.lastLayer +
                              ' → ' + layer + '，间隔 ' + dt + ' 帧）—— 这就是「闪」');
                }
            }
            Trace.prevLayer = Trace.lastLayer;
            Trace.prevLayerFrame = Trace.frames;
            Trace.lastLayer = layer;
            Trace.lastMode = m;
        }
        var ex = (typeof Input !== 'undefined') ? !!Input.exit : false;
        if (ex && !Trace.lastExit) Trace.add('★ Input.exit 被置起');
        Trace.lastExit = ex;
    },

    /* 打出记录（控制台用）。`n` 省略 = 全部。 */
    dump: function (n) {
        var list = Trace.buf;
        if (n > 0) list = list.slice(-n);
        var out = list.map(function (t) { return '  #' + t.n + ' f' + t.f + '  ' + t.tag + (t.info ? '  ' + t.info : ''); });
        try { console.log('===== Trace（共 ' + Trace.buf.length + ' 条，显示 ' + list.length + '）=====\n' + out.join('\n')); } catch (e) { /* 忽略 */ }
        return out.join('\n');
    }
};

/* 浏览器控制台入口 */
try { window.__trace = function (n) { return Trace.dump(n); }; } catch (e) { /* 忽略 */ }
