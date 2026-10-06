/* Project Two — ui.js
 * 界面菜单层：**主界面（选关 / 角色 / 商店 / 设置 四个页签）** + 结算（全部是 DOM）
 *
 * ⭐ `0.1.1` 的关键结构变化（改这个文件前先读）：
 *   `0.1.0` 是 4 块菜单屏（选关 / 战前配置 / 成长）+ 标题 + 关卡内，共 5 层，
 *   彼此靠"返回"按钮来回跳。`0.1.1` 按原稿 p13 的新界面层级图**压平**为：
 *       标题屏 → 主界面（四个**页签**）→ 关卡内
 *   选关 / 角色 / 商店 / 设置 是**同一屏的四个页签**（`UI.showTab`），
 *   切页签**不切层**，所以再没有"返回上一级"这种来回跳。
 *
 * 为什么单独一个文件：
 *   - 这部分是"菜单逻辑"，与关卡内玩法（update/render）几乎不相干
 *   - 它占了 game.js 近 280 行，混在一起改玩法时要翻很久
 *
 * 加载顺序（见 index.html）：collision -> core -> level -> hud -> ui -> game
 *   依赖：core.js（Save / changeLayer / MAIN_LAYER / TITLE_LAYER / GAME_LAYER /
 *                  ACTIVES / PASSIVES / ITEMS）
 *         hud.js（HUD.build / HUD.setScale）
 *         game.js 的 startLevel / quitToSelect 由 UI 在运行期调用
 *         -- 函数声明有提升，且回调都是"点击时才跑"，所以顺序安全。
 *
 * 文字全部走 DOM：画在 canvas 上会被整体放大成低分辨率位图，必糊。
 */
'use strict';

/* ============ 界面（DOM 菜单层） ============ */
var ITEM_MAX = 1;                    // 首版道具槽 1（1→3 放 0.2.0）

function el(id) { return document.getElementById(id); }

/* ⭐ 安全挂监听：元素不存在时**只警告，不抛异常**。
 *
 * ⚠️⚠️ 为什么必须有这个（`0.1.1` 实测踩过，代价是"一打开就黑屏"）：
 *    重写 `index.html` 时删掉了「返回」按钮，但 `UI.init()` 仍写着
 *    `el('btn-back1').addEventListener(...)` → `null.addEventListener` 抛 TypeError →
 *    **`start()` 直接中断** → `requestAnimationFrame(frame)` 没执行 →
 *    整个游戏**黑屏**（界面和画布都不动）。
 *    一个按钮没找到，不该让整个游戏起不来。
 *
 * ⚠️ 它也顺带解决"测试抓不到"的问题：测试桩里 `getElementById` 对任何 id 都返回一个
 *    新元素，所以"元素不存在"在桩里**永远不报错**（这正是黑屏能溜过 538 项自检的原因）。
 *    真要守"HTML 里的 id 和 JS 里要挂的 id 一致"，得靠 **test-screens 对着 index.html 校验**。 */
function on(id, evt, fn) {
    var node = el(id);
    if (!node || !node.addEventListener) {
        if (window.console && console.warn) console.warn('[UI] 找不到元素 #' + id + '，跳过事件绑定');
        return null;
    }
    node.addEventListener(evt, fn);
    return node;
}

/* ⭐ 安全写文本：元素不存在时**只警告，不抛异常**（与 `on()` 同一个理由）。
 *
 * ⚠️ 为什么必须有：`el('x').textContent = …` 在元素缺失时抛 TypeError，
 *    而这个异常会**顺着调用栈一路炸穿**（曾把 `start()` 打断 → 整个游戏黑屏）。
 *    实测踩过两次：① 给已删除的按钮挂监听；② 往已删除的 `s-level` 等元素写文本。
 *    一个元素没找到，不该让整局游戏起不来。
 *
 * ⚠️ 它**不是**用来掩盖"HTML 与 JS 对不上"的：真对不上时控制台会一直警告，
 *    而且 `test-screens` 第 ⑫ 节会**对着 index.html 静态校验**每个 id 是否存在。
 *    这里的容错只是"别把整个游戏带走"。 */
function setText(id, v) {
    var node = el(id);
    if (!node) {
        if (window.console && console.warn) console.warn('[UI] 找不到元素 #' + id + '，跳过写文本');
        return null;
    }
    node.textContent = v;
    return node;
}

