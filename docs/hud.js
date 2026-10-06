/* Project Two — hud.js
 * 关卡内 HUD（**全部走 DOM**，不画在 canvas 上）

 * ⚠️ 为什么不用 canvas 画文字：
 *    canvas 内部固定 1280×720，屏幕上被放大 ~1.5 倍 ——
 *    把汉字画进去再整体放大 = 放大低分辨率位图 → **必糊**。
 *    改用 DOM 后由屏幕分辨率渲染，放大也清晰。

 * 性能：只在数值/状态**变化时**才写 DOM，避免每帧重排。
 */
'use strict';

/* ============ 关卡内 HUD（DOM 渲染） ============
 * 性能：只在数值/状态**变化时**才写 DOM，避免每帧重排。
 */
/* ⭐⭐ **技能图标 → 素材名**（`0.3.0` 图片化）。下标与 `ACTIVES` 一一对应：
 *    0 单发点射 / 1 扇形散射 / 2 环形护体 / 3 激光 / 4 冻结。
 * ⚠️ 加了新主动技就在 `ACTIVES` 后面追加一张同名素材（`assets\skill_xxx.png`，16×16 美术像素）；
 *    漏了不会报错，只是那个槽没有图标（`makeIcon` 收到 `undefined` 会返回 `null`）。
 * ⚠️⚠️ **必须定义在模块顶部、`HUD.build` 之前**：它是在"建槽循环"里读的，
 *    而 `var` 只提升声明不提升赋值 —— 定义写在 `HUD.built = true;` 附近的话，
 *    循环里读到的会是 `undefined`（图标一个都不显示，且**不报错**）。 */
var ACTIVE_ICONS = ['skill_shot', 'skill_fan', 'skill_ring', 'skill_laser', 'skill_freeze'];

/* ⭐ **造一个图标节点**（HUD 的图标一律走这里：统一尺寸、统一兜底）。
 * ⚠️ `onerror` **必须在设 `src` 之前挂** —— 否则文件缺失时来不及隐藏，
 *    会留一个"碎图"占着版面（顺序反了不报错，只是看着像坏了）。 */
function makeIcon(spriteId) {
    if (!spriteId) return null;
    var img = document.createElement('img');
    img.className = 'hud-slot-icon';
    img.onerror = function () { img.style.display = 'none'; };
    img.src = 'assets/' + ((typeof Sprites !== 'undefined' && Sprites.fileOf) ? Sprites.fileOf(spriteId) : (spriteId + '.png'));
    /* ⭐⭐ **尺寸按素材本身的美术尺寸算**（用户 2026-10-02："道具的图标似乎与实际大小不匹配"）。
     *    CSS 里原来统一写死 32px ✗ —— 那是**技能图标**（16 美术像素 × 2）的尺寸；
     *    而道具图标只有 **7×7** 美术像素 ⇒ 实际应该是 **14px**，按 32 显示等于放大 4.57 倍 ✗
     *    （非整数倍，像素还会糊）。
     *    ⇒ 用 `Sprites.LIST` 的尺寸 × `PIXEL`：技能 16→32 ✔、道具 7→14 ✔，
     *      与"游戏里实际画多大"**同一个比例** ✔（以后改素材尺寸，这里自动跟着变）。 */
    var e = (typeof Sprites !== 'undefined' && Sprites.LIST) ? Sprites.LIST[spriteId] : null;
    if (e) {
        var px = (typeof PIXEL !== 'undefined') ? PIXEL : 2;
        img.style.width = 'calc(' + (e.w * px) + 'px * var(--hud-scale))';
        img.style.height = 'calc(' + (e.h * px) + 'px * var(--hud-scale))';
    }
    return img;
}

