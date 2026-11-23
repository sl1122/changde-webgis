/* ============================================================
 * 常德市城市公共服务 WebGIS 系统 - main.js（v39 全开源版）
 * 引擎：Leaflet 1.9 + OpenStreetMap 瓦片 + leaflet.markercluster
 * 坐标系：WGS-84（数据已由 GCJ-02 反变换，浏览器定位零转换直接叠加）
 * 不含任何高德成分：无高德底图 / 无高德组件 / 无高德 API 缓存
 * ============================================================ */
(function () {
    'use strict';

    // ---------------- 1. 数据加载（服务器 fetch 优先，内嵌 geo-data 兜底） ----------------
    var GEO_KEYS = ['school', 'hospital', 'scenic', 'road'];
    var DATA = {};
    var EMBED = null;
    try { EMBED = JSON.parse(document.getElementById('geo-data').textContent); } catch (e) { EMBED = null; }

    function fetchOrEmbed(key) {
        return fetch('data/' + key + '.geojson')
            .then(function (r) { return r.json(); })
            .then(function (d) { DATA[key] = d; })
            .catch(function () { if (EMBED && EMBED[key]) DATA[key] = EMBED[key]; });
    }

    // ---------------- 2. 工具函数 ----------------
    function havMeters(lat1, lng1, lat2, lng2) {
        var R = 6371000, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
        var dp = (lat2 - lat1) * Math.PI / 180, dl = (lng2 - lng1) * Math.PI / 180;
        var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function toast(msg, isErr) {
        var el = document.getElementById('map-toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'map-toast' + (isErr ? ' error' : '');
        el.hidden = false;
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { el.hidden = true; }, isErr ? 7000 : 4000);
    }
    function showMeasure(msg, persist) {
        var el = document.getElementById('measure-result');
        if (!el) return;
        // v81：空消息不显示卡片——杜绝只剩关闭按钮的空壳残留
        if (!msg) { el.hidden = true; return; }
        var txt = document.getElementById('measure-text');
        if (txt) txt.textContent = msg; else el.textContent = msg;
        var done = document.getElementById('measure-done');
        if (done) done.hidden = !measure || !measure.mode;
        el.hidden = false;
        clearTimeout(showMeasure._t);
        // v79：结果卡常驻（清除测量 / 退出模式 / 切换工具时隐藏）；操作提示卡 3s 自动消退
        if (!persist) {
            showMeasure._t = setTimeout(function () { el.hidden = true; }, 3000);
        }
    }

    // ---------------- 3. 地图（Leaflet + 多源开源底图，默认高德瓦片） ----------------
    var gcjMode = true; // 当前底图是否为高德 GCJ-02（默认高德，切换时同步数据坐标系）
    var map = L.map('map', {
        center: gcjMode ? [29.045, 111.69] : gcj2wgs([29.045, 111.69]),
        zoom: 13,
        zoomControl: false,
        minZoom: 3,
        maxZoom: 18,
        attributionControl: true,
        // v125：矢量线/面/圆标记默认走 Canvas 后端（Leaflet 官方 FAQ：矢量大数据从 SVG 切 Canvas，
        // 避免每条线/每个圆一个 SVG path 节点）。内置设施点仍是 divIcon DOM marker，不受此 renderer 影响；
        // tooltip / 弹窗是独立 overlay，也不经过 renderer。
        renderer: L.canvas()
    });
    // 底图多源链：高德矢量/栅格（GCJ-02，国内最快最稳）→ OSM（WGS-84）
    // 同坐标系内先切换（高德矢量→高德栅格，数据不重绘、无缝），跨坐标系才重绘数据
    // v54：裁剪掉易丢瓦片的 CartoDB / ArcGIS 源，保留三个稳定源
    var TILE_CHAIN = [
        { url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', name: '高德·矢量', gcj: true, maxZoom: 18, attr: '&copy; <a href="https://www.amap.com/">高德地图</a> &copy; OpenStreetMap &copy; CARTO' },
        { url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', name: '高德·栅格', gcj: true, maxZoom: 18, attr: '&copy; <a href="https://www.amap.com/">高德地图</a> &copy; OpenStreetMap &copy; CARTO' },
        { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', name: 'OSM', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', name: '卫星影像', gcj: false, maxZoom: 18, subs: '', attr: '&copy; <a href="https://www.esri.com/en-us/arcgis/products/arcgis-location-services/overview">Esri</a>, Maxar, Earthstar Geographics' }
    ];
    // v100：高德 wprd0{s}+night=1 瓦片参数实测无效（返回仍亮色，PIL 实测 avg-rgb 228,222,209）；免费暗色瓦片源
    // （Carto Dark / Esri Dark Gray / OpenFreeMap）2026 已全部 API key 化或停服；高德暗色样式只能走 JS API 矢量
    // 渲染（mapStyle，需 AMap 地图实例，与 Leaflet 瓦片体系不兼容）。夜间底图统一由 CSS 高覆盖深色遮罩
    // --map-tint: rgba(8,12,32,.8) 呈现深色底（视觉=底色真正更换），POI/道路/标注在上层保持原色清晰；纯 CSS
    // 单层合成一次、零逐帧开销、拖动缩放零 filter 成本。
    // 标准 WGS-84 → GCJ-02（高德）加密转换
    function transformLat(x, y) {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }
    function transformLng(x, y) {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }
    function wgs2gcj(ll) { // [lat, lng] → GCJ-02 [lat, lng]
        var lat = ll[0], lng = ll[1];
        var a = 6378245.0, ee = 0.00669342162296594323;
        var dLat = transformLat(lng - 105.0, lat - 35.0);
        var dLng = transformLng(lng - 105.0, lat - 35.0);
        var radLat = lat / 180.0 * Math.PI;
        var magic = Math.sin(radLat);
        magic = 1 - ee * magic * magic;
        var sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
        dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
        return [lat + dLat, lng + dLng];
    }
    // GeoJSON [lng,lat] → Leaflet [lat,lng]
    // 数据坐标 = GCJ-02（高德原始采集，v36 时代坐标系）：高德底图零转换直用（完全对齐），
    // 开源底图(WGS-84)时动态转换；切换底图时全部图层重绘（activateTile 内）
    function gcj2wgs(ll) { // [lat,lng] GCJ-02 → WGS-84 [lat,lng]
        var lat = ll[0], lng = ll[1];
        var a = 6378245.0, ee = 0.00669342162296594323;
        var dLat = transformLat(lng - 105.0, lat - 35.0);
        var dLng = transformLng(lng - 105.0, lat - 35.0);
        var radLat = lat / 180.0 * Math.PI;
        var magic = Math.sin(radLat);
        magic = 1 - ee * magic * magic;
        var sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
        dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
        return [lat * 2 - (lat + dLat), lng * 2 - (lng + dLng)];
    }
    function toMapCoord(c) {
        var ll = [c[1], c[0]];
        return gcjMode ? ll : gcj2wgs(ll);
    }
    var tile = null, tileIdx = 0, tileWatchdog = null;
    var basemapLocked = false; // 手动选择底图后锁定，不再自动跳变
    function activateTile(idx, silent) {
        var old = tile;
        var t = TILE_CHAIN[idx];
        var mz = t.maxZoom || 20;
        var newT = L.tileLayer(t.url, {
            maxZoom: mz, maxNativeZoom: mz, subdomains: t.subs || '1234',
            attribution: t.attr
        });
        var errN = 0;
        newT.on('tileerror', function () {
            errN++;
            // 单源连续失败过多才降级；手动锁定后不自动切换，仅提示
            if (errN >= 8 && tileIdx < TILE_CHAIN.length - 1) {
                if (basemapLocked) {
                    toast('底图加载异常（' + TILE_CHAIN[tileIdx].name + '），可在「底图」面板手动切换');
                } else {
                    activateTile(tileIdx + 1, true);
                    toast('底图加载不畅，已切换为 ' + TILE_CHAIN[tileIdx].name + ' 瓦片');
                }
            }
        });
        // 平滑切换：新源首张瓦片加载成功后移除旧层，避免切换瞬间地图空白
        newT.on('load', function () {
            if (old && old !== newT) { try { map.removeLayer(old); } catch (e) { } }
        });
        newT.addTo(map);
        tile = newT;
        tileIdx = idx;
        // 切换底图时自动隐藏测量结果卡片（状态联动）
        try { hideMeasureCard(); } catch (e) { }
        // 底图坐标系切换 → 全部数据与定位点重绘对齐（高德矢量/栅格同为 GCJ-02，不触发重绘）
        var wasGcj = gcjMode;
        gcjMode = !!t.gcj;
        if (wasGcj !== gcjMode) {
            try { refreshAllLayers(); } catch (e) { }
            if (geoLastBest && typeof geoLastBest.lat === 'number' && typeof geoLastBest.lng === 'number')
                renderLoc(L.latLng(geoLastBest.lat, geoLastBest.lng), geoLastBest.acc, geoLastBest.src || '', 'gps', false);
            if (typeof pointsLayer !== 'undefined' && pointsLayer &&
                (pointsLayer.clusters.school || pointsLayer.plains.school)) map.setView(map.getCenter(), map.getZoom());
        }
        // 兜底：3 秒后新源仍无任何瓦片加载则强制移除旧层（避免双重叠加）
        setTimeout(function () {
            if (old && old !== newT) { try { map.removeLayer(old); } catch (e) { } }
        }, 3000);
        // 看门狗：12 秒后瓦片仍稀少且 5 秒内无增长才判定当前源过慢，降级下一源
        function loadedCount() {
            var n = 0;
            try {
                Object.keys(newT._tiles).forEach(function (k) {
                    if (newT._tiles[k] && newT._tiles[k].loaded) n++;
                });
            } catch (e) { }
            return n;
        }
        if (tileWatchdog) clearTimeout(tileWatchdog);
        tileWatchdog = setTimeout(function () {
            var n1 = loadedCount();
            setTimeout(function () {
                var n2 = loadedCount();
                if (n2 < 10 && n2 - n1 < 2 && tileIdx < TILE_CHAIN.length - 1) {
                    if (basemapLocked) {
                        toast('底图加载缓慢（' + TILE_CHAIN[tileIdx].name + '），可在「底图」面板手动切换');
                    } else {
                        activateTile(tileIdx + 1, true);
                        toast('底图加载缓慢，已切换为 ' + TILE_CHAIN[tileIdx].name + ' 瓦片');
                    }
                }
            }, 5000);
        }, 12000);
    }
    // 默认直接启用高德矢量瓦片（国内加载最快），异常自动在同坐标系内切换高德栅格，再降级 OSM/CartoDB/ArcGIS
    activateTile(0);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 140 }).addTo(map);
    // 自定义放大缩小按钮
    // 缩放键：防抖 320ms，避免快速连点触发多级缩放叠加导致卡顿
    function bindZoom(btnId, fn) {
        var btn = document.getElementById(btnId);
        if (!btn) return;
        var locked = false;
        btn.addEventListener('click', function () {
            if (locked) return;
            locked = true;
            setTimeout(function () { locked = false; }, 320);
            fn();
        });
    }
    bindZoom('btn-zoom-in', function () { map.zoomIn(); });
    bindZoom('btn-zoom-out', function () { map.zoomOut(); });

    var INIT_CENTER = [29.045, 111.69], INIT_ZOOM = 13; // GCJ-02 中心（高德底图直用）

    // ---------------- 4. 图层管理 ----------------
    var LAYER_CONFIG = {
        school: { name: '学校', color: '#2563eb', radius: 7 },
        hospital: { name: '医院', color: '#dc2626', radius: 7 },
        scenic: { name: '景点', color: '#059669', radius: 7 },
        road: { name: '道路', color: '#d97706' }
    };
    var layerState = {
        school: { visible: true, data: [] },
        hospital: { visible: true, data: [] },
        scenic: { visible: true, data: [] },
        road: { visible: true, data: [] }
    };
    // Leaflet 图层对象：pointsLayer.clusters[key] / plains[key]（每个图层独立槽位，可同时显示）
    var pointsLayer = { clusters: {}, plains: {} };
    var linesLayer = null;
    var clusterEnabled = true;

    // 用户打点道路库（localStorage 持久化；与内置 14 条道路合并显示，同名自动替代内置线）
    var userRoads = [];
    function loadUserRoads() {
        try { userRoads = JSON.parse(localStorage.getItem('cd_user_roads') || '[]'); } catch (e) { userRoads = []; }
        if (!Array.isArray(userRoads)) userRoads = [];
    }
    function saveUserRoads() {
        try { localStorage.setItem('cd_user_roads', JSON.stringify(userRoads)); } catch (e) { }
    }
    loadUserRoads();

    // ---------------- v114：自建要素统一数据模型（点 / 线 / 面） ----------------
    // 存储结构：[{id, geometry:{type,coordinates}, properties:{name,kind,remark}, crs, ts}]
    // 坐标约定与既有图层一致：存 [lng,lat]（底图坐标系），显示统一走 toMapCoord()
    var CF_KEY = 'cd_custom_features';
    var customFeatures = [];
    var CF_KINDS = ['设施点', '公交站', '公园', '自定区域', '道路'];
    // v126：兜底类型也走主题变量（--cf-*），随材质包/夜间/纸笺联动；不再写死 hex。
    // 变量名与 CSS :root / night / paper 三段一一对应，未知新类型落区域紫兜底。
    var CF_KIND_VAR = { '设施点': '--cf-facility', '公交站': '--cf-bus', '公园': '--cf-park', '自定区域': '--cf-area' };
    // v120：导入归并出的「学校/医院/景点/道路」直接取内置图层色（跟主题变量走），
    // 否则四类全落进兜底色，侧栏三行点色一样、地图上同是学校却两个颜色
    var CF_KIND_TO_LAYER = { '学校': 'school', '医院': 'hospital', '景点': 'scenic', '道路': 'road' };
    function cfColor(kind) {
        var lk = CF_KIND_TO_LAYER[kind];
        if (lk && LAYER_CONFIG[lk]) return LAYER_CONFIG[lk].color;
        var v = CF_KIND_VAR[kind];
        if (v) return themeCSSVar(v);
        return themeCSSVar('--cf-area');
    }
    // ===== v122：导入文件即图层 =====
    // 每个要素记住自己的来源文件（properties.source），图层管理按「文件 → 地类」两级呈现。
    // 显隐的唯一真源是 pair 开关（source|kind）；文件行的勾选只是该文件全部 pair 的批量镜像，
    // 不再另存一份 cfFileOn —— 双真源必然出现「文件勾着、子类全关」的自相矛盾态。
    var CF_SRC_MANUAL = '手工绘制';
    function cfSource(f) {
        var s = f && f.properties && f.properties.source;
        s = s ? String(s).trim() : '';
        return s || CF_SRC_MANUAL;
    }
    function cfKindOf(f) { return (f && f.properties && f.properties.kind) || '设施点'; }
    function cfPairKey(srcOrF, kind) {
        var s = (typeof srcOrF === 'string') ? srcOrF : cfSource(srcOrF);
        var k = (kind == null) ? cfKindOf(srcOrF) : kind;
        return s + '\u0001' + k;
    }
    var cfPairOn = {};        // pairKey -> false 表示「该文件下的该类」隐藏
    function cfRowVisible(f) { return cfPairOn[cfPairKey(f)] !== false; }
    // v119：外部数据（如常德地区 js）的业务类型五花八门——先归一到本站的四类点/线，再成层，
    // 避免「高等院校」「卫生院」「风景名胜」各占一行，图层列表被同义类型撑散
    var KIND_EXACT = {
        '学校': '学校', '高校': '学校', '大学': '学校', '学院': '学校', '中学': '学校', '小学': '学校', '幼儿园': '学校',
        '医院': '医院', '医疗': '医院', '卫生院': '医院', '诊所': '医院', '医疗机构': '医院',
        '景点': '景点', '景区': '景点', '风景名胜': '景点', '公园': '景点', '旅游景点': '景点', '古迹': '景点',
        '道路': '道路', '公路': '道路', '主干道': '道路', '街道': '道路',
        '公交站': '公交站', '公交站点': '公交站', '站台': '公交站',
        '区域': '自定区域', '片区': '自定区域', '自定区域': '自定区域',
        '设施点': '设施点'
    };
    // 只对强特征词做包含匹配，避免「公园路」被判成景点、「学院路」被判成学校
    // v120：补「医院」包含词——外部数据常写「三甲医院」「人民医院」「口腔医院」，只认 exact 会把它们各立一行
    var KIND_CONTAIN = ['高校', '大学', '学院', '中学', '小学', '幼儿园', '卫生院', '诊所', '医院', '景区', '风景名胜', '公交站', '公交站点'];
    function normKind(raw) {
        var s = String(raw == null ? '' : raw).trim().slice(0, 12);
        if (!s) return '设施点';
        if (KIND_EXACT[s]) return KIND_EXACT[s];
        if (s.indexOf('路') >= 0 && s.length <= 6) return '道路';
        for (var i = 0; i < KIND_CONTAIN.length; i++) {
            if (s.indexOf(KIND_CONTAIN[i]) >= 0) return KIND_EXACT[KIND_CONTAIN[i]];
        }
        return s;
    }
    function cfCoordList(f) {
        if (!f || !f.geometry) return [];
        var g = f.geometry;
        if (g.type === 'Point') return [g.coordinates];
        if (g.type === 'LineString') return g.coordinates || [];
        if (g.type === 'Polygon') return (g.coordinates && g.coordinates[0]) || [];
        return [];
    }
    function cfById(id) {
        for (var i = 0; i < customFeatures.length; i++) if (String(customFeatures[i].id) === String(id)) return customFeatures[i];
        return null;
    }
    // v119：地区归属——按坐标粗判常德市域框，导入数据在图层行上直接标出所属地区
    var REGION_BOX = { w: 110.9, e: 112.4, s: 28.5, n: 30.1 };
    function regionOfPoint(c) {
        if (!c || c.length < 2) return '未标注';
        if (c[0] >= REGION_BOX.w && c[0] <= REGION_BOX.e && c[1] >= REGION_BOX.s && c[1] <= REGION_BOX.n) return '常德';
        return '外地';
    }
    // v122：地区判定下沉到"要素集合"层——文件与地类各自用自己那批点算归属，互不串味
    function regionOfList(list) {
        var cd = 0, out = 0;
        (list || []).forEach(function (f) {
            var r = regionOfPoint((cfCoordList(f) || [])[0]);
            if (r === '常德') cd++; else if (r === '外地') out++;
        });
        if (!cd && !out) return '未标注';
        if (cd && !out) return '常德';
        if (out && !cd) return '外地';
        return '常德+外';
    }
    function regionOfKind(k) {
        return regionOfList(customFeatures.filter(function (f) { return (f.properties.kind || '设施点') === k; }));
    }
    function saveCustom() {
        try { localStorage.setItem(CF_KEY, JSON.stringify(customFeatures)); } catch (e) { }
    }
    function loadCustom() {
        var raw = null;
        try { raw = localStorage.getItem(CF_KEY); } catch (e) { }
        if (raw === null) {
            // 首次运行 v114：把旧 cd_user_roads 一次性迁入，旧键保留只读，不删用户数据
            customFeatures = (userRoads || []).map(function (r, i) {
                return {
                    id: 'cf' + (r.id || (Date.now() + i)),
                    geometry: { type: 'LineString', coordinates: (r.coordinates || []).slice() },
                    properties: { name: (r.street || r.name || ('道路' + (i + 1))), kind: '道路', remark: '' },
                    crs: r.crs || 'WGS-84', ts: r.ts || Date.now(), legacy: 'cd_user_roads'
                };
            }).filter(function (f) { return f.geometry.coordinates.length >= 2; });
            saveCustom();
        } else {
            try { customFeatures = JSON.parse(raw); } catch (e) { customFeatures = []; }
        }
        if (!Array.isArray(customFeatures)) customFeatures = [];
        customFeatures = customFeatures.filter(function (f) { return f && f.geometry && f.properties; });
    }
    loadCustom();

    function userRoadPopupHtml(r) {
        var n = (r.coordinates || []).length;
        var dt = r.ts ? new Date(r.ts).toLocaleString() : '';
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:#6d28d9">我的标注 · ' + esc(r.street || r.name) + '</div>' +
            '<div class="pw-row"><span class="pw-k">点数</span><span class="pw-v">' + n + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">坐标系</span><span class="pw-v">' + esc(r.crs || 'GCJ-02') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">底图</span><span class="pw-v">' + esc(r.basemap || '-') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">时间</span><span class="pw-v">' + esc(dt) + '</span></div></div>';
    }

    function pointPopupHtml(key, p, fid) {
        var c = LAYER_CONFIG[key];
        var rows = [
            ['名称', p.name], ['类别', p.type || '-'], ['区域', p.adname || '-'],
            ['地址', p.address || '-'], ['来源', p.source || '-']
        ].map(function (r) {
            return '<div class="pw-row"><span class="pw-k">' + r[0] + '</span><span class="pw-v">' + esc(r[1]) + '</span></div>';
        }).join('');
        // v117b：单点删除入口（只删这一个要素，图层与其它点保留）
        var del = '<button type="button" class="pw-del" data-poi-key="' + key + '" data-poi-id="' + esc(fid) +
            '" data-poi-name="' + esc(p.name) + '">删除此点</button>';
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:' + c.color + '">' + esc(p.name) + '</div>' + rows + del + '</div>';
    }
    function roadPopupHtml(p) {
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:#d97706">' + esc(p.name) + '</div>' +
            '<div class="pw-row"><span class="pw-k">类别</span><span class="pw-v">' + esc(p.type || '主干道') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">长度</span><span class="pw-v">' + (p.len_km != null ? p.len_km + ' 公里' : '-') + '</span></div>' +
            '</div>';
    }

    // v115 地物点「形状语义化」：学校=方块+书页 / 医院=方块+十字 / 景点=四瓣花
    // 统一画法：1.5px 白环 + 同色核，夜间由 repaintThemeColors 换核色
    var POI_SHAPE = {
        school: '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.2"/>',
        hospital: '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.2"/>',
        scenic: '<g><circle cx="12" cy="8.2" r="3.6"/><circle cx="15.8" cy="12" r="3.6"/><circle cx="12" cy="15.8" r="3.6"/><circle cx="8.2" cy="12" r="3.6"/><circle cx="12" cy="12" r="2.1"/></g>'
    };
    var POI_GLYPH = {
        school: '<rect x="8.2" y="8" width="7.6" height="1.7" rx=".5" opacity=".92"/><rect x="8.2" y="11.2" width="7.6" height="1.7" rx=".5" opacity=".92"/><rect x="8.2" y="14.4" width="4.8" height="1.7" rx=".5" opacity=".92"/>',
        hospital: '<rect x="11" y="8" width="2" height="10" rx=".5"/><rect x="7" y="12" width="10" height="2" rx=".5"/>',
        scenic: '<path d="M6.6 17.4 L10.8 9.6 L14 15 L16.4 11.8 L19.8 17.4 Z" opacity=".92"/><circle cx="17.6" cy="8.6" r="1.5" opacity=".7"/>'
    };
    // v116 纸章图钉：白纸圆章 + 类别色细环 + 下压尖角，取代 v115 的实心方块
    function poiIconHtml(key) {
        var c = LAYER_CONFIG[key] ? LAYER_CONFIG[key].color : '#2563eb';
        return '<svg class="poi-svg" viewBox="0 0 28 32" width="24" height="26" aria-hidden="true">' +
            '<path d="M14 31 L9.9 21.5 h8.2 Z" fill="' + c + '" fill-opacity=".9"/>' +
            '<circle cx="14" cy="13" r="9.4" fill="#fffdf8" stroke="' + c + '" stroke-width="1.5"/>' +
            '<g fill="' + c + '" transform="translate(2,1)">' + (POI_GLYPH[key] || '') + '</g>' +
            '</svg>';
    }
    // ---- v124：内置设施点多选（Shift 点选 / 多选态点击不弹卡 / 实时淡化预览）----
    // v122 只在自建要素上做了多选，内置 POI 仍走 bindPopup：卡片必弹、遮住半屏，且无法追加选择。
    // 这里把卡片改成「受控打开」（不再 bindPopup 自动开），点击语义：
    //   无选中 + 普通点击 -> 开卡片；Shift/Ctrl/⌘ 点击 -> 进入/追加多选；
    //   已有多选 + 普通点击 -> 追加/取消（手机上没法按 Shift，也能继续选）；
    //   多选态一律不开卡片，选中/未选中靠透明度 100% / 34% 实时预览。
    var POI_MK = {};                 // fid -> marker
    var poiSel = { ids: [] };        // 多选集合（fid 是坐标指纹，已带图层 key）
    var poiBatchDel = false;
    var pwPopup = null;
    function poiSelHas(id) {
        for (var i = 0; i < poiSel.ids.length; i++) if (poiSel.ids[i] === id) return true;
        return false;
    }
    // v124b：淡化要按点量自适应。558 个点一律压到 34% 会把整个城区糊成灰雾（实测截图确认），
    // 所以只有候选点很少（<= 60，如自建要素或单类）时才整体淡化，否则只给选中项加白环高亮。
    function poiSelPaint() {
        var ids = Object.keys(POI_MK);
        var on = poiSel.ids.length > 0;
        var dimAll = on && ids.length <= 60;
        ids.forEach(function (id) {
            var mk = POI_MK[id];
            var el = mk && mk.getElement ? mk.getElement() : null;
            if (!el) return;
            var sel = poiSelHas(id);
            el.style.opacity = (dimAll && !sel) ? '0.34' : '';
            el.style.filter = (dimAll && !sel) ? 'saturate(.55)' : '';
            if (sel) {
                el.classList.add('poi-sel');
                el.style.zIndex = '1300';
            } else {
                el.classList.remove('poi-sel');
                el.style.zIndex = '';
            }
        });
    }
    function clearPoiSel() {
        if (!poiSel.ids.length) return;
        poiSel.ids = [];
        poiSelPaint();
        updatePoiSelBar();
    }
    function poiToggle(id, key) {
        var i = -1;
        for (var j = 0; j < poiSel.ids.length; j++) if (poiSel.ids[j] === id) { i = j; break; }
        if (i >= 0) poiSel.ids.splice(i, 1); else poiSel.ids.push(id);
        // 自建要素与内置点共用底部一条选择条：进这边就清那边，避免两条叠在一起
        if (typeof cfSelIds !== 'undefined' && cfSelIds.length) {
            cfSelIds = [];
            if (typeof cfSelId !== 'undefined') cfSelId = null;
            if (typeof renderCustom === 'function') renderCustom();
            if (typeof updateCfSelBar === 'function') updateCfSelBar();
        }
        poiSelPaint();
        updatePoiSelBar();
    }
    function updatePoiSelBar() {
        var bar = document.getElementById('poi-selbar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'poi-selbar';
            bar.className = 'cf-selbar';
            bar.hidden = true;
            document.body.appendChild(bar);
        }
        if (!poiSel.ids.length) { bar.hidden = true; bar.innerHTML = ''; return; }
        var byKind = {}, n = 0;
        poiSel.ids.forEach(function (id) {
            var mk = POI_MK[id]; if (!mk) return;
            var k = mk.__pKey;
            var nm = (LAYER_CONFIG[k] && LAYER_CONFIG[k].name) || k;
            byKind[nm] = (byKind[nm] || 0) + 1; n++;
        });
        bar.hidden = false;
        bar.innerHTML = '<span class="cf-sel-n">已选 ' + n + ' 个点</span>' +
            '<span class="cf-sel-kinds">' + esc(Object.keys(byKind).map(function (k) { return k + ' ' + byKind[k]; }).join(' · ')) + '</span>' +
            '<button type="button" class="cf-sel-btn danger" data-poi-sel="del">删除选中</button>' +
            '<button type="button" class="cf-sel-btn" data-poi-sel="clear">取消</button>';
    }
    function openPwCard(htmlStr, ll) {
        if (pwPopup) { map.closePopup(pwPopup); pwPopup = null; }
        pwPopup = L.popup({ autoPan: true, maxWidth: 280, closeButton: true, className: 'pw-pop', offset: [0, -16] })
            .setLatLng(ll).setContent(htmlStr).openOn(map);
        return pwPopup;
    }
    function makePointMarker(key, feat) {
        var p = feat.properties;
        var coords = feat.geometry.coordinates;
        var icon = L.divIcon({
            className: 'poi-node-wrap',
            html: '<div class="poi-node poi-' + key + '">' + poiIconHtml(key) + '</div>',
            iconSize: [24, 26], iconAnchor: [12, 26]
        });
        var fid = String(poiFid(feat));
        var mk = L.marker(toMapCoord(coords), { icon: icon });
        mk.bindTooltip(p.name, { direction: 'top', offset: [0, -24], className: 'poi-tip' });
        mk.__pKey = key;
        mk.__pFid = fid;
        POI_MK[fid] = mk;
        mk.on('click', function (e) {
            if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
            if (markMode || (measure && measure.mode) || cfEditing) return;
            var oe = e.originalEvent || {};
            var add = !!(oe.shiftKey || oe.ctrlKey || oe.metaKey);
            if (add || poiSel.ids.length) { poiToggle(fid, key); return; }
            openPwCard(pointPopupHtml(key, p, fid), mk.getLatLng());
            highlightSearchRow(p.name);
        });
        return mk;
    }

    function makeCluster(key) {
        return L.markerClusterGroup({
            maxClusterRadius: 60,
            // v115 P0-b：分块灌入，勾选图层时不再一次性冻结主线程
            chunkedLoading: true,
            chunkInterval: 200,
            chunkDelay: 30,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 18,
            iconCreateFunction: function (cluster) {
                var n = cluster.getChildCount();
                var size = n < 10 ? 32 : n < 40 ? 40 : 50;
                var fs = n < 10 ? 12 : n < 40 ? 14 : 16;
                return L.divIcon({
                    html: '<div class="mc-bubble mc-' + key + '" style="width:' + size + 'px;height:' + size + 'px;line-height:' + size + 'px;font-size:' + fs + 'px">' + n + '</div>',
                    className: 'mc-wrap',
                    iconSize: L.point(size, size)
                });
            }
        });
    }
    function buildPointLayers(key, useCluster) {
        var feats = layerState[key].data;
        if (useCluster) {
            var cg = makeCluster(key);
            feats.forEach(function (f) { cg.addLayer(makePointMarker(key, f)); });
            return cg;
        }
        var g = L.layerGroup();
        // v115：关聚合时也用同一套形状标记，保证「开关聚合」前后符号不跳变
        feats.forEach(function (f) { g.addLayer(makePointMarker(key, f)); });
        return g;
    }

    function buildLinesLayer() {
        var g = L.layerGroup();
        // 同名替代：用户打点道路（如"武陵大道"）优先于内置同名线
        var userNames = {};
        customFeatures.forEach(function (f) { if (f.geometry.type === 'LineString') userNames[f.properties.name] = true; });
        layerState.road.data.forEach(function (f) {
            if (userNames[f.properties.name]) return;
            var coords = f.geometry.coordinates.map(function (c) { return toMapCoord(c); });
            if (coords.length < 2) return;
            // 双层线：极淡描边 + 琥珀主线（描边仅用于分离底色，不喧宾夺主）
            g.addLayer(L.polyline(coords, {
                color: '#ffffff', weight: 6.5, opacity: 0.22,
                lineJoin: 'round', lineCap: 'round'
            }));
            var line = L.polyline(coords, {
                color: LAYER_CONFIG.road.color, weight: 4.5, opacity: 0.95,
                lineJoin: 'round', lineCap: 'round'
            }).bindPopup(roadPopupHtml(f.properties), { autoPan: true, maxWidth: 280 });
            // 悬停高亮
            line.on('mouseover', function () { line.setStyle({ weight: 7.5, opacity: 1 }); });
            line.on('mouseout', function () { line.setStyle({ weight: 4.5, opacity: 0.95 }); });
            g.addLayer(line);
            // 路名标签（中点，玻璃质感）
            if (!f.properties.no_name) {
                var mid = coords[Math.floor(coords.length / 2)];
                var tag = L.tooltip({
                    permanent: true, direction: 'center', className: 'road-tag', opacity: 1
                }).setContent(f.properties.name).setLatLng(mid);
                g.addLayer(tag);
            }
        });
        // v114：用户自建要素不再挂在内置道路图层上，改由 customLayer 统一渲染（点/线/面）
        updateRoadLabelZoom();
        return g;
    }
    // 路名标签随缩放级别控制字号与显隐：缩小地图时标签变小/隐藏，避免互相遮盖
    function updateRoadLabelZoom() {
        var z = map.getZoom();
        var fs = z <= 12 ? 0 : z === 13 ? 10 : z === 14 ? 12 : z >= 17 ? 15 : 13;
        document.querySelectorAll('.leaflet-tooltip.road-tag').forEach(function (t) {
            if (fs <= 0) { t.style.display = 'none'; }
            else { t.style.display = ''; t.style.fontSize = fs + 'px'; }
        });
    }
    map.on('zoomend', updateRoadLabelZoom);

    function refreshLayer(key) {
        var vis = layerState[key].visible;
        if (key === 'road') {
            if (linesLayer) { map.removeLayer(linesLayer); linesLayer = null; }
            if (vis) { linesLayer = buildLinesLayer(); map.addLayer(linesLayer); }
            return;
        }
        if (pointsLayer.clusters[key]) { map.removeLayer(pointsLayer.clusters[key]); pointsLayer.clusters[key] = null; }
        if (pointsLayer.plains[key]) { map.removeLayer(pointsLayer.plains[key]); pointsLayer.plains[key] = null; }
        if (!vis) return;
        if (clusterEnabled) {
            pointsLayer.clusters[key] = buildPointLayers(key, true);
            map.addLayer(pointsLayer.clusters[key]);
        } else {
            pointsLayer.plains[key] = buildPointLayers(key, false);
            map.addLayer(pointsLayer.plains[key]);
        }
        // v124：重建 marker 后 DOM 是新的，多选淡化要重新刷一次
        if (poiSel.ids.length) poiSelPaint();
    }
    function refreshAllLayers() {
        GEO_KEYS.forEach(refreshLayer);
        updateCounts();
    }

    // 聚合总开关
    document.getElementById('chk-cluster').addEventListener('change', function () {
        clusterEnabled = this.checked;
        ['school', 'hospital', 'scenic'].forEach(refreshLayer);
        updateCounts();
        syncSetToggles();
    });

    // ---------------- 5. 视野实时计数 ----------------
    function visibleCount(key) {
        if (!layerState[key].visible) return 0;
        var b = map.getBounds();
        if (key === 'road') {
            var n = 0;
            layerState[key].data.forEach(function (f) {
                var any = f.geometry.coordinates.some(function (c) { return b.contains(toMapCoord(c)); });
                if (any) n++;
            });
            // v114：自建要素中的「线」计入道路视野计数
            n += customFeatures.filter(function (f) {
                return f.geometry.type === 'LineString' && cfCoordList(f).some(function (c) { return b.contains(toMapCoord(c)); });
            }).length;
            return n;
        }
        return layerState[key].data.filter(function (f) {
            var c = f.geometry.coordinates;
            return b.contains(toMapCoord(c));
        }).length;
    }
    function updateCounts() {
        GEO_KEYS.forEach(function (k) {
            var el = document.getElementById('cnt-' + k);
            if (el) el.textContent = visibleCount(k);
        });
    }
    map.on('moveend', updateCounts);
    map.on('zoomend', updateCounts);
    // v78：手机端信息密度分级——默认只显示聚合气泡；缩放 >= 13 浮现地名标签、>= 14 浮现道路标签
    // （内容按缩放压力分层浮现，CSS 控制 opacity，零性能负担、不碰数据层）
    map.on('zoomend', function () {
        var z = map.getZoom();
        document.body.classList.toggle('labels-13', z >= 13);
        document.body.classList.toggle('labels-14', z >= 14);
    });

    // ---------------- 6. 图层勾选 / 全选 / 隐藏 ----------------
    // 图例动态联动：勾选状态 ↔ 图例行增删（带过渡）
    function syncLegend() {
        GEO_KEYS.forEach(function (k) {
            var row = document.querySelector('.legend-row[data-layer="' + k + '"]');
            if (row) row.classList.toggle('off', !layerState[k].visible);
        });
    }
    function bindLayerCheck(k) {
        document.getElementById('chk-' + k).addEventListener('change', function () {
            layerState[k].visible = this.checked;
            refreshLayer(k);
            updateCounts();
            syncLegend();
            syncLayerActions();
        });
    }
    GEO_KEYS.forEach(bindLayerCheck);

    // ---- v126：分组可见性统计与批量切换（内置组 / 我的图层组，组头三态 + 全局全选全隐）----
    function builtinAliveKeys() { return GEO_KEYS.filter(function (k) { return !goneLayers[k] && (layerState[k].data || []).length; }); }
    function builtinAllOn() { var ks = builtinAliveKeys(); return ks.length > 0 && ks.every(function (k) { return layerState[k].visible; }); }
    function builtinSomeOn() { return builtinAliveKeys().some(function (k) { return layerState[k].visible; }); }
    function cfAllPairKeys() { var m = {}; customFeatures.forEach(function (f) { m[cfPairKey(f)] = true; }); return Object.keys(m); }
    function cfAllOn() { var ks = cfAllPairKeys(); return ks.length > 0 && ks.every(function (k) { return cfPairOn[k] !== false; }); }
    function cfSomeOn() { return cfAllPairKeys().some(function (k) { return cfPairOn[k] !== false; }); }
    function setBuiltinVisible(on) {
        builtinAliveKeys().forEach(function (k) {
            layerState[k].visible = on;
            var chk = document.getElementById('chk-' + k); if (chk) chk.checked = on;
        });
        refreshAllLayers(); syncLegend();
    }
    function setCfVisible(on) {
        cfAllPairKeys().forEach(function (k) { cfPairOn[k] = on; });
        renderCustom(); syncCfCats();
    }
    // 刷新组头三态（全勾 / 横线半选 / 全不选）与全局按钮禁用态；无存在层时禁用
    function syncLayerActions() {
        var bAll = builtinAllOn(), bSome = builtinSomeOn();
        var cAll = cfAllOn(), cSome = cfSomeOn();
        var builtinHead = document.getElementById('chk-builtin-all');
        if (builtinHead) {
            var alive = builtinAliveKeys().length;
            builtinHead.disabled = !alive;
            builtinHead.checked = bAll;
            builtinHead.indeterminate = !bAll && bSome;
        }
        var cfHead = document.getElementById('chk-cf-all');
        if (cfHead) {
            cfHead.disabled = !customFeatures.length;
            cfHead.checked = cAll;
            cfHead.indeterminate = !cAll && cSome;
        }
        var allBtn = document.getElementById('btn-all'), noneBtn = document.getElementById('btn-none');
        var totalAlive = builtinAliveKeys().length + cfAllPairKeys().length;
        if (allBtn) allBtn.disabled = !totalAlive || (bAll && cAll);
        if (noneBtn) noneBtn.disabled = !totalAlive || (!bSome && !cSome);
    }
    var builtinHeadCb = document.getElementById('chk-builtin-all');
    if (builtinHeadCb) builtinHeadCb.addEventListener('change', function () {
        setBuiltinVisible(this.checked); syncLayerActions();
    });
    document.getElementById('btn-all').addEventListener('click', function () {
        setBuiltinVisible(true);
        setCfVisible(true);
        document.getElementById('chk-cluster').checked = true; clusterEnabled = true;
        syncSetToggles(); syncLayerActions();
    });
    document.getElementById('btn-none').addEventListener('click', function () {
        setBuiltinVisible(false);
        setCfVisible(false);
        syncLayerActions();
    });

    // ---------------- 7. 搜索与类型筛选 ----------------
    var searchIdx = [];
    function buildSearchIndex() {
        searchIdx = [];
        GEO_KEYS.forEach(function (k) {
            layerState[k].data.forEach(function (f) {
                searchIdx.push({ key: k, name: f.properties.name || '', feat: f });
            });
        });
        // v114：自建要素一并进索引，删除后重建索引即不再出现（杜绝"删了还能搜到"）
        customFeatures.forEach(function (f) {
            searchIdx.push({ key: 'custom', name: f.properties.name || '', cf: f, kind: f.properties.kind });
        });
    }
    function refreshSearch() {
        buildSearchIndex();
        if ((searchInput.value || '').trim()) runSearch();
    }
    var searchResultEl = document.getElementById('search-result');
    var searchInput = document.getElementById('search-input');
    var searchType = document.getElementById('search-type');
    function runSearch() {
        var q = (searchInput.value || '').trim();
        var type = searchType.value;
        var hits = searchIdx.filter(function (it) {
            if (type) {
                if (it.key === 'custom') { if (it.kind !== type) return false; }
                else if (it.key !== type) return false;
            }
            return it.name.toLowerCase().indexOf(q.toLowerCase()) >= 0;
        }).slice(0, 30);
        if (!q) { searchResultEl.innerHTML = ''; searchResultEl.hidden = true; return; }
        if (!hits.length) {
            searchResultEl.innerHTML = '<div class="sr-none">未找到匹配地点</div>';
            searchResultEl.hidden = false;
            return;
        }
        searchResultEl.innerHTML = hits.map(function (it, i) {
            var conf = it.key === 'custom'
                ? { color: cfColor(it.kind), name: '我的' + it.kind }
                : LAYER_CONFIG[it.key];
            return '<div class="sr-item" data-i="' + i + '"><span class="sr-name">' + esc(it.name) + '</span><span class="sr-type" style="color:' + conf.color + '">' + conf.name + '</span></div>';
        }).join('');
        searchResultEl.hidden = false;
        Array.prototype.forEach.call(searchResultEl.querySelectorAll('.sr-item'), function (el) {
            el.addEventListener('click', function () {
                var it = hits[+el.getAttribute('data-i')];
                if (!it) return;
                if (it.key === 'custom') {
                    showCfKind(it.kind, true);
                    selectCf(it.cf.id, true);
                    closeDrawer();
                    return;
                }
                if (!layerState[it.key].visible) {
                    document.getElementById('chk-' + it.key).checked = true;
                    layerState[it.key].visible = true;
                    refreshLayer(it.key);
                }
                locateFeature(it.key, it.feat);
                closeDrawer();
            });
            // v125 B1：列表行悬停 → 地图上对应点临时放大描边（仅内置点；自建点走 cf 层，不在此列）
            el.addEventListener('mouseenter', function () {
                var it = hits[+el.getAttribute('data-i')];
                if (!it || it.key === 'custom') return;
                var mk = POI_MK[poiFid(it.feat)];
                var dom = mk && mk.getElement ? mk.getElement() : null;
                if (dom) dom.classList.add('sr-hover');
            });
            el.addEventListener('mouseleave', function () {
                var it = hits[+el.getAttribute('data-i')];
                if (!it || it.key === 'custom') return;
                var mk = POI_MK[poiFid(it.feat)];
                var dom = mk && mk.getElement ? mk.getElement() : null;
                if (dom) dom.classList.remove('sr-hover');
            });
        });
    }
    // v125 B1：地图点被点开时，若搜索结果列表可见且含同名项，滚动定位并短暂高亮（地图→列表反向联动）
    function highlightSearchRow(name) {
        if (!searchResultEl || searchResultEl.hidden || !name) return;
        var rows = Array.prototype.slice.call(searchResultEl.querySelectorAll('.sr-item'));
        var hit = null;
        rows.forEach(function (r) {
            var nm = r.querySelector('.sr-name');
            if (!hit && nm && nm.textContent === name) hit = r;
        });
        if (!hit) return;
        rows.forEach(function (r) { r.classList.remove('sr-active'); });
        hit.classList.add('sr-active');
        hit.scrollIntoView({ block: 'nearest' });
    }
    searchInput.addEventListener('input', runSearch);
    searchType.addEventListener('change', runSearch);

    function locateFeature(key, feat) {
        var coords = feat.geometry.coordinates;
        var ll = toMapCoord(coords);
        map.setView(ll, Math.max(map.getZoom(), 15));
        var target = null;
        var container = (clusterEnabled ? pointsLayer.clusters[key] : pointsLayer.plains[key]);
        if (container) {
            container.eachLayer(function (ly) {
                if (!target && ly.getLatLng && ly.getLatLng().lat === ll[0] && ly.getLatLng().lng === ll[1]) target = ly;
            });
        }
        openTargetPopup(container, target);
        if (key === 'road' && linesLayer) {
            linesLayer.eachLayer(function (ly) {
                if (!target && ly.getLatLng && ly.getLatLng().lat === ll[0] && ly.getLatLng().lng === ll[1]) target = ly;
            });
            if (!target) {
                linesLayer.eachLayer(function (ly) { if (!target && ly.getLatLng) target = ly; });
            }
            if (target && target.openPopup) target.openPopup();
        }
    }
    // v125 B1：聚合态下子点被气泡包住、不在地图上，直接 openPopup 无效；
    // 先用 zoomToShowLayer 散开/放大到该点，回调里再开详情卡。
    function openTargetPopup(container, target) {
        if (!target) return;
        if (container && typeof container.zoomToShowLayer === 'function') {
            container.zoomToShowLayer(target, function () { if (target.openPopup) target.openPopup(); });
        } else if (target.openPopup) target.openPopup();
    }

    // ---------------- 8. 测距 / 测面 ----------------
    var measure = { mode: null, pts: [], line: null, poly: null, dots: [], segs: [], total: 0 };
    function hideMeasureCard() {
        clearTimeout(showMeasure._t);
        var mr = document.getElementById('measure-result');
        if (mr) mr.hidden = true;
    }
    function clearMeasure() {
        measure.pts = []; measure.total = 0;
        (measure.dots || []).forEach(function (m) { map.removeLayer(m); });
        (measure.segs || []).forEach(function (l) { map.removeLayer(l); });
        if (measure.line) map.removeLayer(measure.line);
        if (measure.poly) map.removeLayer(measure.poly);
        measure.dots = []; measure.segs = []; measure.line = null; measure.poly = null;
        document.getElementById('btn-distance').classList.remove('active');
        document.getElementById('btn-area').classList.remove('active');
        measure.mode = null;
        hideMeasureCard();
        if (window._recordsClearEcho) window._recordsClearEcho(); // v86：清除测量同时清掉记录回显
    }
    // v75：UI 命中守卫——Leaflet 地图点击监听收到事件时，若来源是任何玻璃面板/卡片/弹窗，
    // 一律忽略（彻底杜绝卡片点击"刺透"到地图触发打点/测量/选点，不依赖冒泡拦截顺序）
    function uiHit(ev) {
        var t = ev && ev.originalEvent && ev.originalEvent.target;
        if (!t || !t.closest) return false;
        return !!t.closest('.settings-panel, .basemap-panel, .mark-panel, .legend-panel, .measure-result, .records-panel, .cl-card, .map-toast, .toolbar, .zoom-ctrl, .leaflet-popup');
    }
    map.on('click', function (e) {
        if (uiHit(e)) return; // v75：卡片/面板内点击不触发测量
        if (!measure.mode) {
            // v81：非测量模式下点击地图任意处 → 隐藏测量结果卡（看完即走；打点面板打开时不打扰）
            var mp = document.getElementById('mark-panel');
            if (!(mp && !mp.hidden)) { try { hideMeasureCard(); } catch (err) { } }
            return;
        }
        // 双击结束时的第二次 click（detail>1）不添加测量点，避免距离/面积多算
        if (e.originalEvent && e.originalEvent.detail > 1) return;
        var ll = [e.latlng.lat, e.latlng.lng];
        measure.pts.push(ll);
        var dot = L.circleMarker(ll, { radius: 4, color: '#2563eb', weight: 1.5, fillColor: '#2563eb', fillOpacity: 0.9 });
        measure.dots.push(dot); map.addLayer(dot);
        if (measure.mode === 'dist') {
            if (measure.pts.length >= 2) {
                var n = measure.pts.length;
                var seg = L.polyline([measure.pts[n - 2], measure.pts[n - 1]], { color: '#2563eb', weight: 2.5, dashArray: '6 6' });
                measure.segs.push(seg); map.addLayer(seg);
                measure.total += havMeters(measure.pts[n - 2][0], measure.pts[n - 2][1], measure.pts[n - 1][0], measure.pts[n - 1][1]);
            }
            showMeasure('距离：' + fmtDist(measure.total) + '（双击结束）', false);
        } else {
            if (measure.pts.length >= 2) {
                if (measure.line) map.removeLayer(measure.line);
                measure.line = L.polyline(measure.pts, { color: '#059669', weight: 2.5, dashArray: '6 6' });
                map.addLayer(measure.line);
            }
            showMeasure('已添加 ' + measure.pts.length + ' 个顶点（双击闭合求面积）', false);
        }
    });
    map.on('dblclick', function (e) {
        if (uiHit(e)) return; // v86：双击任何玻璃面板/卡片不再触发地图测量结束/多边形闭合（防穿透），地图本体双击缩放保留
        if (!measure.mode) return;
        e.originalEvent.preventDefault();
        if (measure.mode === 'dist') {
            showMeasure('总距离：' + fmtDist(measure.total));
            if (window._recordsAdd) window._recordsAdd('dist', '总距离', fmtDist(measure.total), measure.pts.slice());
        } else if (measure.pts.length >= 3) {
            if (measure.line) map.removeLayer(measure.line);
            measure.poly = L.polygon(measure.pts, { color: '#059669', weight: 2, fillColor: '#059669', fillOpacity: 0.15 });
            map.addLayer(measure.poly);
            var area = polygonAreaM2(measure.pts);
            showMeasure('面积：' + fmtArea(area));
            if (window._recordsAdd) window._recordsAdd('area', '面积', fmtArea(area), measure.pts.slice());
        }
        measure.mode = null;
        document.getElementById('btn-distance').classList.remove('active');
        document.getElementById('btn-area').classList.remove('active');
    });
    function polygonAreaM2(pts) {
        var R = 6371000, n = pts.length, area = 0;
        for (var i = 0; i < n; i++) {
            var p1 = pts[i], p2 = pts[(i + 1) % n];
            var lng1 = p1[1] * Math.PI / 180, lng2 = p2[1] * Math.PI / 180;
            var lat1 = p1[0] * Math.PI / 180, lat2 = p2[0] * Math.PI / 180;
            area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
        }
        return Math.abs(area * R * R / 2);
    }
    // v105：测量单位自动转换（课程第10节验收要求）——距离 ≥1000m 切 km、面积 ≥1e6 m² 切 km²，保留两位小数
    function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m.toFixed(2) + ' m'; }
    function fmtArea(m2) { return m2 >= 1000000 ? (m2 / 1000000).toFixed(2) + ' km²' : m2.toFixed(2) + ' m²'; }
    document.getElementById('btn-distance').addEventListener('click', function () {
        if (measure.mode) { clearMeasure(); APP_MODE = (cfSelId != null ? 'select' : 'idle'); return; }
        setAppMode('measure');
        clearMeasure();
        measure.mode = 'dist';
        this.classList.add('active');
        // v76：激活测量工具即显示测量卡片（操作提示），默认不显示；清除/退出自动隐藏
        showMeasure('单击地图添加测量点，双击结束并显示总距离', false);
    });
    document.getElementById('btn-area').addEventListener('click', function () {
        if (measure.mode) { clearMeasure(); APP_MODE = (cfSelId != null ? 'select' : 'idle'); return; }
        setAppMode('measure');
        clearMeasure();
        measure.mode = 'area';
        this.classList.add('active');
        // v76：激活测量工具即显示测量卡片（操作提示），默认不显示；清除/退出自动隐藏
        showMeasure('单击地图添加顶点，双击闭合计算面积', false);
    });
    document.getElementById('btn-clear').addEventListener('click', function () {
        clearMeasure();
        APP_MODE = (cfSelId != null ? 'select' : 'idle');
    });
    // 「完成测量」按钮（手机端无法双击结束，必须有明确结束入口）
    var measureDoneBtn = document.getElementById('measure-done');
    if (measureDoneBtn) measureDoneBtn.addEventListener('click', function () {
        if (measure.mode === 'dist') {
            showMeasure('总距离：' + fmtDist(measure.total));
            if (window._recordsAdd) window._recordsAdd('dist', '总距离', fmtDist(measure.total), measure.pts.slice());
        } else if (measure.mode === 'area' && measure.pts.length >= 3) {
            if (measure.line) map.removeLayer(measure.line);
            measure.poly = L.polygon(measure.pts, { color: '#059669', weight: 2, fillColor: '#059669', fillOpacity: 0.15 });
            map.addLayer(measure.poly);
            var area = polygonAreaM2(measure.pts);
            showMeasure('面积：' + fmtArea(area));
            if (window._recordsAdd) window._recordsAdd('area', '面积', fmtArea(area), measure.pts.slice());
        }
        measure.mode = null;
        document.getElementById('btn-distance').classList.remove('active');
        document.getElementById('btn-area').classList.remove('active');
        measureDoneBtn.hidden = true;
    });
    // v83：「×」关闭按钮已彻底移除——测量结果卡靠点地图任意处 / 清除测量 / 退出测量模式自动隐藏

    // ---------------- 8.7 测量历史记录（导出 / 导入 / 点击回显点线面）v86 ----------------
    (function initRecords() {
        var records = [];
        try { records = JSON.parse(localStorage.getItem('cd_records_v1') || '[]'); } catch (e) { records = []; }
        var echoId = null, echoLayers = [];
        function fmtNow() {
            try { return new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'); } catch (e) { return ''; }
        }
        function saveRec() { try { localStorage.setItem('cd_records_v1', JSON.stringify(records)); } catch (e) { } }
        // 记录坐标统一存 WGS-84 标准（跨底图不偏移）；回显时按当前底图坐标系转回
        function stdPt(ll) { return gcjMode ? gcj2wgs(ll) : ll.slice(); }
        function wgsToDisp(ll) { return gcjMode ? wgs2gcj(ll) : ll.slice(); }
        function addRecord(type, label, value, pts) {
            records.push({ id: Date.now() + Math.floor(Math.random() * 999), type: type, label: label, value: String(value), pts: pts.map(stdPt), time: fmtNow() });
            saveRec(); renderRec();
        }
        function clearRecordEcho() {
            echoLayers.forEach(function (l) { try { map.removeLayer(l); } catch (e) { } });
            echoLayers = []; echoId = null;
            document.querySelectorAll('.rp-item.echo').forEach(function (el) { el.classList.remove('echo'); });
        }
        function renderRec() {
            var list = document.getElementById('records-list');
            var empty = document.getElementById('records-empty');
            if (!list) return;
            list.innerHTML = '';
            if (!records.length) { if (empty) empty.hidden = false; return; }
            if (empty) empty.hidden = true;
            records.forEach(function (r) {
                var item = document.createElement('div');
                item.className = 'rp-item' + (r.id === echoId ? ' echo' : '');
                item.innerHTML =
                    '<span class="rp-type ' + (r.type === 'area' ? 'area' : 'dist') + '">' + (r.type === 'area' ? '面' : '距') + '</span>' +
                    '<span class="rp-val">' + esc(r.label) + '：' + esc(r.value) + '</span>' +
                    '<span class="rp-time">' + esc(r.time || '') + '</span>' +
                    '<button class="rp-del" data-id="' + r.id + '" title="删除该记录">×</button>';
                item.addEventListener('click', function (ev) {
                    if (ev.target.classList.contains('rp-del')) return;
                    echoRecord(r.id);
                });
                list.appendChild(item);
            });
            list.querySelectorAll('.rp-del').forEach(function (b) {
                b.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var id = Number(b.getAttribute('data-id'));
                    records = records.filter(function (x) { return x.id !== id; });
                    if (echoId === id) clearRecordEcho();
                    saveRec(); renderRec();
                });
            });
        }
        function echoRecord(id) {
            var r = null;
            records.forEach(function (x) { if (x.id === id) r = x; });
            if (!r || !r.pts || !r.pts.length) return;
            clearRecordEcho(); echoId = id;
            var disp = r.pts.map(wgsToDisp);
            var col = r.type === 'area' ? '#059669' : '#2563eb';
            r.pts.forEach(function (ll) {
                var dot = L.circleMarker(wgsToDisp(ll), { radius: 4, color: col, weight: 1.5, fillColor: col, fillOpacity: .9 });
                echoLayers.push(dot); map.addLayer(dot);
            });
            if (r.type === 'area' && disp.length >= 3) {
                var poly = L.polygon(disp, { color: col, weight: 2, fillColor: col, fillOpacity: .12 });
                echoLayers.push(poly); map.addLayer(poly);
            } else if (disp.length >= 2) {
                var line = L.polyline(disp, { color: col, weight: 2.5, dashArray: '6 6' });
                echoLayers.push(line); map.addLayer(line);
            }
            try { map.fitBounds(L.latLngBounds(disp).pad(0.2)); } catch (e) { }
            showMeasure(r.label + '：' + r.value, true);
            renderRec();
        }
        function exportRec() {
            if (!records.length) { toast('暂无测量记录可导出', true); return; }
            var payload = { app: 'changde-webgis', version: 86, exportedAt: new Date().toISOString(), records: records };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = '常德WebGIS测量记录_' + Date.now() + '.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            toast('已导出 ' + records.length + ' 条测量记录');
        }
        function importRec(file) {
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var data = JSON.parse(reader.result);
                    var arr = Array.isArray(data) ? data : (data.records || []);
                    var added = 0;
                    arr.forEach(function (x) {
                        if (x && x.pts && Array.isArray(x.pts) && x.pts.length >= 2 && (x.type === 'dist' || x.type === 'area')) {
                            records.push({ id: Date.now() + added++, type: x.type, label: x.label || (x.type === 'area' ? '面积' : '总距离'), value: String(x.value || ''), pts: x.pts, time: x.time || fmtNow() });
                        }
                    });
                    if (added) { saveRec(); renderRec(); toast('导入 ' + added + ' 条测量记录'); }
                    else toast('文件中没有有效测量记录', true);
                } catch (e) { toast('导入文件解析失败，请选择有效的 JSON 文件', true); }
            };
            reader.readAsText(file, 'utf-8');
        }
        var panel = document.getElementById('records-panel');
        var btnRec = document.getElementById('btn-records');
        if (btnRec && panel) {
            btnRec.addEventListener('click', function () {
                panel.hidden = !panel.hidden;
                if (!panel.hidden) renderRec(); else clearRecordEcho();
            });
            var closeBtn = document.getElementById('records-close');
            if (closeBtn) closeBtn.addEventListener('click', function () { panel.hidden = true; clearRecordEcho(); });
            var expBtn = document.getElementById('records-export');
            if (expBtn) expBtn.addEventListener('click', exportRec);
            var impBtn = document.getElementById('records-import');
            var fileInput = document.getElementById('records-file');
            if (impBtn && fileInput) impBtn.addEventListener('click', function () { fileInput.click(); });
            if (fileInput) fileInput.addEventListener('change', function () {
                if (fileInput.files && fileInput.files[0]) importRec(fileInput.files[0]);
                fileInput.value = '';
            });
            var clrBtn = document.getElementById('records-clear');
            if (clrBtn) clrBtn.addEventListener('click', function () {
                if (!records.length) return;
                records = []; clearRecordEcho(); saveRec(); renderRec();
                toast('已清空全部测量记录');
            });
        }
        window._recordsAdd = addRecord;
        window._recordsClearEcho = clearRecordEcho;
    })();

    // ---------------- 8.5 手动底图切换 ----------------
    var btnBasemap = document.getElementById('btn-basemap');
    var basemapPanel = document.getElementById('basemap-panel');
    function paintBasemapSel() {
        basemapPanel.querySelectorAll('.bm-item').forEach(function (it) {
            it.classList.toggle('sel', parseInt(it.getAttribute('data-idx')) === tileIdx);
        });
    }
    if (btnBasemap && basemapPanel) {
        btnBasemap.addEventListener('click', function () {
            basemapPanel.classList.toggle('open');
            if (basemapPanel.classList.contains('open')) {
                forceBackdropResample(basemapPanel);
                paintBasemapSel();
            }
        });
        document.getElementById('basemap-close').addEventListener('click', function () { basemapPanel.classList.remove('open'); try { hideMeasureCard(); } catch (e) { } });
        basemapPanel.querySelectorAll('.bm-item').forEach(function (it) {
            it.addEventListener('click', function () {
                var idx = parseInt(it.getAttribute('data-idx'));
                if (idx === tileIdx) { basemapPanel.classList.remove('open'); return; }
                activateTile(idx, true);
                basemapLocked = true;
                paintBasemapSel();
                try { localStorage.setItem('cd_basemap', idx); } catch (e) { }
                toast('已切换为「' + TILE_CHAIN[idx].name + '」底图（已锁定，不再自动跳变）');
                basemapPanel.classList.remove('open');
            });
        });
        try {
            var savedBm = parseInt(localStorage.getItem('cd_basemap'));
            if (!isNaN(savedBm) && savedBm > 0 && savedBm < TILE_CHAIN.length) {
                activateTile(savedBm, true);
                basemapLocked = true;
            }
        } catch (e) { }
    }

    // ---------------- 8.6 道路打点工具 ----------------
    var markMode = false, markStreet = '', markPts = [], markLayer = null, markLine = null, markEditingId = null;
    var markDrawType = 'LineString', markKind = '道路';
    var btnMark = document.getElementById('btn-mark');
    var markPanel = document.getElementById('mark-panel');

    // v114：把「道路打点」面板升级为「自建要素」面板（点 / 线 / 面 + 业务类型 + 备注）
    (function injectDrawUI() {
        if (!markPanel || document.getElementById('mark-seg')) return;
        var title = markPanel.querySelector('.settings-title');
        if (title) title.innerHTML = '自建要素<span class="settings-close" id="mark-close" title="关闭">×</span>';
        var seg = document.createElement('div');
        seg.className = 'cf-seg';
        seg.id = 'mark-seg';
        seg.innerHTML = '<button type="button" data-t="Point">点</button><button type="button" data-t="LineString" class="on">线</button><button type="button" data-t="Polygon">面</button>';
        var firstRow = markPanel.querySelector('.set-row');
        // v114w：给「点/线/面」加标题，避免和列表上方的「编辑权限」三个同名 chip 混成一团
        var segCap = document.createElement('div');
        segCap.className = 'cf-seg-cap';
        segCap.textContent = '绘制类型';
        if (firstRow) {
            markPanel.insertBefore(segCap, firstRow);
            markPanel.insertBefore(seg, firstRow);
        } else {
            markPanel.appendChild(segCap);
            markPanel.appendChild(seg);
        }
        var kindRow = document.createElement('div');
        kindRow.className = 'set-row';
        kindRow.innerHTML = '<span class="set-name" style="width:60px">业务类型</span><select id="mark-kind">' +
            CF_KINDS.map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join('') + '</select>';
        var startBtn = document.getElementById('mark-start');
        if (startBtn) markPanel.insertBefore(kindRow, startBtn); else markPanel.appendChild(kindRow);
        var remark = document.createElement('textarea');
        remark.id = 'mark-remark';
        remark.className = 'mark-export';
        remark.style.height = '54px';
        remark.placeholder = '备注（选填，如：临时站点 / 边界待核）';
        var status = document.getElementById('mark-status');
        if (status) markPanel.insertBefore(remark, status); else markPanel.appendChild(remark);
        var secTitle = markPanel.querySelector('.mark-sec-title');
        if (secTitle) secTitle.innerHTML = '我的自建要素（<span id="mark-sec-n">0</span>）';
        var secNote = markPanel.querySelector('.mark-sec-note');
        if (secNote) secNote.textContent = '点 / 线 / 面统一入库；点击地图上的要素可选中，再进行改形状、整体移动或删除';
        seg.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button[data-t]') : null;
            if (!b) return;
            markDrawType = b.getAttribute('data-t');
            Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
            markPts = [];
            if (markMode) paintMarkDots();
            updateMarkHint();
        });
        var kindSel = document.getElementById('mark-kind');
        if (kindSel) {
            kindSel.value = markKind;
            kindSel.addEventListener('change', function () { markKind = kindSel.value; if (markMode) paintMarkDots(); });
        }
        updateMarkHint();
    })();

    // ---------------- 8.6.1 编辑权限（v114 P2 挑战 2）----------------
    // 只锁几何操作（改形状 / 整体移动 / 删除）；属性仍可改，避免「关掉编辑＝连备注都存不了」。
    // 总开关「整体」+ 点 / 线 / 面 三档独立开关，状态存 cd_edit_geom（不改动既有红线键）。
    var EDIT_MOD = { all: true, Point: true, LineString: true, Polygon: true };
    var EDIT_MOD_KEY = 'cd_edit_geom';
    (function loadEditMod() {
        try {
            var s = JSON.parse(localStorage.getItem(EDIT_MOD_KEY) || 'null');
            if (s && typeof s === 'object') {
                ['all', 'Point', 'LineString', 'Polygon'].forEach(function (k) {
                    if (typeof s[k] === 'boolean') EDIT_MOD[k] = s[k];
                });
            }
        } catch (e) { }
    })();
    function saveEditMod() {
        try { localStorage.setItem(EDIT_MOD_KEY, JSON.stringify(EDIT_MOD)); } catch (e) { }
    }
    function editAllowed(t) {
        var ty = (t && t.geometry) ? t.geometry.type : t;
        return !!EDIT_MOD.all && !!EDIT_MOD[ty];
    }
    function editOffTip(ty) {
        if (!EDIT_MOD.all) return '（编辑已整体关闭，在「编辑权限」里打开）';
        return '（' + (ty === 'Point' ? '点' : ty === 'LineString' ? '线' : '面') + '要素编辑已关闭，在「编辑权限」里打开）';
    }
    window.__editAllowed = editAllowed;
    window.__editOffTip = editOffTip;
    window.__applyEditMod = applyEditMod;
    window.__syncCardEditBtns = syncCardEditBtns;
    (function injectEditModUI() {
        var sec = document.getElementById('mark-sec');
        if (!sec || document.getElementById('cf-editmod')) return;
        var box = document.createElement('div');
        box.className = 'cf-editmod';
        box.id = 'cf-editmod';
        box.innerHTML =
            '<span class="cf-em-label">编辑权限</span>' +
            '<button type="button" class="cf-em-chip" id="cf-em-all" title="总开关：关闭后只能查看与改属性，改形状 / 整体移动 / 删除全部上锁">整体</button>' +
            '<button type="button" class="cf-em-chip" data-t="Point" title="是否允许编辑「点」要素">点</button>' +
            '<button type="button" class="cf-em-chip" data-t="LineString" title="是否允许编辑「线」要素">线</button>' +
            '<button type="button" class="cf-em-chip" data-t="Polygon" title="是否允许编辑「面」要素">面</button>';
        sec.appendChild(box);
        box.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!b || b.disabled) return;
            if (b.id === 'cf-em-all') {
                EDIT_MOD.all = !EDIT_MOD.all;
                toast(EDIT_MOD.all ? '编辑已开启：可改形状 / 整体移动 / 删除' : '编辑已关闭：几何操作全部上锁，仍可查看与改属性');
            } else {
                var t = b.getAttribute('data-t');
                EDIT_MOD[t] = !EDIT_MOD[t];
                toast((EDIT_MOD[t] ? '已开放编辑：' : '已锁定编辑：') + (t === 'Point' ? '点' : t === 'LineString' ? '线' : '面') + '要素');
            }
            saveEditMod();
            applyEditMod();
        });
        applyEditMod();
    })();
    function applyEditMod() {
        var box = document.getElementById('cf-editmod');
        if (box) {
            var allBtn = document.getElementById('cf-em-all');
            if (allBtn) allBtn.classList.toggle('on', !!EDIT_MOD.all);
            Array.prototype.forEach.call(box.querySelectorAll('.cf-em-chip[data-t]'), function (b) {
                var t = b.getAttribute('data-t');
                b.classList.toggle('on', !!EDIT_MOD[t] && !!EDIT_MOD.all);
                b.classList.toggle('is-locked', !EDIT_MOD.all);
                b.disabled = !EDIT_MOD.all;
            });
        }
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        if (cfSelId !== null) {
            var f = cfById(cfSelId);
            var card = document.getElementById('cf-card');
            if (f && card && card.classList.contains('open')) syncCardEditBtns(f);
        }
    }
    function syncCardEditBtns(f) {
        var ok = editAllowed(f);
        ['cf-shape', 'cf-move', 'cf-del'].forEach(function (id) {
            var b = document.getElementById(id);
            if (!b) return;
            b.disabled = !ok;
            b.classList.toggle('is-off', !ok);
            var base = id === 'cf-shape' ? '改形状（拖顶点改轮廓）' : id === 'cf-move' ? '整体移动（拖动整个要素）' : '删除该要素';
            b.title = ok ? base : base + editOffTip(f.geometry.type);
        });
    }

    function updateMarkHint() {
        var st = document.getElementById('mark-status');
        var ph = document.getElementById('mark-name');
        if (ph) ph.placeholder = markDrawType === 'Point' ? '如：柳叶湖公交站' : markDrawType === 'LineString' ? '如：武陵大道' : '如：滨湖公园';
        if (!st || markMode) return;
        var label = markDrawType === 'Point' ? '单击地图放置一个点，再点「完成」入库'
            : markDrawType === 'LineString' ? '沿线连续单击添加节点（≥2 点可完成）'
                : '沿边界连续单击添加顶点（≥3 点自动闭合成面）';
        st.textContent = '选类型 → 输入名称 → 点「开始打点」→ ' + label;
    }
    function exitMark() {
        markMode = false;
        markEditingId = null;
        if (btnMark) btnMark.classList.remove('active');
        if (markLayer) { map.removeLayer(markLayer); markLayer = null; }
        if (markLine) { map.removeLayer(markLine); markLine = null; }
        markPts = [];
    }
    // 载入已有道路为可编辑草稿（节点可拖动，完成后更新原记录）
    function loadUserRoadForEdit(f) {
        if (!f) return;
        if (!editAllowed(f)) { toast('编辑已锁定：' + editOffTip(f.geometry.type).replace(/[（）]/g, ''), true); return; }
        if (measure.mode) clearMeasure();
        clearCfSel();
        markEditingId = f.id;
        markDrawType = f.geometry.type;
        markStreet = f.properties.name || '';
        markKind = f.properties.kind || '道路';
        markPts = cfCoordList(f).map(function (c) { return [c[1], c[0]]; });
        markMode = true;
        btnMark.classList.add('active');
        var seg = document.getElementById('mark-seg');
        if (seg) Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.toggle('on', x.getAttribute('data-t') === markDrawType); });
        var kindSel = document.getElementById('mark-kind');
        if (kindSel) kindSel.value = markKind;
        var remarkEl = document.getElementById('mark-remark');
        if (remarkEl) remarkEl.value = f.properties.remark || '';
        document.getElementById('mark-name').value = markStreet;
        document.getElementById('mark-ops').hidden = false;
        document.getElementById('mark-export').value = '';
        document.getElementById('mark-copy').hidden = true;
        markPanel.classList.add('open');
        paintMarkDots();
        toast('已载入「' + markStreet + '」进入编辑模式：拖动节点微调，完成后点「完成」保存');
    }
    function paintMarkDots() {
        if (markLayer) map.removeLayer(markLayer);
        if (markLine) { map.removeLayer(markLine); markLine = null; }
        markLayer = L.layerGroup();
        markPts.forEach(function (p, i) {
            var icon = L.divIcon({
                className: 'mark-dot-icon',
                html: '<div class="mark-dot">' + (i + 1) + '</div>',
                iconSize: [20, 20], iconAnchor: [10, 10]
            });
            var m = L.marker(p, { icon: icon, draggable: true, title: '第 ' + (i + 1) + ' 个点（可拖动调整）' });
            // 移动点：拖动节点实时更新坐标并重绘连线
            m.on('dragend', function (e) {
                var ll = e.target.getLatLng();
                markPts[i] = [ll.lat, ll.lng];
                paintMarkDots();
                toast('已移动第 ' + (i + 1) + ' 个节点');
            });
            markLayer.addLayer(m);
        });
        if (markPts.length >= 2) {
            if (markDrawType === 'Polygon') {
                markLine = L.polygon(markPts, { color: cfColor(markKind), weight: 2.5, opacity: .9, fillColor: cfColor(markKind), fillOpacity: .18, dashArray: '3 7' });
            } else {
                markLine = L.polyline(markPts, { color: cfColor(markKind), weight: 3, opacity: .85, dashArray: '2 8' });
            }
            map.addLayer(markLine);
        }
        map.addLayer(markLayer);
        var needPts = markDrawType === 'Point' ? 1 : markDrawType === 'LineString' ? 2 : 3;
        document.getElementById('mark-status').textContent =
            '「' + (markStreet || '未命名') + '」已打 ' + markPts.length + ' 个' + (markDrawType === 'LineString' ? '节点' : '点') +
            (markPts.length >= needPts
                ? '，可以点「完成」入库'
                : '，还需 ' + (needPts - markPts.length) + ' 个' + (markDrawType === 'Polygon' ? '顶点（≥3 自动闭合成面）' : '节点'));
    }
    map.on('click', function (e) {
        if (uiHit(e)) return; // v75：卡片/面板内点击不触发打点
        if (!markMode) return;
        if (markDrawType === 'Point') markPts = [[e.latlng.lat, e.latlng.lng]];
        else markPts.push([e.latlng.lat, e.latlng.lng]);
        paintMarkDots();
    });
    if (btnMark && markPanel) {
        // 阻断地图内所有浮层 UI 的点击冒泡到地图容器
        // （否则打点/测距模式下点击「开始打点」「清空」、工具栏按钮等，click 会冒泡到地图加点监听，在按钮位置误创建一个点）
        // v56 扩展：同时隔离 touch/pointer/mouse 拖动事件，防止手机端拖动滑块/面板时事件穿透到地图导致地图跟着动
        ['.toolbar', '.zoom-ctrl', '.mark-panel', '.settings-panel', '.basemap-panel', '.legend-panel', '.measure-result', '.map-toast'].forEach(function (sel) {
            var el = document.querySelector(sel);
            if (el) {
                el.addEventListener('click', function (e) { e.stopPropagation(); });
                el.addEventListener('touchstart', function (e) { e.stopPropagation(); });
                el.addEventListener('touchmove', function (e) { e.stopPropagation(); });
                el.addEventListener('touchend', function (e) { e.stopPropagation(); });
                el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
                el.addEventListener('pointermove', function (e) { e.stopPropagation(); });
                el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
                el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
                el.addEventListener('mousemove', function (e) { e.stopPropagation(); });
                el.addEventListener('mouseup', function (e) { e.stopPropagation(); });
            }
        });
        btnMark.addEventListener('click', function () {
            markPanel.classList.toggle('open');
            if (markPanel.classList.contains('open')) {
                setAppMode('mark');   // v114 P1-I：开自建要素面板即退出测量 / 结束编辑 / 清选中，避免卡片互相叠压
                forceBackdropResample(markPanel);
            } else {
                if (markMode) { exitMark(); toast('打点已退出'); }
                APP_MODE = (cfSelId != null ? 'select' : 'idle');
            }
        });
        document.getElementById('mark-close').addEventListener('click', function () {
            markPanel.classList.remove('open');
            if (markMode) { exitMark(); toast('打点已退出'); }
            APP_MODE = (cfSelId != null ? 'select' : 'idle');
        });
        document.getElementById('mark-start').addEventListener('click', function () {
            var name = (document.getElementById('mark-name').value || '').trim();
            if (!name) { toast('请先输入要素名称', true); return; }
            setAppMode('mark');
            markStreet = name; markPts = []; markMode = true; markEditingId = null;
            var kindSel = document.getElementById('mark-kind');
            if (kindSel) markKind = kindSel.value;
            btnMark.classList.add('active');
            document.getElementById('mark-ops').hidden = false;
            document.getElementById('mark-export').value = '';
            document.getElementById('mark-copy').hidden = true;
            paintMarkDots();
            var what = markDrawType === 'Point' ? '设施点' : markDrawType === 'LineString' ? '线要素' : '面要素';
            toast('开始绘制「' + name + '」（' + what + '）：' + (markDrawType === 'Point' ? '单击地图放置' : '单击地图连续加点'));
        });
        document.getElementById('mark-undo').addEventListener('click', function () {
            if (markMode && markPts.length) { markPts.pop(); paintMarkDots(); toast('已撤销一个节点'); }
        });
        // 清空：始终清空当前草稿节点；已入库的标注道路不受影响（用「清空全部」删除）
        document.getElementById('mark-clear').addEventListener('click', function () {
            markPts = [];
            if (markMode) paintMarkDots();
            if (markEditingId) {
                markEditingId = null;
                btnMark.classList.remove('active');
                document.getElementById('mark-ops').hidden = true;
            }
            toast('已清空当前绘制草稿（已入库的 ' + customFeatures.length + ' 个自建要素仍保留，删除请选中要素或点「清空全部」）');
        });
        document.getElementById('mark-done').addEventListener('click', function () {
            if (!markMode) return;
            var name = (markStreet || '').trim();
            if (!name) { toast('请先输入要素名称', true); return; }
            var needPts = markDrawType === 'Point' ? 1 : markDrawType === 'LineString' ? 2 : 3;
            if (markPts.length < needPts) {
                toast(markDrawType === 'Point' ? '请先在地图上点一个位置' : markDrawType === 'LineString' ? '线至少要 2 个节点' : '面至少要 3 个顶点', true);
                return;
            }
            var ring = markPts.map(function (p) {
                return [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6];
            });
            if (markDrawType === 'Polygon') {
                if (ring.length === 3 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
                    ring.push([ring[0][0], ring[0][1]]);
                }
            }
            var geom = markDrawType === 'Point'
                ? { type: 'Point', coordinates: ring[0] }
                : markDrawType === 'LineString'
                    ? { type: 'LineString', coordinates: ring }
                    : { type: 'Polygon', coordinates: [ring] };
            var kindSel = document.getElementById('mark-kind');
            var kindVal = (kindSel && kindSel.value) || markKind;
            var remarkVal = ((document.getElementById('mark-remark') || {}).value || '').trim();
            var isEdit = !!markEditingId;
            var feat = {
                id: isEdit ? markEditingId : ('cf' + Date.now()),
                geometry: geom,
                properties: { name: name, kind: kindVal, remark: remarkVal },
                crs: gcjMode ? 'GCJ-02' : 'WGS-84',
                basemap: TILE_CHAIN[tileIdx].name,
                ts: Date.now()
            };
            markEditingId = null;
            var idx = -1;
            for (var k = 0; k < customFeatures.length; k++) { if (String(customFeatures[k].id) === String(feat.id)) { idx = k; break; } }
            if (isEdit && idx >= 0) customFeatures[idx] = feat; else customFeatures.push(feat);
            saveCustom();
            markMode = false;
            btnMark.classList.remove('active');
            if (markLayer) { map.removeLayer(markLayer); markLayer = null; }
            if (markLine) { map.removeLayer(markLine); markLine = null; }
            markPts = [];
            document.getElementById('mark-ops').hidden = true;
            renderCustom();
            syncCfCats();
            renderMarkList();
            refreshSearch();
            updateCounts();
            var txt = JSON.stringify(feat, null, 2);
            document.getElementById('mark-export').value = txt;
            document.getElementById('mark-copy').hidden = false;
            var geoLabel = markDrawType === 'Point' ? '点' : markDrawType === 'LineString' ? '线' : '面';
            document.getElementById('mark-status').textContent =
                (isEdit ? '已更新「' : '已入库「') + name + '」（' + kindVal + ' · ' + geoLabel + '），当前共 ' + customFeatures.length + ' 个自建要素；刷新页面仍会保留';
            toast((isEdit ? '已更新「' : '已存入「') + name + '」，已同步到图层 / 搜索 / 图例');
        });
        document.getElementById('mark-copy').addEventListener('click', function () {
            var v = document.getElementById('mark-export').value;
            if (!v) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(v).then(function () {
                    toast('坐标 JSON 已复制，直接粘贴发送即可');
                }).catch(function () {
                    toast('复制失败，请手动全选复制');
                });
            } else {
                var ta = document.getElementById('mark-export');
                ta.focus(); ta.select();
                toast('已选中，请手动复制');
            }
        });

        // ---- 我的道路点库：管理列表 ----
        // 已合入判断：拉取服务端 road.geojson 的道路名集合，与标注同名即显示「已合入」徽标
        var mergedNames = null;
        function ensureMergedNames() {
            if (mergedNames) return mergedNames;
            mergedNames = [];
            try {
                fetch('data/road.geojson').then(function (r) { return r.json(); }).then(function (j) {
                    mergedNames = (j.features || []).map(function (f) { return f.properties && f.properties.name; });
                    renderMarkList();
                }).catch(function () { });
            } catch (e) { }
            return mergedNames;
        }
        function renderMarkList() {
            window.__renderMarkList = renderMarkList;  // v114：暴露给外层的删除 / 拖拽落库 / 属性保存后刷新列表
            var sec = document.getElementById('mark-sec');
            var list = document.getElementById('mark-list');
            if (!sec || !list) return;
            var nEl = document.getElementById('mark-sec-n');
            if (nEl) nEl.textContent = customFeatures.length;
            list.innerHTML = '';
            if (!customFeatures.length) {
                list.innerHTML = '<div class="mark-empty">暂无自建要素：选点 / 线 / 面 → 输入名称 → 开始绘制 → 完成即入库</div>';
                return;
            }
            customFeatures.forEach(function (f) {
                var row = document.createElement('div');
                row.className = 'mark-item';
                var geo = f.geometry.type === 'Point' ? '点' : f.geometry.type === 'LineString' ? '线' : '面';
                var pts = cfCoordList(f).length;
                // v114 P2-2：编辑权限关闭时，改 / 删两个入口置灰禁用（定位不受影响）
                var okE = window.__editAllowed ? window.__editAllowed(f) : true;
                var offCls = okE ? '' : ' is-off';
                var disAttr = okE ? '' : ' disabled';
                var offTip = okE ? '' : (window.__editOffTip ? window.__editOffTip(f.geometry.type) : '（编辑已关闭）');
                row.innerHTML =
                    '<span class="mi-name">' + esc(f.properties.name) + '</span>' +
                    '<span class="mi-badge" style="background:' + cfColor(f.properties.kind) + '">' + esc(f.properties.kind) + '</span>' +
                    '<span class="mi-meta">' + geo + '·' + pts + '点</span>' +
                    '<span class="mi-ops">' +
                    // v114 P2-4：文字按钮换图标 + 悬浮提示（title 兼作读屏标签），行宽够放三个
                    '<button data-act="zoom" class="mi-btn ico" title="定位到该要素" aria-label="定位"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg></button>' +
                    '<button data-act="edit" class="mi-btn ico' + offCls + '"' + disAttr + ' title="编辑形状（拖顶点改轮廓）' + offTip + '" aria-label="编辑形状"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5l-4-4L4 16v4z"/><path d="M14.5 5.5l4 4"/></svg></button>' +
                    '<button data-act="del" class="mi-btn ico' + offCls + '"' + disAttr + ' title="删除该要素' + offTip + '" aria-label="删除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M7.5 7l1 12.5h7l1-12.5"/></svg></button>' +
                    '</span>';
                row.querySelector('[data-act=zoom]').addEventListener('click', function () {
                    var c = cfCoordList(f);
                    if (!c.length) return;
                    var pts = c.map(function (p) { return toMapCoord(p); });
                    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 16));
                    else map.fitBounds(L.latLngBounds(pts).pad(0.2));
                    selectCf(f.id);
                });
                row.querySelector('[data-act=edit]').addEventListener('click', function () {
                    loadUserRoadForEdit(f);
                });
                row.querySelector('[data-act=del]').addEventListener('click', function () {
                    deleteCf(f.id);   // 确认框只在 deleteCf 内弹一次，避免双击确认
                });
                list.appendChild(row);
            });
        }
        // ---- v114 P1-H：自建要素 GeoJSON 导出 / 导入（按 id 去重合并）----
        // 坐标口径如实标注：本项目存的是底图坐标系（GCJ-02），不是 WGS-84；
        // 导出文件不谎报坐标系，需要 WGS-84 时先做偏移纠偏，避免在 QGIS 里错位上百米。
        // v126：内置采集层要素纳入导出（此前导出只含自建/导入）。隐藏层仍导出，已整层删除（goneLayers）的不含。
        function collectBuiltinFeatures() {
            var out = [];
            GEO_KEYS.forEach(function (k) {
                if (goneLayers[k]) return;
                (layerState[k].data || []).forEach(function (f, i) {
                    var p = (f && f.properties) || {};
                    out.push({
                        type: 'Feature',
                        id: String(poiFid(f) || ('bi-' + k + '-' + i)),
                        geometry: f.geometry,
                        properties: { name: p.name || '', kind: LAYER_CONFIG[k].name, source: '内置', remark: p.remark || '', crs: f.crs || '', ts: 0 }
                    });
                });
            });
            return out;
        }
        function collectCustomFeatures() {
            return customFeatures.map(function (f) {
                return {
                    type: 'Feature',
                    id: f.id,
                    geometry: f.geometry,
                    properties: { name: f.properties.name, kind: f.properties.kind, remark: f.properties.remark || '', source: cfSource(f), crs: f.crs || '', ts: f.ts || 0 }
                };
            });
        }
        // scope: 'all' 全部存在图层 / 'builtin' 仅内置 / 'custom' 仅我的图层
        function buildExportGeoJSON(scope) {
            var isGcj = (typeof gcjMode === 'undefined') ? true : !!gcjMode;
            var feats = [], counts = { builtin: 0, custom: 0 };
            if (scope !== 'custom') { var b = collectBuiltinFeatures(); counts.builtin = b.length; feats = feats.concat(b); }
            if (scope !== 'builtin') { var c = collectCustomFeatures(); counts.custom = c.length; feats = feats.concat(c); }
            return {
                type: 'FeatureCollection',
                name: 'changde-webgis-exported',
                scope: scope,
                crs_note: '坐标为 ' + (isGcj ? 'GCJ-02（高德/腾讯系，非 WGS-84）' : 'WGS-84') + '；如需 WGS-84 请先做 GCJ-02→WGS-84 偏移纠偏',
                generated: new Date().toISOString(),
                counts: counts,
                features: feats
            };
        }
        // 兼容旧探针 / 打点面板：cfGeoJSON 仍只取我的图层
        function cfGeoJSON() { return buildExportGeoJSON('custom'); }
        function downloadGeoJSON(payload, filename) {
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        }
        // 规范化坐标：容错「面少一层外环」「环首尾没闭合」「点写成嵌套数组」这三种真实坏数据
        function normPt(p) {
            if (!p) return null;
            var x = null, y = null;
            if (typeof p[0] === 'number' && typeof p[1] === 'number') { x = p[0]; y = p[1]; }
            else if (p[0] && typeof p[0][0] === 'number') { x = p[0][0]; y = p[0][1]; }
            if (x === null || y === null || !isFinite(x) || !isFinite(y)) return null;
            if (Math.abs(y) > 90 || Math.abs(x) > 180) return null;   // [lng,lat] 顺序，纬度不可能超过 90
            return [x, y];
        }
        function normRing(arr) {
            if (!Array.isArray(arr)) return null;
            var ring = [];
            for (var i = 0; i < arr.length; i++) {
                var q = normPt(arr[i]);
                if (!q) return null;
                ring.push(q);
            }
            if (ring.length < 3) return null;
            var a = ring[0], b = ring[ring.length - 1];
            if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);   // 首尾不闭合就补上
            return ring;
        }
        function normCfGeom(type, c) {
            if (!c) return null;
            if (type === 'Point') return normPt(c);
            if (type === 'LineString') {
                if (!Array.isArray(c) || c.length < 2) return null;
                var line = [];
                for (var i = 0; i < c.length; i++) {
                    var q = normPt(c[i]);
                    if (!q) return null;
                    line.push(q);
                }
                return line;
            }
            if (type === 'Polygon') {
                // 两层（[[lng,lat],…]）是漏了外环那一层——正是让整个面不渲染的经典坏数据，这里自动补一层
                if (Array.isArray(c) && c.length && typeof c[0][0] === 'number') {
                    var r0 = normRing(c);
                    return r0 ? [r0] : null;
                }
                var rings = [];
                for (var k = 0; k < c.length; k++) {
                    var r = normRing(c[k]);
                    if (!r) return null;
                    rings.push(r);
                }
                return rings.length ? rings : null;
            }
            return null;
        }
        function importCfText(text, fname) {
            var data;
            try { data = JSON.parse(text); } catch (e) {
                // v122：常德地区的图层数据常以 .js 交付（var 名 = {...}; / window.DATA = {...}），
                // JSON.parse 直接失败，这里截取首个 { 到最后一个 } 再试一次，仍失败才报错
                var s0 = String(text || ''), a = s0.indexOf('{'), b = s0.lastIndexOf('}');
                if (a >= 0 && b > a) { try { data = JSON.parse(s0.slice(a, b + 1)); } catch (e2) { data = null; } }
                if (!data) { toast('导入失败：不是合法 JSON（.js 数据文件需形如 var 名 = {...};）', true); return; }
            }
            // v122：图层名 = 文件名（去扩展名），同一文件重复导入自动并回同一图层行
            var srcName = String(fname || '导入图层').replace(/\.(geojson|json|js|txt)$/i, '').trim().slice(0, 40) || '导入图层';
            var arr = [];
            if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) arr = data.features;
            else if (data && data.type === 'Feature') arr = [data];
            else if (Array.isArray(data)) arr = data;
            if (!arr.length) { toast('文件里没有可导入的要素', true); return; }
            var added = 0, dup = 0, bad = 0, newKinds = {}, newPts = [];
            arr.forEach(function (ft) {
                try {
                    var g = ft && ft.geometry;
                    if (!g || !g.coordinates) { bad++; return; }
                    var type = g.type;
                    if (type !== 'Point' && type !== 'LineString' && type !== 'Polygon') { bad++; return; }
                    var coords = normCfGeom(type, g.coordinates);
                    if (!coords) { bad++; return; }
                    var p = ft.properties || {};
                    var id = String(ft.id || p.id || ('cfimp' + Date.now() + '_' + added));
                    if (cfById(id)) { dup++; return; }               // 按 id 去重：同一个要素重复导入不会翻倍
                    // v116：类型不再限于内置 5 类——按数据自带的业务类型成层（笔记「图层由数据决定」）
                    // v119：先归一同义类型（高校→学校、卫生院→医院），再成层，图层列表不被同义类型撑散
                    var rawKind = String(p.kind || p.KIND || p.type || p.类型 || '').trim().slice(0, 12);
                    var kind = normKind(rawKind);
                    customFeatures.push({
                        id: id,
                        geometry: { type: type, coordinates: coords },
                        properties: {
                            name: String(p.name || p.NAME || ('导入要素 ' + (added + 1))).slice(0, 40),
                            kind: kind,
                            remark: String(p.remark || p.note || '').slice(0, 120),
                            source: srcName
                        },
                        crs: p.crs || 'GCJ-02',
                        ts: Date.now() + added
                    });
                    newKinds[kind] = (newKinds[kind] || 0) + 1;
                    cfCoordList({ geometry: { type: type, coordinates: coords } }).forEach(function (c) { newPts.push(c); });
                    added++;
                } catch (eOne) { bad++; }
            });
            saveCustom(); renderCustom(); syncCfCats(); updateCounts(); renderMarkList(); refreshSearch();
            // v116：导入后自动把视野移到数据范围（padding 避开左侧栏），新增业务类型由 syncCfCats 自动生成图层行
            if (added > 0 && newPts.length) {
                try {
                    var b = L.latLngBounds(newPts.map(toMapCoord));
                    map.fitBounds(b, { paddingTopLeft: [86, 70], paddingBottomRight: [70, 60], maxZoom: 16 });
                } catch (e) { }
            }
            // v116：导入的类型若正好是「此前被整层删除的内置图层」，自动把它复活（笔记验收 8）
            var revived = [];
            if (added > 0) {
                Object.keys(newKinds).forEach(function (nm) {
                    GEO_KEYS.forEach(function (k) {
                        if (!LAYER_CONFIG[k] || LAYER_CONFIG[k].name !== nm) return;
                        if (!goneLayers[k]) return;
                        var src = (DATA[k] && DATA[k].features) || [];
                        if (!src.length) return;
                        layerState[k].data = src;
                        layerState[k].visible = true;
                        var chk = document.getElementById('chk-' + k);
                        if (chk) chk.checked = true;
                        delete goneLayers[k];
                        refreshLayer(k);
                        revived.push(nm);
                    });
                });
                if (revived.length) {
                    saveGoneLayers();
                    try { syncLegend(); } catch (e) { }
                    try { syncGoneOptions(); } catch (e) { }
                    try { renderRestoreBtn(); } catch (e) { }
                    updateCounts();
                }
            }
            var kindList = Object.keys(newKinds);
            var msg = (fname ? '「' + fname + '」' : '') + '导入 ' + added + ' 个要素';
            if (kindList.length) msg += '：' + kindList.map(function (k) { return k + ' ×' + newKinds[k]; }).join('、') + '，图层列表已同步';
            if (dup) msg += '，跳过 ' + dup + ' 个（id 重复）';
            if (bad) msg += '，跳过 ' + bad + ' 个（结构不合法）';
            toast(msg, !added);
        }
        window.__cfExport = cfGeoJSON;                 // 验收探针：当前我的图层导出结构
        window.__cfExportAll = function () { return buildExportGeoJSON('all'); };  // 探针：内置 + 我的全部
        window.__cfImport = importCfText;              // 验收探针：直接喂文本走导入
        document.getElementById('mark-export-all').addEventListener('click', function () {
            if (!customFeatures.length) { toast('暂无自建要素可导出', true); return; }
            downloadGeoJSON(cfGeoJSON(), '我的自建要素.geojson');
            toast('已下载「我的自建要素.geojson」（' + customFeatures.length + ' 个），可直接在 QGIS / GeoJSON.io 打开');
        });
        // v126：图层管理面板「导出」= 内置 + 我的图层全部存在要素（隐藏层仍导出，已删层不含）
        var layerExportBtn = document.getElementById('btn-layer-export');
        if (layerExportBtn) layerExportBtn.addEventListener('click', function () {
            var payload = buildExportGeoJSON('all');
            if (!payload.features.length) { toast('当前没有可导出的图层要素', true); return; }
            downloadGeoJSON(payload, '常德WebGIS全部图层.geojson');
            toast('已导出 ' + payload.features.length + ' 个要素（内置 ' + payload.counts.builtin + ' · 我的 ' + payload.counts.custom + '），可在 QGIS / GeoJSON.io 打开');
        });
        var cfImportBtn = document.getElementById('mark-import-all');
        var cfFileInput = document.getElementById('mark-file');
        if (cfImportBtn && cfFileInput) {
            cfImportBtn.addEventListener('click', function () { cfFileInput.click(); });
            cfFileInput.addEventListener('change', function () {
                var file = cfFileInput.files && cfFileInput.files[0];
                if (!file) return;
                // v116：读取阶段先给一条带文件名与体积的提示（笔记挑战 4「显示加载进度」）
                toast('正在读取「' + file.name + '」…（' + Math.max(1, Math.round(file.size / 1024)) + ' KB）');
                var reader = new FileReader();
                reader.onload = function () { importCfText(String(reader.result || ''), file.name); };
                reader.onerror = function () { toast('读取失败：「' + file.name + '」', true); };
                reader.readAsText(file, 'utf-8');
                cfFileInput.value = '';
            });
        }
        // v116：图层管理区的「导入」按钮复用同一个文件输入，导入完自动定位
        var layerImportBtn = document.getElementById('btn-layer-import');
        if (layerImportBtn && cfFileInput) {
            layerImportBtn.addEventListener('click', function () { cfFileInput.click(); });
        }
        document.getElementById('mark-clear-all').addEventListener('click', function () {
            if (!customFeatures.length) return;
            if (!window.confirm('确定清空全部 ' + customFeatures.length + ' 个自建要素？此操作不可恢复')) return;
            customFeatures = [];
            saveCustom();
            clearCfSel();
            renderCustom();
            syncCfCats();
            updateCounts();
            renderMarkList();
            refreshSearch();
            toast('已清空全部自建要素');
        });
        renderMarkList();
    }

    // ---------------- 8.7 Ctrl+Z 全局撤销 ----------------
    // 打点模式：撤销最后一个打点节点；测距/测面模式：撤销最后一个测量点
    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'z') return;
        if (markMode && markPts.length) {
            e.preventDefault();
            markPts.pop();
            paintMarkDots();
            toast('已撤销一个打点节点（Ctrl+Z）');
            return;
        }
        if (measure.mode && measure.pts.length) {
            e.preventDefault();
            measure.pts.pop();
            var d = measure.dots.pop();
            if (d) map.removeLayer(d);
            if (measure.mode === 'dist') {
                var seg = measure.segs.pop();
                if (seg) map.removeLayer(seg);
                measure.total = 0;
                for (var k = 1; k < measure.pts.length; k++) {
                    measure.total += havMeters(measure.pts[k - 1][0], measure.pts[k - 1][1], measure.pts[k][0], measure.pts[k][1]);
                }
                showMeasure(measure.pts.length >= 2 ? '距离：' + fmtDist(measure.total) + '（双击结束）' : '单击地图添加测量点（双击结束）', false);
            } else {
                if (measure.line) { map.removeLayer(measure.line); measure.line = null; }
                if (measure.pts.length >= 2) {
                    measure.line = L.polyline(measure.pts, { color: '#059669', weight: 2.5, dashArray: '6 6' });
                    map.addLayer(measure.line);
                }
                showMeasure('已添加 ' + measure.pts.length + ' 个顶点（双击闭合求面积）', false);
            }
            toast('已撤销一个测量点（Ctrl+Z）');
        }
    });

    // ---------------- 9. 复位 / 全景适配 ----------------
    document.getElementById('btn-home').addEventListener('click', function () {
        map.setView(gcjMode ? INIT_CENTER : gcj2wgs(INIT_CENTER), INIT_ZOOM);
    });
    document.getElementById('btn-locate').addEventListener('click', function () {
        fitDataView();
        toast('已定位到常德市区全景（武陵区 + 鼎城区）');
    });
    function fitDataView() {
        var bounds = L.latLngBounds([]);
        var any = false;
        GEO_KEYS.forEach(function (k) {
            layerState[k].data.forEach(function (f) {
                var coords = f.geometry.coordinates;
                if (k === 'road') {
                    coords.forEach(function (c) { bounds.extend(toMapCoord(c)); any = true; });
                } else {
                    bounds.extend(toMapCoord(coords)); any = true;
                }
            });
        });
        customFeatures.forEach(function (f) {
            cfCoordList(f).forEach(function (c) { bounds.extend(toMapCoord(c)); any = true; });
        });
        if (any) map.fitBounds(bounds, { padding: [70, 70, 40, 70], maxZoom: 14 });
    }

    // ---------------- 10. 我的位置：全开源定位（v39） ----------------
    // 引擎：原生 navigator.geolocation 持续追踪（WGS-84 直接叠加，零坐标转换）
    //      + 国外开源 IP 定位降级（ipapi.co）+ OSM Nominatim 逆地理地址
    var geoMarker = null, geoCircle = null, geoWatchId = null, geoLastBest = null, geoLastAddrAt = 0, geoRenderedOnce = false;

    function locLevelText(acc) {
        if (acc <= 100) return { level: 'gps', src: '卫星/GPS' };
        if (acc <= 500) return { level: 'network', src: 'WiFi·基站' };
        return { level: 'ip', src: 'IP 网络' };
    }
    function reverseAddr(ll, cb) {
        if (Date.now() - geoLastAddrAt < 3000) return;
        geoLastAddrAt = Date.now();
        fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + ll.lat + '&lon=' + ll.lng + '&zoom=16&accept-language=zh-CN')
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.display_name) cb('OSM · ' + String(d.display_name).split(',').slice(0, 3).join(','));
            })
            .catch(function () { cb(''); });
    }
    function renderLoc(ll, acc, srcText, level, isFresh) {
        // v113：空值保护——geoLastBest 数据不完整时不渲染
        if (!ll || typeof ll.lat !== 'number' || typeof ll.lng !== 'number') return;
        // 底图为高德(GCJ-02)时，定位坐标(WGS-84)转换后再显示；逆地理始终用 WGS-84
        var wgsLL = ll;
        if (gcjMode) ll = L.latLng(wgs2gcj([ll.lat, ll.lng]));
        if (geoMarker) map.removeLayer(geoMarker);
        if (geoCircle) map.removeLayer(geoCircle);
        var icon = L.divIcon({ className: 'geo-dot-wrap', html: '<div class="geo-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
        geoMarker = L.marker(ll, { icon: icon, zIndexOffset: 1000, title: '我的位置（' + srcText + '，精度约±' + Math.round(acc) + ' 米）' });
        map.addLayer(geoMarker);
        geoCircle = L.circle(ll, { radius: Math.max(acc, 20), color: '#1677ff', weight: 1, opacity: 0.4, fillColor: '#1677ff', fillOpacity: 0.12 });
        map.addLayer(geoCircle);
        map.setView(ll, Math.max(map.getZoom(), 16));
        var poor = (level === 'ip') ? '；IP 级定位（运营商节点，误差较大），建议到室外并授予"精确位置"权限' : '';
        if (isFresh) toast('已定位（' + srcText + '，精度约±' + Math.round(acc) + ' 米）' + poor);
        reverseAddr(wgsLL, function (addr) {
            if (addr && geoMarker) geoMarker.setTitle('我的位置（' + srcText + '，精度约±' + Math.round(acc) + ' 米）· ' + addr);
        });
    }
    function doAutoLocate(btn) {
        try {
            var ua = navigator.userAgent || '';
            if (/MiuiBrowser|UCBrowser|Quark|baiduboxapp|Coolpad|DingTalk|MicroMessenger/i.test(ua)) {
                toast('检测到系统/国产浏览器，定位能力受限。建议用手机 Chrome 打开本页后重试', true);
            }
        } catch (e) { /* 忽略 */ }
        toast('正在定位（开源引擎：GPS / WiFi·基站）…');
        var gotNative = false, settled = false, ipDone = false;
        var frames = [];
        var t0 = Date.now();

        function renderBest(isFresh) {
            var best = null;
            for (var i = 0; i < frames.length; i++) if (!best || frames[i].acc < best.acc) best = frames[i];
            if (!best) return;
            var s = locLevelText(best.acc);
            var n = frames.length;
            var fixed = n >= 3 &&
                frames[n - 1].lng === frames[n - 2].lng && frames[n - 2].lng === frames[n - 3].lng &&
                frames[n - 1].lat === frames[n - 2].lat && frames[n - 2].lat === frames[n - 3].lat &&
                best.acc > 200;
            if (fixed) { s.level = 'ip'; s.src = 'IP 固定点'; }
            var fresh = !geoRenderedOnce;
            geoRenderedOnce = true;
            renderLoc(L.latLng(best.lat, best.lng), best.acc, s.src, s.level, fresh);
        }
        function startNative() {
            if (geoWatchId !== null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
            if (!navigator.geolocation) { ipLocate(); return; }
            geoWatchId = navigator.geolocation.watchPosition(
                function (pos) {
                    gotNative = true;
                    var acc = pos.coords.accuracy || 9999;
                    frames.push({ lng: pos.coords.longitude, lat: pos.coords.latitude, acc: acc, t: Date.now() });
                    if (frames.length > 40) frames.splice(0, frames.length - 40);
                    var best = null;
                    for (var i = 0; i < frames.length; i++) if (!best || frames[i].acc < best.acc) best = frames[i];
                    if (!best) return;
                    if (!geoLastBest || best.acc <= geoLastBest.acc * 3) {
                        geoLastBest = { acc: best.acc };
                        renderBest(false);
                    }
                    if (Date.now() - t0 > 12000 && !settled) { settled = true; btn.disabled = false; }
                },
                function () { if (!gotNative && !ipDone) ipLocate(); },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
            setTimeout(function () { if (!gotNative && !ipDone && !settled) ipLocate(); }, 8000);
        }
        function ipLocate() {
            if (ipDone || settled) return;
            ipDone = true;
            fetch('https://ipapi.co/json/')
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
                        frames.push({ lng: d.longitude, lat: d.latitude, acc: 3000, t: Date.now() });
                        if (!geoLastBest || geoLastBest.acc > 3000) { geoLastBest = { acc: 3000 }; renderBest(true); }
                        if (!settled) { settled = true; btn.disabled = false; }
                    } else { throw new Error('bad payload'); }
                })
                .catch(function () {
                    if (!settled) {
                        settled = true; btn.disabled = false;
                        toast('定位失败：浏览器未授予精确位置权限，且开源 IP 定位不可达。请在浏览器地址栏旁点击"位置"图标授权后重试', true);
                    }
                });
        }
        startNative();
    }
    document.getElementById('btn-geoloc').addEventListener('click', function () { doAutoLocate(this); });

    // ---------------- 11. 图例 / 材质包飘落系统（桂花/绿叶/玫瑰 + 节律调节） ----------------
    document.getElementById('btn-legend').addEventListener('click', function () {
        var p = document.getElementById('legend-panel');
        p.hidden = !p.hidden;
    });
    var PACKS = {
        peach: { name: '桃花', accent: '#c85d8b', accentDark: '#a9446f', accentSoft: '#fdf2f6', pclass: 'peach' },
        osmanthus: { name: '桂花', accent: '#b45309', accentDark: '#92400e', accentSoft: '#fef3c7', pclass: 'osmanthus' },
        leaf: { name: '绿叶', accent: '#15803d', accentDark: '#166534', accentSoft: '#dcfce7', pclass: 'leaf' },
        rose: { name: '玫瑰', accent: '#be185d', accentDark: '#9d174d', accentSoft: '#fce7f3', pclass: 'rose' },
        paper: { name: '纸笺', accent: '#7d6a4f', accentDark: '#4b4133', accentSoft: '#f3eee2', pclass: 'paper' },
        night: { name: '夜间', accent: '#818cf8', accentDark: '#6366f1', accentSoft: 'rgba(129,140,248,.14)', pclass: 'night' }
    };
    var themeState = { pack: 'peach', rhythm: 5, on: false };
    function loadTheme() {
        try {
            var t = JSON.parse(localStorage.getItem('cd_theme') || 'null');
            if (t && PACKS[t.pack]) { themeState.pack = t.pack; }
            if (t && t.rhythm !== undefined && t.rhythm >= 1 && t.rhythm <= 10) { themeState.rhythm = t.rhythm; }
            if (t && t.on !== undefined) { themeState.on = !!t.on; }
        } catch (e) { }
    }
    function saveTheme() { try { localStorage.setItem('cd_theme', JSON.stringify(themeState)); } catch (e) { } }
    // v116 修：主题必须在「设置面板初始化」之前读档——设置面板初始化时会写回默认 rhythm，
    // 如果等到启动段才 loadTheme，新写入的默认值（peach / 5）会先把用户存档覆盖掉，
    // 表现为「选了纸笺，刷新又回到桃花」。这里读一次，启动段不再重复读。
    loadTheme();
    function rebuildPetals() {
        var wrap = document.getElementById('petal-wrap');
        if (!wrap) return;
        var p = PACKS[themeState.pack];
        var r = themeState.rhythm;              // 1-10：越大越密越快
        var count = 4 + r;                     // v115：8~26 → 6~14，减少叠加合成层
        var durBase = 15 - r * 0.8;             // 14.2 ~ 7s
        var swayBase = 20 + r * 7;              // 27 ~ 90px
        // 粒子池复用：数量不足补、多余移除；已有粒子只换外观类（保留下落动画状态，平滑变形状，不再整池重建闪跳）
        while (wrap.children.length < count) {
            var d = document.createElement('i');
            var l = Math.random() * 100, s = 0.55 + Math.random() * 0.75;
            var dur = durBase * (0.7 + Math.random() * 0.6), delay = Math.random() * 12;
            var sway = swayBase * (0.6 + Math.random() * 0.8), rot = Math.random() * 360;
            var w = 7 + Math.random() * 9, h = 7 + Math.random() * 9;
            d.style.cssText = 'left:' + l.toFixed(1) + '%;--dur:' + dur.toFixed(2) + 's;--delay:-' + delay.toFixed(2) + 's;--sway:' + sway.toFixed(0) + 'px;--rot:' + rot.toFixed(0) + 'deg;width:' + w.toFixed(0) + 'px;height:' + h.toFixed(0) + 'px;transform:scale(' + s.toFixed(2) + ');';
            wrap.appendChild(d);
        }
        while (wrap.children.length > count) { wrap.removeChild(wrap.lastChild); }
        for (var i = 0; i < wrap.children.length; i++) {
            wrap.children[i].className = 'petal ' + p.pclass;
        }
    }
    // 材质包切换时同步地图图层颜色（POI 圆点/道路线随材质包与夜间模式换色）
    function themeCSSVar(name) {
        return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
    }
    function repaintThemeColors() {
        LAYER_CONFIG.school.color = themeCSSVar('--school');
        LAYER_CONFIG.hospital.color = themeCSSVar('--hospital');
        LAYER_CONFIG.scenic.color = themeCSSVar('--scenic');
        LAYER_CONFIG.road.color = themeCSSVar('--road');
        ['school', 'hospital', 'scenic'].forEach(function (key) {
            ['clusters', 'plains'].forEach(function (bucket) {
                var g = pointsLayer[bucket][key];
                if (!g) return;
                g.eachLayer(function (l) {
                    if (l.setStyle) { l.setStyle({ color: LAYER_CONFIG[key].color, fillColor: LAYER_CONFIG[key].color }); return; }
                    // v115：点位已换成 SVG 形状标记（divIcon），换肤时必须重建 icon，否则夜间仍是白天的色
                    if (l.setIcon && l.options && l.options.icon && l.options.icon.options &&
                        String(l.options.icon.options.className).indexOf('poi-node-wrap') >= 0) {
                        l.setIcon(L.divIcon({
                            className: 'poi-node-wrap',
                            html: '<div class="poi-node poi-' + key + '">' + poiIconHtml(key) + '</div>',
                            iconSize: [24, 26], iconAnchor: [12, 26]
                        }));
                    }
                });
            });
        });
        // 道路线：白描边层不动，主线换色（SVG path 在 theme-anim 下有 stroke 过渡，平滑换色不闪）
        if (linesLayer) {
            linesLayer.eachLayer(function (l) {
                if (l.setStyle && l.options && l.options.color && l.options.color !== '#ffffff') {
                    l.setStyle({ color: LAYER_CONFIG.road.color });
                }
            });
        }
    }
    // 顶部 logo 图案随材质包（最左符号：桃花瓣/桂花十字花/叶形/玫瑰尖瓣/星形）
    var LOGO_SHAPES = {
        peach: '<ellipse cx="12" cy="7" rx="2.7" ry="3.8"/><ellipse cx="12" cy="7" rx="2.7" ry="3.8" transform="rotate(72 12 12)"/><ellipse cx="12" cy="7" rx="2.7" ry="3.8" transform="rotate(144 12 12)"/><ellipse cx="12" cy="7" rx="2.7" ry="3.8" transform="rotate(216 12 12)"/><ellipse cx="12" cy="7" rx="2.7" ry="3.8" transform="rotate(288 12 12)"/><circle cx="12" cy="12" r="1.7" fill="#fff" opacity=".8"/>',
        osmanthus: '<ellipse cx="12" cy="5.5" rx="2.3" ry="3.4"/><ellipse cx="12" cy="18.5" rx="2.3" ry="3.4"/><ellipse cx="5.5" cy="12" rx="3.4" ry="2.3"/><ellipse cx="18.5" cy="12" rx="3.4" ry="2.3"/><circle cx="12" cy="12" r="1.6" fill="#fff" opacity=".85"/>',
        leaf: '<path d="M12 2 C6.8 6.4 4.8 10.4 4.8 12 C4.8 16.8 8.6 22 12 22 C15.4 22 19.2 16.8 19.2 12 C19.2 10.4 17.2 6.4 12 2 Z"/><path d="M12 4.5 L12 20.5" stroke="#fff" stroke-width="1.1" opacity=".55" fill="none" stroke-linecap="round"/>',
        rose: '<path d="M12 2.6 C13.6 6.2 13.6 8.4 12 9.4 C10.4 8.4 10.4 6.2 12 2.6 Z"/><path d="M12 2.6 C13.6 6.2 13.6 8.4 12 9.4 C10.4 8.4 10.4 6.2 12 2.6 Z" transform="rotate(72 12 12)"/><path d="M12 2.6 C13.6 6.2 13.6 8.4 12 9.4 C10.4 8.4 10.4 6.2 12 2.6 Z" transform="rotate(144 12 12)"/><path d="M12 2.6 C13.6 6.2 13.6 8.4 12 9.4 C10.4 8.4 10.4 6.2 12 2.6 Z" transform="rotate(216 12 12)"/><path d="M12 2.6 C13.6 6.2 13.6 8.4 12 9.4 C10.4 8.4 10.4 6.2 12 2.6 Z" transform="rotate(288 12 12)"/><circle cx="12" cy="12" r="1.4" fill="#fff" opacity=".7"/>',
        night: '<path d="M12 2 L14.6 8.4 L21.4 8.4 L15.9 12.6 L18.4 19 L12 15 L5.6 19 L8.1 12.6 L2.6 8.4 L9.4 8.4 Z"/>',
        paper: '<rect x="3.9" y="3.1" width="16.2" height="17.8" rx="1.3"/><rect x="6.7" y="7" width="10.6" height="1.4" rx=".4" fill="#fff" opacity=".9"/><rect x="6.7" y="10.5" width="10.6" height="1.4" rx=".4" fill="#fff" opacity=".9"/><rect x="6.7" y="14" width="6.4" height="1.4" rx=".4" fill="#fff" opacity=".9"/>'
    };
    function applyLogoShape(packKey) {
        var logo = document.querySelector('.blossom-logo');
        if (!logo || !LOGO_SHAPES[packKey]) return;
        logo.innerHTML = '<g fill="currentColor">' + LOGO_SHAPES[packKey] + '</g>';
    }
    function applyPack(packKey, keepAutoSel) {
        var p = PACKS[packKey] || PACKS.peach;
        themeState.pack = packKey;
        // body 级主题类：整套 --plum/--rose/--rose-soft/--accent 联动，材质包切换彻底生效
        var cls = ['theme-peach', 'theme-osmanthus', 'theme-leaf', 'theme-rose', 'theme-paper', 'theme-night'];
        document.body.classList.remove.apply(document.body.classList, cls);
        document.body.classList.add('theme-' + packKey);
        // v100：夜间材质包 → 底图真正切换为 Carto Dark 深色瓦片（底色整体变深，地名/道路为暗色设计），
        // 非夜间切回用户原底图；用户手动锁定过底图时尊重其选择，不强制切换
        try {
            // v100 夜间：高德 wprd+night=1 参数实测无效（返回仍亮色），免费暗色瓦片源 2026 全部 key 化/停服；
            // 夜间底图统一由 CSS 高覆盖深色遮罩 --map-tint: rgba(8,12,32,.8) 呈现深色底（纯 CSS 零性能开销），
            // 不再切换瓦片源，避免无效 URL 请求与切换闪烁
            document.body.classList.remove('night-dark-tiles');
        } catch (e) { }
        var root = document.documentElement;
        root.style.setProperty('--accent', p.accent);
        root.style.setProperty('--accent-dark', p.accentDark);
        root.style.setProperty('--accent-soft', p.accentSoft);
        document.querySelectorAll('.pack-item').forEach(function (b) {
            var isAuto = b.getAttribute('data-pack') === 'auto';
            // 综合轮播中只亮「综合」按钮；手动选择时只亮当前包（避免同时亮多个）
            b.classList.toggle('sel', keepAutoSel ? isAuto : (b.getAttribute('data-pack') === packKey));
        });
        applyLogoShape(packKey);
        repaintThemeColors();
        // v126：自建/导入要素随材质包重绘——四类取刷新后的主题变量色，兜底类型读 --cf-* 变量；
        // 否则切包后地图上的点线面与侧栏圆点仍是旧主题快照（根因：此前 applyPack 只刷内置层）。
        if (typeof renderCustom === 'function') renderCustom();
        if (typeof syncCfCats === 'function') syncCfCats();
        rebuildPetals();
        saveTheme();
    }
    function syncSetToggles() {
        var pOn = document.getElementById('petal-wrap').classList.contains('on');
        var st = document.getElementById('set-petal');
        if (st) { st.textContent = pOn ? '开启' : '关闭'; st.classList.toggle('on', pOn); }
        var cOn = document.getElementById('chk-cluster').checked;
        var sc = document.getElementById('set-cluster');
        if (sc) { sc.textContent = cOn ? '开启' : '关闭'; sc.classList.toggle('on', cOn); }
    }
    function togglePetals() {
        var w = document.getElementById('petal-wrap');
        themeState.on = w.classList.toggle('on');
        syncSetToggles();
        saveTheme();
    }

    // ---------------- 12. 移动端抽屉 ----------------
    var sidebarEl = document.querySelector('.sidebar');
    var backdropEl = document.getElementById('sidebar-backdrop');
    function closeDrawer() {
        if (sidebarEl) sidebarEl.classList.remove('open');
        if (backdropEl) backdropEl.classList.remove('show');
    }
    // v78：Esc 关闭抽屉（mobile-ux-optimizer Drawer 模式规范）
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
    });
    // v78：手机端抽屉打开时锁定背景滚动，关闭恢复
    var drawerObs = new MutationObserver(function () {
        var open = sidebarEl && sidebarEl.classList.contains('open');
        document.body.style.overflow = open ? 'hidden' : '';
    });
    if (sidebarEl) drawerObs.observe(sidebarEl, { attributes: true, attributeFilter: ['class'] });
    var menuBtn = document.getElementById('btn-menu');
    // 全端强制显示菜单按钮（桌面折叠侧边栏 / 手机打开抽屉）
    if (menuBtn) menuBtn.style.display = 'flex';
    // 折叠动画结束后防抖重绘地图（连续折叠/展开只触发一次）
    var sizeDebounce = null;
    function resizeMapDebounced() {
        clearTimeout(sizeDebounce);
        sizeDebounce = setTimeout(function () {
            if (typeof map !== 'undefined' && map) map.invalidateSize();
        }, 430);
    }
    function toggleDrawer() {
        var isPhone = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
        if (isPhone) {
            var open = sidebarEl ? sidebarEl.classList.toggle('open') : false;
            if (backdropEl) backdropEl.classList.toggle('show', open);
        } else if (sidebarEl) {
            // 桌面端：折叠 / 展开侧边栏（等 width 动画结束再 invalidateSize，避免地图顿跳）
            sidebarEl.classList.toggle('hidden');
            resizeMapDebounced();
        }
    }
    // v78：手机端底部导航 / 抽屉快捷区——点击代理到悬浮球原按钮（复用全部功能，桌面悬浮球不受影响）
    [['m-geoloc', 'btn-geoloc'], ['m-distance', 'btn-distance'], ['m-area', 'btn-area'],
     ['m-clear', 'btn-clear'], ['m-basemap', 'btn-basemap'], ['m-legend', 'btn-legend'], ['m-settings', 'btn-settings']]
        .forEach(function (pair) {
            var m = document.getElementById(pair[0]), o = document.getElementById(pair[1]);
            if (m && o) m.addEventListener('click', function (e) { e.stopPropagation(); o.click(); });
        });
    [['q-locate', 'btn-locate'], ['q-home', 'btn-home'], ['q-mark', 'btn-mark']]
        .forEach(function (pair) {
            var m = document.getElementById(pair[0]), o = document.getElementById(pair[1]);
            if (m && o) m.addEventListener('click', function (e) { e.stopPropagation(); o.click(); });
        });
    if (menuBtn) {
        // click 监听作为次级兜底；capture 兜底正常时会 stopPropagation，这里不会重复触发
        menuBtn.addEventListener('click', function (e) {
            if (e.menuHandled) return;
            e.menuHandled = true;
            toggleDrawer();
        });
        // touchstart 兜底：部分移动浏览器 click 合成事件被触摸滚动/屏蔽层吞掉时仍可靠触发
        menuBtn.addEventListener('touchstart', function (e) {
            e.preventDefault();
            if (e.menuHandled) return;
            e.menuHandled = true;
            toggleDrawer();
        }, { passive: false });
    }
    if (backdropEl) backdropEl.addEventListener('click', closeDrawer);
    // document 级捕获兜底：某些 iframe / WebView 环境点击事件在冒泡阶段被吞，
    // 捕获阶段（先于 target 触发）直接判定点击目标是否落在菜单按钮内，100% 可靠
    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#btn-menu')) {
            e.stopPropagation();
            if (e.menuHandled) return;
            e.menuHandled = true;
            toggleDrawer();
        }
    }, true);
    var layerListEl = document.getElementById('layer-list');
    if (layerListEl) layerListEl.addEventListener('click', closeDrawer);
    if (searchResultEl) searchResultEl.addEventListener('click', closeDrawer);

    // ---------------- 13. 设置面板（玻璃调节，Apple glass-liquid） ----------------
    var settingsPanel = document.getElementById('settings-panel');
    var btnSettings = document.getElementById('btn-settings');
    var setBlur = document.getElementById('set-blur');
    var setAlpha = document.getElementById('set-alpha');
    var setSat = document.getElementById('set-sat');
    // v112：通用玻璃面板工具——backdrop 重采样（加防抖，连续点击只执行一次）
    var _resampleTimer = null;
    function forceBackdropResample(panel) {
        if (!panel) return;
        if (_resampleTimer) cancelAnimationFrame(_resampleTimer);
        _resampleTimer = requestAnimationFrame(function () {
            panel.style.backdropFilter = 'none';
            void panel.offsetWidth;
            requestAnimationFrame(function () { panel.style.backdropFilter = ''; });
        });
    }
    // v113：面板可拖动——Pointer Events + 拖动阈值 + rAF 节流 + transform 加速
    function makeDraggable(panel, storageKey) {
        if (!panel) return;
        var header = panel.querySelector('h4, .panel-title, .bm-title, .settings-title') || panel;
        var startX, startY, startLeft, startTop, dragging = false, moved = false;
        var rafId = null;
        header.style.cursor = 'move';

        header.addEventListener('pointerdown', function (e) {
            if (e.target.closest('button, input, select, a, .settings-close, .panel-close, .bm-close, .close')) return;
            dragging = true;
            moved = false;
            startX = e.clientX; startY = e.clientY;
            var r = panel.getBoundingClientRect();
            var mapR = document.getElementById('map').getBoundingClientRect();
            startLeft = r.left - mapR.left;
            startTop = r.top - mapR.top;
            header.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        header.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - startX, dy = e.clientY - startY;
            // 拖动阈值：5px 内不触发
            if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            moved = true;
            header.style.cursor = 'grabbing';
            // rAF 节流——transform 用偏移量 dx/dy，不是绝对位置
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(function () {
                panel.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0)';
            });
        });

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'move';
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            if (moved) {
                // 结束后把 transform 偏移转成 left/top 绝对位置
                var dx = e.clientX - startX, dy = e.clientY - startY;
                var mapR = document.getElementById('map').getBoundingClientRect();
                var newLeft = Math.max(0, Math.min(mapR.width - panel.offsetWidth, startLeft + dx));
                var newTop = Math.max(0, Math.min(mapR.height - panel.offsetHeight, startTop + dy));
                panel.style.transform = '';
                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
                panel.style.right = 'auto';
                try { localStorage.setItem(storageKey, JSON.stringify({ left: newLeft + 'px', top: newTop + 'px' })); } catch (e) {}
            }
        }
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        // 恢复位置——v112：检查是否在可视区域内，越界则不恢复
        try {
            var saved = localStorage.getItem(storageKey);
            if (saved) {
                var pos = JSON.parse(saved);
                if (pos.left && pos.top) {
                    var mapR = document.getElementById('map').getBoundingClientRect();
                    var panelW = panel.offsetWidth || 280;
                    var panelH = panel.offsetHeight || 200;
                    var left = parseInt(pos.left) || 0;
                    var top = parseInt(pos.top) || 0;
                    if (left >= 0 && left + panelW <= mapR.width && top >= 0 && top + panelH <= mapR.height) {
                        panel.style.left = pos.left;
                        panel.style.top = pos.top;
                        panel.style.right = 'auto';
                    }
                }
            }
        } catch (e) {}
    }
    makeDraggable(settingsPanel, 'cd_panel_settings');
    makeDraggable(basemapPanel, 'cd_panel_basemap');
    makeDraggable(markPanel, 'cd_panel_mark');
    function applyGlass() {
        var blur = setBlur.value, alpha = setAlpha.value, sat = setSat ? setSat.value : 150;
        // 可读性边界保护：低模糊度时自动提升背景不透明度，避免文字无法识别
        if (blur < 3 && alpha < 60) alpha = 60;
        // v106 美学地板：alpha 映射下限 0.18（最透仍可辨），夜间提升至 0.55 保文字可读；与 initGlassSystem writeVars 同构，杜绝双写不一致
        var night = document.body.classList.contains('theme-night');
        var aFloor = night ? 55 : 18;
        var aVal = Math.max(aFloor, alpha) / 100;
        document.documentElement.style.setProperty('--glass-blur', blur + 'px');
        document.documentElement.style.setProperty('--glass-alpha', aVal.toFixed(2));
        document.documentElement.style.setProperty('--glass-sat', (sat / 100).toFixed(2));
        document.getElementById('set-blur-val').textContent = blur + 'px';
        document.getElementById('set-alpha-val').textContent = alpha + '%';
        if (setSat && document.getElementById('set-sat-val')) document.getElementById('set-sat-val').textContent = sat + '%';
        try { localStorage.setItem('cd_glass', JSON.stringify({ blur: blur, alpha: alpha, sat: sat })); } catch (e) { }
    }
    // 高频操作节流：滑杆拖动用 rAF 合并，避免频繁样式写入
    function bindThrottledRange(el, fn) {
        if (!el) return;
        var ticking = false;
        el.addEventListener('input', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () {
                ticking = false;
                fn();
            });
        });
    }
    // 果冻感：调节滑块时设置面板弹性回弹（手机端跳过，避免毛玻璃+动画卡顿）
    var isMobileDevice = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    var settingsBackdrop = document.getElementById('settings-backdrop');
    function toggleSettingsBackdrop(show) {
        if (!settingsBackdrop || !isMobileDevice) return;
        settingsBackdrop.hidden = !show;
        settingsBackdrop.classList.toggle('show', show);
    }
    if (settingsBackdrop) settingsBackdrop.addEventListener('click', function () {
        if (settingsPanel) settingsPanel.classList.remove('open');
        if (btnSettings) btnSettings.classList.remove('active');
        toggleSettingsBackdrop(false);
    });
    function jellyPulse() {
        if (!settingsPanel) return;
        settingsPanel.classList.remove('jelly');
        void settingsPanel.offsetWidth;
        settingsPanel.classList.add('jelly');
        // v107：兜底定时移除——动画 .45s 播完即清除 .jelly（不依赖 animationend，动画被降级/未播放时同样生效）
        clearTimeout(window.__jellyTimer);
        window.__jellyTimer = setTimeout(function () { settingsPanel.classList.remove('jelly'); }, 500);
    }
    // v107：jelly-pop 动画播完立即移除 .jelly 类——动画持续存在会冻结面板 background-color 的级联更新
    // （切夜间时深色规则无法应用、背景被卡在半透明白 = 「点击按钮透明度短暂变化」与「夜间白底白字修不好」的隐藏根因）
    if (settingsPanel) settingsPanel.addEventListener('animationend', function () {
        settingsPanel.classList.remove('jelly');
    });
    if (btnSettings && settingsPanel) {
        btnSettings.addEventListener('click', function () {
            settingsPanel.classList.toggle('open');
            btnSettings.classList.toggle('active', settingsPanel.classList.contains('open'));
            if (settingsPanel.classList.contains('open')) {
                forceBackdropResample(settingsPanel);
                settingsPanel.classList.remove('pop');
                void settingsPanel.offsetWidth;
                settingsPanel.classList.add('pop');
                toggleSettingsBackdrop(true);
            } else {
                toggleSettingsBackdrop(false);
            }
        });
        document.getElementById('settings-close').addEventListener('click', function () {
            settingsPanel.classList.remove('open');
            btnSettings.classList.remove('active');
            toggleSettingsBackdrop(false);
            try { hideMeasureCard(); } catch (e) { }
        });
        // v106：高级滑杆 input 统一由 initGlassSystem（applyAdv/applySat）驱动——此前 set-blur/set-alpha/set-sat 在此与 applyAdv 双绑定，
        // 同一滑杆一次拖动写两次 --glass-alpha（clamp 逻辑不同），是「透明度短暂跳变、不稳定」的根因；现移除旧绑定，仅保留滑杆值与 UI 文案同步
        setBlur.addEventListener('input', function () { var el = document.getElementById('set-blur-val'); if (el) el.textContent = setBlur.value + 'px'; });
        setAlpha.addEventListener('input', function () { var el = document.getElementById('set-alpha-val'); if (el) el.textContent = setAlpha.value + '%'; });
        if (setSat) setSat.addEventListener('input', function () { var el = document.getElementById('set-sat-val'); if (el) el.textContent = setSat.value + '%'; });
        settingsPanel.addEventListener('animationend', function () { settingsPanel.classList.remove('jelly'); });
        // 材质包切换
        var autoCycleTimer = null;
        var AUTO_CYCLE_MS = 6000;   // 综合包：每 6 秒丝滑轮播一次（只轮播白天四套，不含夜间）
        var AUTO_ORDER = ['peach', 'osmanthus', 'leaf', 'rose'];
        function stopAutoCycle() {
            if (autoCycleTimer) { clearInterval(autoCycleTimer); autoCycleTimer = null; }
            document.body.classList.remove('theme-anim');
            // 熄灭「综合」按钮，恢复当前实际材质包高亮（防止综合关闭后按钮残留点亮）
            document.querySelectorAll('.pack-item').forEach(function (b) {
                b.classList.toggle('sel', b.getAttribute('data-pack') === themeState.pack);
            });
        }
        document.querySelectorAll('.pack-item').forEach(function (b) {
            b.addEventListener('click', function () {
                var pk = b.getAttribute('data-pack');
                if (pk === 'auto') {
                    if (autoCycleTimer) { stopAutoCycle(); toast('综合轮播已关闭'); return; }
                    autoCycleTimer = setInterval(function () {
                        document.body.classList.add('theme-anim');
                        var next = AUTO_ORDER[Math.floor(Math.random() * AUTO_ORDER.length)];
                        applyPack(next, true);
                        setTimeout(function () { document.body.classList.remove('theme-anim'); }, 850);
                    }, AUTO_CYCLE_MS);
                    var first = AUTO_ORDER[0];
                    document.body.classList.add('theme-anim');
                    applyPack(first, true);
                    setTimeout(function () { document.body.classList.remove('theme-anim'); }, 850);
                    toast('综合材质包已开启：每 ' + (AUTO_CYCLE_MS / 1000) + ' 秒自动丝滑轮播（桃花/桂花/绿叶/玫瑰，不含夜间）');
                    return;
                }
                stopAutoCycle();
                if (pk && PACKS[pk]) {
                    applyPack(pk);
                    toast('已切换「' + PACKS[pk].name + '」材质包（飘落与界面配色同步更新）');
                }
            });
        });
        // 飘落节律滑块
        var setRhythm = document.getElementById('set-rhythm');
        if (setRhythm) {
            setRhythm.value = themeState.rhythm;
            var rhythmVal = document.getElementById('set-rhythm-val');
            function paintRhythm() {
                var v = parseInt(setRhythm.value, 10);
                themeState.rhythm = v;
                rhythmVal.textContent = v <= 3 ? '舒缓' : v <= 7 ? '适中' : '热烈';
                rebuildPetals();
                saveTheme();
            }
            setRhythm.addEventListener('input', paintRhythm);
            paintRhythm();
        }
        document.getElementById('set-petal').addEventListener('click', function () {
            var before = document.getElementById('petal-wrap').classList.contains('on');
            togglePetals();
            toast(before ? '飘落特效已关闭' : '「' + PACKS[themeState.pack].name + '」飘落特效已开启');
        });
        document.getElementById('set-cluster').addEventListener('click', function () {
            var c = document.getElementById('chk-cluster');
            c.checked = !c.checked;
            c.dispatchEvent(new Event('change', { bubbles: true }));
            syncSetToggles();
            toast(c.checked ? '聚合气泡已开启' : '聚合气泡已关闭');
        });
        document.getElementById('set-reset').addEventListener('click', function () {
            // v115：单一入口——主滑杆回到默认 35%（去偏透档），高级滑杆、CSS 变量、cd_glass72 一次性对齐
            if (window.applyGlassPreset) { window.applyGlassPreset(35); }
            if (setSat) { setSat.value = 150; var sv = document.getElementById('set-sat-val'); if (sv) sv.textContent = '150%'; }
            applyPack('peach');
            if (setRhythm) { setRhythm.value = 5; setRhythm.dispatchEvent(new Event('input', { bubbles: true })); }
            toast('已恢复默认（35% 偏透 + 桃花材质包）');
        });
        try {
            var g = JSON.parse(localStorage.getItem('cd_glass') || 'null');
            if (g && g.blur !== undefined) { setBlur.value = g.blur; setAlpha.value = g.alpha; if (g.sat !== undefined && setSat) setSat.value = g.sat; applyGlass(); }
        } catch (e) { }
    }

    // ---------------- 13.5 更新日志（点击顶部版本号打开） ----------------
    var CHANGELOG = [
        {
            v: 'v126', t: '导出覆盖内置+我的图层 + 分组三态全选/全隐 + 自建点材质随主题完整联动',
            pts: [
                '导出范围自洽化：图层管理面板新增「导出」，汇总内置未删采集层 + 自建/导入要素为一个 GeoJSON，properties.source 标注「内置 / 文件名」，counts 分别计数；隐藏层仍导出，已整层删除的层不含；打点面板原「导出」保留，仅导我的图层',
                '全选 / 全部隐藏扩到全部存在图层：跳过已删除的空内置层；内置组、我的图层组各加三态组头勾选框（全勾 / 横线半选 / 全不选），点组头批量切换整组；全局按钮按当前勾选态动态禁用（全勾时禁全选、全隐时禁全隐、无存在层时禁用），导入 / 删除 / 清空后自动刷新',
                '自建/导入点材质完整跟随主题：切材质包后重绘自建层与侧栏列表，学校/医院/景点/道路四类取刷新后的主题变量色；兜底类型（设施点/公交站/公园/自定区域）纳入 --cf-* 主题变量，白天/夜间/纸笺三套配色，设施点改青蓝避开学校蓝，不再写死原色',
                '根因修复：此前切材质包只重绘内置层，自建/导入的点线面与侧栏圆点停留在旧主题快照；兜底类型颜色写死 hex，夜间/纸笺下也不随包变化'
            ]
        },
        {
            v: 'v125', t: '流畅性加固（Canvas 渲染 + 去玻璃嵌套）+ 列表地图双向联动 + 提示一致性',
            pts: [
                '矢量线 / 面 / 圆标记默认切到 Canvas 后端渲染（Leaflet 官方 FAQ 建议）：不再每条线、每个圆占一个 SVG 节点，多点矢量场景减少 DOM 节点数；内置设施点仍是图标 DOM 标记，弹窗与标签不受影响',
                '列表 ↔ 地图双向联动：搜索结果行悬停时地图上对应点临时放大描边；在地图上点开某点，若搜索列表可见同名项会滚动定位并高亮；聚合态下先散开 / 放大到该点再开详情卡（此前聚合包裹时直接开弹窗无效）',
                '视觉令牌收敛：提取圆角 / 字阶令牌（大卡 12、行与中组件 9、小标签 8；标题 14 / 正文 13 / 辅助 11），面板标题 14.5px 对齐到 14px，两处 13px 圆角对齐到 12px；不改既有材质色板，纸笺仍为 2px 直角',
                '提示一致性修复：错误提示的样式类名此前 JS 写 err、CSS 找 error，导致报错 toast 一直没变红；现已对齐，并补齐夜间（浅红字 + 暗红底）与纸笺（墨红字 + 细红边）的错误态；两处空态字号统一到辅助级',
                '消除玻璃套玻璃：标题栏整块磨砂内部的菜单钮、版本标签不再二次 blur，复用父级已磨砂背景；全量补上「减少动态效果」系统偏好的动画降级（脉冲 / 花瓣 / 弹卡 / 淡入在该偏好下近乎瞬时）',
                '大数据预留：自建要素超过 60 个时，常驻地名标签自动降级为悬停提示，避免每条常驻一个标签 DOM 撑爆覆盖层；批量重绘仍是先清旧标签与图层再一次性重建'
            ]
        },
        {
            v: 'v124', t: '纸笺详情卡归位 + 内置点多选（不弹卡、可预览）',
            pts: [
                '纸笺材质下的设施点详情卡补齐：纸底 + 直角 2px + 宋体 + 墨棕字，标题左侧竖线压成墨棕细线，关闭钮改直角描边方钮——此前 .pw-box 只有「白天玻璃 / 夜间深色」两条分支，纸笺从未被覆盖',
                '内置设施点支持 Shift / Ctrl / ⌘ 点选多选（原来只有自建要素能多选，内置点走 Leaflet 默认弹窗，卡片必弹且无法追加）',
                '多选态下点击不再弹卡：卡片只在你单击单个点时才开，避免半屏被挡住；手机上没法按 Shift，已进入多选后普通点击同样按追加/取消处理',
                '多选有实时预览：未选中的点淡到 34% 并降饱和，选中的保持原样并置顶；底部出现「已选 N 个点 · 学校 3 · 医院 2」选择条，带「删除选中」「取消」',
                'Esc 清空、Delete / Backspace 删除选中（与自建要素同一套快捷键），批量删除一次确认、逐条记进 cd_poi_gone，仍可一键恢复',
                '内置点多选与自建要素多选互斥：进一边会清掉另一边，底部只留一条选择条，不再两条叠在一起'
            ]
        },
        {
            v: 'v123', t: '极致流畅：玻璃族背景模糊收敛 + 交互期降载',
            pts: [
                '定位「除纸笺外其他材质包都卡」的真因：玻璃族全屏 31 个背景模糊元素、覆盖约 78 万像素（占满屏六成），纸笺只有 5 个约 1 万像素——同一个拖动动作，玻璃族要逐帧重采样六成屏幕，纸笺几乎不采样，这就是两者手感差一档的来源',
                '背景模糊半径全面收敛：设置面板 20→10px、详情面板 18→10px、浮动卡片 26→11px、移动端 18→8px，滑杆厚段上限 30→16px；模糊层数不变，但每层成本随半径平方下降，观感仍是一块玻璃不是一块塑料',
                '地图交互期（拖动/缩放开始 → 停手 240ms）全局关闭背景模糊：运动中人眼辨不出磨砂，停手那一刻玻璃质感原样回来；实测交互态三种材质全部 60fps（优化前桃花静止 2.9fps、纸笺 8.5fps、夜间 7.9fps）',
                '折射减一层：侧栏与设置面板本体的整块 SVG 位移滤镜（feTurbulence + feDisplacementMap，每帧整块离屏重算）撤掉，只留高光位移层——面板边缘的液态折光还在，但不再为整块内容付滤镜账',
                '道路标签气泡去掉浮层模糊（自身实底已够清晰）；夜间瓦片的亮度滤镜改为交互期临时关闭，静止时照旧暗化',
                '飘落层的 will-change 从常驻改为「飘落开启时」才申请，关闭飘落不再白占 25 个合成层'
            ]
        },
        {
            v: 'v122', t: '图层管理重构成文件级图层树 + 地物点多选与快捷键',
            pts: [
                '导入图层不再归并成「我的·学校」这类自建分类：图层管理改为「导入文件 → 地类」两级，文件行直接显示文件名（如「长沙地物点示例」），地类子行缩进挂在文件下面',
                '文件行勾选框 = 该文件全部地类的批量开关，部分隐藏时进入半选态；地类子行只管自己的「文件|地类」这一对，显隐只有这一个真源，不再出现文件勾着而子类全关的矛盾态',
                '两级各带一个 ×：删文件 = 移除该文件下全部地物点，删地类 = 只移除该文件下的这一类；删完图层行、搜索下拉、图例与点数同步清理',
                '「我的图层」标题右侧给出总账（N 个文件 · M 个要素），每行继续标地区归属，长沙数据导入后文件行与三个地类子行一律标「外地」',
                'Shift 点击地图要素 = 追加 / 取消多选；Ctrl（⌘）+A 全选当前可见要素（超过 300 个先提示收起分类），Esc 清空，Delete / Backspace 删除选中，输入框聚焦时不响应',
                '多选有实时预览：未选中要素淡到 45% 退成背景，选中项保持原样跳出来；地图底部出现选择条，实时报「已选 N 个」与地类分布（学校 4 · 医院 2 · 景点 3），旁边就是「删除选中」「取消」',
                '批量删除一次确认、逐条过编辑权限校验，被锁要素计数提示而不是顺手删掉；内置图层与导入图层加了分组标题（内置图层 · 常德 / 我的图层），两组不再交叉',
                '文件行勾选框接入与内置图层同一套控件皮肤（玻璃圆角 4、纸笺直角 1），纸包与夜间各自适配，消掉浏览器默认复选框的毛边'
            ]
        },
        {
            v: 'v121', t: '更新日志弹层按材质分道 + 条目排版重做',
            pts: [
                '纸笺材质下的日志头不再沿用桃花粉渐变：改纸底 + 墨棕细线 + 宋体标题，与侧栏面板、纸片按钮同一套语言',
                '纸笺下关闭按钮改 24×24 直角细描边方钮（原来是白色半透玻璃圆钮，hover 还在旋转），hover 只换纸底色不旋转',
                '纸笺下版本号标签由粉红胶囊改为墨棕描边方片（直角 2px、白底、宋体），与纸包其他标签同族；玻璃包仍保留胶囊',
                '条目正文去掉「· 」文本前缀，改为小圆点 + 悬挂缩进，换行后的文字与首行左缘对齐，长条目不再顶格散开',
                '行内圆角与外壳圆角对齐同族（纸 3/2、玻璃 22/12），hover 取消放大位移，只提亮底色 —— 不再出现「外壳直角、内部大圆角」的椅子现象',
                '滚动条改为 6px 细轨（纸包墨棕 26%、玻璃中性色），不贴内边距边缘，滚动轨道透明；底部统计行加分隔线与纸包宋体字距'
            ]
        },
        {
            v: 'v120', t: '长沙跨区域数据导入实测 + 「XX医院」同义词补齐',
            pts: [
                '用长沙 9 个地物点（湖南大学 / 中南大学 / 湘雅医院 / 岳麓山 等）走完整文件导入链路实测：读取提示 → FileReader → 类型归并 → 图层行动态生成 → 自动定位到数据范围，全流程一次通过',
                '补齐「医院」包含匹配：三甲医院 / 人民医院 / 口腔医院 等归入「医院」这一行，导入 9 个长沙要素由 4 类收敛为 3 类（学校 4 / 医院 2 / 景点 3）',
                '地区归属在真实跨区域数据上得到确认：9 个点全部落在常德市域框外，分类行一律标「外地」，与标题「图层管理·常德」并存不冲突',
                '图层开关与删类在异地数据上复验：取消「学校」地图标签 9→5、勾回 9；点 × 删「医院」后行消失、地图少 1 点、「我的·医院」同步从搜索下拉移除；搜「岳麓山」命中「我的景点」',
                '自建要素配色对齐内置图层：导入归并出的学校 / 医院 / 景点 / 道路直接取 --school / --hospital / --scenic / --road，侧栏三行圆点与地图点位不再统一落进紫色兜底色（原来三行同色，同是学校却两个颜色）'
            ]
        },
        {
            v: 'v119', t: '悬浮球展开面板重做 + 导入图层类型归并与地区归属 + 面板流畅性收紧',
            pts: [
                '展开面板从 180px / 84px 按钮 / 11px 字重排为 224px / 98×42 按钮 / 11.5px 单行，字号与尺寸同步放大，「我的位置」「清除测量」不再折行',
                '按钮圆角 8、面板圆角 16（2:1 同族），不用无关圆角值，消掉原来的"方块拼贴"感',
                '新增分组标题「视图 / 测量 / 要素」横跨两列，字距 .16em + 细线分隔，11 个功能钮有了结构层次',
                '三材质分别适配：玻璃面板 blur 降到 10px 换流畅；纸笺改纸面 + 直角 + 无 blur；夜间转实色深底并关闭 blur',
                '展开/收起过渡由 0.22s 弹簧收紧为 0.18s 无回弹曲线，减少整块重排的拖沓感',
                '导入外部数据先归一同义类型（高校/大学/学院→学校，卫生院/诊所→医院，景区/风景名胜→景点，公路/主干道→道路），图层列表不再被同义类型撑散',
                '图层管理标题显示本站归属「常德」；导入生成的分类行按坐标判定标出「常德 / 常德+外 / 外地」徽标，行名去掉「我的·」前缀与「导入」小标签，名称不再被挤成省略号',
                '「图例」拉成两列通栏收口，消掉双列布局里必然落单的半行空白；折叠态同步隐藏分组标题，玻璃球里不再露出「视图 / 测量 / 要素」'
            ]
        },
        {
            v: 'v118', t: '删除单个地物点：点位信息卡内「删除此点」+ 坐标指纹记忆 + 一键恢复已删点位',
            pts: [
                '点击任意学校 / 医院 / 景点点位，信息卡底部新增「删除此点」——只删这一个要素，所属图层的其它点照旧显示',
                '被删点位按坐标指纹记进 cd_poi_gone，刷新后不再出现；视野计数与搜索结果同时更新，图层本身保留',
                '图层管理区下方新增「恢复已删点位（n）」，一次找回全部单点删除；与整层删除互不干扰（整层删除优先）',
                '删除前二次确认，文案写明只删这一个点、图层保留、可一键还原；删除后关闭弹窗并提示点位名称',
                '图层列表折叠时恢复按钮随列表一起收起'
            ]
        },
        {
            v: 'v117', t: '第 13 节收尾：图层列表可拖拽排序 + 折叠 + 删除后搜索/图例同步 + 导入复活已删图层 + 导入进度提示',
            pts: [
                '图层排序可拖拽（挑战 2）：内置图层行与「我的·」动态行都能按住拖动，松手即记住顺序（cd_layer_order / cd_cf_order），刷新后按记忆顺序排列',
                '图层列表可折叠（挑战 5）：图层管理标题右侧新增 ▾ / ▸ 折叠按钮，收起后只留标题，状态存 cd_layer_fold，刷新保持',
                '删除整层后搜索类型与图例同步消失：被删类型的 option 置灰隐藏、图例行隐藏，恢复后一并还原（笔记验收 7）',
                '再次导入已删类型会自动把该内置图层复活（从缓存数据重建、勾选框打勾、恢复按钮随之收起），不必手动恢复（笔记验收 8）',
                '导入类型不再受白名单限制：按 GeoJSON 里自带的 kind 字段直接成层（任意业务类型都能生成图层行）',
                '导入读取阶段先提示「正在读取 文件名 …（KB）」，读取失败给红字提示（挑战 4 的加载进度）',
                '整层删除的确认文案改为「将删除该图层及其全部要素（共 n 个）」，并说明会一并清掉视野计数、搜索结果与图例'
            ]
        },
        {
            v: 'v115', t: '显示系统改造：玻璃锚点重定 + 恢复默认单一入口 + 点位形状语义化 + Inter 自托管 + 夜间底图暗化',
            pts: [
                '玻璃锚点：轻薄端不再被硬抬 alpha（旧逻辑 blur<3 就把 alpha 抬到 60，越薄越不透），薄段改为低模糊高边光',
                '「恢复默认设置」收成单一入口 applyGlassPreset(35)：滑杆读数、CSS 变量、cd_glass72 存档一次对齐，不再「滑杆不动质感变」',
                '侧栏改固定令牌 --sb-*，不随玻璃滑杆漂移；面板四层边缘（左上受光/右下压暗/冷折射暗边/柔投影）+ 22° 镜面扫光',
                '地物点改 SVG 形状语义化：学校方块+书页、医院方块+十字、景点四瓣花；聚合气泡改玻璃胶囊',
                '字体：西文自托管 Inter + 中文自托管 Noto Sans SC（首版只换 Inter，它仅覆盖拉丁字母、满屏中文全部回落系统字体，这就是「一点变化都没有」的真因）；标题 13→14.5px、说明 12→12.5px、全站字距 .012em、字重收敛 400/500/600',
                '夜间底图实测压暗 46%：瓦片级滤镜 + 深色容器混色，点位与面板保持原亮度']
        },
        { v: 'v36', t: '道路数据重构', pts: ['14 条主干道线要素重建（路口锚点 + 步行描线）', '弯道圆弧平滑、34/34 交叉口拓扑校验通过', '去抖动、无锯齿，拒绝横冲直撞的折线'] },
        { v: 'v38', t: '定位技术开源化', pts: ['告别单一闭源方案，转向 OSM 开源体系', '定位精度问题开启根治之路'] },
        { v: 'v39', t: '全开源迁移', pts: ['Leaflet + OSM 底图，坐标动态转换', '不再受制于单一地图源'] },
        { v: 'v40', t: 'UI 全面升级', pts: ['玻璃质感界面 + 动态图例', '图层要素显示重构'] },
        { v: 'v41', t: '底图多源 + Liquid Glass', pts: ['高德 / OSM 双源平滑切换', '毛玻璃材质重写'] },
        { v: 'v42', t: '显示精修', pts: ['道路显示优化、玻璃原色还原', '气泡分类着色'] },
        { v: 'v43', t: '双坐标体系', pts: ['高德 + OSM 综合底图，坐标动态换算', '两套坐标系共存互转'] },
        { v: 'v45', t: '坐标彻底修复', pts: ['GCJ-02 统一口径，点位 1 米级准确', '多端显示不再错位'] },
        { v: 'v46', t: '底图稳定', pts: ['平滑切换 + 缩放上限 18', '不再进入空白世界'] },
        { v: 'v47', t: '玻璃滑块', pts: ['玻璃质感滑动调节', '透明度 / 模糊 / 饱和自由掌控'] },
        { v: 'v48', t: '打点系统 + 底图锁定', pts: ['手选底图不再自动跳变', '街道打点替代绘制'] },
        { v: 'v49', t: '点库同名替代', pts: ['用户打点道路优先显示', '跨设备数据同步'] },
        { v: 'v50', t: '打点工具完善', pts: ['Ctrl+Z 撤销 / 拖动 / 编辑', '工具链完整化'] },
        { v: 'v51', t: '草稿清理', pts: ['完成自动清空草稿', '交互手感优化'] },
        { v: 'v52', t: '点击隔离', pts: ['打点 / 测距误触修复', '浮层事件全隔离'] },
        { v: 'v53', t: '柳叶大道入库', pts: ['用户绘制 4.152km 同名替代', '多端适配规范确立'] },
        { v: 'v54', t: '材质包系统上线', pts: ['桂花 / 绿叶 / 玫瑰首套材质', '飘落节律调节 + 工具栏重构'] },
        { v: 'v55', t: '主题化 + 桃花包', pts: ['手机崩溃紧急修复', 'body 级主题联动 + 桃花默认包'] },
        { v: 'v56', t: '夜间模式 + 自我审核', pts: ['夜间材质包（地图同变暗）', '自我审核 skill + 桂花四瓣花'] },
        { v: 'v57', t: '材质联动深化', pts: ['夜间文字修复、符号随包变色', '综合轮播上线'] },
        { v: 'v58', t: '区分度与丝滑', pts: ['设施四色区分度回归', '粒子池化 + 0.7s 平滑过渡'] },
        { v: 'v59', t: '视觉语言统一', pts: ['logo 形状随材质、图例联动', '玻璃面板深色适配'] },
        { v: 'v60', t: '版本更新日志 + 灵动倾斜', pts: ['点击版本号打开更新日志（回顾全部版本）', '高透光泽玻璃卡片 + 果冻动画 + 随材质包', '工具栏按钮 3D 倾斜 + 顶部高光扫过'] },
        { v: 'v61', t: '胶囊质感 + 布局修复', pts: ['版本号改回椭圆玻璃胶囊（渐变 + 内高光 + 毛玻璃）', '修复 CSS 结构问题导致的地图 / 工具栏不显示'] },
        { v: 'v62', t: '地图回归 + 日志完善', pts: ['修复多余花括号导致的布局崩溃，地图 / 工具栏恢复显示', '更新日志收录 v60 / v61 版本'] },
        { v: 'v63', t: '手机端体验优化', pts: ['标题栏名字与版本号不再重叠', '缩放键移到右下角贴底、比例尺底部居中', '菜单按钮可见性与点击稳定性加固'] },
        { v: 'v64', t: '菜单按钮彻底修复', pts: ['修复 v63 推送时 CSS/JS 版本号漏升导致旧缓存', '菜单按钮四层加固：display!important + z-index + JS 强制显示 + pointerdown 兜底'] },
        { v: 'v65', t: '全端菜单按钮', pts: ['所有屏幕显示汉堡菜单按钮', '桌面端点击折叠 / 展开侧边栏，地图自动占满'] },
        { v: 'v66', t: '操作手感全面优化', pts: ['缩小限制放宽到全球（minZoom 9→3）', '桌面折叠改为平滑宽度动画，不再生硬', '缩放键防抖 320ms，手机端不再卡顿连跳', '菜单按钮 document 捕获级兜底，任何环境点击必触发', '手机端比例尺改绝对定位固定在底部中间，不再消失'] },
        { v: 'v67', t: '悬浮球工具栏 + 测量修复', pts: ['右侧工具栏改为果冻质感悬浮球，点击扇形展开 + 弹性动画', '按钮点击果冻回弹 + 高光扫过，夜间深色果冻适配', '测距/测面修复：双击结束不再多加点，手机端新增「完成测量」按钮', '标题栏层级提升（z-index 2000）防被遮挡', '菜单按钮新增 touchstart 兜底，真实手机触摸必触发', '比例尺移到左下角（不再被缩放键遮挡）'] },
        { v: 'v68', t: '右侧常驻功能区（不折叠）', pts: ['回退悬浮球折叠设计：右侧改为常驻竖排玻璃面板，10 个功能按钮一屏全显', '按钮为矩形横排（图标 + 文字），hover 高光扫过 + 点击果冻回弹', '桌面端 88px 宽面板，手机端自动收窄为图标窄条（不占地图）', '夜间模式深色玻璃面板适配'] },
        { v: 'v69', t: 'Apple 式高透重构', pts: ['右侧功能区改为 56px 纯图标果冻胶囊面板（杜绝文字截断），按钮 44px 图标 20px', '按钮 hover / 触摸一次弹性跳跃（上移 7px 回弹）+ 按压果冻压缩，transform 硬件加速', '侧边栏玻璃拟态（毛玻璃 + 高光边缘 + 柔和阴影），折叠动画结束后防抖重绘地图', '菜单按钮热区扩至 48×48 与标题栏居中对齐', '比例尺重构为 Apple 玻璃组件（桌面 150px / 手机 100px，米公里自动切换）', '测量卡片改高透玻璃（白底深字 + 细描边），完成按钮柔和绿色，清除按钮中性灰', '全局低饱和玻璃语言：面板 / 缩放键统一高透圆角，夜间模式全套深色玻璃'] },
        { v: 'v70', t: '悬浮球 + 玻璃液体调节', pts: ['右侧功能区升级为 Apple 悬浮球：点击展开果冻列表，按钮依次弹性弹出；再点/点外收起；手机端保持常驻窄条', '悬浮球与放大缩小键分离：缩放键独立玻璃胶囊，移到悬浮球下方保持间距', '按钮 hover 上浮 9px 回弹 + 按鼠标靠近方向左右倾斜 2-5° + 液态光泽扫过 + 按压压缩', 'hover 显示玻璃 tooltip 文字标签（定位/复位/测距/测面等），离开消失', '侧边栏三个面板统一关闭按钮（圆形 ×，hover 放大旋转 + 压缩反馈），可逐一面板关闭并一键恢复', '测量结果卡片非常驻：清除/切换工具/关闭即自动隐藏，关闭按钮 ×', '设置新增 glassliquid 调节：液态光泽 / 阴影强度 / 反射高光滑杆，全面板实时预览', '测量完成保留双击 + 绿色完成按钮双触发'] },
        { v: 'v71', t: '悬浮球拖拽 + 全量液态玻璃', pts: ['悬浮球支持长按拖拽（桌面鼠标 / 手机手指），松手果冻吸附最近边缘，位置持久化记忆', '智能自适应展开方向：停靠左/右边缘竖向展开，停靠上/下边缘横向展开，自动避让缩放控件', '外部收起防误触：展开动画未完成不收起 + 200ms 延时 + 面板附近点击不收起，面板内新增收起按钮', '移动端窄条可点击展开详情：图标旁同步显示精简文字标签，不再纯图标盲操作', '全 UI 液态玻璃统一层：磨砂基底 + 内高光 + 细描边 + 外阴影全由 CSS 变量管控', '设置面板滑杆重构：磨砂模糊度 / 面板透明度 / 边框高光强度 / 阴影柔和度，滑杆 rAF 节流', '可读性边界保护：低模糊度自动提升背景不透明度，避免文字不可读', '新增液态折射增强开关：SVG 位移滤镜仅作用于侧边栏与设置面板，桌面默认开、移动端自动关', '清除测量全链路清零 + 切换底图/关闭面板/关闭设置自动隐藏测量卡', '移动端动效降幅：弹性上浮 4px、按压 0.97，渐进增强保性能'] },
        { v: 'v72', t: '玻璃单轴调节 + 交互误触修复', pts: ['玻璃质感改为 Apple 式单轴主滑杆：0-100% 预设联动磨砂模糊 / 面板透明 / 边框高光 / 阴影柔和 4 维变量，轻薄半透→中等通透→厚重磨砂连续渐变，调节差异显著', '高级设置折叠区：默认收起，展开可微调 4 项细分参数，与主滑杆双向联动（拖主滑杆同步高级值，微调高级参数自动反推主滑杆强度）', '液态折射增强落地：SVG 位移滤镜 + 错位折射层叠加，开启前后视觉差异明确，仅作用于侧边栏与设置面板', '全玻璃组件统一复用同一套 CSS 变量，单滑杆调节全量同步，杜绝质感脱节', '面板点击穿透修复：设置 / 底图 / 测量等玻璃弹层点击空白不再触发地图点位选择', '取消悬浮球「点击外部自动关闭」：仅面板收起按钮 / 再次点击球体收起，彻底解决误收起', '设置面板仅通过右上角 × / 再点设置按钮关闭，不随悬浮球收起自动关闭', '竖向停靠展开升级：按钮改胶囊长条「图标+文字」直显，48px 触控高，缩放组独立物理分离', '横向停靠保持纯图标 + hover tooltip，拖拽吸附与持久化保留'] },
        { v: 'v73', t: '定向修复：弹窗关闭 / 折射偏转 / 悬浮球中点吸附', pts: ['更新日志关闭按钮修复：click + touchstart 双端直接绑定（不再依赖冒泡委托），弹出层 z-index 提升至全局顶级 2000，关闭 0.25s 平滑淡出 + 轻微缩放，无残留无遗留', '液态折射偏转修复：设置面板滤镜从面板本体移到 .settings-inner 外包盒并预留 8px 滤镜安全边距，滤镜仅作用视觉层不影响定位盒模型，开启折射面板位置不漂移、文字不错位', '悬浮球吸附规则重写：松手吸附最近边「中点」，四角区域按距离判定就近竖边/横边后吸该边中点；吸附果冻 0.3s，拖拽中透明度 70% 暂停滤镜仅位置跟随', '折叠方向严格双轨：竖向停靠折叠按钮置顶、向下竖向展开（图标+文字长胶囊）收起向上；横向停靠折叠按钮固定最左、向右横向展开纯图标，收起向左；过渡方向与停靠边严格平行', '竖向展开顶部内边距 12px 折叠按钮完全置顶，层级提升不被遮挡；展开尺寸边界：竖向 ≤ 视口 80%（超出自适应滚动），横向 ≤ 视口 60%', '吸附边界避让：停靠上下边时自动避开左下比例尺与右下缩放组，互不重叠', '测量卡片显示逻辑严格化：进入测量模式仅轻量 toast 提示，卡片仅在激活工具且已有绘制内容时显示；清除/切换/退出全链路隐藏', '测量卡片渲染层提升（translateZ），消除边缘斑块模糊，质感对齐全局玻璃标准'] },
        { v: 'v74', t: '日志关闭根治 + 高级设置折叠修复 + 横向全量展开', pts: ['更新日志叉号关闭根治：发现 removing 动画防抖残留会导致快速重开后再点叉号被误拦，openChangelog 现会清除残留；关闭按钮升级 click + touchstart + pointerdown 三通道直接绑定；面板拦截名单移除 cl-card，杜绝一切事件干扰', '高级设置折叠修复：展开/收起改为 hidden 与 open 类完全同步（去掉原无条件 add 类与 280ms 延时收起），杜绝展开后自动折叠与按钮状态错乱，折叠状态持久化保留', '悬浮球横向停靠升级：横向展开改为 flex-wrap 自动换行，一次性完整展示全部功能按钮，移除滚动条与拖动条遮挡，超宽自动两行排布；竖向展开保持长胶囊直显不变', '吸附/折叠方向/避让规则与 v73 保持一致，三通道绑定不影响正常关闭动效 0.25s 淡出缩放'] },
        { v: 'v75', t: '地图穿透终极守卫 + 日志关闭流畅化', pts: ['地图穿透终极修复：Leaflet 地图点击监听（测量加点 / 打点）增加 UI 命中守卫——事件来源落在任何玻璃面板/卡片/弹窗（设置/底图/打点/图例/测量卡/更新日志/悬浮球/缩放组/POI 弹窗）时一律忽略，不再依赖冒泡拦截顺序，杜绝卡片点击刺透到地图', '更新日志 cl-card 恢复面板拦截名单（叉号三通道直绑不受影响），卡内点击不冒泡到地图', '日志关闭卡顿优化：关闭动画期间移除全屏 backdrop-filter 模糊（动画结束自动恢复），消除大屏 blur 重排卡顿'] },
        { v: 'v76', t: '测量斑块清理 + 悬浮球拖拽手感重构', pts: ['测量卡片显示严格化：未激活工具时完全不显示；点击测距/测面瞬间显示操作提示卡（实时数值随绘制更新，6s 自动消退不常驻）；清除测量同步清图形+隐藏卡+重置状态，无斑块残留', '悬浮球吸附回归沿边投影：取消"强制中点吸附"导致的拖拽后位置跳变，球停哪吸哪，仅做安全范围 clamp', '竖向停靠吸附上限收紧（视口高 - 展开面板高 - 边距）：保证竖向展开后功能栏完整显示在视口内，不被底部截断、无遮挡滚动条', '横向展开固定一排（nowrap）：桌面 44px 完整一排；移动端 36px 紧凑排布，超宽隐藏式横向滚动（滚动条不可见），杜绝两行换行与可见滚动条', '吸附避让规则保留：横向停靠避开左下比例尺与右下缩放组；展开方向/折叠方向与停靠边严格平行'] },
        { v: 'v77', t: '双击卡片放大根治 + 全站性能提速 + 悬浮球/缩放组布局修正', pts: ['双击卡片放大根治：所有玻璃面板/卡片（设置/底图/打点/图例/测量卡/更新日志/提示）新增 dblclick 拦截，双击它们不再触发 Leaflet 地图双击缩放；viewport 禁用用户缩放（maximum-scale=1, user-scalable=no），手机端双击页面也不放大', '全站卡顿修复：更新日志遮罩移除全屏 backdrop-filter（纯 rgba 暗化遮罩，日志卡自身保留小面积玻璃模糊），打开/关闭日志不再触发全屏 blur 重排；侧边栏面板恢复按钮打开前统一清除关闭动画残留类，快速多次开合不再动画叠加卡顿', '悬浮球横向展开态禁用拖拽（停靠上/下边缘时）——该状态用于浏览功能列表，拖动不再把悬浮球吸走；竖向展开与折叠态仍可长按拖动', '悬浮球初始位置改为右上角（off 56px），anchor 持久化键升级 cd_fab_anchor77，旧位置作废强制复位右上', '缩放按钮组移至右下角（桌面/手机统一），按钮适当缩小（桌面 38px / 手机 34px），与右上悬浮球完全分离不重叠', '手机横向展开固定一排完整展示（31px 紧凑按钮全功能容纳在 96vw 内，无需滚动）'] },
        { v: 'v78', t: '移动端从0适应性配置（底部导航 + 信息密度分级 + dvh + 触控审计）', pts: ['手机端功能入口重构：右侧 46px 常驻窄条改为全宽玻璃底部导航条（我的位置/测距/测面/清除/底图/图例/设置 7 项，44px 触控高、图标+文字、safe-area 避让、底部玻璃胶囊外壳），右侧地图彻底清爽；缩放组上移至导航上方；手机端悬浮球隐藏', '信息密度分级（dense-data）：手机默认只显示聚合气泡，地名标签在地图放大 ≥13 级浮现、道路标签 ≥14 级浮现，三重文字叠压问题根治；桌面端不受影响', '页面壳层（page-layout）：顶部 title 精简为「常德公共服务WebGIS」；地图容器高度 100dvh 优先 + 100vh 兜底，浏览器地址栏收起/展开不再导致地图跳变；全局 touch-action: manipulation 消除触摸点击延迟', '抽屉侧边栏补齐：Esc 键关闭、打开时锁定背景滚动；抽屉底部新增快捷功能区（定位常德/复位/打点），手机端全功能保留', '学习成果落地：本版按 responsive-design（先分类 dense-data+page-layout 再写 CSS）、mobile-ux-optimizer（底部导航/dvh/44px/safe-area）、layout-system（内容驱动断点）、apple-hig-expert（触控≥44pt 审计）五组 skill 原则执行'] },
        { v: 'v79', t: '测量结果卡彻底常驻化 + 手机端层级修复 + title 保真', pts: ['底部测量结果卡彻底改对：双击结束测量后结果卡持续显示（总距离/面积），只在点击「清除测量」、退出测量模式、切换测距↔测面、切换底图时隐藏——不再 6s 自动消失；操作提示类文案（单击添加测量点/已添加 N 个顶点/双击结束）改为 3s 短显不常驻，界面干净', '手机端抽屉层级修复：侧边栏抽屉 z-index 提升至 1260（底部导航 1250 之上），打开抽屉时全屏接管、底部快捷区不再被导航遮挡；遮罩 1255、菜单按钮 1270，点按永不穿透', '手机端 title 保真：作者名「- 佘磊」手机端隐藏，标题文字加大 13.5px 且始终完整可见，不再消失/截断', '手机端测量结果卡上移（底部导航上方 72px），不被导航遮挡'] },
        { v: 'v80', t: '测量卡叉号根治 + 悬浮球双排最终方案（果冻展开/触发球收缩/折叠态拖拽）', pts: ['底部测量结果卡「×」彻底修复：关闭按钮三通道直绑（pointerdown + click + touchstart，按下立即清除并退出测量），面板守卫对测量卡放行 pointerdown/mousedown（仅拦 click/dblclick 防地图穿透），杜绝点击无效', '悬浮球双排最终方案：点击折叠触发球 → 果冻弹性过渡展开双排功能栏（2 列网格、图标+文字直显、交错弹性出现），不再区分横/竖向展开形态，停靠边仅决定位置避让', '再次点击触发球 → 丝滑收缩回 56px 圆球（原「收起」键已优化掉，面板内无冗余按键）', '拖动规则：折叠态长按可拖、沿边果冻吸附、位置持久化；展开态（双排浏览时）一律禁拖，不再误吸走'] },
        { v: 'v81', t: '测量卡不再常驻（点地图即消失）+ 悬浮球展开加固 + 双排面板收紧', pts: ['底部测量结果卡彻底不常驻：测量完成后结果卡短暂显示，非测量模式下点击地图任意处立即消失（看完即走）；空内容绝不渲染卡片——杜绝只剩关闭按钮的「× 空壳」残留', '悬浮球展开可靠性加固：折叠/展开统一为单一事件委托（折叠态任意点击含触发球即展开；展开态点触发球或空白处收缩、点功能按钮正常执行），杜绝双绑定时序歧义', '双排面板收紧尺寸（180px 宽 / 84×40 按钮 / 更小内边距），展开后更轻盈，减少对地图的遮挡影响'] },
        { v: 'v82', t: '悬浮球展开真根因修复（CSS 优先级压制）+ 触发球置顶', pts: ['悬浮球「展开不了 / 展开影响地图」真根因：折叠态隐藏功能按钮的规则（#fab > button:not(#fab-trigger)）优先级高于展开态显示规则，导致点击展开后功能按钮仍被隐藏、只剩透明空壳面板盖在地图上——已改为「仅折叠态隐藏」（#fab:not(.fab-open)），展开后双排 2×5 功能按钮完整可见，空壳遮挡消失', '折叠触发球移至功能面板首行（grid 第一行置顶），点击任意位置果冻展开/收缩，视觉层级正确', '测量结果卡渲染复验：卡片主体与数值文字清晰可见（白底 0.78 不透明 + 玻璃模糊），不再出现「只剩关闭按钮的空壳」', '双排面板 180px 收紧、84×40 按钮、触发球置顶 32px，展开形态经桌面 1280 视口截图验证完整无缺'] },
        { v: 'v83', t: '测量卡「×」彻底移除（无空壳可残留）+ 悬浮球改球面图案展开', pts: ['底部测量结果卡的「×」关闭按钮已彻底删除——再没有任何「红框空壳 ×」残留的可能；结果卡只在测量进行中 / 双击结束显示结果时出现，点地图任意处 / 清除测量 / 退出测量模式即自动消失', '悬浮球展开改「球面图案」：点击折叠球 → 果冻弹性膨胀为 252px 圆形玻璃球，10 个功能按钮以圆形小钮（图标+文字）直接铺在球面，顶部「功能」触发球作收缩开关；再次点击收缩回 56px 圆球', '球面高光：圆球内顶部高光 + 底部阴影渐变，液态玻璃质感统一；停靠边不改变形态，展开态禁拖，折叠态长按拖拽吸附与位置持久化保留'] },
        { v: 'v84', t: '悬浮球回退：展开改回双排矩形，折叠球面加刻度环图案', pts: ['收到「这个好丑啊」反馈——v83 的 252px 大圆球展开被圆边裁切按钮（如「清除测」缺字）、排列拥挤，已整体回退', '展开形态回退为 v82 双排矩形（180px、2 列 × 5 行、按钮 84×40 图文完整无裁切、触发球置顶）', '「悬浮球表面的图案」落地在折叠态：56px 圆球表面新增同心刻度环 + 顶部液态高光图案（伪元素实现，零 JS、零性能开销），点击展开后图案层隐藏不影响浏览', '测量卡无「×」保持（v83 已移除，杜绝空壳）；拖拽吸附 / 位置持久化 / 展开禁拖全部保留'] },
        { v: 'v85', t: '修复「清除测量后底部仍显示测量数据」——hidden 属性被 display 覆盖的根因修复', pts: ['根因定位：测量结果卡 CSS 显式声明 display:flex，优先级高于浏览器对 HTML hidden 属性的默认隐藏（[hidden]{display:none}）——所以 JS 执行 el.hidden=true 后卡片依然显示，清除测量、退出测量、点地图隐藏全部失效，且历次「空壳卡片残留」同源', '修复：新增统一兜底规则 #map .measure-result[hidden]{display:none!important}（更新日志卡片 .cl-card 同为 display:flex，一并兜底）——hidden 存在即强制隐藏，压过一切作者 display 声明', '影响面：清除测量 / 退出测量模式 / 点地图任意处 / 底图切换 / 关闭面板时，底部测量卡即刻消失，无残留、无空壳'] },
        { v: 'v86', t: '悬浮球罗盘图案 + 全卡片双击防穿透 + 测量历史记录（导出/导入/回显）', pts: ['悬浮球折叠态球面图案重新设计：罗盘刻度样式（中心定位点 + 双环 + 放射刻度线 + 顶部液态高光），纯 CSS 渐变实现，视觉清晰、零性能开销', '防穿透：地图双击监听新增 UI 命中守卫——双击任何玻璃面板/卡片（设置/底图/图例/打点/测量记录/更新日志/测量卡）不再触发地图双击缩放或测量结束/多边形闭合；测量记录面板加入全部穿透拦截名单（mousedown/pointerdown/click/dblclick）', '新增「测量记录」功能按钮与面板：完成测距/测面（双击结束或完成按钮）自动归档进历史，localStorage 持久化；面板支持导出全部记录为 JSON 文件、从 JSON 文件导入、清空、单条删除', '点击任意测量记录 → 地图回显对应点线面（顶点圆点 + 距离虚线/面积填充多边形）并自动适配视野，底部玻璃卡显示数值；记录坐标统一存 WGS-84 标准，切换底图后回显不偏移；清除测量同步清掉回显', '记录面板玻璃质感与动画：与设置/底图面板共用同一套 CSS 变量（玻璃强度滑杆实时联动），列表项果冻滑入动画，夜间模式与材质包自动适配'] },
        { v: 'v87', t: '悬浮球球面图案改为高对比罗盘刻度（清晰可见）', pts: ['收到「悬浮球貌似没有图案」反馈——v86 图案为白色刻度叠在淡白球底上，对比度不足且依赖 mask 裁剪，实际观感近乎空白', '重设计：白球底上叠加深紫（品牌色）罗盘刻度——8 个刻度点（上下左右主点 + 对角次点）+ 双细环 + 顶部白色液态高光，中心留空给触发球图标', '纯 CSS 多点径向渐变实现，移除 mask / conic-gradient 依赖，全浏览器（含 file:// 离线）兼容；图案清晰、与 Apple 液态玻璃风格统一'] },
        { v: 'v88', t: '悬浮球图案再修复：真根因 = ::before 被旧三点图标 mask 裁掉，改画在球背景', pts: ['v87 实机仍无图案。二次排查找到真正根因：`.toolbar::before`（v73 遗留的三点折叠图标）自带 mask 裁成三点形状，v87 的 `#fab::before` 罗盘背景渐变叠加在该 mask 上，被裁切到几乎不可见——此前 DOM 断言只检查了 backgroundImage 含 radial-gradient（True），未检查 mask 生效，被表象误导', '彻底修复：罗盘图案不再用 ::before，改为多层背景渐变直接合成在折叠球表面（`#fab:not(.fab-open)` 背景上）——内粗环（18-22px）+ 外细环（24-26px）+ 8 个刻度点（主点 3px、次点 2.5px）+ 顶部白色液态高光 + 半透明白玻璃底，中心 18px 留空给触发球图标；同时显式 `#fab:not(.fab-open)::before { display: none }` 隐藏旧三点图标', '图案更大更粗、对比更强，且绕开伪元素与 mask 的一切层级/裁切问题；展开态（.fab-open）有自己的背景与布局，完全不受影响'] },
        { v: 'v89', t: '悬浮球图案改为 Apple 液态玻璃球 + 中央精致准星（协调优雅）', pts: ['收到「图案好丑跟网站风格不协调」反馈——v88 深紫粗环罗盘在浅色玻璃球上过于突兀，与 Apple 液态玻璃语言冲突', '重设计：折叠球面 = Apple 液态玻璃球——半透明白玻璃基底 + 左上弧形主高光 + 下缘内反射 + 极淡品牌紫辉光，层次细腻、轻盈克制；表面图案改为中央 30px 精致准星 SVG（细线外圈 + 四向刻度 + 中心点），地图定位感强、与 WebGIS 主题协调', '折叠态隐藏六点小图标与「功能」文字、显示准星；展开态恢复「六点 + 功能」胶囊，两态互不干扰；图案即内嵌 SVG 图标本体，永远可见、无伪元素/mask 风险'] },
        { v: 'v90', t: '悬浮球图案终版：材质包纯色液态玻璃球 + 展开面板双击防穿透 + 顶部收起按钮重设计', pts: ['收到「图案还是不满意，建议设计成符合当前材质包的纯色玻璃质感小球」反馈——v89 白底紫准星与材质包体系割裂。终版：折叠球面 = 材质包强调色 var(--accent) 纯色立体球（左上→右下球体渐变 + 左上弧形主高光 + 下缘内反射 + 中心白色玻璃环），随材质包切换自动变色（桃花梅红/桂花金黄/绿叶绿/玫瑰粉/夜间蓝紫），玻璃强度滑杆实时联动高光/阴影/透明度，立体光泽感、与 Apple 液态玻璃语言完全同源', '双击防穿透补齐：悬浮球展开面板加入 dblclick 源头拦截（stopPropagation），双击面板内任何按钮/空隙不再冒泡到 Leaflet 容器触发地图双击缩放；配合既有 uiHit（.toolbar 已在名单）双保险', '展开态顶部折叠按钮重设计：弃用旧「六点+功能」畸变行，改为清晰的「双上箭头收起图标 + 收起」玻璃胶囊行（内高光 + 材质包主色图标），收起语义明确、无拉伸畸变；折叠态球面不再依赖内嵌 SVG（纯色球 + CSS 玻璃环）'] },
        { v: 'v91', t: '悬浮球玻璃质感重写：真·液态玻璃（去塑料感，四维滑杆全联动 + 颜色把控）', pts: ['收到「玻璃质感表现力差、塑料感、不能随质感调节变化」反馈——v90 球面为完全不透明纯色 + 仅 sheen/shadow 参与联动，在夜间尤显「深色灯罩 + 白色灯泡」的塑料感。根因：无透明度、无磨砂、无光学层次', '重写为真玻璃光学结构：① 材质包同色系半透明基底（透明度随 --glass-alpha，透过玻璃隐约见底图）；② 四层光学高光（中心柔光斑 + 左上主高光弧 + 左上小光点 + 下缘内反射弧）亮度随 --glass-sheen；③ backdrop 磨砂透光随 --glass-blur（滑杆动 → 球面透光/磨砂同步变）；④ 双描边 + 内投影 + 外柔光随 sheen/shadow——主滑杆 0-100% 四维全联动，调节差异显著', '颜色把控：球体渐变仅用材质包同色系（亮 accent → accent → 深 accent），白色只用于高光层，杜绝纯黑/纯白生硬对比；中心玻璃环改细柔版（1.2px + 中低透明度），夜间不再是「灯泡」', '夜间适配：暗底上球面磨砂透光更强（blur 系数 .24 + 饱和 165%），透出夜色 + 更通透的蓝紫玻璃'] },
        { v: 'v92', t: '夜间模式文字可读性专项 + 敷贴式玻璃光晕层（纯 CSS 增量）', pts: ['夜间可读性专项：全局变量提亮（正文 #eef2ff / 辅助文字 #b6c2e0 / 边框 #3d4c74）+ 语义色提亮（学校蓝/医院红/景点绿/道路橙明度提升，图层分类/图例/POI 辨识度不降）+ 全组件文字 1px 同色系深色微投影（磨砂模糊不发虚发灰，不破坏玻璃通透感）', '控件与分隔线适配：搜索框/下拉/输入描边提亮 #4a5a88，滑杆与复选框 accent-color 跟随主题蓝紫，面板标题/记录头/图例/设置/更新日志/信息卡分隔线统一提亮；placeholder/计数徽标/包选择卡等全部提亮一档', '背景通透度适配：夜间玻璃面板底色加深（rgba(19,26,48, calc(min(.97, alpha*1.02)))，保留磨砂质感同时防地图过亮透出干扰文字，参数纳入玻璃调节体系随主滑杆同步', '敷贴式玻璃光晕层：全部玻璃组件（侧边栏/悬浮球/设置/底图/打点/图例/记录/测量卡/toast/更新日志/标题栏/弹窗）统一 drop-shadow 三层弥散外发光 + 柔外投影，跟随圆角形状、不冲突 box-shadow 与伪元素；光晕强度经全局变量 --glass-halo 暴露并随主滑杆 sheen/shadow 联动，强度越高光晕越明显', '分级适配：桌面完整光晕，移动端自动降级仅保留轻微光晕（max-width:768px），保障地图渲染帧率；纯 CSS 增量，零 JS、零 DOM、零布局改动，不施加于地图容器/瓦片/POI'] },
        { v: 'v93', t: '三修：夜间字体再提亮 + 瓦片反色闪亮根治 + 卡片动画减负', pts: ['收到「还是看不清字体 / 点击卡片过渡动画卡顿 / 夜间缩放颜色突然变亮」三项反馈——根因定位：① L49 `transition: filter .7s ease`：夜间瓦片反色带 0.7s 渐变，放大/缩小时新瓦片加入后 filter 从 none 渐变到 invert，浅色原图以半过滤状态闪现即「突然变亮」——直接移除渐变，zoom 全程无原色闪现', '② 卡片动画卡顿：面板/弹窗 open-close 动画带 backdrop-filter + v92 光晕 drop-shadow，transform 动画逐帧重算 backdrop 合成 → 卡顿——新增 .anim-nobf 动画减负机制（JS 捕获点击 → 面板临时 340ms 去 blur/光晕，动画退化为纯 transform/opacity 合成，结束自动恢复玻璃质感）', '③ 夜间字体再提亮：正文 #f5f8ff / 辅助文字 #c9d5f5 + 双层同色系深色微投影（0 1px 2px .65 + 0 0 2px .4），磨砂背景边缘更清晰；夜间侧边栏磨砂系数降为 .6（文字更实）；小字号辅助文字（提示/计数/说明/placeholder）单列提亮'] },
        { v: 'v94', t: '流畅优先三改：夜间遮罩替代瓦片反色 + 悬浮球真透光 + 夜间文字换表现', pts: ['收到「还是看不清 / 整体卡顿 / 悬浮球不透光」——① 整体卡顿主源定位：夜间模式对每张瓦片逐帧 invert+hue-rotate filter 合成，拖动/缩放/切底图时几十张瓦片持续重算，GPU 负载远高于动画本身。根治：移除瓦片 filter，改为 tile-pane 伪元素深色遮罩（rgba(10,16,38,.62)，pointer-events none，z-index 只盖瓦片），夜间拖动缩放零 filter 成本，地图观感 = 暗色底 + 亮要素，比反色更自然', '② 悬浮球真透光：v91 球基底 color-mix 只混 accent+白+黑（实际完全不透明，磨砂形同虚设）——这就是「塑料感/不透光」的真相。v94 基底掺 transparent，不透明度随 --glass-alpha 在 42%-74% 区间（默认约 56-71%），透过玻璃真实见底图 + 更强磨砂（blur×.3，夜间 ×.36）+ 四层光学高光', '③ 夜间文字换表现形式（不再依赖提亮）：面板底色更实（rgba(15,20,40, alpha×1.1)）+ 正文纯白 #f8faff + font-weight 500、标题 600——用「更实底 + 加粗纯白字」对冲磨砂透出地图纹理造成的视觉噪声，摆脱反复提亮仍看不清的死循环', '④ 悬浮球展开动画减负：取消按钮 stagger 错位（统一同弹），过渡缩短至 0.22s，点击更跟手；anim-nobf 名单纳入 .toolbar，展开动画期间同样去 blur/光晕纯合成'] },
        { v: 'v95', t: '夜间可读性终极方案：玻璃面板转 Apple 深色实底卡片（结构性解决看不清）', pts: ['收到「夜间字体还是看不清，有没有更好的办法」——三轮提亮（v92 #eef2ff / v93 #f5f8ff / v94 纯白加粗）后仍不满意，判断根因是玻璃拟态固有缺陷：backdrop-filter 磨砂 + 半透明底色，地图纹理（浅色路名/色块/道路线）透过面板与文字混杂，亮度再高也是「亮字+噪底」，不是对比度问题', '结构性方案：夜间所有承载文字的面板（侧边栏/悬浮球展开/设置/底图/打点/图例/记录/测量卡/更新日志/标题栏/信息卡/toast）统一转近实色深底卡片——backdrop-filter 全部关闭（地图零透过、文字零干扰，同时夜间 backdrop 合成开销清零进一步减卡顿）、背景 #121a2e 近实色、保留圆角/细描边/柔和阴影/内高光保持精致卡片观感，对齐 Apple Dark 模式「玻璃只在浅色」的官方做法', '信息卡特修：实色底 #0f1628 + 行距 1.75 + 分隔线提亮；悬浮球展开面板按钮实色深底 + 亮字；折叠悬浮球保留 v94 真透明玻璃（用户明确要透光球），展开面板转实色'] },
        { v: 'v96', t: '收敛过度渲染 + 精准提亮低对比辅助文字 + 夜间底图切换修复', pts: ['收到「看不清的是字体颜色和底色重合的颜色，其他能看见的文字别再过度渲染了；夜间地图不能切换」——① 过度渲染收敛：移除 v93 双层 text-shadow（重影感）与 v94 全局 font-weight:500（生硬感），正文回常规字重，仅标题保留层级加粗，已清楚的文字恢复朴素', '② 精准提亮「与底色重合」的文字：定位为 11-12px 辅助小字（提示/说明/计数/placeholder/图例标签/记录空态/滑杆数值等），统一提到 #dbe6ff（对实色底对比度 ≈ 14:1），不加粗、无发光，只解决低对比', '③ 夜间底图切换修复：排查确认切换逻辑本身正常，根因是 v94 夜间遮罩 rgba(10,16,38,.62) 把所有底图都暗化到接近，切换后观感几乎无变化导致「以为切不动」。遮罩降至 .45——保留夜间暗化观感，但底图差异清晰可见，切换有感知'] },
        { v: 'v97', t: '夜间暗化恢复 + 「白底白字」彻底根治', pts: ['收到「地图没有切换到夜间模式（突然丢失）+ 夜间材质包下避免白底白字：悬浮球收起按钮/设置若干按钮/医院等设施详情卡」——① 地图暗化丢失：v97 曾把夜间遮罩试降到 .28（透明度过低，暗化观感几乎消失被误判为夜间失效），恢复 .45——夜间地图保持明显暗化、区别于白天，同时瓦片地名仍可读', '② 白底白字根治：排查发现 .set-toggle（高级设置展开/收缩）、部分面板按钮、收起按钮等控件基础样式是白底（background:#fff），文字却随夜间全局规则变白 → 白底白字不可见。v97 统一兜底：悬浮球收起按钮（#fab-trigger）、设置面板全部按钮、底图/打点/图例/记录/日志按钮、标题栏菜单钮、搜索项、图层操作钮夜间一律深底（rgba(30,41,82,.96)）+ 亮字（#f8faff）；active/sel 保持主题色（#6366f1 白字）；信息卡实色深底强化 + 标题纯白 + 行亮字 + 标签提亮 + 类型徽标主题色——夜间不再存在任何白底白字', '③ 用户明确「不是字号的问题」——本轮不再动字号'] },
        { v: 'v98', t: '设施点详情卡（.pw-box）统一优化：白天玻璃化 + 夜间深色实底', pts: ['收到「图层设施点的详情卡片忘记优化了，所有设施点都要优化」——排查发现设施点/道路/用户标注详情卡用的是 .pw-box（bindPopup pointPopupHtml/roadPopupHtml/userRoadPopupHtml 生成），v95-v97 的夜间实色规则覆盖的是 .iw-card，从未命中 .pw-box——所以夜间仍是 Leaflet 默认白底卡片（石灰社区卫生室截图实证白底）', 'v98 统一：白天 .leaflet-popup-content-wrapper 对齐全局玻璃（半透明白 + 磨砂 + 尖角同步），夜间转 Apple 深色实底卡片（外层 popup 与尖角 #0f1628、标题纯白加粗、行亮字 #dbe7ff、标签提亮 #a5b4fc、描边/内高光/深阴影）——所有设施点（学校/医院/景点/诊所）、道路、用户标注详情卡全覆盖，不再有白底详情卡'] },
        { v: 'v99', t: '材质包→地图底图联动着色（tile-pane 主题色叠加）', pts: ['收到「地图还是其他材质的样子」——切换材质包只有 UI 变色、地图底图完全不变（此前仅夜间有 .45 深色遮罩）。v99 给每套材质包定义 --map-tint：桃花 rgba(216,93,140,.16) / 桂花 rgba(214,128,26,.14) / 绿叶 rgba(34,130,80,.13) / 玫瑰 rgba(210,32,92,.14) 低透明主题色，夜间沿用 .45 深色遮罩，综合透明', '实现：tile-pane 单层伪元素 background:var(--map-tint)——纯 CSS 一次合成、pointer-events none、z-index 10 只盖瓦片（POI/聚合/标注在上层不受影响）、零逐帧开销、切换 0.5s 平滑过渡；夜间特化规则（特异性更高）仍保证 .45 深色优先——切换材质包时地图底图可见地随主题染色'] },
        { v: 'v100', t: '夜间真深色底图（高覆盖深色遮罩 .8）+ 设施点悬停标签深底亮字', pts: ['收到「夜间的时候地图底色还没更换 + 鼠标经过图层设施点显示的标签白底白字」——① 底色：实测排查全部分案——免费暗色瓦片源（Carto Dark / Esri Dark Gray / OpenFreeMap）2026 已全部 API key 化或停服（API KEY REQUIRED / Map data not yet available / 404）；高德 wprd0{s}+night=1 参数实测无效（下载瓦片 PIL 实测 avg-rgb 228,222,209 仍是亮色）；高德暗色样式只能走 JS API 矢量渲染（mapStyle，需 AMap 地图实例，与 Leaflet 瓦片体系不兼容）。v100 最终采用高覆盖深色遮罩方案：夜间 --map-tint 提升至 rgba(8,12,32,.8)——底图整体呈现深色底（视觉=底色真正更换），POI 圆点/道路线/标注在遮罩上层保持原色清晰可读；纯 CSS 单层合成一次、零逐帧开销、拖动缩放零 filter 成本', '② 悬停标签：.poi-tip 白天玻璃白底、夜间文字随全局规则变亮 → 白底白字看不清（v97 兜底漏了 tooltip）。v100 夜间 .leaflet-tooltip/.poi-tip 统一深底 rgba(15,22,40,.96)+亮字 #f8faff+描边 #334155+深阴影，箭头三角四向同步深色——设施点/道路悬停标签夜间全部深底亮字，无白底白字'] },
        { v: 'v101', t: 'v100-fix 最终修复：夜间真深色底图(深遮罩.8)+单文件重复清理+反色filter残留清除', pts: ['收到「用高德的啊 + 暗色瓦片没显示」——① 实测高德 wprd0{s}+night=1 参数无效（下载瓦片 PIL 实测 avg-rgb 228,222,209 仍亮色）；免费暗色源（Carto/Esri/OpenFreeMap）2026 已全部 key 化/停服；高德暗色仅 JS API 矢量渲染可做。v101 最终采用高覆盖深色遮罩 rgba(8,12,32,.8)：夜间底图整体呈现深色底（视觉=底色真正更换），POI/道路/标注在上层保持原色清晰；纯 CSS 单层合成零性能开销', '② 根因级修复：main.js 曾被重复拼接 4 份完整副本（8560 行，重复执行互相覆盖导致夜间样式失效+卡顿），v101 重建为单份 2143 行；同时移除 v94 瓦片反色 filter 残留（卡顿主源）。③ 悬停标签深底亮字（v100 已做，保留）'] },
        { v: 'v102', t: '悬浮球「细胞形态+液态折射」动态化：细胞膜呼吸浮动+边缘色散+细胞核布朗漂移+色散光晕', pts: ['三层细胞级液态结构落地：外层细胞膜 = border-radius 低频呼吸浮动（0.45Hz/2.2s 周期，±2px 幅度）+ 多层冷暖半透描边错位色散（棱镜感）；中层细胞质 = 沿用 backdrop 磨砂透光玻璃；内层细胞核 = 珍珠白高光核心（15px，左上聚光渐变）+ 蓝紫/粉双色散光晕 + 12s 缓慢布朗漂移（±5px 安全区，不触碰按钮图标）', '参数可调：--cell-breathe（膜呼吸周期 2.2s）/ --cell-drift（核漂移周期 12s）/ --cell-disperse（色散强度 .5）三组 CSS 变量，色散随玻璃质感滑杆（--glass-sheen/--glass-shadow）联动，夜间蓝紫散色更通透；装饰层由 main.js 注入（.fab-cell-core/.fab-cell-glow，pointer-events:none）', '性能与分级：纯 transform/border-radius/box-shadow/opacity 合成层动画、零重排；拖拽/展开/收起（.fab-dragging/.fab-open/.fab-closing）全停动画仅留基础玻璃；移动端（≤768px）关闭全部连续形变与漂移、隐藏装饰层；prefers-reduced-motion 自动降级——桌面端完整细胞液态效果，移动端零额外开销'] },
        { v: 'v103', t: '悬浮球专项修正：轮廓恒正圆 + 移除中心色块 + 细胞核气泡化 + 基底透光折射', pts: ['收到「都不圆了 / 细胞核没采用原来的 / 没折射透光感 / 去掉中间色块」四项反馈——① 不圆根因：v102 膜呼吸动画改 border-radius 各角非对称值（22/18/24/19），动画中帧视觉变形。v103 废弃角变化，改纯 scale(1↔1.02) 微呼吸 + 边缘色散光晕同步呼吸，几何永远正圆、轮廓不破形', '② 中间色块根因：v90 遗留的「中心白色玻璃环」（#fab:not(.fab-open)::before 15px 白环）与 v102 细胞核叠成两个核——v103 移除该环（display:none），细胞核成为唯一核心；③ 细胞核由实心珍珠白点重做为透明液态折射气泡（聚光高光点+半透渐变+1px 细折射环+底部微内阴影+蓝紫/粉双色散光晕），像液体中悬浮的气泡/晶核', '④ 折射透光：折叠球基底由完全不透明材质包纯色改为 color-mix 掺 transparent 的半透明（透出底图）+ 顶部透光带折射光路层，边缘冷暖双色描边保留；夜间气泡蓝紫散色更通透。参数与降级不变：--cell-breathe/--cell-drift/--cell-disperse 三组可调，拖拽/展开/收起全停，移动端与 prefers-reduced-motion 自动降级'] },
        { v: 'v104', t: '悬浮球细胞膜呼吸感增强 + 涟漪波纹环（水面涟漪扩散，双层节奏）', pts: ['呼吸感增强：膜呼吸由 scale(1↔1.02) 提升至 scale(1↔1.03)，50% 帧叠加双色光晕脉冲（蓝紫外发光 14px + 白色泛光 24px 同步扩散收缩）——球体涨缩感更明显、更鲜活', '波纹感新增：利用空闲伪元素 #fab:not(.fab-open)::after 增加 52px 细纹涟漪环——从球缘以 cubic-bezier 缓动向外扩散（scale .88→1.55）并渐隐（opacity .55→0），模拟水面涟漪一圈圈荡开；周期 2.6s 与呼吸 2.2s 错相，形成「涨缩呼吸 + 环波扩散」双层节奏，视觉不机械', '适配与降级：涟漪环颜色随材质包（白描边+蓝紫/粉散色，夜间蓝紫），拖拽/展开/收起全停（动画 none+透明度 0），移动端与 prefers-reduced-motion 隐藏/停用——零重排纯合成层动画，不影响地图帧率'] },
        { v: 'v108', t: '点击卡片透明度变化终修（移除 jelly 弹跳动画：scale 弹跳即「先更透后恢复」视觉源）', pts: ['现象再定位：v107 已根治背景冻结（切夜间深色正常、点击材质包背景恒定），但用户仍反馈「点击设置的卡片透明度变化」——高频采样发现 settings-panel 每次打开/点滑杆/恢复默认时 jellyPulse 播放 jelly-pop scale 弹跳（1→1.03→0.983→1）：面板放大瞬间边缘透出更多玻璃区域、磨砂采样区变化，视觉上正是「先更透明随后透明减少」', '修复：移除 jellyPulse() 全部三处调用（打开面板、恢复默认、高级滑杆 applyAdv 尾部）——面板打开/点击/拖动全程无形态抖动、无透明度视觉变化；jellyPulse 函数定义与 animationend 清理逻辑保留（防引用错误，动画类永不悬挂）', '保留 v107 的全部级联冻结修复（.jelly 自动移除 + 背景子属性化）——夜间深色面板与滑杆联动不受影响'] },
        { v: 'v106', t: '透明度跳变根修 + 玻璃调节美学重调（悬浮球全量接入透明度变量）', pts: ['「点击设置面板按钮时透明度短暂跳变」根因定案：set-blur/set-alpha/set-sat 高级滑杆被双 handler 重复绑定（旧 applyGlass 与 initGlassSystem 的 applyAdv/applySat 双写同一 CSS 变量、clamp 逻辑不同）——一次拖动写两次 --glass-alpha，变量抖动即「不稳定」。v106 移除旧绑定，高级滑杆统一由 applyAdv 单通道驱动，果冻反馈迁移保留，写入值与 applyGlass 同构', '「玻璃透明度调节不够有效」根因二：悬浮球整体硬编码背景（折叠 .58 / hover .66 / 展开 .66）与球体基底 color-mix（42/60/82%）完全不随 --glass-alpha——滑杆对悬浮球无效。v106 全部接入变量：toolbar 背景 .68/.72/.78 系数、球体基底掺入比例 30+24a / 44+32a / 68+26a 随滑杆实时联动', '调节幅度美学拓宽：主滑杆 alpha 锚点 70/85/97 → 50/80/96（低端可调出真通透玻璃）；高级滑杆下限 25 → 0，统一美学地板 0.18（最透仍可辨）、夜间地板 0.55（保文字可读）', 'hover 稳定性：展开态 hover 禁用位移与背景切换（fab-open:hover 背景/transform 均不变）；背景过渡 0.3s → 0.18s 快速到位无拖尾；夜间悬浮球 hover 保持深色玻璃（原全局白色半透明覆盖夜间深底 = 夜间 hover 白底跳变，已修）'] },
        { v: 'v105', t: '按课程笔记第10节验收迭代：卫星影像底图 + 测量单位自动转换', pts: ['底图切换新增第4源「卫星影像」（Esri World_Imagery，免费无Key长期稳定，实测瓦片可用）——底图面板加入口，切换时专题数据自动换算坐标系对齐，与高德矢量/栅格/OSM 共 4 源自由切换', '测量单位自动转换（课程验收任务四）：距离 <1000m 显示 m、≥1000m 自动切 km；面积 <1,000,000 m² 显示 m²、≥ 自动切 km²——全部保留两位小数，替代原来固定「公里/平方公里」3 位小数，小尺度测量读数更直观', '全部测量显示点统一接入：实时距离、双击总距离、完成按钮、面积、测量记录归档（recordsAdd）五处同步，历史记录数值为新格式'] },
    ];
    var clBackdrop = document.getElementById('cl-backdrop');
    var clList = document.getElementById('cl-list');
    var clCount = document.getElementById('cl-count');
    function renderChangelog() {
        if (!clList || !clCount) return;
        clList.innerHTML = CHANGELOG.map(function (c) {
            return '<div class="cl-row">' +
                '<span class="cl-ver">' + c.v + '</span>' +
                '<div class="cl-body"><div class="cl-row-title">' + c.t + '</div>' +
                '<div class="cl-row-points">' + c.pts.map(function (p) {
                    return '<div class="cl-pt"><i class="cl-pt-i"></i><span class="cl-pt-t">' + p + '</span></div>';
                }).join('') + '</div></div></div>';
        }).join('');
        clCount.textContent = CHANGELOG.length;
    }
    function openChangelog() {
        renderChangelog();
        clBackdrop.hidden = false;
        clBackdrop.classList.remove('removing'); // v74：清除上一次关闭动画残留，避免 closing 防抖误拦
        // 强制重排后加 .show，触发果冻弹入动画
        void clBackdrop.offsetWidth;
        clBackdrop.classList.add('show');
    }
    function closeChangelog() {
        if (!clBackdrop || clBackdrop.classList.contains('removing')) return;
        clBackdrop.classList.add('removing');
        clBackdrop.classList.remove('show');
        setTimeout(function () {
            clBackdrop.hidden = true;
            clBackdrop.classList.remove('removing');
        }, 260);
    }
    // v74：关闭按钮 click + touchstart + pointerdown 三通道直接绑定（pointerdown 最即时，杜绝任何拦截路径）
    var clCloseBtn = document.getElementById('cl-close');
    if (clCloseBtn) {
        clCloseBtn.addEventListener('click', function (e) { e.stopPropagation(); closeChangelog(); });
        clCloseBtn.addEventListener('touchstart', function (e) { e.stopPropagation(); e.preventDefault(); closeChangelog(); }, { passive: false });
        clCloseBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); closeChangelog(); });
    }
    var verTag = document.getElementById('ver-tag');
    if (verTag) verTag.addEventListener('click', openChangelog);
    if (clBackdrop) {
        clBackdrop.addEventListener('click', function (e) {
            if (e.target === clBackdrop) closeChangelog(); // v73：仅点击遮罩空白关闭
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && clBackdrop && !clBackdrop.hidden && clBackdrop.classList.contains('show')) closeChangelog();
        });
    }

    // ---------------- 13.6 悬浮球功能区（桌面折叠球 + 手机常驻窄条；支持长按拖拽吸附、方向自适应展开、防误触收起） ----------------
    (function initFab() {
        var fab = document.getElementById('fab');
        if (!fab) return;
        // v102：注入细胞形态装饰层（折叠态细胞核 + 色散光晕），纯视觉、pointer-events none、不影响按钮与拖拽热区
        if (!fab.querySelector('.fab-cell-core')) {
            var cellGlow = document.createElement('i');
            cellGlow.className = 'fab-cell-glow';
            var cellCore = document.createElement('i');
            cellCore.className = 'fab-cell-core';
            fab.insertBefore(cellGlow, fab.firstChild);
            fab.insertBefore(cellCore, fab.firstChild);
        }
        var btns = Array.prototype.slice.call(fab.querySelectorAll('button'));
        var mapEl = document.getElementById('map');
        var isMobile = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
        var open = false, openedAt = 0;
        function layout(doOpen) {
            if (doOpen === open) return;
            open = doOpen;
            openedAt = Date.now();
            fab.classList.toggle('fab-open', doOpen);
            if (!doOpen) {
                fab.classList.add('fab-closing');
                setTimeout(function () { fab.classList.remove('fab-closing'); }, 320);
            }
            var n = btns.length;
            btns.forEach(function (b, i) {
                b.style.transitionDelay = (doOpen ? i * 30 : (n - 1 - i) * 14) + 'ms';
            });
        }
        // —— 长按拖拽 + 智能吸附（quickLiquid 弹簧物理概念：拖拽结束果冻回弹吸附最近边缘） ——
        // v77：anchor 键名升级为 cd_fab_anchor77（旧位置作废）→ 初始位置强制回到右上角
        function loadAnchor() {
            try {
                var s = localStorage.getItem('cd_fab_anchor77');
                if (s) return JSON.parse(s);
            } catch (e) { /* ignore */ }
            return { side: 'right', off: 56 }; // 默认右上角
        }
        function applyAnchor(a) {
            if (!a || !a.side) return;
            fab.setAttribute('data-anchor', a.side);
            var off = Math.max(6, a.off || 0);
            if (a.side === 'left') { fab.style.right = ''; fab.style.bottom = ''; fab.style.left = '10px'; fab.style.top = off + 'px'; }
            else if (a.side === 'right') { fab.style.left = ''; fab.style.bottom = ''; fab.style.right = '10px'; fab.style.top = off + 'px'; }
            else if (a.side === 'top') { fab.style.left = off + 'px'; fab.style.top = '10px'; fab.style.right = ''; fab.style.bottom = ''; }
            else { fab.style.left = off + 'px'; fab.style.bottom = '10px'; fab.style.right = ''; fab.style.top = ''; }
        }
        applyAnchor(loadAnchor());
        var drag = { on: false, sx: 0, sy: 0, sx0: 0, sy0: 0, moved: false };
        fab.addEventListener('pointerdown', function (e) {
            if (e.target.closest && e.target.closest('button')) return;
            // v80：展开态（双排功能栏）一律禁用拖拽——浏览功能时不误吸走；折叠态长按可拖、沿边吸附
            if (fab.classList.contains('fab-open')) return;
            drag.on = true; drag.moved = false;
            drag.sx = e.clientX; drag.sy = e.clientY;
            var r = fab.getBoundingClientRect(), mr = mapEl.getBoundingClientRect();
            drag.sx0 = r.left - mr.left; drag.sy0 = r.top - mr.top;
            fab.classList.add('fab-dragging');
            if (fab.setPointerCapture) { try { fab.setPointerCapture(e.pointerId); } catch (err) { } }
            e.preventDefault();
        }, { passive: false });
        fab.addEventListener('pointermove', function (e) {
            if (!drag.on) return;
            if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) drag.moved = true;
            var mr = mapEl.getBoundingClientRect();
            var x = drag.sx0 + (e.clientX - drag.sx), y = drag.sy0 + (e.clientY - drag.sy);
            fab.style.left = Math.max(4, Math.min(x, mr.width - 66)) + 'px';
            fab.style.top = Math.max(4, Math.min(y, mr.height - 66)) + 'px';
            fab.style.right = ''; fab.style.bottom = '';
            e.preventDefault();
        }, { passive: false });
        function endDrag(e) {
            if (!drag.on) return;
            drag.on = false;
            fab.classList.remove('fab-dragging');
            var mr = mapEl.getBoundingClientRect(), r = fab.getBoundingClientRect();
            var dL = r.left - mr.left, dR = mr.right - r.right, dT = r.top - mr.top, dB = mr.bottom - r.bottom;
            var min = Math.min(dL, dR, dT, dB);
            // v76：沿边投影吸附（球停哪吸哪，保留拖拽手感，不强制中点）
            // 竖向 clamp 上限 = 视口高 - 展开面板高 - 底部安全边距（确保竖向展开后功能栏完整显示、不被视口截断）
            var EXPAND_H = 410, a;
            if (min === dL) a = { side: 'left', off: clampOff(r.top - mr.top, mr.height - EXPAND_H - 8, 56) };
            else if (min === dR) a = { side: 'right', off: clampOff(r.top - mr.top, mr.height - EXPAND_H - 8, 56) };
            else if (min === dT) a = { side: 'top', off: clampOff(r.left - mr.left, mr.width - 110, 150) };
            else a = { side: 'bottom', off: clampOff(r.left - mr.left, mr.width - 110, 150) }; // 避让左下比例尺(150)与右下缩放组(110)
            applyAnchor(a);
            try { localStorage.setItem('cd_fab_anchor77', JSON.stringify(a)); } catch (err) { /* ignore */ }
        }
        function clampOff(v, max, min) { return Math.max(min, Math.min(v, Math.max(min, max))); }
        ['pointerup', 'pointercancel'].forEach(function (t) { fab.addEventListener(t, endDrag, { passive: true }); });
        // v111：resize 后 FAB 被侧边栏遮住时自动移到右边
        function ensureFabVisible() {
            var mr = mapEl.getBoundingClientRect(), r = fab.getBoundingClientRect();
            if (r.left < mr.left + 10 || r.right > mr.right - 10 || r.top < mr.top + 10 || r.bottom > mr.bottom - 10) {
                applyAnchor({ side: 'right', off: 56 });
                try { localStorage.setItem('cd_fab_anchor77', JSON.stringify({ side: 'right', off: 56 })); } catch (e) {}
            }
        }
        window.addEventListener('resize', function () { setTimeout(ensureFabVisible, 100); });
        // v113：页面加载时也检查 FAB 可见性
        setTimeout(ensureFabVisible, 500);
        // —— 展开/收起（v81 统一事件委托：折叠态任意点击含触发球即展开；展开态点触发球/空白收缩、点功能按钮执行功能） ——
        fab.addEventListener('click', function (e) {
            if (drag.moved) { drag.moved = false; return; } // 拖拽后的 click 不触发展开
            var t = e.target.closest && e.target.closest('button');
            if (t && t.id === 'fab-trigger') { layout(!open); return; }
            if (t) return; // 功能按钮：执行功能，不折叠
            layout(!open);
        });
        // 触屏果冻跳跃 + 方向倾斜（react-tilt-button 方向逻辑）
        btns.forEach(function (b) {
            if (b._fabTouch) return;
            b._fabTouch = true;
            b.addEventListener('touchstart', function () {
                b.classList.add('fab-pop');
            }, { passive: true });
            ['touchend', 'touchcancel', 'touchleave'].forEach(function (t) {
                b.addEventListener(t, function () {
                    b.classList.remove('fab-pop');
                    b.classList.remove('tilt-l', 'tilt-r');
                }, { passive: true });
            });
            b.addEventListener('mouseenter', function (ev) {
                var r = b.getBoundingClientRect();
                var fromLeft = ev.clientX < r.left + r.width / 2;
                b.classList.add(fromLeft ? 'tilt-l' : 'tilt-r');
            });
            b.addEventListener('mouseleave', function () {
                b.classList.remove('tilt-l', 'tilt-r');
            });
        });
    })();

    // ---------------- 13.7 面板关闭（图层管理/地点搜索/数据说明）与恢复 ----------------
    (function initPanelClose() {
        var closes = document.querySelectorAll('.panel-close');
        Array.prototype.forEach.call(closes, function (x) {
            if (x._pc) return;
            x._pc = true;
            x.addEventListener('click', function () {
                var panel = x.closest('.panel');
                if (!panel || panel.classList.contains('panel-removing')) return;
                panel.classList.add('panel-removing');
                try { hideMeasureCard(); } catch (e) { }
                setTimeout(function () {
                    panel.hidden = true;
                    panel.classList.remove('panel-removing');
                    var restore = document.getElementById('panel-restore');
                    if (restore) restore.hidden = false;
                }, 320);
            });
        });
        var restore = document.getElementById('panel-restore');
        if (restore) restore.addEventListener('click', function () {
            // v77：打开前统一清除关闭动画残留类，杜绝快速多次开合时的动画叠加卡顿
            document.querySelectorAll('.sidebar .panel.panel-removing').forEach(function (p) { p.classList.remove('panel-removing'); });
            document.querySelectorAll('.sidebar .panel').forEach(function (p) {
                p.hidden = false;
            });
            restore.hidden = true;
        });
    })();

    // ---------------- 13.8 玻璃质感调节体系（Apple 式单轴主滑杆 + 高级微调双向联动，参考 glasskit 参数体系） ----------------
    (function initGlassSystem() {
        var docEl = document.documentElement;
        var glass = document.getElementById('set-glass');
        var glassVal = document.getElementById('set-glass-val');
        var advArea = document.getElementById('adv-area');
        var advToggle = document.getElementById('set-adv-toggle');
        var adv = {
            blur: document.getElementById('set-blur'),
            alpha: document.getElementById('set-alpha'),
            sheen: document.getElementById('set-sheen'),
            shadow: document.getElementById('set-shadow')
        };
        var advVal = {
            blur: document.getElementById('set-blur-val'),
            alpha: document.getElementById('set-alpha-val'),
            sheen: document.getElementById('set-sheen-val'),
            shadow: document.getElementById('set-shadow-val')
        };
        var satEl = document.getElementById('set-sat');
        var satVal = document.getElementById('set-sat-val');
        // v115：锚点按「光学结构」重定——薄段不再靠白底遮，而是低模糊 + 高边光；厚段维持磨砂高反
        // P0 边光 1.15 高于 P50，形成「薄而亮」的玻璃薄片感（旧版 P0 sheen 0.2 是错的）
        var P0 = { blur: 2, alpha: 8, sheen: 1.15, shadow: 0.18 };
        var P50 = { blur: 10, alpha: 50, sheen: 0.85, shadow: 0.55 };
        var P100 = { blur: 16, alpha: 96, sheen: 1.5, shadow: 1.6 };
        function clamp(v, mn, mx) { return Math.max(mn, Math.min(v, mx)); }
        function presetAt(g) {
            var a = g < 50 ? { from: P0, to: P50, t: g / 50 } : { from: P50, to: P100, t: (g - 50) / 50 };
            // v109：非线性 t 曲线——低区间更敏感
            a.t = Math.pow(a.t, 1.3);
            return {
                blur: Math.round(a.from.blur + (a.to.blur - a.from.blur) * a.t),
                alpha: Math.round(a.from.alpha + (a.to.alpha - a.from.alpha) * a.t),
                sheen: +(a.from.sheen + (a.to.sheen - a.from.sheen) * a.t).toFixed(2),
                shadow: +(a.from.shadow + (a.to.shadow - a.from.shadow) * a.t).toFixed(2)
            };
        }
        function labelOf(v) { var x = Math.round(v); return x <= 2 ? '弱' : x <= 4 ? '偏弱' : x === 5 ? '中' : x <= 7 ? '偏强' : '强'; }
        function glassLabel(g) { return g <= 15 ? '轻薄' : g <= 40 ? '偏透' : g <= 70 ? '中' : g <= 88 ? '偏厚' : '厚重'; }
        function writeVars(v) {
            docEl.style.setProperty('--glass-blur', v.blur + 'px');
            // v115：删掉「blur<3 就把 alpha 硬抬到 60%」——它是「切到轻薄反而不透」的根因之一
            // 白天 8% 只作可读性护栏，夜间 62% 保证深底浅字；其余全部交给滑杆本身
            var night = document.body.classList.contains('theme-night');
            var aFloor = night ? 62 : 8;
            var aVal = Math.max(v.alpha, aFloor);
            docEl.style.setProperty('--glass-alpha', (aVal / 100).toFixed(2));
            docEl.style.setProperty('--glass-sheen', v.sheen.toFixed(2));
            docEl.style.setProperty('--glass-shadow', v.shadow.toFixed(2));
            // v115 边缘透光强度：薄段 0.90 → 厚段 1.00，配合 style.css 的 Rim / Specular / Refraction 三层
            docEl.style.setProperty('--glass-edge', (0.9 + Math.min(aVal / 100, 1) * 0.1).toFixed(2));
        }
        function saveState(s) { try { localStorage.setItem('cd_glass72', JSON.stringify(s)); } catch (e) { } }
        // 主滑杆 → 预设联动（同步高级滑杆 UI + 变量）
        function applyMain() {
            var g = clamp(parseFloat(glass.value), 0, 100);
            var v = presetAt(g);
            writeVars(v);
            adv.blur.value = v.blur; adv.alpha.value = v.alpha;
            adv.sheen.value = Math.round(clamp(v.sheen / 1.5 * 10, 0, 10));
            adv.shadow.value = Math.round(clamp(v.shadow / 1.6 * 10, 0, 10));
            advVal.blur.textContent = v.blur + 'px';
            advVal.alpha.textContent = v.alpha + '%';
            advVal.sheen.textContent = labelOf(v.sheen / 1.5 * 10);
            advVal.shadow.textContent = labelOf(v.shadow / 1.6 * 10);
            glassVal.textContent = glassLabel(g);
            applySat();
            saveState({ glass: g, blur: v.blur, alpha: v.alpha, sheen: v.sheen, shadow: v.shadow });
        }
        // v115：对外暴露唯一入口——「恢复默认」及任何外部重置必须走这里，杜绝滑杆与 CSS 变量脱钩
        window.applyGlassPreset = function (g) {
            glass.value = clamp(g, 0, 100);
            applyMain();
        };
        // 高级微调 → 写变量 + 反推主滑杆相对强度（双向联动）
        function applyAdv() {
            var v = {
                blur: clamp(parseFloat(adv.blur.value), 0, 40),
                alpha: clamp(parseFloat(adv.alpha.value), 0, 100),
                sheen: +(clamp(parseFloat(adv.sheen.value), 0, 10) / 10).toFixed(2),
                shadow: +(clamp(parseFloat(adv.shadow.value), 0, 10) / 10).toFixed(2)
            };
            writeVars(v);
            var b = clamp((v.blur - 6) / 24, 0, 1), a = clamp((v.alpha - 70) / 27, 0, 1);
            var sn = clamp((v.sheen - 0.3) / 1.2, 0, 1), sh = clamp((v.shadow - 0.3) / 1.3, 0, 1);
            var g = Math.round((b + a + sn + sh) / 4 * 100);
            glass.value = g;
            glassVal.textContent = glassLabel(g);
            advVal.blur.textContent = v.blur + 'px';
            advVal.alpha.textContent = v.alpha + '%';
            advVal.sheen.textContent = labelOf(parseFloat(adv.sheen.value));
            advVal.shadow.textContent = labelOf(parseFloat(adv.shadow.value));
            applySat();
            saveState({ glass: g, blur: v.blur, alpha: v.alpha, sheen: v.sheen, shadow: v.shadow });
            // v108：移除 jellyPulse 果冻弹跳（视觉上造成「面板透明度先透后恢复」+ 动画卡顿），滑杆拖动仅变量实时联动
        }
        function applySat() {
            var sat = satEl ? parseFloat(satEl.value) : 150;
            docEl.style.setProperty('--glass-sat', (sat / 100).toFixed(2));
            if (satVal) satVal.textContent = sat + '%';
            try { var g = JSON.parse(localStorage.getItem('cd_glass') || 'null'); if (!g) g = {}; g.sat = sat; localStorage.setItem('cd_glass', JSON.stringify(g)); } catch (e) { }
        }
        // 高级设置折叠区（v74：hidden 与 open 类完全同步，去掉无条件 add 与延时收起，杜绝展开后自动折叠/状态错乱）
        if (advArea && advToggle) {
            advToggle.addEventListener('click', function () {
                var on = advArea.classList.toggle('open');
                advArea.hidden = !on;
                advToggle.textContent = on ? '收起' : '展开';
                try { localStorage.setItem('cd_adv_open', on ? '1' : '0'); } catch (e) { }
            });
            try {
                if (localStorage.getItem('cd_adv_open') === '1') {
                    advArea.hidden = false;
                    advArea.classList.add('open');
                    advToggle.textContent = '收起';
                }
            } catch (e) { }
        }
        // 加载：新键优先，旧键（cd_glass / cd_gl_set-*）迁移
        function load() {
            try {
                var s = JSON.parse(localStorage.getItem('cd_glass72') || 'null');
                if (s && s.glass !== undefined && s.blur !== undefined) {
                    glass.value = s.glass;
                    adv.blur.value = s.blur; adv.alpha.value = s.alpha;
                    adv.sheen.value = Math.round(s.sheen * 10); adv.shadow.value = Math.round(s.shadow * 10);
                    applyMain(); return;
                }
            } catch (e) { }
            try {
                var g0 = JSON.parse(localStorage.getItem('cd_glass') || 'null');
                var gs = localStorage.getItem('cd_gl_set-sheen');
                var gsh = localStorage.getItem('cd_gl_set-shadow');
                if (g0 && g0.blur !== undefined) {
                    adv.blur.value = g0.blur; adv.alpha.value = g0.alpha;
                    if (satEl && g0.sat !== undefined) satEl.value = g0.sat;
                    if (gs !== null) adv.sheen.value = clamp(parseFloat(gs), 0, 10);
                    if (gsh !== null) adv.shadow.value = clamp(parseFloat(gsh), 0, 10);
                    applyAdv(); return;
                }
            } catch (e) { }
            applyMain();
        }
        load();
        glass.addEventListener('input', function () { applyMain(); });
        adv.blur.addEventListener('input', function () { applyAdv(); });
        adv.alpha.addEventListener('input', function () { applyAdv(); });
        adv.sheen.addEventListener('input', function () { applyAdv(); });
        adv.shadow.addEventListener('input', function () { applyAdv(); });
        if (satEl) satEl.addEventListener('input', function () { applySat(); });
        // 液态折射增强：桌面默认开、移动端自动关；SVG 位移滤镜 + 错位层仅作用于侧边栏与设置面板
        var refractBtn = document.getElementById('set-refract');
        if (refractBtn) {
            var refractDefault = !(window.matchMedia && window.matchMedia('(max-width:768px)').matches);
            var refractOn = refractDefault;
            try {
                var rv = localStorage.getItem('cd_refract');
                if (rv === '0' || rv === '1') refractOn = rv === '1';
            } catch (e) { }
            function paintRefract() {
                document.body.classList.toggle('refraction', refractOn);
                refractBtn.textContent = refractOn ? '开启' : '关闭';
            }
            paintRefract();
            refractBtn.addEventListener('click', function () {
                refractOn = !refractOn;
                paintRefract();
                try { localStorage.setItem('cd_refract', refractOn ? '1' : '0'); } catch (e) { }
            });
        }
    })();

    // ---------------- 13.9 面板点击穿透拦截（玻璃弹层点击不触发地图 / 不误关悬浮球） ----------------
    (function initPanelGuard() {
        // v75：cl-card 恢复拦截（叉号三通道直绑不依赖冒泡，stopPropagation 无副作用；防止卡内点击冒泡到地图）
        // v77：dblclick 一并拦截——双击任何玻璃面板/卡片不再触发 Leaflet 地图双击缩放（"双击卡片放大"根治），地图本体双击缩放保留
        ['settings-panel', 'basemap-panel', 'mark-panel', 'legend-panel', 'records-panel', 'cl-card', 'map-toast'].forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            ['mousedown', 'pointerdown', 'click', 'dblclick'].forEach(function (t) {
                el.addEventListener(t, function (e) { e.stopPropagation(); }, false);
            });
        });
        // v80：measure-result 仅拦 click/dblclick（防地图穿透/双击放大），放行 pointerdown/mousedown——叉号三通道立即响应
        ['click', 'dblclick'].forEach(function (t) {
            var el = document.getElementById('measure-result');
            if (el) el.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });
        var fab = document.getElementById('fab');
        if (fab) fab.addEventListener('mousedown', function (e) {
            if (e.target.closest && e.target.closest('button')) return;
            e.stopPropagation();
        }, false);
        // v90：悬浮球展开面板 dblclick 源头拦截——双击面板/按钮不再冒泡到 Leaflet 容器触发地图双击缩放
        if (fab) fab.addEventListener('dblclick', function (e) { e.stopPropagation(); }, false);
    })();


    // ---------------- 13.10 v114：自建要素渲染 / 选中 / 改形状 / 整体移动 / 删除 ----------------
    var customLayer = L.layerGroup().addTo(map);
    var cfSelId = null;
    // v122：显隐由 cfPairOn（文件|地类）接管，旧的全局 cfKindOn 已废弃（保留空对象只为极端老代码不炸）
    var cfKindOn = {};
    var cfEditing = null;
    // v114：要素自身被点中的时间戳。Leaflet 会先派发图层 click、再派发地图 click，
    // 用这个时间差区分「点中要素」与「点空白」，否则详情卡刚打开就被空白点击逻辑关掉
    var cfHitTs = 0;

    function round6(v) { return Math.round(v * 1e6) / 1e6; }
    function cfLatLngs(f) { return cfCoordList(f).map(function (c) { return L.latLng(c[1], c[0]); }); }
    // 屏幕经纬度 → 入库坐标（与既有 geojson 一致：统一存 GCJ-02 底图坐标）
    function fromMapLatLng(ll) {
        var c = gcjMode ? [ll.lat, ll.lng] : wgs2gcj([ll.lat, ll.lng]);
        return [round6(c[1]), round6(c[0])];
    }
    function writeGeomFromLatLngs(f, lls) {
        var cs = lls.map(fromMapLatLng);
        if (f.geometry.type === 'Point') { f.geometry.coordinates = cs[0]; return; }
        if (f.geometry.type === 'LineString') { f.geometry.coordinates = cs; return; }
        var ring = cs.slice();
        if (ring.length >= 3 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
            ring.push([ring[0][0], ring[0][1]]);
        }
        f.geometry.coordinates = [ring];
    }
    function cfGeoLabel(t) { return t === 'Point' ? '点' : t === 'LineString' ? '线' : '面'; }

    function cfStyle(f, sel) {
        var col = cfColor(f.properties.kind);
        if (f.geometry.type === 'Point') {
            return { radius: sel ? 10 : 7.5, color: '#ffffff', weight: sel ? 3.5 : 2.5, fillColor: col, fillOpacity: 1 };
        }
        if (f.geometry.type === 'LineString') {
            return { color: col, weight: sel ? 6.5 : 4, opacity: .95, lineJoin: 'round', lineCap: 'round' };
        }
        return { color: col, weight: sel ? 3.5 : 2.5, fillColor: col, fillOpacity: sel ? .3 : .16, dashArray: '5 6' };
    }

    function renderCustom() {
        // v114l：permanent tooltip 的 DOM 不会随 clearLayers 一起消失——每次重绘（选中/取消/改属性/导入）
        // 都会再生成一份，旧的不清就会在地图上叠出重影标签。重绘前先把旧标签 DOM 抹掉。
        Array.prototype.forEach.call(document.querySelectorAll('.cf-tag'), function (n) {
            if (n.parentNode) n.parentNode.removeChild(n);
        });
        customLayer.clearLayers();
        customFeatures.forEach(function (f) {
            if (cfEditing && String(cfEditing.id) === String(f.id)) return;
            if (!cfRowVisible(f)) return;
            // v114 加固：单条记录坐标畸形（例如 Polygon 少了外环那一层）时只跳过它，
            // 不能让一条坏数据把整个自建图层和选中/弹卡链路一起打挂
            try {
            var coords = cfCoordList(f);
            if (!coords.length) return;
            var lls = cfLatLngs(f);
            if (!lls.length || lls.some(function (l) { return !l || !isFinite(l.lat) || !isFinite(l.lng); })) return;
            var sel = cfSelHas(f.id);
            var dim = cfSelIds.length > 1 && !sel;   // 多选时未选中的退到背景，选中项自己跳出来
            var col = cfColor(f.properties.kind);
            // 选中光晕：白色描边衬底，任何底图上都能看出"被选中"
            if (sel && f.geometry.type === 'LineString') {
                customLayer.addLayer(L.polyline(lls, { color: '#ffffff', weight: 11, opacity: .9, lineJoin: 'round' }));
            } else if (sel && f.geometry.type === 'Polygon') {
                customLayer.addLayer(L.polygon(lls, { color: '#ffffff', weight: 9, opacity: .85, fillColor: '#ffffff', fillOpacity: .12 }));
            }
            var st = cfStyle(f, sel);
            if (dim) {
                st.dim = true;                       // 只做标记，供验收探针统计
                st.opacity = (st.opacity == null ? 1 : st.opacity) * .32;
                if (st.fillOpacity != null) st.fillOpacity *= .5;
            }
            var layer;
            if (f.geometry.type === 'Point') layer = L.circleMarker(lls[0], st);
            else if (f.geometry.type === 'LineString') {
                layer = L.polyline(lls, st);
                if (f.properties.kind === '道路') layer.setStyle({ dashArray: '9 6' });
            } else {
                layer = L.polygon(lls, st);
            }
            // v125 C3：要素量较大（>60）时常驻标签降级为 hover 提示——每条 permanent tooltip 都是
            // 一个常驻 DOM 节点，几百条同时挂着会撑爆 overlay 层；少量要素时仍保留常驻标签便于对照。
            var manyCf = customFeatures.length > 60;
            layer.bindTooltip(
                '<span class="cf-tip-name">' + esc(f.properties.name) + '</span>' +
                '<span class="cf-tip-meta">' + esc(f.properties.kind) + ' · ' + cfGeoLabel(f.geometry.type) + '</span>',
                { permanent: !manyCf, direction: f.geometry.type === 'Point' ? 'top' : 'center', offset: f.geometry.type === 'Point' ? [0, -10] : [0, 0], className: 'cf-tag', opacity: 1 }
            );
            layer.on('click', function (e) {
                if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
                if (markMode || measure.mode || cfEditing) return;
                cfHitTs = Date.now();
                // v122：Shift 点击 = 追加/取消该点（多选），普通点击 = 单选并打开详情卡
                var additive = !!(e.originalEvent && e.originalEvent.shiftKey);
                selectCf(f.id, false, additive);
            });
            layer.on('mouseover', function () { if (!sel) layer.setStyle({ weight: f.geometry.type === 'Point' ? 10 : (f.geometry.type === 'LineString' ? 6.5 : 4) }); });
            layer.on('mouseout', function () { layer.setStyle(st); });
            customLayer.addLayer(layer);
            } catch (eOne) {
                if (window.console && console.warn) console.warn('[cf] 跳过畸形要素', f && f.id, eOne);
            }
        });
        syncCfCounts();
    }

    // ------- v122：多选（Shift 点选追加 / Ctrl+A 全选可见 / Esc 清空 / Delete 删选中） -------
    var cfSelIds = [];                     // 多选集合（唯一真源）；cfSelId 仍表示"主选中"，兼容旧链路
    function cfSelHas(id) {
        for (var i = 0; i < cfSelIds.length; i++) if (String(cfSelIds[i]) === String(id)) return true;
        return false;
    }
    function cfSelIndexOf(id) {
        for (var i = 0; i < cfSelIds.length; i++) if (String(cfSelIds[i]) === String(id)) return i;
        return -1;
    }
    function updateCfSelBar() {
        var bar = document.getElementById('cf-selbar');
        if (!bar) return;
        if (!cfSelIds.length) { bar.hidden = true; bar.innerHTML = ''; return; }
        var byKind = {}, n = 0;
        cfSelIds.forEach(function (id) {
            var f = cfById(id);
            if (!f) return;
            var k = cfKindOf(f);
            byKind[k] = (byKind[k] || 0) + 1; n++;
        });
        var parts = Object.keys(byKind).map(function (k) { return k + ' ' + byKind[k]; });
        bar.hidden = false;
        bar.innerHTML = '<span class="cf-sel-n">已选 ' + n + ' 个</span>' +
            '<span class="cf-sel-kinds">' + esc(parts.join(' · ')) + '</span>' +
            '<button type="button" class="cf-sel-btn danger" data-cf-sel="del">删除选中</button>' +
            '<button type="button" class="cf-sel-btn" data-cf-sel="clear">取消</button>';
    }

    function selectCf(id, zoom, additive) {
        if (poiSel.ids.length) { poiSel.ids = []; poiSelPaint(); updatePoiSelBar(); }
        var f = cfById(id);
        if (!f) return;
        setAppMode('select');
        var card = document.getElementById('cf-card');
        if (additive) {
            // Shift：只增减集合，不弹详情卡，靠底部选择条与地图高亮做实时预览
            var i = cfSelIndexOf(f.id);
            if (i >= 0) cfSelIds.splice(i, 1); else cfSelIds.push(String(f.id));
            cfSelId = cfSelIds.length ? cfSelIds[cfSelIds.length - 1] : null;
            if (card && cfSelIds.length !== 1) card.classList.remove('open');
            renderCustom();
            updateCfSelBar();
            if (cfSelIds.length === 1) openCfCard(cfById(cfSelIds[0]));
            return;
        }
        cfPairOn[cfPairKey(f)] = true;      // 从列表点进来时，即使该类被隐藏也先恢复可见
        cfSelIds = [String(f.id)];
        cfSelId = f.id;
        renderCustom();
        openCfCard(f);
        updateCfSelBar();
        if (zoom) {
            var lls = cfLatLngs(f);
            if (lls.length === 1) map.setView(lls[0], Math.max(map.getZoom(), 16));
            else map.fitBounds(L.latLngBounds(lls).pad(0.25));
        }
    }
    function clearCfSel() {
        if (cfEditing) stopCfEdit();
        cfSelId = null;
        cfSelIds = [];
        var card = document.getElementById('cf-card');
        if (card) card.classList.remove('open');
        if (APP_MODE === 'select') APP_MODE = 'idle';
        renderCustom();
        updateCfSelBar();
    }
    function showCfKind(kind, on) {
        if (!on) return;
        customFeatures.forEach(function (f) { if (cfKindOf(f) === kind) cfPairOn[cfPairKey(f)] = true; });
        renderCustom();
    }
    // 批量删除：一次确认，逐条走编辑权限校验（锁定的线要素不会被顺手删掉）
    function deleteCfIds(ids) {
        ids = (ids || []).filter(function (id) { return !!cfById(id); });
        if (!ids.length) return;
        var names = ids.map(function (id) { return cfById(id).properties.name; });
        var sample = names.slice(0, 4).join('、') + (names.length > 4 ? ' 等' : '');
        if (!window.confirm('删除选中的 ' + ids.length + ' 个要素？\n' + sample + '\n删除后图层计数、搜索与图例同步更新，不可恢复')) return;
        var blocked = 0;
        ids.forEach(function (id) {
            var f = cfById(id);
            if (!f || !editAllowed(f)) { blocked++; return; }
            customFeatures = customFeatures.filter(function (x) { return String(x.id) !== String(id); });
        });
        cfSelIds = cfSelIds.filter(function (id) { return !!cfById(id); });
        cfSelId = cfSelIds.length ? cfSelIds[cfSelIds.length - 1] : null;
        if (cfEditing) stopCfEdit();
        var card = document.getElementById('cf-card');
        if (card && !cfSelIds.length) card.classList.remove('open');
        if (!cfSelIds.length && (APP_MODE === 'select' || APP_MODE === 'edit' || APP_MODE === 'move')) APP_MODE = 'idle';
        saveCustom(); renderCustom(); syncCfCats(); updateCounts(); refreshSearch();
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        updateCfSelBar();
        if (blocked) toast('已删除 ' + (ids.length - blocked) + ' 个；' + blocked + ' 个被编辑权限锁定未删', true);
        else toast('已删除 ' + (ids.length - blocked) + ' 个要素');
    }
    function selectAllCfVisible() {
        var vis = customFeatures.filter(function (f) { return cfRowVisible(f); });
        if (!vis.length) { toast('当前没有可见的自建要素', true); return; }
        if (vis.length > 300) { toast('可见要素太多（' + vis.length + '），请先在大分类里取消勾选再全选', true); return; }
        setAppMode('select');
        cfSelIds = vis.map(function (f) { return String(f.id); });
        cfSelId = cfSelIds[cfSelIds.length - 1];
        var card = document.getElementById('cf-card');
        if (card && cfSelIds.length > 1) card.classList.remove('open');
        renderCustom(); updateCfSelBar();
        toast('已全选 ' + cfSelIds.length + ' 个要素' +
            (window.innerWidth <= 640 ? '' : '（Shift 点击可增减，Delete 删除）'));
    }
    // 选择条：实时预览选中数量与地类分布，并提供批量删除 / 取消
    (function initCfSelBar() {
        var host = document.getElementById('map');
        if (!host || document.getElementById('cf-selbar')) return;
        var bar = document.createElement('div');
        bar.id = 'cf-selbar';
        bar.className = 'cf-selbar';
        bar.hidden = true;
        bar.addEventListener('click', function (e) {
            var t = e.target;
            var act = (t && t.getAttribute) ? t.getAttribute('data-cf-sel') : null;
            if (act === 'del') deleteCfIds(cfSelIds.slice());
            else if (act === 'clear') clearCfSel();
        });
        host.appendChild(bar);
    })();
    document.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (e.key === 'Escape') {
            if (cfEditing) { stopCfEdit(); toast('已退出编辑（改动已保存）'); return; }
            if (poiSel.ids.length) { clearPoiSel(); return; }
            if (cfSelIds.length) clearCfSel();
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && poiSel.ids.length) {
            e.preventDefault();
            poiBatchDelete(poiSel.ids.slice());
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && cfSelIds.length) {
            e.preventDefault();
            deleteCfIds(cfSelIds.slice());
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            if (customFeatures.length) { e.preventDefault(); selectAllCfVisible(); }
        }
    });

    // v124：内置点多选条的两个按钮 + 批量删除
    function poiBatchDelete(ids) {
        if (!ids.length) return;
        if (!window.confirm('删除选中的 ' + ids.length + ' 个点位？\n\n只删这些点，图层与其它点不受影响；可在图层管理下方的「恢复已删点位」一键还原。')) return;
        poiBatchDel = true;
        ids.forEach(function (id) { var mk = POI_MK[id]; if (mk) deletePoi(mk.__pKey, id); });
        poiBatchDel = false;
        poiSel.ids = [];
        poiSelPaint();
        updatePoiSelBar();
        toast('已删除选中的 ' + ids.length + ' 个点位');
    }
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-poi-sel]') : null;
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        var act = b.getAttribute('data-poi-sel');
        if (act === 'clear') { clearPoiSel(); return; }
        if (act === 'del') poiBatchDelete(poiSel.ids.slice());
    });

    // ---- v114 P1-I：模式互斥状态机（idle / measure / mark(绘制) / select / edit(顶点) / move(整体移动)）----
    // 所有入口统一走 setAppMode(next)：先把不属于 next 的模式全部收干净，再切过去。
    // 这样「绘制中切测距」「编辑中开面板」「测量中开详情卡」都不会留下草稿或点不动的按钮。
    var APP_MODE = 'idle';
    var appModeBusy = false;
    function setAppMode(next) {
        if (appModeBusy) return APP_MODE;
        appModeBusy = true;
        try {
            if (next !== 'measure' && (measure.mode || measure.pts.length || (measure.dots && measure.dots.length))) clearMeasure();
            if (next !== 'mark' && (markMode || markPts.length || markLayer || markLine)) exitMark();
            if (next !== 'edit' && cfEditing) stopCfEdit();   // 顶点编辑与任何其他模式都不共存（含 move）
            if (next !== 'select' && next !== 'edit' && next !== 'move' && cfSelId !== null) clearCfSel();
            // 面板也归模式管：非 mark 模式一律收起自建要素面板，避免它和详情卡/测量卡叠在一起
            if (next !== 'mark') {
                var mpn = document.getElementById('mark-panel');
                if (mpn && mpn.classList.contains('open')) mpn.classList.remove('open');
            }
            APP_MODE = next;
        } catch (e) {
            if (window.console && console.warn) console.warn('[mode] 切换异常', next, e);
        }
        appModeBusy = false;
        try {
            if (next === 'edit' || next === 'move') map.dragging.disable();
            else map.dragging.enable();
        } catch (e2) { }
        return APP_MODE;
    }
    // 验收探针：不改变任何状态，只报当前模式与各分支残留
    window.__appMode = function () {
        return JSON.stringify({
            mode: APP_MODE,
            measure: measure.mode || null,
            measurePts: measure.pts.length,
            mark: markMode,
            markPts: markPts.length,
            editing: !!cfEditing,
            sel: cfSelId,
            selCount: cfSelIds.length,
            selBar: (function () { var b = document.getElementById('cf-selbar'); return b ? (b.hidden ? '' : b.textContent.replace(/\s+/g, ' ').trim()) : null; })(),
            cfRows: document.querySelectorAll('#cf-layer-box .cf-kind-sub').length,
            cfFiles: document.querySelectorAll('#cf-layer-box .cf-file-item').length,
            dim: (function () { var n = 0; customLayer.eachLayer(function (l) { if (l.options && l.options.dim) n++; }); return n; })(),
            handles: document.querySelectorAll('.cf-handle-icon').length,
            dragging: !!(map.dragging && map.dragging.enabled()),
            distBtn: document.getElementById('btn-distance') ? document.getElementById('btn-distance').classList.contains('active') : null,
            areaBtn: document.getElementById('btn-area') ? document.getElementById('btn-area').classList.contains('active') : null,
            markBtn: btnMark ? btnMark.classList.contains('active') : null
        });
    };

    function openCfCard(f) {
        var card = document.getElementById('cf-card');
        if (!card) return;
        document.getElementById('cf-name').value = f.properties.name || '';
        document.getElementById('cf-kind').value = f.properties.kind || '设施点';
        document.getElementById('cf-remark').value = f.properties.remark || '';
        var badge = document.getElementById('cf-badge');
        if (badge) badge.innerHTML = '<span class="cf-badge-dot" style="background:' + cfColor(f.properties.kind) + '"></span>' + esc(f.properties.kind) + ' · ' + cfGeoLabel(f.geometry.type) + ' · ' + cfCoordList(f).length + ' 节点';
        var hint = document.getElementById('cf-hint');
        if (hint) hint.textContent = '改属性点「保存属性」；拖动顶点改形状，或「整体移动」拖动整个要素，改动即时落库';
        // 窄屏：详情卡整宽铺在底部，会和左侧「自建要素」面板叠在一起，开卡时先把面板收起
        if (window.innerWidth <= 1024) {
            var mp = document.getElementById('mark-panel');
            if (mp && mp.classList.contains('open')) {
                mp.classList.remove('open');
                if (markMode) { exitMark(); toast('已退出绘制，查看要素详情'); }
            }
        }
        syncCardEditBtns(f);   // v114 P2-2：卡片打开即按当前编辑权限决定三个几何按钮能否点
        card.classList.add('open');
        if (typeof forceBackdropResample === 'function') forceBackdropResample(card);
    }

    function saveCfCard() {
        var f = cfById(cfSelId);
        if (!f) return;
        var name = (document.getElementById('cf-name').value || '').trim();
        if (!name) { toast('名称不能为空', true); return; }
        var kind = document.getElementById('cf-kind').value;
        var remark = (document.getElementById('cf-remark').value || '').trim();
        f.properties.name = name;
        f.properties.kind = kind;
        f.properties.remark = remark;
        f.ts = Date.now();
        saveCustom();
        renderCustom();
        syncCfCats();
        refreshSearch();
        // v114i 修：改名/改类型后左栏「我的自建要素」列表行仍是旧名称与旧类型（列表由 renderMarkList 生成，
        // 这里此前漏了刷新），补上后名称、类型徽标、节点数一并同步
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        openCfCard(f);
        toast('属性已保存：' + name + '（' + kind + '），图层 / 搜索 / 图例已同步');
    }

    function deleteCf(id) {
        var f = cfById(id);
        if (!f) return;
        if (!editAllowed(f)) { toast('删除已锁定：' + editOffTip(f.geometry.type).replace(/[（）]/g, ''), true); return; }
        if (!window.confirm('确定删除「' + f.properties.name + '」？删除后该要素也会从图层、搜索与图例中移除')) return;
        customFeatures = customFeatures.filter(function (x) { return String(x.id) !== String(id); });
        if (cfSelId !== null && String(cfSelId) === String(id)) cfSelId = null;
        if (cfEditing && String(cfEditing.id) === String(id)) stopCfEdit();
        saveCustom();
        var card = document.getElementById('cf-card');
        if (card) card.classList.remove('open');
        renderCustom();
        syncCfCats();
        refreshSearch();
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        toast('已删除「' + f.properties.name + '」，搜索与图例同步移除');
    }

    // ---- 改形状：顶点拖拽（等价 OpenLayers Modify）----
    function redrawEditGhost(f) {
        var g = cfEditing.ghost;
        g.clearLayers();
        var col = cfColor(f.properties.kind);
        if (f.geometry.type === 'Point') {
            g.addLayer(L.circleMarker(cfEditing.lls[0], { radius: 10, color: '#ffffff', weight: 3, fillColor: col, fillOpacity: .95 }));
        } else if (f.geometry.type === 'LineString') {
            g.addLayer(L.polyline(cfEditing.lls, { color: col, weight: 4, opacity: .9, dashArray: '4 6', lineJoin: 'round' }));
        } else {
            g.addLayer(L.polygon(cfEditing.lls, { color: col, weight: 2.5, fillColor: col, fillOpacity: .2, dashArray: '4 6' }));
        }
    }
    // 顶点拖拽落库（drag 事件与 document mouseup 双通道，防止个别浏览器只给 drag 不给 dragend）
    function commitShapeEdit(f) {
        if (!cfEditing) return;
        writeGeomFromLatLngs(f, cfEditing.lls);
        f.ts = Date.now();
        saveCustom();
        redrawEditGhost(f);
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
    }
    function buildHandles(f) {
        var h = cfEditing.handles;
        h.clearLayers();
        var lls = cfEditing.lls;
        var idxs = [];
        if (f.geometry.type === 'Polygon') {
            for (var i = 0; i < lls.length - 1; i++) idxs.push(i);
        } else {
            for (var j = 0; j < lls.length; j++) idxs.push(j);
        }
        idxs.forEach(function (i) {
            var m = L.marker(lls[i], {
                draggable: true, keyboard: false,
                icon: L.divIcon({ className: 'cf-handle-icon', html: '<div class="cf-handle"></div>', iconSize: [20, 20], iconAnchor: [10, 10] })
            });
            m.on('drag', function (e) {
                cfEditing.lls[i] = e.target.getLatLng();
                if (f.geometry.type === 'Polygon' && i === 0) cfEditing.lls[cfEditing.lls.length - 1] = e.target.getLatLng();
                cfEditing.moved = true;
                redrawEditGhost(f);
            });
            m.on('dragend', function () {
                if (!cfEditing || !cfEditing.moved) return;
                cfEditing.moved = false;
                commitShapeEdit(f);
            });
            h.addLayer(m);
        });
    }
    function startShapeEdit(f) {
        if (!f) return;
        if (!editAllowed(f)) { toast('改形状已锁定：' + editOffTip(f.geometry.type).replace(/[（）]/g, ''), true); return; }
        if (cfEditing) stopCfEdit();          // 重复点「改形状」视为重新进入：先收掉旧手柄，防图层泄漏
        setAppMode('edit');
        APP_MODE = 'edit';
        cfEditing = { id: f.id, ghost: L.layerGroup().addTo(map), handles: L.layerGroup().addTo(map), lls: cfLatLngs(f), mapHandlers: [], moved: false };
        map.dragging.disable();
        redrawEditGhost(f);
        buildHandles(f);
        renderCustom();
        // 兜底：有些输入通道只派发 drag 不派发 dragend，鼠标/手指一松就落库
        var onDocUp = function () {
            if (cfEditing && cfEditing.moved) { cfEditing.moved = false; commitShapeEdit(f); }
        };
        document.addEventListener('mouseup', onDocUp, true);
        document.addEventListener('touchend', onDocUp, true);
        cfEditing.docUp = onDocUp;
        var hint = document.getElementById('cf-hint');
        if (hint) hint.textContent = '拖动彩色顶点调整形状，松开即保存；点「结束编辑」返回';
        var btn = document.getElementById('cf-shape');
        if (btn) btn.textContent = '结束编辑';
        toast('已进入形状编辑：拖动顶点，松手即保存');
    }
    function stopCfEdit() {
        if (!cfEditing) return;
        var ed = cfEditing;
        // v114：先摘掉编辑状态，再做图层清理。
        // 顶点 marker 若停在拖动中途被移除，Leaflet 内部可能抛异常，
        // 旧写法会让「结束编辑」按一次没反应（按钮文字与手柄都不复位）。
        cfEditing = null;
        try { if (ed.ghost) map.removeLayer(ed.ghost); } catch (e) { }
        try {
            if (ed.handles) {
                ed.handles.clearLayers();
                map.removeLayer(ed.handles);
            }
        } catch (e) { }
        // 兜底：把可能残留的手柄 DOM 直接抹掉，保证退出编辑的视觉是干净的
        Array.prototype.forEach.call(document.querySelectorAll('.cf-handle-icon'), function (n) {
            if (n.parentNode) n.parentNode.removeChild(n);
        });
        if (ed.docUp) {
            document.removeEventListener('mouseup', ed.docUp, true);
            document.removeEventListener('touchend', ed.docUp, true);
        }
        if (ed.mapHandlers && ed.mapHandlers.length) {
            ed.mapHandlers.forEach(function (h) { try { map.off(h[0], h[1]); } catch (e) { } });
        }
        try { map.dragging.enable(); } catch (e) { }
        var btn = document.getElementById('cf-shape');
        if (btn) btn.textContent = '改形状';
        var hint = document.getElementById('cf-hint');
        if (hint) hint.textContent = '改属性点「保存属性」；拖动顶点改形状，或「整体移动」拖动整个要素，改动即时落库';
        APP_MODE = (cfSelId != null ? 'select' : 'idle');
        renderCustom();
    }

    // ---- 整体移动：整要素平移（等价 OpenLayers Translate，形状不变）----
    function drawMoveGhost(f, lls) {
        var g = cfEditing.ghost;
        g.clearLayers();
        var col = cfColor(f.properties.kind);
        var shape;
        if (f.geometry.type === 'Point') shape = L.circleMarker(lls[0], { radius: 11, color: '#ffffff', weight: 3, fillColor: col, fillOpacity: .95 });
        else if (f.geometry.type === 'LineString') shape = L.polyline(lls, { color: col, weight: 5, opacity: .95 });
        else shape = L.polygon(lls, { color: col, weight: 3, fillColor: col, fillOpacity: .22 });
        shape.on('mousedown', function (e) {
            if (!cfEditing) return;
            cfEditing.moving = true;
            cfEditing.start = e.latlng;
            cfEditing.delta = [0, 0];
            L.DomEvent.stop(e);
        });
        g.addLayer(shape);
    }
    function startMoveFeature(f) {
        if (!f) return;
        if (!editAllowed(f)) { toast('整体移动已锁定：' + editOffTip(f.geometry.type).replace(/[（）]/g, ''), true); return; }
        if (cfEditing) stopCfEdit();
        setAppMode('move');
        APP_MODE = 'move';
        var lls0 = cfLatLngs(f);
        cfEditing = { id: f.id, ghost: L.layerGroup().addTo(map), handles: null, lls: lls0, base: lls0.map(function (ll) { return [ll.lat, ll.lng]; }), mapHandlers: [], moving: false, delta: [0, 0] };
        map.dragging.disable();
        var base = cfEditing.base;
        drawMoveGhost(f, lls0);
        var onMove = function (e) {
            if (!cfEditing || !cfEditing.moving) return;
            var dLat = e.latlng.lat - cfEditing.start.lat;
            var dLng = e.latlng.lng - cfEditing.start.lng;
            cfEditing.delta = [dLat, dLng];
            drawMoveGhost(f, base.map(function (p) { return L.latLng(p[0] + dLat, p[1] + dLng); }));
        };
        var onUp = function () {
            if (!cfEditing || !cfEditing.moving) return;
            cfEditing.moving = false;
            var d = cfEditing.delta || [0, 0];
            if (Math.abs(d[0]) < 1e-7 && Math.abs(d[1]) < 1e-7) return;
            cfEditing.lls = base.map(function (p) { return L.latLng(p[0] + d[0], p[1] + d[1]); });
            writeGeomFromLatLngs(f, cfEditing.lls);
            f.ts = Date.now();
            saveCustom();
            var id = f.id, nm = f.properties.name;
            stopCfEdit();
            selectCf(id, false);
            try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
            toast('已整体移动「' + nm + '」，形状保持不变');
        };
        map.on('mousemove', onMove);
        map.on('mouseup', onUp);
        cfEditing.mapHandlers = [['mousemove', onMove], ['mouseup', onUp]];
        var hint = document.getElementById('cf-hint');
        if (hint) hint.textContent = '按住图形拖动到新位置，松开即保存（只平移、不变形）';
        toast('已进入整体移动：按住图形拖动');
    }

    // ---- v116：内置图层「整层删除」+ 持久化（笔记第13节第4条）----
    var LAYER_GONE_KEY = 'cd_layer_gone';
    var goneLayers = {};
    function loadGoneLayers() {
        try { goneLayers = JSON.parse(localStorage.getItem(LAYER_GONE_KEY) || '{}') || {}; } catch (e) { goneLayers = {}; }
        if (!goneLayers || typeof goneLayers !== 'object') goneLayers = {};
    }
    function saveGoneLayers() {
        try { localStorage.setItem(LAYER_GONE_KEY, JSON.stringify(goneLayers)); } catch (e) { }
    }
    // 刷新后把已删除的图层保持为空（不让"删掉的图层又回来"）
    function applyGoneLayers() {
        GEO_KEYS.forEach(function (k) {
            if (!goneLayers[k]) return;
            layerState[k].data = [];
            layerState[k].visible = false;
            var chk = document.getElementById('chk-' + k);
            if (chk) chk.checked = false;
        });
        syncGoneOptions();
    }
    // v116：整层删除后「搜索类型」下拉与「图例」同步消失，恢复后还原（笔记验收 7）
    var BASE_KEYS = ['school', 'hospital', 'scenic', 'road'];
    function syncGoneOptions() {
        var sel = document.getElementById('search-type');
        if (sel) {
            Array.prototype.forEach.call(sel.querySelectorAll('option'), function (o) {
                if (BASE_KEYS.indexOf(o.value) < 0) return;
                var gone = !!goneLayers[o.value];
                o.disabled = gone;
                o.hidden = gone;
                if (gone && sel.value === o.value) sel.value = '';
            });
        }
        BASE_KEYS.forEach(function (k) {
            var row = document.querySelector('.legend-row[data-layer="' + k + '"]');
            if (row) row.style.display = goneLayers[k] ? 'none' : '';
        });
    }
    function renderBuiltinDelBtns() {
        GEO_KEYS.forEach(function (k) {
            var row = document.querySelector('.layer-item[data-layer="' + k + '"]');
            if (!row || row.querySelector('.layer-del')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'layer-del';
            btn.title = '整层删除「' + LAYER_CONFIG[k].name + '」：移除该类型全部要素，刷新后不再加载';
            btn.setAttribute('aria-label', '删除该图层');
            btn.textContent = '×';
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                deleteBuiltinLayer(k);
            });
            row.appendChild(btn);
        });
    }
    function deleteBuiltinLayer(k) {
        var n = (layerState[k].data || []).length;
        var nm = LAYER_CONFIG[k].name;
        if (!n) { toast('「' + nm + '」当前没有要素可删除'); return; }
        if (!window.confirm('整层删除「' + nm + '」？\n\n将删除该图层及其全部要素（共 ' + n + ' 个）：地图上的点/线、视野计数、搜索结果与图例都会一起清掉，刷新后不再加载。\n\n可在「恢复已删除图层」一键还原。')) return;
        layerState[k].data = [];
        layerState[k].visible = false;
        goneLayers[k] = true;
        saveGoneLayers();
        var chk = document.getElementById('chk-' + k);
        if (chk) chk.checked = false;
        refreshLayer(k);
        try { buildSearchIndex(); } catch (e) { }
        updateCounts();
        refreshSearch();
        renderRestoreBtn();
        try { syncLegend(); } catch (e) { }
        syncGoneOptions();
        if (typeof syncLayerActions === 'function') syncLayerActions();
        toast('已删除「' + nm + '」整层 ' + n + ' 个要素');
    }
    function renderRestoreBtn() {
        var btn = document.getElementById('btn-layer-restore');
        if (!btn) return;
        var keys = Object.keys(goneLayers).filter(function (k) { return goneLayers[k] && LAYER_CONFIG[k]; });
        if (!keys.length) { btn.hidden = true; return; }
        btn.hidden = false;
        btn.textContent = '恢复已删除图层（' + keys.length + '）';
    }
    function restoreGoneLayers() {
        var keys = Object.keys(goneLayers).filter(function (k) { return goneLayers[k] && LAYER_CONFIG[k]; });
        if (!keys.length) return;
        keys.forEach(function (k) {
            var src = (DATA[k] && DATA[k].features) || [];
            if (!src.length) return;
            layerState[k].data = src;
            layerState[k].visible = true;
            var chk = document.getElementById('chk-' + k);
            if (chk) chk.checked = true;
            delete goneLayers[k];
            refreshLayer(k);
        });
        saveGoneLayers();
        try { buildSearchIndex(); } catch (e) { }
        updateCounts();
        refreshSearch();
        renderRestoreBtn();
        try { syncLegend(); } catch (e) { }
        syncGoneOptions();
        if (typeof syncLayerActions === 'function') syncLayerActions();
        toast('已恢复 ' + keys.length + ' 个图层');
    }

    // ---- v117b：删除单个地物点（按坐标指纹记录，刷新后不再出现；可一键恢复）----
    var POI_GONE_KEY = 'cd_poi_gone';
    var gonePois = [];
    function poiFid(feat) {
        var c = feat.geometry.coordinates;
        return (Math.round(c[0] * 1e5) / 1e5) + ',' + (Math.round(c[1] * 1e5) / 1e5);
    }
    function loadGonePois() {
        try { var a = JSON.parse(localStorage.getItem(POI_GONE_KEY) || '[]'); gonePois = Array.isArray(a) ? a : []; } catch (e) { gonePois = []; }
        gonePois = gonePois.filter(function (g) { return g && g.k && g.id; });
    }
    function saveGonePois() { try { localStorage.setItem(POI_GONE_KEY, JSON.stringify(gonePois)); } catch (e) { } }
    function applyGonePois() {
        if (!gonePois.length) return;
        BASE_KEYS.forEach(function (k) {
            if (k === 'road' || !layerState[k]) return;
            layerState[k].data = (layerState[k].data || []).filter(function (f) {
                var fid = poiFid(f);
                return !gonePois.some(function (g) { return g.k === k && g.id === fid; });
            });
        });
    }
    function deletePoi(key, fid) {
        if (!layerState[key]) return;
        var nm = '';
        var kept = [];
        (layerState[key].data || []).forEach(function (f) {
            if (poiFid(f) === fid) { nm = (f.properties && f.properties.name) || ''; return; }
            kept.push(f);
        });
        if (!nm) { toast('这个点位已经不在图层里了', true); return; }
        layerState[key].data = kept;
        if (!gonePois.some(function (g) { return g.k === key && g.id === fid; })) {
            gonePois.push({ k: key, id: fid, name: nm });
            saveGonePois();
        }
        map.closePopup();
        refreshLayer(key);
        updateCounts();
        refreshSearch();
        renderPoiRestoreBtn();
        if (!poiBatchDel) toast('已删除「' + nm + '」这一个点，图层与其它点保留');
    }
    function renderPoiRestoreBtn() {
        var btn = document.getElementById('btn-poi-restore');
        if (!btn) return;
        if (!gonePois.length) { btn.hidden = true; return; }
        btn.hidden = false;
        btn.textContent = '恢复已删点位（' + gonePois.length + '）';
    }
    function restoreGonePois() {
        if (!gonePois.length) return;
        var n = gonePois.length;
        gonePois = [];
        saveGonePois();
        GEO_KEYS.forEach(function (k) {
            if (k === 'road' || goneLayers[k]) return;
            layerState[k].data = (DATA[k] && DATA[k].features) || [];
            refreshLayer(k);
        });
        updateCounts();
        refreshSearch();
        renderPoiRestoreBtn();
        toast('已恢复 ' + n + ' 个被删点位');
    }
    // popup 里的「删除此点」走事件委托：按钮由 HTML 字符串生成，逐个绑定会随弹窗销毁丢失
    window.__poiGone = function () { return gonePois.slice(); };
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.pw-del') : null;
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        var k = b.getAttribute('data-poi-key');
        var id = b.getAttribute('data-poi-id');
        var nm = b.getAttribute('data-poi-name') || '';
        var ln = LAYER_CONFIG[k] ? LAYER_CONFIG[k].name : k;
        if (!window.confirm('删除「' + nm + '」这一个点？\n\n只删这一个要素，「' + ln + '」图层的其它点不受影响；刷新后它也不会再出现。\n\n可在图层管理下方的「恢复已删点位」一键还原。')) return;
        deletePoi(k, id);
    });

    // ---- v116 挑战 5：图层列表折叠（状态存 cd_layer_fold）----
    function initLayerFold() {
        var btn = document.getElementById('layer-fold');
        var panel = btn && btn.closest ? btn.closest('.panel') : null;
        if (!btn || !panel) return;
        var folded = false;
        try { folded = localStorage.getItem('cd_layer_fold') === '1'; } catch (e) { }
        panel.classList.toggle('folded', folded);
        btn.textContent = folded ? '▸' : '▾';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var now = !panel.classList.contains('folded');
            panel.classList.toggle('folded', now);
            btn.textContent = now ? '▸' : '▾';
            try { localStorage.setItem('cd_layer_fold', now ? '1' : '0'); } catch (e2) { }
        });
    }

    // ---- v116 挑战 2：图层列表拖拽排序（组内排序，内置顺序存 cd_layer_order）----
    var LAYER_ORDER_KEY = 'cd_layer_order';
    function loadLayerOrder() {
        try { var a = JSON.parse(localStorage.getItem(LAYER_ORDER_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    }
    function saveLayerOrder() {
        var list = document.getElementById('layer-list');
        if (!list) return;
        var keys = [];
        Array.prototype.forEach.call(list.querySelectorAll('.layer-item[data-layer]'), function (r) { keys.push(r.getAttribute('data-layer')); });
        try { localStorage.setItem(LAYER_ORDER_KEY, JSON.stringify(keys)); } catch (e) { }
    }
    function applyLayerOrder() {
        var list = document.getElementById('layer-list');
        if (!list) return;
        var order = loadLayerOrder();
        if (!order.length) return;
        var anchor = list.querySelector('.cluster-toggle');
        order.forEach(function (k) {
            if (BASE_KEYS.indexOf(k) < 0) return;
            var row = list.querySelector('.layer-item[data-layer="' + k + '"]');
            if (row && anchor) list.insertBefore(row, anchor);
        });
    }
    function bindLayerDrag() {
        var list = document.getElementById('layer-list');
        if (!list || list.getAttribute('data-drag') === '1') return;
        list.setAttribute('data-drag', '1');
        Array.prototype.forEach.call(list.querySelectorAll('.layer-item[data-layer]'), function (r) { r.draggable = true; });
        var dragRow = null;
        list.addEventListener('dragstart', function (e) {
            var row = e.target && e.target.closest ? e.target.closest('.layer-item[data-layer]') : null;
            if (!row) return;
            dragRow = row;
            row.classList.add('dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.getAttribute('data-layer')); } catch (e2) { }
        });
        list.addEventListener('dragover', function (e) {
            if (!dragRow) return;
            var row = e.target && e.target.closest ? e.target.closest('.layer-item[data-layer]') : null;
            if (!row || row === dragRow) return;
            e.preventDefault();
            var r = row.getBoundingClientRect();
            var after = e.clientY > r.top + r.height / 2;
            list.insertBefore(dragRow, after ? row.nextSibling : row);
        });
        list.addEventListener('drop', function (e) { if (dragRow) e.preventDefault(); });
        list.addEventListener('dragend', function () {
            if (!dragRow) return;
            dragRow.classList.remove('dragging');
            dragRow = null;
            saveLayerOrder();
            toast('图层顺序已保存');
        });
    }

    // ---- v122：删除整类（跨所有文件），旧入口保留兼容；新界面走 deleteCfPair（按文件内单类）----
    function deleteCfKind(k) {
        var hit = customFeatures.filter(function (f) { return cfKindOf(f) === k; });
        if (!hit.length) return;
        if (!window.confirm('删除全部「' + k + '」分类？跨 ' + hit.length + ' 个要素会被一并移除，图层、列表、搜索与图例同步清理')) return;
        if (cfEditing) stopCfEdit();
        cfDropSelWhere(function (f) { return cfKindOf(f) === k; });
        customFeatures = customFeatures.filter(function (f) { return cfKindOf(f) !== k; });
        Object.keys(cfPairOn).forEach(function (key) {
            if (key.indexOf('\u0001' + k) === key.length - k.length - 1) { try { delete cfPairOn[key]; } catch (e) { } }
        });
        saveCustom(); renderCustom(); syncCfCats(); updateCounts(); refreshSearch();
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        toast('已删除「' + k + '」共 ' + hit.length + ' 个要素');
    }

    // ---- v122：图层树（文件 → 地类），文件行管整层、地类行管单类 ----
    function buildCfLayerTree() {
        var tree = {}, order = [];
        customFeatures.forEach(function (f) {
            var s = cfSource(f), k = cfKindOf(f);
            if (!tree[s]) { tree[s] = { kinds: {}, list: [], ts: 1e15 }; order.push(s); }
            var t = tree[s];
            t.list.push(f);
            var ts = Number(f.ts) || 0;
            if (ts && ts < t.ts) t.ts = ts;
            if (!t.kinds[k]) t.kinds[k] = [];
            t.kinds[k].push(f);
        });
        var cfOrder = [];
        try { cfOrder = JSON.parse(localStorage.getItem('cd_cf_order') || '[]') || []; } catch (e) { cfOrder = []; }
        // 文件按首次导入时间排（老数据 ts 缺失时退化为名称排序），地类沿用 cd_cf_order 的顺序
        order.sort(function (a, b) { return (tree[a].ts - tree[b].ts) || String(a).localeCompare(String(b)); });
        var cfHeadOn = cfAllOn(), cfHeadSome = cfSomeOn();
        var html = '<div class="cf-layer-head group-head">' +
            '<input type="checkbox" id="chk-cf-all" data-cf-all="1"' + (cfHeadOn ? ' checked' : '') + (!cfHeadOn && cfHeadSome ? ' data-indet="1"' : '') + ' title="全选 / 隐藏我的图层全部要素">' +
            '<span>我的图层</span><span class="cf-layer-sub">' +
            order.length + ' 个文件 · ' + customFeatures.length + ' 个要素</span></div>';
        order.forEach(function (s) {
            var t = tree[s];
            var kindNames = Object.keys(t.kinds);
            kindNames.sort(function (a, b) {
                var oa = cfOrder.indexOf(a), ob = cfOrder.indexOf(b);
                if (oa >= 0 || ob >= 0) return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob);
                var ia = CF_KINDS.indexOf(a), ib = CF_KINDS.indexOf(b);
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });
            var onCount = kindNames.filter(function (k) { return cfPairOn[cfPairKey(s, k)] !== false; }).length;
            var reg = regionOfList(t.list);
            html += '<div class="cf-file-group">' +
                '<label class="cf-file-item">' +
                '<input type="checkbox" data-cf-src="' + esc(s) + '"' + (onCount ? ' checked' : '') + (onCount && onCount < kindNames.length ? ' data-indet="1"' : '') + '>' +
                '<span class="cf-file-name" title="导入文件：' + esc(s) + '">' + esc(s) + '</span>' +
                '<span class="cf-region" data-region="' + esc(reg) + '" title="按坐标判定的所属地区">' + esc(reg) + '</span>' +
                '<span class="count">' + t.list.length + '</span>' +
                '<button type="button" class="cf-layer-del" data-cf-del-src="' + esc(s) + '" title="删除图层「' + esc(s) + '」及其 ' + t.list.length + ' 个要素" aria-label="删除该图层">×</button>' +
                '</label>' +
                '<div class="cf-kind-subs">';
            kindNames.forEach(function (k) {
                var items = t.kinds[k];
                var on = cfPairOn[cfPairKey(s, k)] !== false;
                var rk = regionOfList(items);
                // 子行只在归属与所属文件不同时才亮地区徽标，避免三行连排「外地」的重复噪音
                var regHtml = (rk !== reg) ? '<span class="cf-region" data-region="' + esc(rk) + '">' + esc(rk) + '</span>' : '';
                html += '<label class="layer-item cf-layer-item cf-kind-sub">' +
                    '<input type="checkbox" data-cf-pair="' + esc(cfPairKey(s, k)) + '"' + (on ? ' checked' : '') + '>' +
                    '<span class="dot" style="background:' + cfColor(k) + '"></span>' +
                    '<span class="layer-name" title="' + esc(s) + ' · ' + esc(k) + '">' + esc(k) + '</span>' +
                    regHtml +
                    '<span class="count">' + items.length + '</span>' +
                    '<button type="button" class="cf-layer-del" data-cf-del-pair="' + esc(cfPairKey(s, k)) + '" title="删除「' + esc(s) + '」下的「' + esc(k) + '」（' + items.length + ' 个）">×</button>' +
                    '</label>';
            });
            html += '</div></div>';
        });
        return html;
    }
    function cfDropSelWhere(pred) {
        cfSelIds = cfSelIds.filter(function (id) {
            var f = cfById(id);
            return !!f && (!pred || !pred(f));
        });
        cfSelId = cfSelIds.length ? cfSelIds[cfSelIds.length - 1] : null;
        if (!cfSelIds.length) {
            var card = document.getElementById('cf-card');
            if (card) card.classList.remove('open');
            if (APP_MODE === 'select' || APP_MODE === 'edit' || APP_MODE === 'move') APP_MODE = 'idle';
        }
        updateCfSelBar();
    }
    // 删除整个导入图层（文件行 ×）
    function deleteCfFile(src) {
        var hit = customFeatures.filter(function (f) { return cfSource(f) === src; });
        if (!hit.length) return;
        if (!window.confirm('删除图层「' + src + '」？\n该图层下 ' + hit.length + ' 个要素会一起移除，图层行、搜索与图例同步清理')) return;
        if (cfEditing) stopCfEdit();
        cfDropSelWhere(function (f) { return cfSource(f) === src; });
        customFeatures = customFeatures.filter(function (f) { return cfSource(f) !== src; });
        Object.keys(cfPairOn).forEach(function (key) {
            if (key.indexOf(src + '\u0001') === 0) { try { delete cfPairOn[key]; } catch (e) { } }
        });
        saveCustom(); renderCustom(); syncCfCats(); updateCounts(); refreshSearch();
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        toast('已删除图层「' + src + '」共 ' + hit.length + ' 个要素');
    }
    // 删除某个文件下的单个地类（地类行 ×）
    function deleteCfPair(pair) {
        var sep = String(pair).indexOf('\u0001');
        if (sep < 0) return;
        var src = pair.slice(0, sep), kind = pair.slice(sep + 1);
        var hit = customFeatures.filter(function (f) { return cfSource(f) === src && cfKindOf(f) === kind; });
        if (!hit.length) return;
        if (!window.confirm('删除「' + src + '」下的「' + kind + '」？共 ' + hit.length + ' 个要素，删除后该地类行消失')) return;
        if (cfEditing) stopCfEdit();
        cfDropSelWhere(function (f) { return cfSource(f) === src && cfKindOf(f) === kind; });
        customFeatures = customFeatures.filter(function (f) { return !(cfSource(f) === src && cfKindOf(f) === kind); });
        try { delete cfPairOn[pair]; } catch (e) { }
        saveCustom(); renderCustom(); syncCfCats(); updateCounts(); refreshSearch();
        try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }
        toast('已删除「' + src + ' · ' + kind + '」共 ' + hit.length + ' 个要素');
    }

    // ---- 分类同步：图层管理动态分组 / 搜索类型下拉 / 图例色带 ----
    function syncCfCats() {
        var kinds = [];
        customFeatures.forEach(function (f) {
            var k = f.properties.kind || '设施点';
            if (kinds.indexOf(k) < 0) kinds.push(k);
        });
        var cfOrder = [];
        try { cfOrder = JSON.parse(localStorage.getItem('cd_cf_order') || '[]') || []; } catch (e) { cfOrder = []; }
        kinds.sort(function (a, b) {
            var oa = cfOrder.indexOf(a), ob = cfOrder.indexOf(b);
            if (oa >= 0 || ob >= 0) return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob);
            var ia = CF_KINDS.indexOf(a), ib = CF_KINDS.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });

        var list = document.getElementById('layer-list');
        var box = document.getElementById('cf-layer-box');
        if (list) {
            if (!box) {
                box = document.createElement('div');
                box.id = 'cf-layer-box';
                box.className = 'cf-layer-box';
                // v122：两级开关——文件行 = 该文件全部地类批量镜像；地类行 = 单个 source|kind
                box.addEventListener('change', function (e) {
                    var cb = e.target;
                    if (!cb || cb.type !== 'checkbox') return;
                    var src = cb.getAttribute('data-cf-src');
                    var pair = cb.getAttribute('data-cf-pair');
                    var all = cb.getAttribute('data-cf-all');
                    if (all !== null) {
                        setCfVisible(cb.checked);
                    } else if (src !== null) {
                        customFeatures.forEach(function (f) {
                            if (cfSource(f) === src) cfPairOn[cfPairKey(f)] = cb.checked;
                        });
                        renderCustom(); syncCfCats();
                    } else if (pair !== null) {
                        cfPairOn[pair] = cb.checked;
                        renderCustom(); syncCfCats();
                    } else return;
                    syncLayerActions();
                });
                // 删除钮：文件行删整层，地类行删该类；label 内点击会顺带勾选，必须拦掉
                box.addEventListener('click', function (e) {
                    var t = e.target;
                    if (!t || typeof t.getAttribute !== 'function') return;
                    var delSrc = t.getAttribute('data-cf-del-src');
                    var delPair = t.getAttribute('data-cf-del-pair');
                    if (delSrc === null && delPair === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (delSrc !== null) deleteCfFile(delSrc);
                    else deleteCfPair(delPair);
                });
                // 文件树排在「内置图层」整组之后（含聚合开关），内置与导入两组不交叉
                list.appendChild(box);
            }
            if (!customFeatures.length) {
                // 删掉最后一个要素后连内容一起清掉，避免重开面板闪出已不存在的行
                box.style.display = 'none';
                box.innerHTML = '';
            } else {
                box.style.display = '';
                box.innerHTML = buildCfLayerTree();
                Array.prototype.forEach.call(box.querySelectorAll('input[data-indet]'), function (el) { el.indeterminate = true; });
            }
        }

        var sel = document.getElementById('search-type');
        if (sel) {
            Array.prototype.slice.call(sel.querySelectorAll('option[data-cf="1"]')).forEach(function (o) { o.parentNode.removeChild(o); });
            kinds.forEach(function (k) {
                var o = document.createElement('option');
                o.value = k;
                o.textContent = '我的·' + k;
                o.setAttribute('data-cf', '1');
                sel.appendChild(o);
            });
            var baseVals = ['', 'school', 'hospital', 'scenic', 'road'];
            if (baseVals.indexOf(sel.value) < 0 && kinds.indexOf(sel.value) < 0) sel.value = '';
        }

        var lp = document.getElementById('legend-panel');
        if (lp) {
            Array.prototype.slice.call(lp.querySelectorAll('.cf-legend-row')).forEach(function (r) { r.parentNode.removeChild(r); });
            var note = lp.querySelector('.legend-note');
            kinds.forEach(function (k) {
                var row = document.createElement('div');
                row.className = 'legend-row cf-legend-row';
                row.innerHTML = '<span class="lg-dot" style="background:' + cfColor(k) + '"></span>我的·' + esc(k);
                if (note) lp.insertBefore(row, note); else lp.appendChild(row);
            });
        }
        if (typeof syncLayerActions === 'function') syncLayerActions();
    }
    function syncCfCounts() {
        var box = document.getElementById('cf-layer-box');
        if (!box) return;
        Array.prototype.forEach.call(box.querySelectorAll('.cf-kind-sub'), function (row) {
            var cb = row.querySelector('input[data-cf-pair]');
            if (!cb) return;
            var pair = cb.getAttribute('data-cf-pair');
            var n = customFeatures.filter(function (f) { return cfPairKey(f) === pair; }).length;
            var cnt = row.querySelector('.count');
            if (cnt) cnt.textContent = n;
        });
        Array.prototype.forEach.call(box.querySelectorAll('.cf-file-item'), function (row) {
            var cb = row.querySelector('input[data-cf-src]');
            if (!cb) return;
            var src = cb.getAttribute('data-cf-src');
            var n = customFeatures.filter(function (f) { return cfSource(f) === src; }).length;
            var cnt = row.querySelector('.count');
            if (cnt) cnt.textContent = n;
        });
    }

    // ---- 详情卡（属性表单 + 操作）----
    (function injectCfCard() {
        if (document.getElementById('cf-card')) return;
        var card = document.createElement('div');
        card.id = 'cf-card';
        card.className = 'mark-panel cf-card';
        card.innerHTML =
            '<div class="settings-title">自建要素详情<span class="settings-close" id="cf-close" title="关闭">×</span></div>' +
            '<div class="cf-badge" id="cf-badge"></div>' +
            '<div class="set-row"><span class="set-name" style="width:52px">名称</span><input type="text" id="cf-name" maxlength="24"></div>' +
            '<div class="set-row"><span class="set-name" style="width:52px">类型</span><select id="cf-kind">' +
            CF_KINDS.map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join('') +
            '</select></div>' +
            '<textarea id="cf-remark" class="cf-remark" placeholder="备注（选填，如：现场核对 / 待补充开放时间）"></textarea>' +
            '<div class="cf-btns">' +
            '<button type="button" id="cf-save" class="mark-btn small">保存属性</button>' +
            // v114 P2-4 续：卡片三个几何按钮也换图标 + 悬浮提示，「保存属性」保留文字（主操作需要有字）
            '<button type="button" id="cf-shape" class="mark-btn small ghost cf-ico" title="改形状（拖顶点改轮廓）" aria-label="改形状"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18.5 9.5l-4-4L4 16v4z"/><path d="M14.5 5.5l4 4"/></svg></button>' +
            '</div>' +
            '<div class="cf-btns">' +
            '<button type="button" id="cf-move" class="mark-btn small ghost cf-ico" title="整体移动（拖动整个要素）" aria-label="整体移动"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M2.5 12h19"/><path d="M9 5.5L12 2.5l3 3M9 18.5l3 3 3-3M5.5 9l-3 3 3 3M18.5 9l3 3-3 3"/></svg></button>' +
            '<button type="button" id="cf-del" class="mark-btn small danger cf-ico" title="删除该要素" aria-label="删除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M7.5 7l1 12.5h7l1-12.5"/></svg></button>' +
            '</div>' +
            '<div class="cf-editmod-note">改形状 / 移动 / 删除受「编辑权限」控制</div>' +
            '<div id="cf-hint" class="mark-status"></div>';
        var host = document.getElementById('map') || document.body;
        host.appendChild(card);
        ['mousedown', 'pointerdown', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend'].forEach(function (t) {
            card.addEventListener(t, function (e) { e.stopPropagation(); });
        });
        document.getElementById('cf-close').addEventListener('click', function () { clearCfSel(); });
        document.getElementById('cf-save').addEventListener('click', saveCfCard);
        document.getElementById('cf-shape').addEventListener('click', function () {
            if (cfEditing && cfEditing.handles) { stopCfEdit(); return; }
            var f = cfById(cfSelId);
            if (f) startShapeEdit(f);
        });
        document.getElementById('cf-move').addEventListener('click', function () {
            var f = cfById(cfSelId);
            if (f) startMoveFeature(f);
        });
        document.getElementById('cf-del').addEventListener('click', function () {
            if (cfSelId !== null) deleteCf(cfSelId);
        });
    })();

    // 空点地图 → 取消选中（多选与单选一起清）
    map.on('click', function (e) {
        if (uiHit(e)) return;
        if (markMode || measure.mode || cfEditing) return;
        if (Date.now() - cfHitTs < 90) return;   // v114：这一下点中的是自建要素，不是空白
        // v122：Shift 点空白 / 点到内置图层时保留已经攒起来的多选，否则一次误点就全清
        if (e.originalEvent && e.originalEvent.shiftKey) return;
        if (cfSelIds.length || cfSelId !== null) clearCfSel();
    });

    syncCfCats();
    renderCustom();
    try { if (window.__renderMarkList) window.__renderMarkList(); } catch (e) { }

    // ---------------- 14. 启动 ----------------
    loadGoneLayers();
    loadGonePois();
    // v116 挑战 2 / 挑战 5：图层顺序记忆 + 折叠记忆 + 拖拽绑定
    applyLayerOrder();
    bindLayerDrag();
    initLayerFold();
    applyPack(themeState.pack);
    if (themeState.on) document.getElementById('petal-wrap').classList.add('on');
    syncSetToggles();
    var loaders = GEO_KEYS.map(function (k) {
        return fetchOrEmbed(k).then(function () {
            layerState[k].data = (DATA[k] && DATA[k].features) || [];
        });
    });
    Promise.all(loaders).then(function () {
        // v116：把历史上整层删除过的图层保持为空，再统一重建
        applyGoneLayers();
        // v117b：再把历史上单点删除过的点位过滤掉（整层删除优先）
        applyGonePois();
        renderBuiltinDelBtns();
        renderRestoreBtn();
        renderPoiRestoreBtn();
        var rBtn = document.getElementById('btn-layer-restore');
        if (rBtn) rBtn.addEventListener('click', restoreGoneLayers);
        var pBtn = document.getElementById('btn-poi-restore');
        if (pBtn) pBtn.addEventListener('click', restoreGonePois);
        buildSearchIndex();
        refreshAllLayers();
        if (typeof syncLayerActions === 'function') syncLayerActions();
        fitDataView();
        map.invalidateSize();
        console.log('常德市城市公共服务WebGIS系统（Leaflet + OpenStreetMap）初始化完成');
    });
})();


