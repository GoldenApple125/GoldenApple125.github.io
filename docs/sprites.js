/* ⭐⭐ **占位素材层**（`0.3.0` 像素化）—— 全场实体与子弹都从这里画。
 *
 * ## 为什么要有这一层
 * `0.2.x` 的实体是 `ctx.fillRect` 直接涂的**纯色方块**：能跑，但（a）没法换成美术素材，
 * （b）画面上没有"像素"这个概念。这一层做两件事：
 *   ① **素材 = PNG 文件**（`assets\*.png`，纯色占位，由 `tools\make-sprites.cjs` 生成）
 *   ② **绘制只有一个入口**（`Sprites.draw`）⇒ 将来换真素材只改文件，不改代码
 *
 * ## 规格（与 `tools\make-sprites.cjs` 一一对应，改单边会被断言抓住）
 * · PNG 是**美术分辨率**（玩家 14×14、BOSS 28×28、子弹 5×5…）
 * · 绘制时按 **`PIXEL`（= 2 画布像素 / 美术像素）整数放大** ⇒ 每个美术像素正好是
 *   2×2 画布像素，**边缘不会重采样**（`imageSmoothingEnabled = false` 已在 `fitStage` 设好）
 * · 目标尺寸 = 实体的**碰撞尺寸**（`2 × half`）⇒ 视觉与判定**边界完全一致**
 *   ⚠️ 这是本项目从 `0.2.0` 起守着的一条（"方块 = 框"），素材**不许留透明边距**
 *
 * ## ⚠️ 两种绘制路径（有意保留）
 * · **有图** ⇒ `ctx.drawImage(img, x, y, w, h)`（浏览器里跑的就是这条）
 * · **没图**（Node 测试桩 / 图还没加载完 / 文件缺失）⇒ 退回 `fillRect` 纯色块
 *   ⇒ **几何逐字相同**，所以那一批像素对齐断言在两条路径下都成立。
 *   ⚠️ 别把这条兜底删掉：测试环境没有 `Image`，删了等于整批渲染断言全废。
 *
 * ## 加载时机
 * `Sprites.load()` 在 `index.html` 里由 `core.js` 的启动流程调（见 `boot()`），
 * **异步**：加载完成前画的是兜底方块，完成后自动变素材（第一帧可能还是方块，可接受）。
 */