var HUD = {
    el: {},
    cache: {},
    built: false,

    /* 技能槽 / 道具槽的**边长（逻辑像素）**。
     * ⚠️⚠️ 它是 `style.css` 里 `.hud-slot` 的 `width`/`height` 的**同一份数值**，
     *    在这里再写一遍是因为**冷却遮罩的高度要用它算**（见 `sync` 里那段）——
     *    遮罩是按比例给的 px 高度，不知道槽多高就算不出来。
     * ⚠️ 改槽尺寸时**两处都要改**（`0.2.0` 从 94×62 改成 74×74 就是一起改的）。
     *    这条脱节不会报错，只会让遮罩差一截 —— 所以测试里有一条专门对齐它们。 */
    /* ⚠️ **必须与 `style.css` 里 `.hud-slot` 的边长一致**（`test-hud` 有一条专门比它俩）。
     *    `0.3.0` 槽位改版后 = **40px**（= 20 美术像素 × `PIXEL` 2 ⇒ 正好 2 倍整数放大 ✔）。
     *    ⚠️ 以前是 74px（旧文字槽的尺寸）；冷却遮罩删掉之后这个值只用于"与 CSS 对齐"这条断言。 */
    SLOT_PX: 40,

    init: function () {
        var g = function (id) { return document.getElementById(id); };
        HUD.el = {
            hpFill: g('hud-hp-fill'), hpTxt: g('hud-hp-txt'),
        hpBar: null, mpBar: null,   /* 两条的容器（`init()` 里按填充元素反查 ✔） */
            mpFill: g('hud-mp-fill'), mpTxt: g('hud-mp-txt'),
            /* ⭐ `progress` = 「击败数 / 本关总数」那一行（`0.2.0` 合并了原来的
             *    `hud-left-enemies`（剩怪）与 `hud-kills`（击杀）两个元素）。
             *    ⚠️ 别再引用那两个旧 id —— 它们在 index.html 里已经删掉了。 */
            progress: g('hud-progress'),
            /* ⭐ `wave` = **多波关卡**在进度前面补的那句「波次 x/y 」（`0.2.1`）。
             *    单波关卡写空字符串 ⇒ 那一行与以前一字不差（见 sync 里那段）。 */
            wave: g('hud-wave'),
            slots: g('hud-slots'), item: g('hud-item'),
            test: g('hud-test'),
            hud: g('hud')
        };
        HUD.cache = {};
        HUD.built = false;
    },

    /* 重建槽位（只在技能/槽位数量变化时调用）
     * ⚠️ 全部用 createElement + appendChild，并**缓存子元素引用**。
     *    不要混用 innerHTML 与 children[i]——两者对不上，改一处就会错位。 */
    build: function () {
        var e = HUD.el;
        if (!e.slots || !e.slots.appendChild) return;
        clearChildren(e.slots);
        clearChildren(e.item);
        var i, idx, A;
        HUD.sub = { active: [], item: null };

        for (i = 0; i < Save.maxActive; i++) {
            idx = Save.loadout.active[i];
            A = (idx !== undefined) ? ACTIVES[idx] : null;
            var box = document.createElement('div');
            box.className = 'hud-slot';
            /* ⭐⭐ 槽位结构（用户 2026-10-02 定的）：
             *    ① **边框牌**（用户画的 `skill.png` / `item.png`）
             *    ② 两侧**半正方形框**（左 = 冷却进度、右 = 能量进度）
             *    ③ 技能图标压**正中**（最后 append ⇒ 在最上层 ✔）
             * ⚠️ 原来那套 `.k`（序号）/ `.n`（名字）/ `.d`（冷却秒数/耗蓝）/ `.mask`（冷却遮罩）
             *    用户明确要求**删掉**（"删除文字和多余元素"）⇒ 进度改由两侧半框表达 ✔。 */
            var fr = makeFrame('skill');
            if (fr) box.appendChild(fr);
            var rc = makeRing(true);                    /* 左：冷却 */
            if (rc) box.appendChild(rc);
            var rm = makeRing(false);                   /* 右：能量 */
            if (rm) box.appendChild(rm);
            var ic = (idx !== undefined) ? makeIcon(ACTIVE_ICONS[idx]) : null;
            if (ic) box.appendChild(ic);
            /* ⭐⭐ **按键数字**（用户 2026-10-02："在每个技能框/道具框上加对应的按钮数字"）。
             *    ⚠️ 必须与 `core.js` 的按键一一对应：`Digit1` → 槽 0、`Digit2` → 槽 1 …（`i + 1` ✔）；
             *      道具是 `KeyE` ⇒ 写 `E` ✔。改键位时**这两处要一起改**（这里是唯一的显示来源 ✗）。 */
            var kb = document.createElement('div');
            kb.className = 'hud-slot-key';
            kb.textContent = String(i + 1);
            box.appendChild(kb);
            e.slots.appendChild(box);
            /* ⚠️ **不建任何文字 DOM**（用户 2026-10-02："删除文字和多余元素"）——
             *    但保留一个**纯 JS 观察位** `desc`（只有 `.textContent` 一个字段、**不挂到页面**）：
             *    多个套件（`test-hud` / `test-loadout*` / `test-quit`）用它**读 HUD 的语义状态**
             *    （"这格是不是冷却中 / 耗多少蓝"）。它是**状态**不是**显示** ⇒ 屏幕上什么都没有 ✔。
             *    ⚠️ 以后想彻底去掉：把那些断言改成读两侧半框的进度（`cd._v` / `mp._v`）。 */
            HUD.sub.active.push({
                box: box, cd: rc, mp: rm,
                name: { textContent: A ? A.name : '空' },
                desc: { textContent: '' }
            });
        }

        var ibox = document.createElement('div');
        /* ⚠️ 类名里带 `item`：CSS 靠它把**道具的两侧半框都画成白色**（用户 2026-10-02：
         *    "冷却进度和道具次数部分用白色，能量进度部分用能量色"）。 */
        ibox.className = 'hud-slot item';
        var hasItem = Save.loadout.item >= 0;
        /* ⭐⭐ 道具槽与技能槽**同一套结构**（用户 2026-10-02）：
         *    牌（`item.png`）+ 两侧半框 + 图标压正中；文字（`.k` / `.n` / `.d`）全删 ✔。
         *    ⚠️ 道具的**两侧都表示"剩余次数比例"**（左边不是冷却）✔。 */
        var ifr = makeFrame('item');
        if (ifr) ibox.appendChild(ifr);
        var irA = makeRing(true), irB = makeRing(false);
        if (irA) ibox.appendChild(irA);
        if (irB) ibox.appendChild(irB);
        /* ⚠️ `Game.player` 在关卡外可能是 null ✗（踩过崩）⇒ 取不到就按 0 张画 ✔ */
        var iLeft0 = (Game.player && Game.player.itemLeft) ? Game.player.itemLeft : 0;
        var iic = hasItem ? makeIcon(itemSpriteId(Save.loadout.item, iLeft0)) : null;
        if (iic) ibox.appendChild(iic);
        /* ⭐ 道具的按键数字 = **`E`**（对应 `core.js` 的 `KeyE` ⇒ `Input.useItem`）✔ */
        var ikb = document.createElement('div');
        ikb.className = 'hud-slot-key';
        ikb.textContent = 'E';
        ibox.appendChild(ikb);
        /* ⭐⭐ **道具槽并进同一行**（用户 2026-10-02："技能和道具都在底部居中位置排开"）：
         *    原来它挂在 `#hud-item`（右对齐 ⇒ 显示在**右下角** ✗），
         *    现在直接接到 `#hud-slots` 这一行的**最后一位** ✔ ⇒ 整行由 CSS 居中 ✔。
         *    ⚠️ `e.item`（`#hud-item`）仍然会被 `clearChildren` 清空、保持在 DOM 里，
         *      只是不再放东西 —— 这样 `HUD.el.item` 的引用与"清空"逻辑都不用改 ✔。 */
        e.slots.appendChild(ibox);
        /* ⚠️ 同技能槽：`name` / `desc` 只是**给测试读的纯状态对象**（不挂页面、不显示）✔。
         *    屏幕上的道具槽 = 牌 + 两侧半框（剩余次数比例）+ 居中图标 ✔。 */
        /* ⚠️⚠️ **`Game.player` 可能是 `null`**（用户实测的崩溃：`hud.js:146 Cannot read properties
         *    of null (reading 'itemLeft')`）—— `build()` 会在**关卡之外**被调用
         *    （回选关、死亡后、甚至启动那一帧），那时还没有 player ✗。
         *    ⇒ 凡是"从 player 取值"的地方都要判空；取不到就给个中性值（`'无'`）✔。 */
        var P0 = Game.player;
        HUD.sub.item = {
            box: ibox, ringA: irA, ringB: irB, has: hasItem,
            /* ⭐ 存下图标与"当前用的是哪张图"，`sync()` 里按剩余次数换 `src` ✔ */
            icon: iic, sprite: hasItem ? itemSpriteId(Save.loadout.item, iLeft0) : null,
            name: { textContent: hasItem ? ITEMS[Save.loadout.item].name : '空' },
            desc: { textContent: (hasItem && P0) ? ('×' + P0.itemLeft) : '无' }
        };

        /* ⭐⭐ 两条状态条的图标（挂在**容器**上，见 `makeBarIcon` 的说明 ✔）。
         *    ⚠️ `e.hpFill.parentNode` 就是 `.hud-bar` ✔（HTML 里 fill 是它的第一个子元素 ✔）；
         *      桩里可能没有 `parentNode` ✗ ⇒ 判空，缺了就只是没有图标 ✔。 */
        e.hpBar = (e.hpFill && e.hpFill.parentNode) ? e.hpFill.parentNode : null;
        e.mpBar = (e.mpFill && e.mpFill.parentNode) ? e.mpFill.parentNode : null;
        if (e.hpBar && e.hpBar.appendChild) { var ih = makeBarIcon('icon_hp'); if (ih) e.hpBar.appendChild(ih); }
        if (e.mpBar && e.mpBar.appendChild) { var im = makeBarIcon('icon_mp'); if (im) e.mpBar.appendChild(im); }

        HUD.built = true;
        HUD.cache = {};                 // 强制下一帧全量刷新
    },

    /* ⭐⭐ **清缓存**（`0.2.1`）：下次 `sync()` 会把**每个字段都重写一遍**。
     *
     * ⚠️ 为什么需要它：`sync()` 靠"值变了才写 DOM"省开销，而缓存与 DOM 是**同一条路径**写出去的
     *    ⇒ 正常情况下两者一致。但**进关那一瞬间**屏幕上留着的是**上一关**的文字，
     *    如果新值恰好等于缓存里的旧值（例如两关都是"0 / 3"），`sync()` 就**不会写**
     *    —— 屏幕上是旧字、缓存说是新字，两边就此错开。
     *    ⇒ 进关这种"整块内容换了一批"的场合，先 `reset()` 再 `sync()`（见 `startLevel`）。 */
    reset: function () {
        HUD.cache = {};
    },

    /* 每帧调用，但只在变化时写 DOM */
    sync: function () {
        var P = Game.player;
        if (!P || !HUD.el.hpFill || !HUD.el.hpFill.style) return;
        if (!HUD.built) HUD.build();
        var e = HUD.el, c = HUD.cache, i, v;

        /* ⚠️ 血条/蓝条的文字用**中文**（用户 2026-10-01 定：`生命` / `能量`）。
         *    理由：全界面只有这两处是英文缩写，而且技能描述里本来就说"生命/法力"。
         *    ⚠️ 注意：**内部变量名不动**（`hp` / `mp` / `hpMax` / `mpMax`…）——
         *       那是几百处引用，改它属于大范围重构、与这条文案无关。
         *       而且原稿 p07 的属性表用的就是"能量"，与 `mp` 这个内部名本来也不同源。 */
        /* ⚠️⚠️ **条的宽度必须与文字分开缓存**（`0.2.0` 修的 bug）。
         *
         *    用户的反馈："一开始满，受伤后正常减少，但**回血后满血时血条没显示满**"。
         *    根因就是这里原来把"写宽度"塞在"文字变了才更新"的 `if` 里：
         *      `v = Math.ceil(P.hp) + ...` —— `hp = 9.5` 和 `hp = 10` **都算出 "10 / 10"**，
         *      所以从 9.5 血开始文字不再变化 ⇒ 宽度**再也不更新** ⇒
         *      条停在 `9.5/10 = 95%`，**回满血也还是 95%**（实测复现）。
         *    ⇒ 拆成两个缓存：
         *      · `hp`   → 只管**文字**（整数，避免每帧改 DOM 文本）
         *      · `hpW`  → 只管**条的宽度**（用**原始小数**算，所以 9.5 / 10 都会更新）
         *    ⚠️ **蓝条同理**（`Math.floor` 会让它更早就卡住）。两条一起改，别只改一条。
         *    ⚠️ 宽度取值仍是 `0~1` 的**比例**（0.5 血也会画出半个像素级的差异），
         *      不用改成整数百分比 —— DOM 宽度本来就能是小数。 */
        /* ⭐⭐ **只显示当前值**（用户 2026-10-05："让你删掉双条最大值数字" ✗）——
         *    原来写的是 `当前 / 上限` ✗；上限由**条本身的总长**表达 ✔（空色一画就看得出来 ✔）。 */
        v = String(Math.ceil(P.hp));
        if (c.hp !== v) {
            c.hp = v;
            /* ⭐ 只写**数字**（用户 2026-10-05："双条里的文字不要了，数字移到框右边" ✗）——
             *    "生命 / 能量"这两个词由**左侧图标**表达 ✔（不再重复 ✗）。 */
            e.hpTxt.textContent = v;
        }
        var w = Math.max(0, Math.min(1, P.hp / P.hpMax));
        if (c.hpW !== w) {
            c.hpW = w;
            e.hpFill.style.width = w * 100 + '%';
        }
        /* ⚠️ 同上：只留当前值 ✔（`Math.floor` 保留 —— 蓝条比血条更早"看起来满" ✗，这是原来就有的取舍 ✔） */
        v = String(Math.floor(P.mp));
        if (c.mp !== v) {
            c.mp = v;
            e.mpTxt.textContent = v;   /* 同上：图标签表达语义，这里只留数字 ✔ */
        }
        w = Math.max(0, Math.min(1, P.mp / P.mpMax));
        if (c.mpW !== w) {
            c.mpW = w;
            e.mpFill.style.width = w * 100 + '%';
        }
        /* ⭐⭐ **能量条的长度 = 数值比例**（用户 2026-10-05："长度基于数值与血条成比例"）。
         *    `--mp-ratio = mpMax / hpMax` ⇒ CSS 里乘基准宽度 ✗ ⇒ 两条条子同一单位：
         *    例如 10 生命 / 5 能量 ⇒ 能量条正好是生命条的一半长 ✔。
         * ⚠️ 两个上限都会随等级涨（`perLevel`、见 game.js），所以这个值要**跟着重算** ✗
         *    （缓存在 `c.mpRatio` 里，只在变了才写 DOM ✔）。
         * ⚠️ **夹到 3 倍**：防止以后某个等级下比例过大、长条顶到右上角那块（进度/退出 ✗）✗。 */
        var mpRatio = (P.hpMax > 0) ? Math.min(3, P.mpMax / P.hpMax) : 1;
        if (c.mpRatio !== mpRatio) {
            c.mpRatio = mpRatio;
            if (e.hud && e.hud.style && e.hud.style.setProperty) {
                e.hud.style.setProperty('--mp-ratio', String(mpRatio));
            }
        }
        /* ⭐ 「进度 a/b」：a = **已击败数**（`Game.kills`），b = **本关总数**
         *    （`Game.enemiesTotal`，进关时记一次）。
         * ⚠️ 只在这里拼字符串 —— 两个数字都来自 `Game`，不在这里自己数敌人，
         *    否则"击败数"会出现两个来源（`kills` 与 `total - enemies.length`），迟早不一致。
         *
         * ⭐⭐ **多波关卡**（`0.2.1`，用户："有复数波次的关卡，右上角一行内写：
         *    波次x/y 进度a/b，其中 b 为本波进度，而非关卡进度"）：
         *    · 前面补一句「波次 x/y 」（写进 `#hud-wave`，**同一行**）；
         *    · 分子分母都换成**本波**的：`Game.waveKills` / `Game.waveEnemiesTotal`。
         *    ⚠️ 分子必须换成 `waveKills`：拿整关的 `kills` 当分子，第二波开局就会显示
         *      "3 / 1" 这种超过分母的数字（分母是本波的）。
         *    ⚠️ **单波关卡一个字都不变**（`waveTotal <= 1` 走 else 分支，写空字符串）——
         *      `test-hud` 里那几条"进度 = 0 / 本关总数"的断言依赖这一点。 */
        if (Game.waveTotal > 1) {
            /* ⚠️ 文案格式与「进度 a / b」**对齐**（用户 2026-10-02：
             *    "接下来'波次a/b'改成和进度对应的'波次 a / b'"）：
             *    中文与数字之间一个空格、斜杠两边各一个空格 ⇒ `波次 1 / 2 进度 0 / 2`。 */
            v = '波次 ' + (Game.wave + 1) + ' / ' + Game.waveTotal + ' ';
            if (c.wave !== v) {
                c.wave = v;
                e.wave.textContent = v;
            }
            v = Game.waveKills + ' / ' + Game.waveEnemiesTotal;
        } else {
            if (c.wave !== '') {          /* 从多波关卡退回单波时也要**清掉**那句 */
                c.wave = '';
                if (e.wave) e.wave.textContent = '';
            }
            v = Game.kills + ' / ' + Game.enemiesTotal;
        }
        if (c.progress !== v) {
            c.progress = v;
            e.progress.textContent = v;
        }

        for (i = 0; i < HUD.sub.active.length; i++) {
            /* ⚠️⚠️ **两个下标不是一回事**（`0.2.0` 修，用户实测报的 bug：
             *    **"如果装备技能顺序与默认顺序不同，则使用后冷却的显示错误"**）：
             *      · `idx`  = **技能 id**（`Save.loadout.active[i]`）⇒ 用来查 `ACTIVES[idx]`
             *      · `i`    = **槽位** ⇒ 才是 `P.cds` / `P.mp` 那套的下标
             *    `castSkill(P, slot)` 里 `P.cds[slot] = …`（见 game.js）——
             *    它只知道**按了哪个键**，不知道那是哪个技能。
             *    ⚠️ 原来这里四处都写成 `P.cds[idx]` ⇒ 只在"装备顺序恰好等于 id 顺序"
             *      时才碰巧正确；一旦玩家把技能换个位置，冷却就画到**别的槽**上
             *      （实测：槽 0 放「环形护体」后，槽 0 显示"耗 5"、
             *        而没放过的槽 1 显示 "7.0s"）。
             *    ⚠️ `S.cd` 仍然用**技能自己的**冷却总时长 —— 那是技能属性，不是槽位属性。 */
            var idx = Save.loadout.active[i];
            var slot = HUD.sub.active[i];
            if (idx === undefined || !slot) continue;
            var S = ACTIVES[idx];
            var cd = P.cds[i];                              /* ⚠️ 槽位下标，不是 idx */
            var ready = cd <= 0 && P.mp >= S.cost;
            var cls = 'hud-slot' + (ready ? ' ready' : (cd > 0 ? ' cooling' : ''));
            if (c['cls' + i] !== cls) {
                c['cls' + i] = cls;
                slot.box.className = cls;
            }
            /* ⭐⭐ 两侧半框（用户 2026-10-02 定的口径）：
             *    · **左 = 冷却进度**：0% = 刚放完、100% = 已就绪（所以是"已恢复比例"）。
             *      ⚠️ 用户原话"左边表示冷却进度"，并按"条在下面中间代表 0%……上面中间 100%"读
             *        ⇒ 0% 那端点必然对应"没恢复" ✔（想要反过来只需把这里改成 `cd / S.cd`）。
             *    · **右 = 这个技能自己的能量进度**（用户 2026-10-02："能量进度是这个技能的，
             *      不是玩家能量条的"）⇒ 用**当前蓝量相对该技能的耗蓝**：`mp / S.cost`（封顶 1）。
             *      读法：**填满 = 这招现在放得出来** ✔（0% = 一点蓝都没有）；
             *      ⚠️ **不是** `mp / mpMax`（那是"玩家能量条"的口径，屏幕上另有那条蓝条 ✗）。 */
            /* ⚠️⚠️ 分母用**本次实际冷却**（`P.cdMax[slot]` ✗）—— 极速项链会把它砍半 ✔；
         *    取不到时退回 `S.cd`（理论上不会发生 ✗）✔。 */
        var cdMax = (P.cdMax && P.cdMax[i] > 0) ? P.cdMax[i] : S.cd;
        setRing(slot.cd, cdMax > 0 ? 1 - cd / cdMax : 1);
            setRing(slot.mp, S.cost > 0 ? Math.min(1, P.mp / S.cost) : 1);
            /* ⚠️ 这两个字符串**不显示**，只是给测试读的**语义状态**（见 build 里那段说明）：
             *    "这格现在是不是冷却中 / 耗多少蓝"。想要还原成文字显示时改这里即可。 */
            slot.desc.textContent = cd > 0 ? (cd / 60).toFixed(1) + 's' : ('耗 ' + S.cost);
        }

        /* ⭐ 道具：**两边都是"剩余次数比例"**（用户："道具两边都表示剩余次数比例"）✔ */
        if (HUD.sub.item) {
            var ratio = (P.itemMax > 0) ? (P.itemLeft / P.itemMax) : 0;
            if (c.itemRatio !== ratio) {
                c.itemRatio = ratio;
                setRing(HUD.sub.item.ringA, ratio);
                setRing(HUD.sub.item.ringB, ratio);
            }
            /* ⚠️ 类名必须**保留 `item`**（CSS 靠它把道具两侧都画成白色 ✔），只追加 `ready`。
             * ⭐⭐ **道具的 `ready` 不只看数量**（用户 2026-10-02："道具也做对应的（如满血/数量 0）变灰"）：
             *    还要"现在用得上" —— 满血时回血药、满蓝时回蓝药都算**不可用** ✔。
             * ⚠️ 判据走 `itemWant()`（game.js）—— 与真正"用掉"那一段**是同一个函数** ✔，
             *    所以不会出现"灰着却能用 / 亮着却用不了" ✗。取不到就退回"只看数量" ✔。 */
            var want = (typeof itemWant === 'function') ? itemWant(P) : { hp: P.itemLeft > 0, mp: false };
            var usable = P.itemLeft > 0 && (want.hp || want.mp);
            var icls = 'hud-slot item' + (usable ? ' ready' : '');
            if (c.itemCls !== icls) {
                c.itemCls = icls;
                HUD.sub.item.box.className = icls;
            }
            if (c.itemTxt !== P.itemLeft) {
                c.itemTxt = P.itemLeft;
                HUD.sub.item.desc.textContent = P.itemLeft > 0 ? ('×' + P.itemLeft) : '无';
                /* ⭐⭐ **换图**：题图里的数字就是"还剩几次" ✔ ⇒ 数量一变必须换（否则图与数字对不上 ✗）。
                 *    ⚠️ 素材已在 `Sprites.load()` 里预加载 ⇒ 换 `src` 不会闪一下 ✔。 */
                var wantSprite = itemSpriteId(Save.loadout.item, P.itemLeft);
                if (wantSprite && HUD.sub.item.sprite !== wantSprite) {
                    HUD.sub.item.sprite = wantSprite;
                    if (HUD.sub.item.icon) HUD.sub.item.icon.src = 'assets/' + ((typeof Sprites !== 'undefined' && Sprites.fileOf) ? Sprites.fileOf(wantSprite) : (wantSprite + '.png'));
                }
            }
        }

        HUD.syncTest();
    },

    /* 测试关面板：把哨兵的统计显示出来（DOM 文字，清晰） */
    syncTest: function () {
        var e = HUD.el.test;
        if (!e || !currentLevel().test) return;
        var c = COLCHECK.counts;
        var bad = c.tunnel + c.cross + c.crush + c.ghost;
        var txt =
            (bad === 0 ? '<span class="ok">碰撞检查：正常</span>'
                       : '<span class="bad">⚠ 发现 ' + bad + ' 处异常</span>') +
            '　帧 ' + c.checks +
            '　穿墙 ' + (c.tunnel ? '<span class="bad">' + c.tunnel + '</span>' : '0') +
            '　幽灵 ' + (c.ghost ? '<span class="bad">' + c.ghost + '</span>' : '0') +
                '　假阳性 ' + (c.cross ? '<span class="bad">' + c.cross + '</span>' : '0') +
            '　挤压 ' + (c.crush ? '<span class="bad">' + c.crush + '</span>' : '0') +
            '　最大速度 ' + COLCHECK.maxSpeed.toFixed(1) +
            '<br><span class="tip">' +
            '逐项试：贴墙滑行 · 撞角 · 挤窄缝 · 进小室 · 与敌人对撞 · 斜着蹭四个角' +
            '</span>' +
            (COLCHECK.lastPair && bad
                ? '<br><span class="bad">最近异常：' + COLCHECK.lastPair +
                  ' 深度 ' + COLCHECK.lastDeep.toFixed(2) + '</span>'
                : '');
        if (HUD.cache.testTxt !== txt) {
            HUD.cache.testTxt = txt;
            e.innerHTML = txt;
        }
    },
    /* 缩放倍率变化时同步 HUD 尺寸系数 */
    setScale: function (s) {
        if (HUD.el.hud && HUD.el.hud.style) HUD.el.hud.style.setProperty('--hud-scale', s);
    }
};