// ================= v123：地图交互期背景模糊降载 =================
// 不依赖 map 实例（它是主 IIFE 的局部变量）：直接吃 Leaflet 加到 body 上的 leaflet-dragging，
// 松手后留 240ms 缓冲（Leaflet 的惯性滑动仍在跑，立即恢复会再逐帧重采样）。
(function () {
    if (!window.MutationObserver) return;
    var busyT = null, was = false;
    function on() {
        if (busyT) { clearTimeout(busyT); busyT = null; }
        document.body.classList.add('nav-busy');
    }
    function off() {
        if (busyT) clearTimeout(busyT);
        busyT = setTimeout(function () {
            document.body.classList.remove('nav-busy');
            busyT = null;
        }, 240);
    }
    var mo = new MutationObserver(function () {
        var now = document.body.classList.contains('leaflet-dragging');
        if (now === was) return;
        was = now;
        if (now) { on(); } else { off(); }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();

// ================= v93：卡片/面板过渡动画减负 =================
// 面板/弹窗 open-close 及交互动画期间（340ms）临时移除 backdrop-filter 与光晕 filter，
// 动画退化为纯 transform/opacity 合成，杜绝逐帧重算 backdrop 导致的点击卡顿；
// 动画结束后自动恢复玻璃质感。点击面板任意位置触发（捕获阶段，含打开/关闭/内部交互）。
(function () {
    var ANIM_SEL = '.iw-card, .settings-panel, .basemap-panel, .mark-panel, .legend-panel, .records-panel, .cl-card, .measure-result, .map-toast, .toolbar';
    function nobf(el) {
        if (!el || !el.classList) return;
        el.classList.add('anim-nobf');
        clearTimeout(el.__nobfT);
        el.__nobfT = setTimeout(function () { el.classList.remove('anim-nobf'); }, 340);
    }
    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest(ANIM_SEL) : null;
        if (el) nobf(el);
    }, true);

    
    })();






