var Sprites = {
    /* 素材清单：`w/h` 是**美术像素**，`pal` 指回 `PAL` 里的颜色（兜底色 + 生成器的色源）。
     * ⚠️ 这张表是**唯一真相**：`tools\make-sprites.cjs` 的清单、`tools\test-visual.cjs`
     *    的断言、以及 PNG 文件本身都必须与它一致。 */
    LIST: {
        player:      { w: 14, h: 14, pal: 'player', file: '[10]player.png' },
        enemy_base:  { w: 14, h: 14, pal: 'enemyBase', file: '[10]enemy_base.png' },
        enemy_fan:   { w: 14, h: 14, pal: 'enemyFan', file: '[10]enemy_fan.png' },
        enemy_cross: { w: 14, h: 14, pal: 'enemyCross', file: '[10]enemy_cross.png' },

        /* ⭐ 0.3.1 小怪 4「追踪」：与其它小怪同规格 ✔（先生成占位图 ✗，作者可另画 ✔） */

        enemy_homing: { w: 14, h: 14, pal: 'enemyHoming', file: '[10]enemy_homing.png' },
    /* ⭐ 0.3.1 小怪 5「旋转」：与其它小怪同规格 ✔（先生成占位图 ✗） */
    enemy_spin:   { w: 14, h: 14, pal: 'enemySpin', file: '[10]enemy_spin.png' },
    /* ⭐ 0.3.1 小怪 6「激光」：与其它小怪同规格 ✔（先生成占位图 ✗） */
    enemy_beam:   { w: 14, h: 14, pal: 'enemyBeam', file: '[10]enemy_beam.png' },
        enemy_boss1: { w: 28, h: 28, pal: 'enemyBoss1', file: '[10]enemy_boss1.png' },
        enemy_boss2: { w: 28, h: 28, pal: 'enemyBoss2', file: '[10]enemy_boss2.png' },
    /* ⭐ 0.3.1 BOSS3：与其它 BOSS 同规格（28×28 美术像素 ✗）；先生成占位图 ✔ */
    enemy_boss3: { w: 28, h: 28, pal: 'enemyBoss3', file: '[10]enemy_boss3.png' },
    /* ⭐ 0.3.1 BOSS4 ✗ */
    enemy_boss4:  { w: 28, h: 28, pal: 'enemyBoss4', file: '[10]enemy_boss4.png' },
        pbullet:     { w: 5, h: 5, pal: 'pbullet', file: '[10]pbullet.png' },
        pbullet_big: { w: 10, h: 10, pal: 'pbullet', file: '[10]pbullet_big.png' },
        ebullet:     { w: 5, h: 5, pal: 'ebullet', file: '[10]ebullet.png' },
        ebullet_big: { w: 10, h: 10, pal: 'ebullet', file: '[10]ebullet_big.png' },
        /* ⭐⭐ 道具图标：**16×16**（与技能图标同尺寸 ⇒ 画布 32×32px ✔）。
         * ⭐⭐ **按剩余次数分三档**（用户 2026-10-05："血瓶蓝瓶图片后面的数字代表剩余使用次数，匹配之"
         *    ⇒ "指关卡内道具图片按剩余次数改变"）—— 数字是**画在图里**的 ✔
         *    ⇒ HUD 按 `itemLeft` 选 `…0 / …1 / …2`（见 hud.js 的 `itemSpriteId()`）✔。
         *    ⚠️ 原来那两张不带数字的（`item_heal` / `item_mp`）**已被用户删除** ✗ ⇒ 这里不再登记
         *      （登记了就是**死引用**，`test-visual` 的"每个素材都有 PNG 文件"会红 ✔）。 */
        item_heal0:  { w: 16, h: 16, pal: 'heal', file: '[20]item_heal0.png' },
        item_heal1:  { w: 16, h: 16, pal: 'heal', file: '[20]item_heal1.png' },
        item_heal2:  { w: 16, h: 16, pal: 'heal', file: '[20]item_heal2.png' },
        item_mp0:    { w: 16, h: 16, pal: 'mpItem', file: '[20]item_mp0.png' },
        item_mp1:    { w: 16, h: 16, pal: 'mpItem', file: '[20]item_mp1.png' },
        item_mp2:    { w: 16, h: 16, pal: 'mpItem', file: '[20]item_mp2.png' },
        /* ══════ `0.3.0` 补的一批（"把还需要图片化的东西补全"，用户 2026-10-02）══════
         * ⚠️ 与上面 12 个同规矩：尺寸 = 绘制尺寸 ÷ `PIXEL`；改了实体大小要同步这里。 */
        wall:         { w: 20, h: 20, pal: 'wall', file: '[10]wall.png' },          /* 40×40 掩体块（大墙靠平铺） */
        grass:        { w: 20, h: 20, pal: 'grass', file: '[30]grass.png' },         /* ⭐ 空地/地砖：40×40 一格（用户画的） */
        /* ⭐ 草地变体（用户 2026-10-02 画的三张；尺寸与 grass 相同 ⇒ 直接替换即可） */
        /* ⭐ 技能 / 道具的**边框牌**（用户 2026-10-02 画的）：图标压在它正中央 */
        /* ⭐ 状态条左侧的像素图标（10 美术像素 = 20px，与条同高 ✔）；**占位图**，可替换 ✗ */
        icon_hp:      { w: 10, h: 10, pal: 'barHp', file: '[10]icon_hp.png' },
        icon_mp:      { w: 10, h: 10, pal: 'mpItem', file: '[10]icon_mp.png' },
        skill:        { w: 20, h: 20, pal: 'frame', file: '[10]skill.png' },
        item:         { w: 20, h: 20, pal: 'frame', file: '[10]item.png' },
        grass1:       { w: 20, h: 20, pal: 'grass', file: '[30]grass1.png' },
        grass2:       { w: 20, h: 20, pal: 'grass', file: '[30]grass2.png' },
        grass3:       { w: 20, h: 20, pal: 'grass', file: '[30]grass3.png' },
        /* ⭐⭐ `0.3.1`（用户 2026-10-05）：非纯色草地又加了 3 张（4/5/6 ✗）——
         *    「一半 1→4、一半 2→5、一半 3→6」**已经烘进地图数据** ✗（不是运行时随机 ✔），
         *    所以这六张现在会**同时**出现在地图里 ✔。 */
        grass4:       { w: 20, h: 20, pal: 'grass', file: '[30]grass4.png' },
        grass5:       { w: 20, h: 20, pal: 'grass', file: '[30]grass5.png' },
        grass6:       { w: 20, h: 20, pal: 'grass', file: '[30]grass6.png' },
        tree:         { w: 20, h: 20, pal: 'tree', file: '[40]tree.png' },          /* ⭐ 前 4 关掩体的外观（`skin` 指定，用户画的） */
        crosshair:    { w: 11, h: 11, pal: 'player', file: '[20]crosshair.png' },        /* 22×22 自绘准心 */
        laser_origin: { w: 11, h: 11, pal: 'laserOrigin', file: '[10]laser_origin.png' },   /* 22×22 激光源方块（绘制时带 0.75 透明度） */
        beam_mark:    { w: 11, h: 11, pal: 'beamMark', file: '[10]beam_mark.png' },      /* 22×22 光束源标记 */
        /* HUD 技能图标：DOM 里用 `<img>` 显示，2 倍 = 32 CSS 像素。5 个主动各一张 */
        skill_shot:   { w: 16, h: 16, pal: 'player', file: '[20]skill_shot.png' },
        skill_fan:    { w: 16, h: 16, pal: 'player', file: '[20]skill_fan.png' },
        skill_ring:   { w: 16, h: 16, pal: 'player', file: '[20]skill_ring.png' },
        skill_laser:  { w: 16, h: 16, pal: 'player', file: '[20]skill_laser.png' },
        skill_freeze: { w: 16, h: 16, pal: 'player', file: '[20]skill_freeze.png' }
    },
    /* ⭐⭐ **文件名映射**（`0.3.0`，用户 2026-10-05："我在所有图片的名字前面加了 [x] 表示其
     *     美观/完成 分数，你重新匹配素材名字"）。
     *    · 代码里一律用**干净的 id**（`player` / `enemy_base` …）✔；
     *    · 真实文件名集中在每条 `LIST[id].file` 里 ✔（带 `[分数]` 前缀 ✗）；
     *    · **分数变了怎么办**：跑一条 `node tools/sync-sprite-names.cjs` ⇒ 自动重新匹配 ✔
     *      （它按"去掉 `[x]` 前缀后的名字"对齐，然后把 `file:` 重写一遍 ✔）。
     *    ⚠️ 找不到映射时回退成 `id + '.png'` ⇒ 素材缺失时表现为"加载失败"而不是崩溃 ✔。 */
    fileOf: function (id) {
        var e = this.LIST[id];
        return (e && e.file) ? e.file : (id + '.png');
    },
    DIR: 'assets/',
    images: {},
    loaded: 0,
    failed: 0,

    /* 素材的颜色（**兜底方块**用；有图时不读它） */
    color: function (id) {
        var e = this.LIST[id];
        return (e && PAL[e.pal]) || PAL.hitWhite;
    },

    /* 按"实体尺寸"挑素材：子弹按大小分（`size >= 2` 是大子弹） */
    bulletId: function (mine, size) {
        return (mine ? 'pbullet' : 'ebullet') + ((size && size >= 2) ? '_big' : '');
    },

    size: function (id) {
        var e = this.LIST[id];
        return e ? { w: e.w * PIXEL, h: e.h * PIXEL } : null;
    },

    /* 异步加载（浏览器专用）。⚠️ 没有 `Image`（Node 测试桩）时**直接返回**，
     *    所有绘制都走兜底方块 —— 测试要的就是那条路径的几何。 */
    load: function () {
        if (typeof Image === 'undefined') return;
        var self = this;
        Object.keys(this.LIST).forEach(function (id) {
            var img = new Image();
            img.onload = function () { self.loaded++; };
            img.onerror = function () { self.failed++; };
            /* ⚠️ 走映射（真实文件名带 `[分数]` 前缀 ✗），不要自己拼 id ✔ */
            img.src = self.DIR + self.fileOf(id);
            self.images[id] = img;
        });
    },

    /* 取图：**只有真正加载完成**的图才拿来画（`complete && naturalWidth` 两个都看 ——
     *  只判 `complete` 时，加载失败的图也会进去，画出来是一片空白）。 */
    get: function (id) {
        var img = this.images[id];
        if (!img) return null;
        if (img.complete === false) return null;
        if (typeof img.naturalWidth === 'number' && img.naturalWidth === 0) return null;
        if (typeof img.width === 'number' && img.width === 0 && !img.naturalWidth) return null;
        return img;
    },

    /* ⭐⭐ **唯一的绘制入口**。
     * `id` 素材名、`cx/cy` 中心（世界坐标，可小数）、`size` 目标边长（画布像素，通常 = 2×half）。
     * ⚠️ 取整规则与场内其它绘制**完全一致**（`snap`，四边都由取整后的中心算）
     *    —— 这样"素材 = 碰撞框"仍然成立，那批断言也照旧能过。 */
    draw: function (ctx, id, cx, cy, size) {
        if (!ctx) return false;
        var s = Math.max(1, Math.round(size));
        var x = snap(cx - s / 2), y = snap(cy - s / 2);
        var img = this.get(id);
        if (img && typeof ctx.drawImage === 'function') {
            /* ⚠️ 目标尺寸用 `s`（整数）而不是 `img.width`：素材可能是别的分辨率，
             *    我们只保证**放大倍数 = 目标 ÷ 美术尺寸**这一件事由尺寸算出来。 */
            ctx.drawImage(img, x, y, s, s);
            return true;
        }
        ctx.fillStyle = this.color(id);
        ctx.fillRect(x, y, s, s);
        return false;
    },

    /* ⭐ **冰冻/特殊染色的覆盖层**（`0.2.1` 的「冻结」在敌人身上是"换色"，
     *   换成素材之后改成**盖一层半透明色** —— 效果一样，且不用为每种敌人多存一张图）。 */
    tint: function (ctx, cx, cy, size, colorHex, alpha) {
        if (!ctx) return;
        var s = Math.max(1, Math.round(size));
        ctx.save();
        ctx.globalAlpha = (alpha === undefined) ? 0.55 : alpha;
        ctx.fillStyle = colorHex;
        ctx.fillRect(snap(cx - s / 2), snap(cy - s / 2), s, s);
        ctx.restore();
    },

    /* 给测试用：塞一张"已加载"的假图进去（Node 里没有真 `Image`）。
     * ⚠️ 只有测试会调它 —— 产品代码里**一次都不许出现**。 */
    _inject: function (id, img) { this.images[id] = img; },
    _reset: function () { this.images = {}; this.loaded = 0; this.failed = 0; }
};