/* ⭐⭐ 两侧"**半正方形框**"：进度用 `stroke-dashoffset` 表示（用户 2026-10-02 定的口径）。
 *
 * 形状：从**下边中点**出发 → 下左角 → 左边中点 → 上左角 → 上边中点（右半是它的镜像）。
 * 于是进度读法正好是用户要的：
 *     0%   = 下边中点（起点）
 *     25%  = 左下角
 *     50%  = 左边中点
 *     75%  = 左上角
 *     100% = 上边中点
 * ⚠️ 靠 `pathLength="100"` 把路径长度归一化成 100 ⇒ `dasharray/dashoffset` 直接当**百分比**用 ✔。
 * ⚠️ 桩里可能没有 `createElementNS` ⇒ 返回 null（调用处判空），**不影响其余 HUD** ✔。
 * ⚠️⚠️ 这两个函数**必须在 `HUD` 对象之外**（模块顶层）：写进对象字面量里会变成语法错误
 *    （`function` 声明不能出现在对象字面量里 —— 这次就踩了，而且报错信息很绕 ✗）。 */
/* ⚠️⚠️ **路径要整体向外挪"半个笔画宽"**（2.5 个 viewBox 单位 = 1px）：
 *    笔画是沿路径**居中**画的 ⇒ 直接贴着框边画的话，会有一半**陷进框里**
 *    （用户 2026-10-02 实测："现在不是紧贴，而是**深入了一部分**" ✗）。
 *    ⇒ 把路径外移 2.5，笔画的**内边缘正好贴着框的外边缘**、整条进度条都在框外 ✔。
 *    ⚠️ 坐标超出 0~100 是**故意**的 —— SVG 靠 CSS 的 `overflow: visible` 正常画出去 ✔。 */