var UI = {
    pickLevel: 0,                        // 选关屏选中的关卡

    /* ⭐ 当前页签（'select' / 'character' / 'shop' / 'settings'）。
     * ⚠️ 它是**记忆**：从关卡内退出来、从结算回来，都停在上次那个页签
     *    （见 `UI.toSelect()` 的说明）。 */
    tab: 'select',

    /* ⭐ 切页签 —— **只切 `.pane.on`，不切层**。
     *    这是 `0.1.1` 压平层级的关键：选关 / 角色 / 商店 / 设置 是同一屏的
     *    四个页签，不是四块屏。所以这里**绝对不要**调 changeLayer。
     *    回到主界面那一层由调用方负责（`UI.toSelect()` / `showMain()`）。
     *
     * ⚠️ 切页签时**重建该页签的内容**：商店的按钮要按当前金币变灰、
     *    角色的卡片要按当前配置亮灭 —— 建好不管就会显示过期状态。 */
    showTab: function (name) {
        UI.tab = name;
        var panes = ['select', 'character', 'shop', 'settings'];
        for (var i = 0; i < panes.length; i++) {
            var pane = el('pane-' + panes[i]), btn = el('tab-' + panes[i]);
            if (pane) pane.classList.toggle('on', panes[i] === name);
            if (btn) btn.classList.toggle('on', panes[i] === name);
        }
        /* ⚠️ 选关页签要**重建方块网格**，不能只刷新数字：
         *    · 通关后 ★ 计数、解锁状态都会变（不通关就回不到这里，所以一定会变）
         *    · 方块是 JS 建的（HTML 里只有空容器），不重建就一直是上次那批
         *    两个函数分工：`syncSelect` 写数字，`buildLevelList` 建方块。 */
        if (name === 'select') { UI.syncSelect(); UI.buildLevelList(); }
        else if (name === 'character') UI.buildLoadout();
        else if (name === 'shop') UI.buildShop();
        else if (name === 'settings') UI.syncSettings();
    },

    /* 切到主界面并停在**指定**页签（默认停在上次那个）。
     * ⚠️ 所有"回主界面"的路径都走这里，不要各写一套 changeLayer。
     *    外层负责刷新的页签只有"选关"（关卡列表会变），其余按需重建。 */
    showMain: function (name) {
        Game.mode = 'idle';
        changeLayer(MAIN_LAYER);
        UI.showTab(name === undefined ? UI.tab : name);
    },

    /* ⭐ 选关界面：**传统方块网格**（一个方块一个数字 = 一关）。
     *
     * 样式参照用户另一个已上线的游戏《十万流明》的选关界面：
     *   · 方块等大、`flex-wrap` 换行、整体居中；方块里只有一个数字
     *   · 顶部一个"★ 已得 / 总数"的计数框
     *   · 事件**委托在容器上**（不给每个方块单独挂监听）—— 方块会随存档重建，
     *     逐个挂监听既啰嗦、又容易漏掉重建后的那一批
     *
     * 本项目在它之上多两件事（《十万流明》全部关卡开放、没有锁）：
     *   ① **逐关解锁**（用户定）：未解锁的方块降亮度、显示"锁"，不可点
     *   ② 通关过的方块显示"★"，让进度一眼可见
     *
     * ⚠️ 真关卡与测试场**分开**：测试场（`lv.test`）没有通关条件、也不参与解锁链，
     *    它固定摆在网格**下方**单独一个按钮，不占编号。
     *
     * ⚠️⚠️ **清空必须用 DOM API，不能靠 innerHTML = ''**：
     *    本函数其余部分全是 createElement + appendChild，
     *    混用两套写法时，一旦 innerHTML 没真把子节点摘掉（如某些测试桩），
     *    每调用一次就**再追加一遍** —— 实测选关列表会变成 4 → 8 → 12 项。
     *    而 UI.toSelect() 每次回选关都会调本函数，所以这 bug 一定会发作。
     *    ⇒ 统一用 removeChild 循环清空，与后面的 appendChild 配套。 */
    buildLevelList: function () {
        var box = el('lv-list');
        if (!box) return;
        clearChildren(box);
        var i, lv, block, cleared, unlocked, label;

        /* ---- 顶部：★ 进度计数框 ---- */
        /* ⚠️ `LEVELS` 里**只有真关卡**（测试场已改成独立对象 `TEST_LEVEL`），
         *    所以这里不用再写 `if (LEVELS[i].test) continue`。
         *    ⚠️ 仍然保留那个判断没坏处，但**别再依赖它** —— 数组本身已经干净了。 */
        var total = 0, got = 0;
        for (i = 0; i < LEVELS.length; i++) {
            if (LEVELS[i].test) continue;          // 兜底：测试临时标记的关卡不计入
            total++;
            if (Save.cleared && Save.cleared[i]) got++;
        }
        var bar = document.createElement('div');
        bar.className = 'lv-star';
        bar.id = 'lv-star';
        bar.textContent = '★ ' + got + ' / ' + total;
        box.appendChild(bar);

        /* ---- 主体：关卡方块网格（一个方块 = 一关，方块里只有数字） ---- */
        var grid = document.createElement('div');
        grid.className = 'lv-grid';
        grid.id = 'lv-grid';
        var n = 0;
        for (i = 0; i < LEVELS.length; i++) {
            lv = LEVELS[i];
            if (lv.test) continue;                 // 兜底：测试临时标记的关卡不摆方块
            n++;
            cleared = !!(Save.cleared && Save.cleared[i]);
            unlocked = levelUnlocked(i);
            block = document.createElement('div');
            /* ⚠️ 状态全用 class 表达（CSS 只管外观）。
             *    关卡号存在**节点属性** `_levelId` 上（不用 `data-*`）：
             *    这里是"内部数字"，直接读属性比"塞进 DOM 再 parse 回来"简单，
             *    也不用依赖测试桩实现 `getAttribute`。
             *    点击由**容器委托**读这个属性 —— 不要在闭包里硬写 i。 */
            block._levelId = i;
            block.className = 'lv-block' + (cleared ? ' cleared' : '') + (unlocked ? '' : ' locked');
            block.id = 'lv-block-' + i;
            label = document.createElement('span');
            label.className = 'lv-num';
            label.textContent = unlocked ? String(n) : '锁';
            block.appendChild(label);
            grid.appendChild(block);
        }
        box.appendChild(grid);

        /* ---- 测试场按钮：**静态写在 HTML 里**，这里只填关卡 id ----
         * ⚠️⚠️ 为什么改成静态（`0.2.0`）：它原来由 JS **动态创建**，而
         *    「JS 引用的 id 全都在 index.html 里」那条断言（`test-screens`）
         *    会把它判成"引用了不存在的元素" ⇒ 每次 check 都红。
         *    改成静态之后 `#lv-extra-test` / `#btn-test-level` 都在 HTML 里，
         *    结构也一眼看得见（比"运行时凭空长出一个按钮"清楚）。
         * ⚠️ 显隐由 `UI.syncTestLevel()` 每帧对齐到**调试模式**（见 `core.js`）——
         *    生成时**不要**按 `debugOn` 决定建不建：本函数只在选关屏重建时跑，
         *    而调试模式是运行时开的，那时列表早建好了。
         * ⚠️ 只**填 id 与挂监听**，不改文案：文案在 HTML 里（单一真相源）。 */
        var testLv = (typeof testLevel === 'function') ? testLevel() : null;
        var tstBtn = el('btn-test-level');
        if (testLv && tstBtn) {
            tstBtn._levelId = testLv.id;
            if (!tstBtn._bound) {
                tstBtn._bound = true;
                tstBtn.addEventListener('click', function () { UI.fight(tstBtn._levelId); });
            }
        }
    },

    /* 选关网格的点击（**事件委托**）。
     * ⚠️ 只在 init 里挂**一次**，且挂在容器 `#lv-list` 上：
     *    方块是每次 `buildLevelList()` 重建的，逐个挂监听会在重建后全部失效。 */
    onLevelGridClick: function (ev) {
        var node = ev && ev.target;
        /* 从被点中的元素往上找最近的 .lv-block（点到的可能是里面的 span） */
        while (node && node !== document.body) {
            if (node.classList && node.classList.contains('lv-block')) break;
            node = node.parentNode;
        }
        if (!node || !node.classList || !node.classList.contains('lv-block')) return;
        if (node.classList.contains('locked')) return;      // 未解锁：点了没反应
        var id = node._levelId;
        if (typeof id === 'number' && !isNaN(id)) UI.fight(id);
    },
    /* ⭐ 出击：**不换页签、不换屏**，直接把这一关开起来。
     *    进关前的清洗与存档都在这里做掉，别指望"配置屏"那一步（已经不在了）。 */
    fight: function (levelId) {
        UI.normalizeLoadout();
        saveNow();
        HUD.build();                    // 按当前配置重建 HUD 槽位
        changeLayer(GAME_LAYER);
        startLevel(levelId === undefined ? (UI.pickLevel || 0) : levelId);
    },

    init: function () {
        recalcUnlocked();      // 启动时按等级对齐解锁（见 game.js）
        /* ⚠️⚠️ 挂监听一律走 `on()`，**不要直接 `el('x').addEventListener(...)`**。
         *    实测踩过（`0.1.1` 一打开就**黑屏**）：重写 index.html 时删掉了「返回」按钮，
         *    但这里仍给 `el('btn-back1')` 挂监听 → `null.addEventListener` 抛异常 →
         *    `start()` 中断 → **主循环根本没跑起来**，整个游戏黑屏。
         *    ⇒ 一个元素缺失不该让整个游戏起不来：`on()` 找不到元素时**只警告、不抛**。
         *    （警告不写进 UI，用 console.warn，免得给玩家看。） */
        on('btn-start', 'click', function () { UI.toSelect(); });
        /* ⭐⭐ 「帮助」覆盖层（`0.2.0`，用户要求"标题界面加入帮助，把操作说明移到那里面"）。
         *
         * ⚠️ 开关**只切 `#help` 的 `hidden` 类**，不碰层号、不碰 `#result` ——
         *    它是"浮在任何一层之上的一张卡片"，不是一个屏幕。
         *    （所以 HTML 里它放在 `#ui` 的直接子级，不在任何 `.screen` 里；
         *      塞进 layer1 的话进了主界面就用不到了。）
         * ⚠️ 「返回」按钮的 id 是 `btn-help-close`，**不是** `btn-help` ——
         *    两个 id 差一个词，写错的话表现是"点了没反应"（`on()` 只 warn 不抛）。
         * ⚠️ `UI.showHelp(false)` 显式传 false 关闭；不传参是打开（见那里的说明）。 */
        on('btn-help', 'click', function () { UI.showHelp(true); });
        on('btn-help-close', 'click', function () { UI.showHelp(false); });
        /* ⭐⭐ 清档按钮（`0.2.0` 从标题屏挪到**设置页签**，用户要求
         *    "删除存档移到设置那里（与返回标题同一行）"）。
         *    ⚠️ 全项目仍然**只有这一个**清档入口（id 没变，两击确认也没变），
         *      只是换了个位置 —— 见 index.html 里那段说明。 */
        on('btn-wipe', 'click', function () { UI.wipeConfirm(this); });
        /* ⭐ 页签：四个按钮各自切自己那块内容区。
         *    ⚠️ 名字集中在这个数组里，加页签**只改这里 + index.html**。
         *       名字与 `data-tab` / `pane-*` 必须一致（test-screens 会对着 HTML 校验）。 */
        var tabs = ['select', 'character', 'shop', 'settings'];
        for (var i = 0; i < tabs.length; i++) {
            (function (name) {
                on('tab-' + name, 'click', function () { UI.showTab(name); });
            })(tabs[i]);
        }
        UI.buildLevelList();                 // 关卡方块网格由数据生成（见上）
        /* ⭐ 选关网格用**事件委托**（只挂一次，见 onLevelGridClick 的说明） */
        on('lv-list', 'click', function (ev) { UI.onLevelGridClick(ev); });
        on('btn-back1', 'click', function () { changeLayer(TITLE_LAYER); });
        /* ⭐ 「小怪血条」开关（设置页签 → 显示）。
         * ⚠️ 改存档与存盘都在 `toggleMobHp()` 里（game.js），这里只刷新按钮文字 ——
         *    与 `buyPassive` / `UI.buildShop` 是同一个分工。
         * ⚠️ 刷新只改**按钮文字**，不用重建整个设置页：这一页没有别的联动项
         *    （不像商店要跟着刷新金币和别的按钮的灰态）。 */
        on('btn-mobhp', 'click', function () {
            toggleMobHp();
            UI.syncMobHp();
        });
        /* ⭐⭐ 「画面像素对齐」开关（设置页签，用户 2026-10-02）。
         *    同一个分工：改存档/存盘/立刻重算舞台都在 `toggleScaleCrisp()` 里（game.js），
         *    这里只刷新按钮文字 ✔（它自己会调 `fitStage()` ⇒ 开关立刻生效 ✔）。 */
        on('btn-scale', 'click', function () {
            toggleScaleCrisp();
            UI.syncScaleMode();
        });
        /* ⚠️ 角色页签**不再有**「出击」/「返回选关」按钮（`0.1.1` 删的）：
         *    前者与"点关卡方块开打"重复，后者与点头顶的「选关」页签重复。
         *    所以这里也不再给这两个按钮挂监听。
         *    （写注释时别把那两个 id 原样写进来：`test-screens` 会扫源码找
         *      `el/on/setText('<id>')` 并对着 HTML 校验，写进来会被当成真引用而误报。） */
        on('btn-again', 'click', function () {
            HUD.build();
            startLevel(Game.levelId);
        });
        /* ⭐ 结算框的「下一关」：直接把下一关开起来（用户 2026-10-01 要求）。
         *    ⚠️ 用 `nextLevelId()` **现算**，不要缓存下标 ——
         *       解锁状态刚在 `endLevel` 里变过（本关被标成已通关）。
         *    ⚠️ 走 `UI.fight()`（它会 normalizeLoadout + saveNow + HUD.build），
         *       不要在这里另写一套"进关准备"。 */
        on('btn-next', 'click', function () {
            var nid = nextLevelId(Game.levelId);
            if (nid === null || nid === undefined) return;   // 没有下一关：按钮本该是藏着的
            UI.fight(nid);
        });
        on('btn-result-back', 'click', function () { UI.toSelect(); });
        /* 关卡内 HUD 的"退出关卡"按钮。
         * ⚠️ 它和 update() 里的 Esc 走**同一个函数** quitToSelect()，
         *    不要在这里另写一套清理逻辑 —— 两处不一致就会出现
         *    "按钮退出正常、Esc 退出留残留"这类难查的问题。 */

        HUD.init();
        /* ⚠️⚠️ **`--hud-scale` 要传"基准倍率"，不是 1、也不是 `curScale`** ✗（`0.3.0`，用户 2026-10-02）。
         *
         * 现在的两层关系是：
         *   · 整层 `#ui` / `#hud` 被 `zoom: var(--ui-scale)` 缩放 ✔，而
         *     **`--ui-scale = `curScale / 基准``**（基准 = 首次运行的 `curScale`，见 `fitStage()` ✔）；
         *   · HUD 部件尺寸 = `Npx × --hud-scale × zoom` ✔。
         * ⇒ 要在屏幕上得到"**和画布同一个倍率**"（= 改动前的观感 ✔，也是 HUD 该有的样子 ✗），
         *   就必须让 `--hud-scale = 基准` ✔：
         *     `Npx × 基准 × (curScale / 基准)` = **`N × curScale`** ✔（与改动前逐像素一致 ✔），
         *   而且它**自动跟着窗口走** ✔（`zoom` 里已经含 `curScale` ✗ ⇒ 这里是个常量就够 ✔）。
         * ⚠️ 踩过两次：先传 `curScale`（⇒ `curScale²` 双倍 ✗），又传 `1`（⇒ HUD 不随画布放大 ✗）。
         *    判据一句话：**"部件要跟画布一样大" ⇒ 传基准；"部件不跟画布" ⇒ 传 1** ✔。 */
        HUD.setScale((typeof Save !== 'undefined' && Number(Save.uiRefScale) > 0) ? Number(Save.uiRefScale) : 1);
        UI.syncSettings();
        UI.syncRes();          // 启动就对齐一次顶栏资源（读档后的值）
    },

    /* 「删除存档」的两击确认。
     * ⚠️ 存档是玩家**唯一**的进度（等级/金币/通关记录），误点一次就全没了，
     *    所以第一次点击只把按钮变成"确认态"，再点一次才真的删。
     * ⚠️ 按钮文字**从 HTML 的初始文字取**，不要在这里写死：
     *    写死的话，改 HTML 文案（比如"删除存档，从头开始"）就会被这里悄悄改回去，
     *    而且是**跑过一次才看得出**的那种不一致（实测踩过：复位时把它写回了旧文案）。
     * ⚠️ 判断"记住了没有"要用 `_label === undefined`，**不能**用 `if (!btn._label)` ——
     *    测试桩不解析 HTML，初始 `textContent` 是空串；用真假判断会每次都当成没记过，
     *    于是第一次点击就把"No"记下来，第二次还原成空字符串。
     * ⚠️ 复位走 `syncSettings()`，别在别处再写一份文字。 */
    wipeConfirm: function (btn) {
        if (!btn) return false;
        var armed = btn.classList && btn.classList.contains('arming');
        if (!armed) {
            if (btn.classList) btn.classList.add('arming');
            if (btn._label === undefined) btn._label = btn.textContent;   // 首次点击时记住原文字
            /* ⚠️ 确认态文案是「**确认删除**」（`0.2.0`，用户要求把"再点一次清空"改成这个）
             *    —— 与按钮本身的「删除存档」配套，两处文字**要一起改**。 */
            btn.textContent = '确认删除';
            return false;
        }
        if (btn.classList) btn.classList.remove('arming');
        btn.textContent = (btn._label !== undefined) ? btn._label : '';
        wipeSave();
        /* ⭐⭐ **删完档回到标题界面**（`0.2.0`，用户两次确认后定稿）。
         *
         * ⚠️ 用 `changeLayer(TITLE_LAYER)`，**不是** `UI.toSelect()`：
         *    用户先说"确认删除存档后回到主界面"，随后改口为"**删除后回到标题界面**"。
         *    标题界面更自洽 —— 档删了 = 回到"全新玩家"的状态，
         *    而标题屏正是新玩家看到的第一屏；顶栏/页签/选关网格也都不必再刷
         *    （它们会在下次进主界面时按新档重建）。
         * ⚠️ 与「返回标题」按钮**同一个去处**（`btn-back1` 也是 `changeLayer(TITLE_LAYER)`）——
         *    两者并排放在设置页签里，去处一致才不会让人意外。
         * ⚠️ 复位按钮文字必须在跳转**之前**做完：跳走之后按钮已经被隐藏，
         *    但状态得留着 —— 万一玩家又回到设置页签，不能还停在"确认删除"上。
         * ⚠️ 回归断言在 `test-screens.cjs` 的 ⑨ 节末尾。 */
        changeLayer(TITLE_LAYER);
        return true;
    },

    /* ⭐⭐ **帮助覆盖层**（`0.2.0`，用户要求"标题界面加入帮助，把操作说明移到那里面"）。
     *
     * ⚠️ 它**只切 `#help` 的 `hidden` 类** —— 不换层、不碰 `#result`。
     *    帮助是"浮在任何一层之上的一张卡片"，不是第 4 个屏幕
     *    （所以 `index.html` 里它放在 `#ui` 的直接子级，不在任何 `.screen` 内）。
     * ⚠️ 默认参数是 `true`（打开）：`UI.showHelp()` 就等于"打开"，
     *    调用点写 `UI.showHelp(true/false)` 把意图写明白。
     * ⚠️ 用 `classList.toggle(cls, on)` 的**第二参**而不是 add/remove 二选一：
     *    一行表达"按 on 决定加还是去掉"，也避免"忘了写另一半"。
     * ⚠️ 它**不需要初始化**：HTML 里就带着 `hidden`（见那段注释），
     *    进游戏时是关着的，只有点「帮助」才开。 */
    showHelp: function (show) {
        var node = el('help');
        if (!node || !node.classList) return false;
        node.classList.toggle('hidden', !(show !== false));
        return true;
    },

    /* 设置页的只读信息，顺带刷新**版本号文本**（标题屏那行 + 设置页那行）。
     * ⚠️ 版本号只有 `GAME_VERSION`（core.js）一个来源，这里不写死 ——
     *    之前在 ui.js 里硬编码过 '0.1.1'，与水印是两份，改版时必漏一处。 */
    syncSettings: function () {
        UI.syncVersion();
        /* 复位"删除存档"的待确认态：切回来不该还停在确认态。
         * ⚠️ 清档按钮只有一个（标题屏的 `btn-wipe`），文字还原成它自己的初始值。 */
        var b = el('btn-wipe');
        if (b && b.classList) {
            b.classList.remove('arming');
            if (b._label !== undefined) b.textContent = b._label;
        }
        UI.syncMobHp();
        UI.syncScaleMode();
    },

    /* ⭐ 「小怪血条」开关的文字（用户 2026-10-01 定）。
     * ⚠️ 文字写**当前状态对应的动作**还是**当前状态本身**？
     *    这里按用户 2026-10-05 的要求写"**当前状态**"（开 / 关 ✗），
     *    而不是"点下去会发生什么"（原来的写法 ✗）—— 见下面函数里的说明 ✔。
     * ⚠️ 值从 `Save.showMobHp` 读，**不另存一份 UI 状态** ——
     *    那个字段是真相来源（存盘、render 都用它）。 */
    syncMobHp: function () {
        var b = el('btn-mobhp');
        if (!b) return;
        /* ⚠️ 用 `textContent` 而不是 `innerHTML`（别的 shop 按钮也是这么做的）。 */
        /* ⭐⭐ **显示当前状态**（用户 2026-10-05："小怪血条按钮改成显示当前状态（而非点击后状态）" ✗）
         *    —— 原来写的是"点下去会发生什么"（显示 / 隐藏 ✗），现在写"它现在是开着还是关着" ✔。
         *    ⚠️ 与 `syncScaleMode` 的口径**故意不同** ✗：那个按钮本身就是**模式名**（像素对齐 / 填满屏幕 ✗），
         *      天然表达了状态 ✔；这个按钮没有模式名可用，就直接显示开 / 关 ✔。 */
        b.textContent = Save.showMobHp ? '开' : '关';
        if (b.classList) b.classList.toggle('on', !!Save.showMobHp);
    },

    /* ⭐⭐ 「画面像素对齐」开关的文字（用户 2026-10-02）。
     *    值从 `Save.scaleCrisp` 读（**模式名本身就是状态** ⇒ 不需要"开 / 关" ✗），
     *    （那个字段是真相来源，存盘与 `pickScaleFor` 都用它 ✔，UI 不另存一份状态）。
     *    ⚠️ 默认是**开**（`Save.scaleCrisp !== false`）—— 老存档里没有这个字段 ⇒ 也算开 ✔。 */
    syncScaleMode: function () {
        var b = el('btn-scale');
        if (!b) return;
        var on = Save.scaleCrisp !== false;
        /* ⭐ 只留**模式名**（用户 2026-10-05："设置里的画面缩放的两种状态括号部分的文字删了" ✗）——
         *    括号里原来写的是"关掉更满 / 像素会差 1"，属于**解释**，按钮上不要 ✗。 */
        b.textContent = on ? '像素对齐' : '填满屏幕';
        if (b.classList) b.classList.toggle('on', on);
    },

    /* 把版本号写进所有该显示的地方（标题屏那行 + 设置页签那行）。
     * ⚠️ 两处**必须同一个来源**，否则改版时必漏一处（实测踩过：ui.js 里硬编码过一份）。
     * ⚠️⚠️ 两处的 **id 必须不同**（`ver-title` / `ver-settings`）：
     *    HTML 里 id 必须唯一，写成同一个 id 时 `getElementById` 只返回第一个，
     *    第二处就**永远刷不到**（实测踩过：刚把两处都写成 `set-ver`）。 */
    syncVersion: function () {
        var v = (typeof GAME_VERSION === 'string') ? GAME_VERSION : '';
        setText('ver-title', v);
        setText('ver-settings', v);
    },

    /* ⭐ "回主界面（选关页签）"的**唯一入口**：退出关卡 / 结算「回主界面」都走这里。
     *    ⚠️ 不要在别处自己写 changeLayer —— 抄错层号就会跑到别的界面
     *       （曾经 Esc 退出因为写死 layer1 而回到了**标题界面**）。
     *    ⚠️ 从关卡内退出来时**固定在选关页签**（不用上次记忆）：
     *       "刚打完这一关"最自然的落点就是关卡列表。 */
    toSelect: function () {
        UI.showMain('select');
    },

    /* 以下两个是"切到主界面的某个页签"的语义别名。
     * ⚠️ 名字保留是为了兼容既有调用与测试；实现统一走 showMain，
     *    不要再出现"切到某块独立的屏"那种写法。 */
    toLoadout: function () {
        UI.showMain('character');
    },

    toGrowth: function () {
        UI.showMain('shop');
    },

    /* ⭐ 结算框的按钮按结果**显示/隐藏**（每次出结算都要调，见 level.js 的 endLevel）。
     *
     * 「下一关」只在**通关**且**确实有下一关**时才显示：
     *   · 失败结算 → 没有下一关可言（藏）
     *   · 已经是最后一关 → 藏（否则点了没反应，像坏了）
     *   · 下一关还没解锁 → 藏（正常流程下不会发生：通关时刚把它解锁）
     *
     * ⚠️ 用 `.hidden` 类（`display:none !important`）而不是设 `visibility` ——
     *    隐藏的按钮不该还占位置（三个按钮里少一个，布局要跟着收）。 */
    syncResultButtons: function (win) {
        var nid = nextLevelId(Game.levelId);
        var show = !!win && nid !== null && nid !== undefined;
        var btn = el('btn-next');
        if (btn && btn.classList) btn.classList.toggle('hidden', !show);
        return show;
    },

    /* ⭐ **资源显示的唯一出口**：顶栏的金币 / 等级 / 经验。
     *
     * ⚠️⚠️ 为什么要有这个函数（`0.1.1` 实测的两个 bug，同一个根因）：
     *    ① 资源以前**同时写在两处**（顶栏 + 选关页签里的一个面板）。
     *       那个面板已删（内容与顶栏重复），但更根本的问题是——
     *       一个数字写两处，就要求**每一处变化都记得刷新两处**，漏一处就显示旧值。
     *    ② 顶栏原先**只在"切到选关页签"时**刷新（`syncSelect` 里写的），
     *       于是在**商店页签买东西**时：金币扣了、顶栏还显示旧值（实测复现）。
     *
     *    ⇒ 规矩：**任何改动 `Save.gold` / `Save.exp` / `Save.level` 的地方，
     *      之后都要调一次本函数**。目前调用点：`showTab('select')`、
     *      `init()`、`buildShop()`（进商店 / 买完东西都会重建它）、
     *      以及 `level.js` 的 `endLevel()`（加经验升级之后）。
     *    ⚠️ 加了新的"会改资源"的功能（掉落、任务奖励…），记得也调一下。 */
    syncRes: function () {
        var need = levelNeed(Save.level);
        setText('m-gold', String(Save.gold));
        setText('m-level', String(Save.level));
        setText('m-exp', Save.exp + ' / ' + need);
        /* ⭐⭐ **升级进度条**（用户 2026-10-05）—— 与数字同一个数据源 ✔：
         *    `exp / levelNeed(level)` 夹到 0~1 ⇒ 百分比宽度 ✔。
         *    ⚠️ `need` 理论上不会是 0（`levelNeed` 有下限 ✗），但仍然防一手除零 ✔。 */
        var fill = el('m-exp-fill');
        if (fill) {
            var pct = (need > 0) ? Math.max(0, Math.min(1, Save.exp / need)) : 0;
            fill.style.width = (pct * 100) + '%';
        }
    },

    /* ---- 选关页签 ----
     * ⚠️ 这里**只**刷顶栏资源；关卡方块由 `buildLevelList()` 建（见 showTab 的说明）。
     *    以前这里还写 `s-level/s-exp/s-gold/s-slots` 四个 id，那个面板已随
     *    "内容与顶栏重复"一起删掉 —— 留着写就是"往不存在的元素写"，会抛异常。 */
    syncSelect: function () {
        UI.syncRes();
    },

    /* 把「碰撞测试场」按钮的显隐对齐到**调试模式**（`0.2.0`）。
     * ⚠️⚠️ 为什么要有这个函数、而不是建列表时就决定：
     *    `buildLevelList()` 只在**重建关卡列表**时跑（进选关屏、存档变动），
     *    而调试模式是**运行时**按 `/` 开的 —— 那时列表早建好了。
     *    ⇒ 生成时一律建出来，显隐交给这里每帧对齐。
     * ⚠️ 只在"值真的变了"时才写 DOM（`_testLvShown` 记着上次的状态），
     *    否则每帧 `classList.toggle` 会让浏览器一直重算样式。
     * ⚠️ 由 `updateDebug()` 每帧调一次（见 core.js）—— 那里是 `debugOn`
     *    唯一的"扇出点"，不再另加一处主循环调用。 */
    syncTestLevel: function () {
        var wrap = el('lv-extra-test');
        if (!wrap || !wrap.classList) return;
        var want = (typeof debugMode !== 'undefined') && debugMode;
        if (UI._testLvShown === want) return;
        UI._testLvShown = want;
        wrap.classList.toggle('hidden', !want);
    },

    /* ---- 战前配置 ---- */
    buildLoadout: function () {
        recalcUnlocked();      // 等级可能变过 → 先对齐解锁（见 game.js）
        /* ⚠️ **先清洗再画**：否则会画出与清洗结果不一致的卡片
         *    （旧 bug 的表现之一就是卡片「自己又亮了」） */
        UI.normalizeLoadout();
        UI.hint('');
        var wrapA = el('pick-active');
        clearChildren(wrapA);
        /* ⚠️⚠️ 用 `skillUnlocked(i)`，**不要**写 `i >= Save.unlocked`
         *    （`0.2.0`）：`Save.unlocked` 只是"按等级解锁了几个"，
         *    而激光是**打赢第 4 关**解锁的，不在那个计数里 ——
         *    用计数判会让激光卡片永远显示"未解锁"。 */
        for (var i = 0; i < ACTIVES.length; i++) {
            wrapA.appendChild(UI.card('A', i, ACTIVES[i], !skillUnlocked(i)));
        }
        var wrapP = el('pick-passive');
        clearChildren(wrapP);
        /* ⚠️ 被动现在要**在商店买**才解锁（`passiveUnlocked`）：没买的显示"（未解锁）"、
         *    点不动 —— 复用技能那套 `locked` 表现，玩家一看就懂。 */
        for (var j = 0; j < PASSIVES.length; j++) wrapP.appendChild(UI.card('P', j, PASSIVES[j], !passiveUnlocked(j)));

        var wrapI = el('pick-item');
        clearChildren(wrapI);
        /* ⭐⭐ **道具卡全部列出，没买的显示未解锁**（`0.2.0`，用户定）。
         *    用户原话："加入回蓝药（8 点），还是只能带一个，且在商店解锁后者"。
         * ⚠️ 与**被动**同一套表现（`locked` 灰色 + 点不动），玩家一看就懂。
         *    ⚠️ 原来这里写死 `ITEMS[0]` + `false`（只有回血药、永不上锁）——
         *      加第 2 个道具时必须改成遍历，否则回蓝药**根本不会出现在界面上**。 */
        for (var k = 0; k < ITEMS.length; k++) {
            wrapI.appendChild(UI.card('I', k, ITEMS[k], !itemOwned(k)));
        }

        UI.refreshCounts();
    },

    card: function (kind, idx, data, locked) {
        var list = kind === 'A' ? Save.loadout.active : (kind === 'P' ? Save.loadout.passive : [Save.loadout.item]);
        var on = list.indexOf(idx) >= 0 && !locked;
        var d = document.createElement('div');
        d.className = 'card' + (on ? ' on' : '') + (locked ? ' locked' : '');
        d.innerHTML = '<div class="card-name">' + data.name + (locked ? '（未解锁）' : '') + '</div>' +
                      '<div class="card-desc">' + data.desc + '</div>';
        if (!locked) {
            d.addEventListener('click', function () {
                UI.toggle(kind, idx);
                UI.buildLoadout();
            });
        }
        return d;
    },

    toggle: function (kind, idx) {
        var L = Save.loadout;
        L.touched = true;              // 手动改过 → 之后不再自动补齐（见 normalizeLoadout）
        /* ⚠️⚠️ **没买的道具点不动**（`0.2.0`）：界面上它是灰的，
         *    但如果只靠 CSS，键盘/程序调用仍能选中一个未拥有的道具 ⇒
         *    进关 `itemLeft = 0`（见 `newPlayer`），表现成"带了道具却用不了"。
         *    主动 / 被动本来就有这道闸，道具一并补上。 */
        if (kind === 'I') {
            if (!itemOwned(idx)) return false;
            L.item = L.item === idx ? -1 : idx;
            return true;
        }
        var arr = kind === 'A' ? L.active : L.passive;
        var max = kind === 'A' ? Save.maxActive : Save.maxPassive;
        var at = arr.indexOf(idx);
        if (at >= 0) {
            /* ⚠️ **允许一个技能都不带**：普攻（自动开火）始终可用，
             *    空手也能正常打。以前这里拦了"至少带 1 个"，是多余的限制，
             *    现已放开（见 test-quit.cjs 的 A 组）。 */
            arr.splice(at, 1);
        } else if (arr.length < max) {
            arr.push(idx);
        } else {
            UI.hint('最多带 ' + max + ' 个');
            return false;
        }
        return true;
    },

    /* 选卡被拒时给一句话反馈（否则玩家只觉得「点了没反应」）。
     * ⚠️ 文字必须走 DOM —— 画在 canvas 上放大会糊（见 hud.js 顶部说明）。
     *    找不到提示元素时静默跳过，不能因为提示把主流程搞崩。 */
    hint: function (msg) {
        var e = el('pick-hint');
        if (e) e.textContent = msg;
    },

    refreshCounts: function () {
        el('a-count').textContent = String(Save.loadout.active.length);
        el('a-max').textContent = String(Save.maxActive);
        el('p-count').textContent = String(Save.loadout.passive.length);
        el('p-max').textContent = String(Save.maxPassive);
        el('i-count').textContent = String(Save.loadout.item >= 0 ? 1 : 0);
    },

    /* 出战配置的清洗：只清**非法**项，不擅自替玩家做选择。
     *
     * ⚠️⚠️ 这里踩过一个典型 bug（用户报「不选技能关卡内也能用」，后来又报
     *    「饰品无法正常取消」—— **同一个根因犯了两次**）：
     *    原实现**无条件**把空槽自动补满，而本函数在**进关前**和 **buildLoadout**
     *    里都会跑，结果玩家取消勾选的项立刻被补回来 ——
     *    界面上卡片当场又亮，进关当然也生效。
     *    正确做法：`loadout.touched` 为 true（玩家手动改过）时**绝不自动补**。
     *    ⚠️ 修的时候必须**三类一起改**（主动 / 被动 / 道具），
     *       只改一半就会留下"主动能取消、被动取消不掉"的怪现象。
     *
     * 规则（三类统一）：
     *   ① 去掉非法项（主动要检查是否已解锁）
     *   ② `touched` 时**绝不自动补**；只有玩家还没选过才补齐（保默认体验）
     *   ③ 允许**一个都不带**：空手也能打（普攻始终可用），
     *      不带被动 / 不带道具同理 —— 玩家的选择就是最终结果。 */
    normalizeLoadout: function () {
        var L = Save.loadout, i;
        /* ① 去掉未解锁的技能（等级没到 / 没打赢 BOSS / 老存档越界）。
         * ⚠️ 用 `skillUnlocked` 而不是 `v < Save.unlocked`（`0.2.0`）——
         *    BOSS 解锁的激光不在那个计数里，用计数会把**已经打出来的激光删掉**。 */
        L.active = L.active.filter(function (v) { return skillUnlocked(v); });
        /* ①b 去掉**没买过**的被动（商店买的才能带；老存档迁移时已全部视为买过） */
        L.passive = L.passive.filter(function (v) { return passiveUnlocked(v); });
        /* ①c 去掉**没买过**的道具（`0.2.0`，回蓝药要 30 金解锁）。
         *     没买却带着 ⇒ `itemLeft` 会是 0，界面上"带着却用不了"，自相矛盾。 */
        if (L.item >= 0 && !itemOwned(L.item)) L.item = -1;
        /* ② 只有"玩家还没手动选过"时才自动补齐，三类一起 */
        if (!L.touched) {
            for (i = 0; i < ACTIVES.length && L.active.length < Save.maxActive; i++) {
                if (skillUnlocked(i) && L.active.indexOf(i) < 0) L.active.push(i);
            }
            /* ⚠️ 被动补齐也要过 `passiveUnlocked` —— 否则新开局会被自动塞满
             *    三个**没买**的被动，配置屏上却是"未解锁"，自相矛盾。 */
            for (i = 0; i < PASSIVES.length && L.passive.length < Save.maxPassive; i++) {
                if (passiveUnlocked(i) && L.passive.indexOf(i) < 0) L.passive.push(i);
            }
            /* ⚠️ 补齐道具也要过 `itemOwned`（`0.2.0`）：写死 `0` 在
             *    "回血药将来也变成要买"时会白送 —— 与被动那两行同一条规则。 */
            if (L.item < 0) {
                for (i = 0; i < ITEMS.length; i++) {
                    if (itemOwned(i)) { L.item = i; break; }
                }
            }
        }
        /* ③ 不做任何"保底"：全空是合法配置 */
    },

    /* ---- 商店页签（原「成长」整屏并进来，依据 p13 的「商店（金）」） ----
     * ⭐ 这里放**一切花金币的东西**：属性提升 + 扩槽位。
     *    不花金币的（技能解锁进度的只读展示）也一并放这儿，玩家一眼能看到
     *    "钱能买什么、等级给什么"。
     * ⚠️ 每次进这个页签都要重建（见 UI.showTab）：按钮的"买得起/买不起"灰态
     *    依赖当时的金币，建好不管就会显示过期状态。 */
    buildShop: function () {
        recalcUnlocked();      // 等级可能变过 → 先对齐解锁（见 game.js）
        /* ⭐ 商店是**花金币**的地方：一进来（以及每次买完重建时）就把顶栏资源对齐。
         *    顶栏以前只在切到选关页签时刷新 → 买东西时数字不动（实测 bug）。 */
        UI.syncRes();
        /* ⚠️ 金币/等级**只显示在顶栏**（`UI.syncRes` 写的 `m-gold/m-level/m-exp`），
         *    这里不再重复一套 —— 两份数字迟早会不一致（那个面板已经删了）。 */

        /* ⭐ 属性**不再用金币买**（`0.1.1` 改的）—— 改成**随等级成长**。
         *    所以这一栏变成**只读展示**："每升 1 级涨多少"，让玩家知道练级有用。
         * ⚠️ 显示的是**当前值**和**每级增量**，不是"已买 N / 上限 M" ——
         *    后者是购买制的说法，现在没有"买"这件事了。
         * ⚠️ 增量与基础值都从 `BAL.player.perLevel` / `BAL.player` 读，
         *    不在这里写第二份数（数值只有一个来源）。 */
        var attrs = el('up-attrs');
        clearChildren(attrs);
        var pl = BAL.player.perLevel;
        /* ⭐ **每行只显示"名字 + 当前实际值"**（用户 2026-10-01 定）。
         *    "实际值"= 基础 + 等级成长 + **被动** —— 靠 `playerStatsNow()` 算，
         *    ⚠️ 不要在这里自己拼公式：那样会漏掉被动（踩过）。
         * ⭐ 五行**顺序与精度**跟着 `perLevel` 走 —— 以后加一项属性（比如护盾）
         *    只要往 `BAL.player` + `perLevel` 里加一个字段，这里自动多一行。
         *    ⚠️ 用**数组**而不是对象：对象在旧引擎里不保证顺序，面板顺序会乱跳。
         * ⚠️⚠️ 这里**曾经**还显示两样东西，用户明确要求删掉，别再"顺手加回来"：
         *    · 「└ 实际单发伤害」（普攻/技能各能打多少）
         *    · 「属性加成封顶 N 级」
         *    · 以及每行的"基础 X，每级 +Y"副标题 —— 现在 `val` 传空字符串。 */
        var now = playerStatsNow();
        var ATTRS = [
            { key: 'hpMax',   name: '生命上限', dec: 0, suffix: '' },
            { key: 'mpMax',   name: '能量上限', dec: 0, suffix: '' },
            /* ⭐ 后缀留空（用户 2026-10-05："能量回复的显示不要带' /秒'" ✗） */
            { key: 'mpRegen', name: '能量回复', dec: 2, suffix: '' },
            /* ⭐ 后缀留空（用户 2026-10-05："属性里攻击的显示不要带'倍'" ✗） */
            { key: 'atk',     name: '攻击',     dec: 2, suffix: '' },
            { key: 'move',    name: '移速', dec: 2, suffix: '' },
        ];
        for (var ai = 0; ai < ATTRS.length; ai++) {
            var A = ATTRS[ai];
            if (pl[A.key] === undefined) continue;          // 没有成长的属性不展示
            /* ⭐⭐ **数值与名字同行**（`0.2.0` 定稿，用户要求"下面那些数字不要单独换行"）。
             * ⚠️ 这里的要求换过两次，别只看一半：
             *    · "和下面饰品的介绍等文字统一" ⇒ 指的是**字色**（别用暗角标色）
             *    · "那些数字不要单独换行"       ⇒ 指的是**排版**（必须在同一行）
             * ⇒ 值走 `infoRow` 的第二参，渲染成 `.up-num`（`--c-text-hi`）挂在右侧。
             * ⚠️ 这个"当前值"是**只读展示**（属性随等级成长，不再花钱买），
             *    所以它也不该长得像"可按等级升级"的角标（`.tag`）。 */
            /* ⭐⭐ **数值不补零**（用户 2026-10-05："后三个属性小数显示不要补零" ✗）：
             *    原来是 `toFixed(dec)` ⇒ `1.50` / `2.00` 这种尾零很难看 ✗。
             *    现在：先 `toFixed(dec)`（**保留精度上限** ✗），再把小数末尾多余的 0 和小数点抹掉 ✔
             *    ⇒ `1.50 → 1.5`、`2.00 → 2`、`0.10 → 0.1` ✔；整数属性（dec: 0 ✗）不受影响 ✔。
             *    ⚠️ 用 `Number(...)` 转一下最省事：`String(Number(x))` 天然去掉尾零 ✔
             *      （`Number("2.00") === 2` ⇒ `"2"` ✔；不会出现科学计数法——数值都很小 ✔）。 */
            var shown = String(Number(now[A.key].toFixed(A.dec)));
            attrs.appendChild(UI.infoRow(A.name, shown + A.suffix));
        }

        var slots = el('up-slots');
        clearChildren(slots);
        /* ⭐⭐ **槽位价格逐次递增**（`0.2.1`）⇒ 价格与"买没买满"都从 `slotPrice()` 拿：
         *    `slotPrice(kind, 已买档数)`，**返回 0 就是已到上限**（见 game.js 的说明）。
         *    ⚠️ 已买档数 = `Save.maxActive - ACTIVE_SLOTS_MIN`（初始 **2** 槽 = 0 档）。
         *    ⚠️ **不要**在这里写 `Save.maxActive >= MAX_ACTIVE_SLOTS`：那是第二处"判满"，
         *      与价格表长度会不同步（表长本来就等于"还能买几档"）。
         *    ⚠️⚠️ 显示值取 `min(Save.maxActive, MAX_ACTIVE_SLOTS)`：老存档可能**比新上限还多**
         *      （`0.2.1` 把技能槽上限从 5 收到 4）—— 直接写 `Save.maxActive` 会显示成"5 / 4"。
         *      饰品槽没这个事（上限一直是 5），所以那一行照旧。 */
        /* ⭐⭐ **槽位显示：`a → a+1`，满了只显示 `a`**（用户 2026-10-05 ✗）。
     *  ⚠️ 原来是 `a / MAX` ✗（读起来像"进度" ✗）—— 用户要的是"**买下一档会变成几**" ✔。
     *  ⚠️ 满了（`a >= max` ✗）就没有"下一档" ⇒ 只显示 `a` ✔。 */
    function slotShow(a, max) {
        return (a >= max) ? String(a) : (a + ' → ' + (a + 1));
    }
    var aPrice = slotPrice('activeSlot', Save.maxActive - ACTIVE_SLOTS_MIN);
        slots.appendChild(UI.upRow(
            '技能槽',
            slotShow(Math.min(Save.maxActive, MAX_ACTIVE_SLOTS), MAX_ACTIVE_SLOTS),
            aPrice, !aPrice,
            function () { Save.maxActive++; }
        ));
        var pPrice = slotPrice('passiveSlot', Save.maxPassive - PASSIVE_SLOTS_MIN);
        slots.appendChild(UI.upRow(
            '饰品槽',
            slotShow(Save.maxPassive, MAX_PASSIVE_SLOTS),
            pPrice, !pPrice,
            function () { Save.maxPassive++; }
        ));
        /* ⚠️ 这里**不再**有"解锁技能"的购买行。
         *    依据原设计（`08` p12 / `09` 第 31 条）：技能**全靠等级解锁，不花钱**
         *    （那是 `08` 里已被废弃的技能点机制的残留）。
         *    技能解锁进度改为**只读信息行**，让玩家知道下一级能拿到什么。 */
        /* ⭐⭐ **技能解锁进度**（`0.2.0` 改）：现在有**两种**解锁方式，
         *    只用 `Save.unlocked`（按等级那个计数）显示会说谎 ——
         *    激光不在那个计数里，玩家会以为"练到 5 级就全解锁了"，
         *    而它其实要**打赢第 4 关**。
         * ⚠️ 所以这里数的是"**真的解锁了几个**"（逐个过 `skillUnlocked`），
         *    下面再补一句"下一个是怎么解锁"——**两种条件分开说**，
         *    因为"还差几级"对 BOSS 技能根本没有意义。 */
        var nUnlocked = 0, iA;
        for (iA = 0; iA < ACTIVES.length; iA++) if (skillUnlocked(iA)) nUnlocked++;
        var nextLv = nextUnlockLevel();
        /* ⭐⭐ **还锁着的 BOSS 技能列出来**（`0.2.1` 改）。
         *    原来只报一个 `BOSS_SKILL_LEVEL`（"通关第 4 关解锁"）——
         *    加了第 5 个主动（首通**关卡 8**）之后那样会说谎：已经通了第 4 关的玩家
         *    会看到"通关第 4 关解锁"，而他早通了。
         *    ⇒ 改成**按各技能自己的 `bossLevel` 列出还没通的那些关**（升序、去重）。 */
        var bossLeft = [];
        for (iA = 0; iA < ACTIVES.length; iA++) {
            var ba = ACTIVES[iA];
            if (ba.boss && !skillUnlocked(iA) && bossLeft.indexOf(ba.bossLevel) < 0) {
                bossLeft.push(ba.bossLevel);
            }
        }
        bossLeft.sort(function (x, y) { return x - y; });
        var bossTxt = bossLeft.map(function (lv) { return '第 ' + (lv + 1) + ' 关'; }).join(' / ');
        slots.appendChild(UI.infoRow(
            '技能解锁',
            /* ⭐ **不带括号内容**（用户 2026-10-05："技能解锁的显示不要带括号里的内容" ✗）：
             *    原来会补"（N 级解锁下一个）/（通关 第 X 关 解锁）/（已全部解锁）" ✗ ⇒ 现在只留计数 ✔。
             *    ⚠️ 下一级的提示没丢：仍然显示在**技能列表自己那几行**里（见下面的 S.next）✔。 */
            nUnlocked + ' / ' + ACTIVES.length


        ));

        /* ⭐⭐ **道具解锁**（`0.2.0`，用户定）。
         *
         * 用户原话：**"加入回蓝药（8 点），还是只能带一个，
         *    且在商店解锁后者（30 金永久解锁）"**。
         * ⚠️ **按表生成**（遍历 `ITEMS` 里"要买且还没买"的那些），
         *    不写死"回蓝药 30 金" —— 以后加第 3 个道具只需要往表里加一行。
         * ⚠️ 买完这一行就**不再出现**（一次性永久解锁，没有"已满"这个概念，
         *    所以不走 `upRow` 的 disabled 文案）。
         *
         * ⚠️⚠️ **它原来挂在「槽位」那一栏里、现在搬到「饰品」右边**（`0.2.0`，用户要求
         *    "商店的道具回蓝药放下面那块（饰品右边）"）。理由很清楚：
         *    原来那三行挤在"槽位"栏（技能槽 / 饰品槽 / 道具），而道具
         *    **既不是槽位、也和"槽位上限"没有关系** —— 它和饰品是同一类东西
         *    （**一次性买断、买完永久解锁**）。放在一起，玩家一眼就看懂"这两个都是解锁"。
         *    ⇒ 现在写进独立的 `#up-items` 容器（HTML 里在被动栏的**右列**）。 */
        var its = el('up-items');
        clearChildren(its);
        for (var ij = 0; ij < ITEMS.length; ij++) {
            if (!(ITEMS[ij].unlock > 0) || itemOwned(ij)) continue;
            /* ⚠️ 用 IIFE 锁住 `ij` —— 直接写进回调的话，闭包捕获的是**循环变量**，
             *    点第 1 行会解锁最后一个（经典陷阱，这里未来加第 3 个道具就会中招）。 */
            (function (idx) {
                its.appendChild(UI.upRow(
                    ITEMS[idx].name, ITEMS[idx].desc,
                    ITEMS[idx].unlock, false,
                    function () {
                        if (!Array.isArray(Save.itemOwned)) Save.itemOwned = [];
                        if (Save.itemOwned.indexOf(idx) < 0) Save.itemOwned.push(idx);
                    }
                ));
            })(ij);
        }

        /* ⭐ 饰品：**一次性购买**（买了永久解锁，之后在「角色」页签里带出战）。
         * ⭐⭐ `0.2.1`：**买过的不再出现在商店里** ——
         *    用户原话：**"饰品改成购买后和道具一样（在商店）消失"**。
         *    ⇒ 与上面「道具」那一栏**同一条规则**：这一栏只列**还没买**的。
         *    那一栏会越买越短，全买光就只剩标题（与道具栏现在的表现一致）。
         * ⚠️⚠️ **只是"不摆在货架上"，不是"没了"**：买过的被动**照旧在「角色」页签里可选**
         *    （`buildLoadout` 仍然遍历**全部** `PASSIVES`，只是把 `locked` 去掉）。
         *    两条规则别搞混：**商店 = 还没买的 / 角色 = 全部（没买的锁着）**。
         * ⚠️ 因为这里已经跳过买过的，`passiveRow` **再也收不到"已买"的下标**
         *    ⇒ 那里原来的「已解锁」按钮态**删掉了**（留着就是不可达的死分支）。
         * ⚠️ 买完要重建**整个商店**（`buildShop`）：顶栏金币、其它行的灰态都得跟着变。 */
        var pas = el('up-passives');
        clearChildren(pas);
        for (var pi = 0; pi < PASSIVES.length; pi++) {
            if (passiveUnlocked(pi)) continue;      /* 买过的从货架上拿掉 */
            pas.appendChild(UI.passiveRow(pi));
        }
    },

    /* 被动购买行：名字 + 说明 + 价格按钮。
     * ⚠️ **只会被"还没买"的被动调用**（买过的在 `buildShop` 里就被跳过了，见那里的说明）
     *    ⇒ 这里**没有**"已解锁"这个态，按钮只有两种：
     *      买得起 → 「N 金」（可点）；买不起 → 灰的「N 金」。 */
    passiveRow: function (i) {
        var P = PASSIVES[i];
        var afford = Save.gold >= P.price;
        var row = document.createElement('div');
        row.className = 'up';
        var left = document.createElement('div');
        left.innerHTML = '<div class="up-name">' + P.name + '</div>' +
                         '<div class="up-val">' + P.desc + '</div>';
        var btn = document.createElement('button');
        btn.className = 'btn small' + (afford ? '' : ' disabled');
        btn.textContent = P.price + ' 金';
        if (afford) {
            btn.addEventListener('click', function () {
                /* ⚠️ 扣钱/记档/存盘都在 `buyPassive()` 里（game.js），这里只管刷新界面 ——
                 *    免得"扣钱"这套逻辑散在 UI 里，和别处的购买各写一遍。 */
                if (buyPassive(i)) UI.buildShop();
            });
        }
        row.appendChild(left);
        row.appendChild(btn);
        return row;
    },

    /* 只读信息行：**名字 + 同行右侧的数值**（不能买，只展示）。
     * 与 `upRow` / `passiveRow` 共用 `.up` 那一套样式。
     *
     * ⚠️⚠️ **数值必须回到同一行**（`0.2.0`，用户要求
     *    "「属性提升」改「属性」，**下面那些数字不要单独换行**"）。
     *
     * 这段历史走了一圈，值得写下来，免得以后又改回去：
     *   ① 最初：`infoRow(名字, '', 值)` —— 值挂在右侧的 **`.tag`** 上，
     *      而 `.tag` 是 `--c-line2`（`#535353`，亮度 83）的**角标色** ⇒
     *      用户报"**属性提升里的属性文字太淡**"。
     *   ② 我改成：值放**名字下面**（与被动行的 `up-val` 同构、同色 `--c-dim`）⇒
     *      颜色问题解决了，但用户接着说"**那些数字不要单独换行**"。
     *   ③ 定稿：**值回到同一行**，但**不再用 `.tag`** —— 改用新的 `.up-num`
     *      （`--c-text-hi`，和名字同档亮度）。
     *      ⇒ 两个要求同时满足：同行 + 不淡。
     *
     * ⚠️ 光靠 CSS 的 `white-space: nowrap` 不够：`.up` 是 `space-between` 的 flex，
     *    左边那块（包着名字的 `div`）**默认可以换行** ⇒ 内容一宽就掉到第二行。
     *    ⇒ 配套改了 `style.css`：`.up > div { white-space: nowrap }` +
     *      商店面板加宽（`w860`）+ 上面那一行改 `shop-grid-fit`（`auto 1fr`）。
     * ⚠️ `val` 参数现在**只作为"名字下面那行副标题"**用（`passiveRow` / `upRow` 走那条路），
     *    `infoRow` 不再用它 —— 三个函数因此长得几乎一样，但**别急着合并**：
     *    它们的右侧控件不同（无 / 角标 / 价格按钮），合并要加一个 kind 参数，
     *    反而更难读。 */
    infoRow: function (name, right) {
        var row = document.createElement('div');
        row.className = 'up';
        var left = document.createElement('div');
        left.innerHTML = '<div class="up-name">' + name + '</div>';
        row.appendChild(left);
        if (right === undefined || right === null) return row;   /* 没传就不生成右侧 */
        var num = document.createElement('span');
        num.className = 'up-num';
        num.textContent = right;
        row.appendChild(num);
        return row;
    },

    upRow: function (name, val, price, disabled, doBuy) {
        var row = document.createElement('div');
        row.className = 'up';
        var left = document.createElement('div');
        left.innerHTML = '<div class="up-name">' + name + '</div><div class="up-val">' + val + '</div>';
        var btn = document.createElement('button');
        btn.className = 'btn small' + (disabled || Save.gold < price ? ' disabled' : '');
        btn.textContent = disabled ? '已满' : (price + ' 金');
        if (!disabled && Save.gold >= price) {
            btn.addEventListener('click', function () {
                Save.gold -= price;
                doBuy();
                saveNow();
                UI.buildGrowth();
            });
        }
        row.appendChild(left);
        row.appendChild(btn);
        return row;
    },

    /* 旧名兼容：`0.1.0` 里这块叫「成长」屏，`0.1.1` 并进「商店」页签后改名。
     * ⚠️ 保留它只是为了让既有调用/测试不用全改；**新代码请用 `UI.buildShop`**。 */
    buildGrowth: function () { return UI.buildShop(); }
};