var RING_LEFT  = 'M 50 102.5 L -2.5 102.5 L -2.5 -2.5 L 50 -2.5';
var RING_RIGHT = 'M 50 102.5 L 102.5 102.5 L 102.5 -2.5 L 50 -2.5';
/* ⭐⭐ **两条半框改用 `canvas` 画**（用户 2026-10-05：
 *    "A1 两条半框改用 canvas 画" ✗）。
 *
 * 为什么换 ✗：原来是 **SVG 描边**（`<path stroke-width="5">` ✗）——
 *    SVG 的 stroke 会**按当前变换重采样** ✗ ⇒ 槽位像素宽 × `--hud-scale` 不是整数时，
 *    笔画落在**非整数设备像素**上 ⇒ 边上一条**半透明灰线** ✗，
 *    而且 `image-rendering: pixelated` **对 SVG 无效** ✗（那只管位图 ✗）⇒ 永远不可能是硬边 ✔。
 *
 * 现在 ✗：canvas + **轴对齐矩形 `fillRect`** ✗（坐标全取整 ✗）⇒ 硬边 ✔。
 *  ⚠️ canvas 会**裁剪**超出自身盒子的内容 ✗ ⇒ 盒子必须比 slot 大一圈 ✔
 *    （CSS 里是 `-5% / 110%` ✗ = 四周各留一个带宽 ✔）。
 *  ⚠️ 背板尺寸按**实际渲染尺寸 × DPR** 设 ✗（`getBoundingClientRect` 给的是**缩放后**的尺寸 ✔，
 *    所以 `--hud-scale` / 外层 `zoom` 都自动算进去了 ✔）。
 *  ⚠️ 进度顺序**与原来的 SVG 路径逐段一致** ✗（用户 2026-10-02 定）：
 *    **底边中点 → 下角 → 侧边（中）→ 上角 → 顶边中点** ✔
 *    ⇒ 0% 在底下中间、25% 左下角、50% 侧边中间、75% 左上角、100% 上面中间 ✔。
 *  ⚠️ 左环从**底中向左**走 ✗、右环从**底中向右**走 ✗（镜像 ✔）。
 *  ⚠️ `_v` = 上次画过的百分比（0~100 ✗，-1 = 还没画 ✗）—— 值没变就不重绘 ✔。
 *    （`test-hud` 里有断言读 `cd._v` ✗ ⇒ 这个名字不能改 ✗。） */
function makeRing(left) {
    if (typeof document.createElementNS !== 'function') return null;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'hud-slot-ring' + (left ? ' left' : ' right'));
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', left ? RING_LEFT : RING_RIGHT);
    p.setAttribute('pathLength', '100');
    p.setAttribute('stroke-dasharray', '100');
    p.setAttribute('stroke-dashoffset', '100');       /* 0% */
    svg.appendChild(p);
    svg._path = p;
    svg._v = 100;
    return svg;
}
/* 写进度（0~1）。⚠️ 值没变就不碰 DOM（与 HUD 其余部分同一条省开销的规矩）。 */
function setRing(svg, p) {
    if (!svg || !svg._path) return;
    if (!(p >= 0)) p = 0;
    if (p > 1) p = 1;
    var v = Math.round(100 * (1 - p));                /* dashoffset：0 = 画满、100 = 空 */
    if (svg._v === v) return;
    svg._v = v;
    svg._path.setAttribute('stroke-dashoffset', String(v));
}
/* ⚠️ 2026-10-05：半框曾试过改成 canvas 画（消除 SVG 描边的重采样灰边 ✗），
 *    但四条带子的贴合始终调不准（用户："还是没有贴合，退回原来的版本" ✗）
 *    ⇒ **已整体回退到 SVG 版** ✔。若以后还想试 canvas ✗，请保留这段说明 ✔。 */

/* ⭐⭐ **边框牌**（用户 2026-10-02：用他画的 `skill.png` / `item.png` 做技能/道具的边框）。
 *    与 `makeIcon` 同一套做法（统一尺寸、统一兜底）。
 *    ⚠️ 这两张图是 **20×20 满像素**（中心**不透明**）⇒ 图标压在它正中央即可，不需要挖空 ✔。 */
/* ⭐⭐ **道具图按"剩余次数"选**（用户 2026-10-05："血瓶蓝瓶图片后面的数字代表剩余使用次数，匹配之"
 *    ⇒ "指关卡内道具图片按剩余次数改变"）。
 *    素材是 **`item_heal0/1/2`、`item_mp0/1/2`**（数字画在图里 ✔，各 16×16 ✗）。
 *    ⚠️ 数量**夹在 0~2**：`BAL.item.uses` 现在是 2 ⇒ 正好三档 ✔；
 *      以后若把上限提到 3，要么再画一张 `…3`，要么这里的上限跟着改（否则会静默用旧图 ✗）。
 *    ⚠️ **必须定义在顶层**（`hud.js` 的槽位代码要调它 ✗）—— 写进 `HUD` 对象或别的函数里
 *      会变成"别的文件/别的作用域读不到"，这个坑本项目踩过三次 ✗。 */
function itemSpriteId(idx, count) {
    var IT = (typeof ITEMS !== 'undefined' && idx >= 0) ? ITEMS[idx] : null;
    if (!IT) return null;
    /* ⚠️ 名字后面**必须**拼上 0/1/2 —— 不带数字的 `item_heal` / `item_mp` **已被用户删除** ✗ */
    var base = (IT.mp > 0) ? 'item_mp' : 'item_heal';
    var n = Math.max(0, Math.min(2, Math.round(Number(count) || 0)));
    return base + n;
}

/* ⭐⭐ **状态条左侧的像素图标**（用户 2026-10-05："给生命条能量条左侧配上像素图标"）。
 *    · 素材走 `Sprites.fileOf()` ✔（真实文件名可能带 `[分数]` 前缀 ✗）；
 *    · 挂在**条的容器**里、用 CSS 摆到条外侧左边 ✔（条本身的尺寸/文字都不用动 ✔）；
 *    · 素材缺失时 `onerror` 隐藏 ✔（不会留一个"碎图"占位 ✗）。 */
function makeBarIcon(spriteId) {
    if (!spriteId || typeof document === 'undefined' || !document.createElement) return null;
    var img = document.createElement('img');
    img.className = 'hud-bar-icon';
    img.onerror = function () { img.style.display = 'none'; };
    img.src = 'assets/' + ((typeof Sprites !== 'undefined' && Sprites.fileOf) ? Sprites.fileOf(spriteId) : (spriteId + '.png'));
    img.alt = '';
    return img;
}

function makeFrame(spriteId) {
    if (!spriteId || typeof document === 'undefined' || !document.createElement) return null;
    var img = document.createElement('img');
    img.className = 'hud-slot-frame';
    img.onerror = function () { img.style.display = 'none'; };
    img.src = 'assets/' + ((typeof Sprites !== 'undefined' && Sprites.fileOf) ? Sprites.fileOf(spriteId) : (spriteId + '.png'));
    img.alt = '';
    return img;
}
