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
        el.className = 'map-toast' + (isErr ? ' err' : '');
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
        attributionControl: true
    });
    // 底图多源链：高德矢量/栅格（GCJ-02，国内最快最稳）→ OSM（WGS-84）
    // 同坐标系内先切换（高德矢量→高德栅格，数据不重绘、无缝），跨坐标系才重绘数据
    // v54：裁剪掉易丢瓦片的 CartoDB / ArcGIS 源，保留三个稳定源
    var TILE_CHAIN = [
        { url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', name: '高德·矢量', gcj: true, maxZoom: 18, attr: '&copy; <a href="https://www.amap.com/">高德地图</a> &copy; OpenStreetMap &copy; CARTO' },
        { url: 'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', name: '高德·栅格', gcj: true, maxZoom: 18, attr: '&copy; <a href="https://www.amap.com/">高德地图</a> &copy; OpenStreetMap &copy; CARTO' },
        { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', name: 'OSM', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }
    ];
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
            maxZoom: mz, maxNativeZoom: mz, subdomains: '1234',
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
            if (geoLastBest) renderLoc(L.latLng(geoLastBest.lat, geoLastBest.lng), geoLastBest.acc, geoLastBest.src || '', 'gps', false);
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
    function userRoadPopupHtml(r) {
        var n = (r.coordinates || []).length;
        var dt = r.ts ? new Date(r.ts).toLocaleString() : '';
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:#6d28d9">我的标注 · ' + esc(r.street || r.name) + '</div>' +
            '<div class="pw-row"><span class="pw-k">点数</span><span class="pw-v">' + n + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">坐标系</span><span class="pw-v">' + esc(r.crs || 'GCJ-02') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">底图</span><span class="pw-v">' + esc(r.basemap || '-') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">时间</span><span class="pw-v">' + esc(dt) + '</span></div></div>';
    }

    function pointPopupHtml(key, p) {
        var c = LAYER_CONFIG[key];
        var rows = [
            ['名称', p.name], ['类别', p.type || '-'], ['区域', p.adname || '-'],
            ['地址', p.address || '-'], ['来源', p.source || '-']
        ].map(function (r) {
            return '<div class="pw-row"><span class="pw-k">' + r[0] + '</span><span class="pw-v">' + esc(r[1]) + '</span></div>';
        }).join('');
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:' + c.color + '">' + esc(p.name) + '</div>' + rows + '</div>';
    }
    function roadPopupHtml(p) {
        return '<div class="pw-box"><div class="pw-t" style="border-left-color:#d97706">' + esc(p.name) + '</div>' +
            '<div class="pw-row"><span class="pw-k">类别</span><span class="pw-v">' + esc(p.type || '主干道') + '</span></div>' +
            '<div class="pw-row"><span class="pw-k">长度</span><span class="pw-v">' + (p.len_km != null ? p.len_km + ' 公里' : '-') + '</span></div>' +
            '</div>';
    }

    // 类别图标（白色符号，彩色圆底）
    var CAT_ICONS = {
        school: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3L1 9l11 6 9-4.9V17h2V9L12 3zm0 12.5L5 13v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4l-7 3.5z"/></svg>',
        hospital: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"/></svg>',
        scenic: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 19l7-9 5 6 3-3 5 6H2z"/></svg>'
    };
    function makePointMarker(key, feat) {
        var p = feat.properties;
        var coords = feat.geometry.coordinates;
        var c = LAYER_CONFIG[key];
        var icon = L.divIcon({
            className: 'poi-icon-wrap',
            html: '<div class="poi-icon poi-' + key + '">' + (CAT_ICONS[key] || '') + '</div>',
            iconSize: [18, 18], iconAnchor: [9, 9]
        });
        return L.marker(toMapCoord(coords), { icon: icon })
            .bindTooltip(p.name, { direction: 'top', offset: [0, -10], className: 'poi-tip' })
            .bindPopup(pointPopupHtml(key, p), { autoPan: true, maxWidth: 280 });
    }

    function makeCluster(key) {
        return L.markerClusterGroup({
            maxClusterRadius: 60,
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
        feats.forEach(function (f) {
            var coords = f.geometry.coordinates;
            var p = f.properties;
            g.addLayer(L.circleMarker(toMapCoord(coords), {
                radius: 5, color: LAYER_CONFIG[key].color, weight: 1.5,
                fillColor: LAYER_CONFIG[key].color, fillOpacity: 0.85
            }).bindTooltip(p.name, { direction: 'top', offset: [0, -8], className: 'poi-tip' })
                .bindPopup(pointPopupHtml(key, p), { autoPan: true, maxWidth: 280 }));
        });
        return g;
    }

    function buildLinesLayer() {
        var g = L.layerGroup();
        // 同名替代：用户打点道路（如"武陵大道"）优先于内置同名线
        var userNames = {};
        userRoads.forEach(function (r) { userNames[r.street || r.name] = true; });
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
        // 用户打点道路（紫色虚线，实时入库后立即参与显示）
        userRoads.forEach(function (r) {
            var coords = (r.coordinates || []).map(function (c) { return toMapCoord(c); });
            if (coords.length < 2) return;
            g.addLayer(L.polyline(coords, {
                color: '#ffffff', weight: 7, opacity: 0.35,
                lineJoin: 'round', lineCap: 'round'
            }));
            var line = L.polyline(coords, {
                color: '#6d28d9', weight: 4, opacity: 0.95, dashArray: '9 6',
                lineJoin: 'round', lineCap: 'round'
            }).bindPopup(userRoadPopupHtml(r), { autoPan: true, maxWidth: 300 });
            line.on('mouseover', function () { line.setStyle({ weight: 6.5, opacity: 1 }); });
            line.on('mouseout', function () { line.setStyle({ weight: 4, opacity: 0.95, dashArray: '9 6' }); });
            g.addLayer(line);
            var mid = coords[Math.floor(coords.length / 2)];
            g.addLayer(L.tooltip({
                permanent: true, direction: 'center', className: 'road-tag user-road-tag', opacity: 1
            }).setContent('我的·' + (r.street || r.name)).setLatLng(mid));
        });
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
            // 用户打点道路计入视野计数
            n += userRoads.filter(function (r) {
                return (r.coordinates || []).some(function (c) { return b.contains(toMapCoord(c)); });
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
        });
    }
    GEO_KEYS.forEach(bindLayerCheck);
    document.getElementById('btn-all').addEventListener('click', function () {
        GEO_KEYS.forEach(function (k) { document.getElementById('chk-' + k).checked = true; layerState[k].visible = true; });
        document.getElementById('chk-cluster').checked = true; clusterEnabled = true;
        refreshAllLayers();
        syncLegend(); syncSetToggles();
    });
    document.getElementById('btn-none').addEventListener('click', function () {
        GEO_KEYS.forEach(function (k) { document.getElementById('chk-' + k).checked = false; layerState[k].visible = false; });
        refreshAllLayers();
        syncLegend();
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
    }
    var searchResultEl = document.getElementById('search-result');
    var searchInput = document.getElementById('search-input');
    var searchType = document.getElementById('search-type');
    function runSearch() {
        var q = (searchInput.value || '').trim();
        var type = searchType.value;
        var hits = searchIdx.filter(function (it) {
            if (type && it.key !== type) return false;
            return it.name.toLowerCase().indexOf(q.toLowerCase()) >= 0;
        }).slice(0, 30);
        if (!q) { searchResultEl.innerHTML = ''; searchResultEl.hidden = true; return; }
        if (!hits.length) {
            searchResultEl.innerHTML = '<div class="sr-none">未找到匹配地点</div>';
            searchResultEl.hidden = false;
            return;
        }
        searchResultEl.innerHTML = hits.map(function (it, i) {
            return '<div class="sr-item" data-i="' + i + '"><span class="sr-name">' + esc(it.name) + '</span><span class="sr-type" style="color:' + LAYER_CONFIG[it.key].color + '">' + LAYER_CONFIG[it.key].name + '</span></div>';
        }).join('');
        searchResultEl.hidden = false;
        Array.prototype.forEach.call(searchResultEl.querySelectorAll('.sr-item'), function (el) {
            el.addEventListener('click', function () {
                var it = hits[+el.getAttribute('data-i')];
                if (!it) return;
                if (!layerState[it.key].visible) {
                    document.getElementById('chk-' + it.key).checked = true;
                    layerState[it.key].visible = true;
                    refreshLayer(it.key);
                }
                locateFeature(it.key, it.feat);
                closeDrawer();
            });
        });
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
        if (target && target.openPopup) target.openPopup();
        else if (key === 'road' && linesLayer) {
            linesLayer.eachLayer(function (ly) {
                if (!target && ly.getLatLng && ly.getLatLng().lat === ll[0] && ly.getLatLng().lng === ll[1]) target = ly;
            });
            if (!target) {
                linesLayer.eachLayer(function (ly) { if (!target && ly.getLatLng) target = ly; });
            }
            if (target && target.openPopup) target.openPopup();
        }
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
            showMeasure('距离：' + (measure.total / 1000).toFixed(3) + ' 公里（双击结束）', false);
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
            showMeasure('总距离：' + (measure.total / 1000).toFixed(3) + ' 公里');
            if (window._recordsAdd) window._recordsAdd('dist', '总距离', (measure.total / 1000).toFixed(3) + ' 公里', measure.pts.slice());
        } else if (measure.pts.length >= 3) {
            if (measure.line) map.removeLayer(measure.line);
            measure.poly = L.polygon(measure.pts, { color: '#059669', weight: 2, fillColor: '#059669', fillOpacity: 0.15 });
            map.addLayer(measure.poly);
            var area = polygonAreaM2(measure.pts);
            showMeasure('面积：' + (area / 1000000).toFixed(3) + ' 平方公里');
            if (window._recordsAdd) window._recordsAdd('area', '面积', (area / 1000000).toFixed(3) + ' 平方公里', measure.pts.slice());
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
    document.getElementById('btn-distance').addEventListener('click', function () {
        if (measure.mode) { clearMeasure(); return; }
        clearMeasure();
        measure.mode = 'dist';
        this.classList.add('active');
        // v76：激活测量工具即显示测量卡片（操作提示），默认不显示；清除/退出自动隐藏
        showMeasure('单击地图添加测量点，双击结束并显示总距离', false);
    });
    document.getElementById('btn-area').addEventListener('click', function () {
        if (measure.mode) { clearMeasure(); return; }
        clearMeasure();
        measure.mode = 'area';
        this.classList.add('active');
        // v76：激活测量工具即显示测量卡片（操作提示），默认不显示；清除/退出自动隐藏
        showMeasure('单击地图添加顶点，双击闭合计算面积', false);
    });
    document.getElementById('btn-clear').addEventListener('click', clearMeasure);
    // 「完成测量」按钮（手机端无法双击结束，必须有明确结束入口）
    var measureDoneBtn = document.getElementById('measure-done');
    if (measureDoneBtn) measureDoneBtn.addEventListener('click', function () {
        if (measure.mode === 'dist') {
            showMeasure('总距离：' + (measure.total / 1000).toFixed(3) + ' 公里');
            if (window._recordsAdd) window._recordsAdd('dist', '总距离', (measure.total / 1000).toFixed(3) + ' 公里', measure.pts.slice());
        } else if (measure.mode === 'area' && measure.pts.length >= 3) {
            if (measure.line) map.removeLayer(measure.line);
            measure.poly = L.polygon(measure.pts, { color: '#059669', weight: 2, fillColor: '#059669', fillOpacity: 0.15 });
            map.addLayer(measure.poly);
            var area = polygonAreaM2(measure.pts);
            showMeasure('面积：' + (area / 1000000).toFixed(3) + ' 平方公里');
            if (window._recordsAdd) window._recordsAdd('area', '面积', (area / 1000000).toFixed(3) + ' 平方公里', measure.pts.slice());
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
            basemapPanel.hidden = !basemapPanel.hidden;
            if (!basemapPanel.hidden) paintBasemapSel();
        });
        document.getElementById('basemap-close').addEventListener('click', function () { basemapPanel.hidden = true; try { hideMeasureCard(); } catch (e) { } });
        basemapPanel.querySelectorAll('.bm-item').forEach(function (it) {
            it.addEventListener('click', function () {
                var idx = parseInt(it.getAttribute('data-idx'));
                if (idx === tileIdx) { basemapPanel.hidden = true; return; }
                activateTile(idx, true);
                basemapLocked = true;
                paintBasemapSel();
                try { localStorage.setItem('cd_basemap', idx); } catch (e) { }
                toast('已切换为「' + TILE_CHAIN[idx].name + '」底图（已锁定，不再自动跳变）');
                basemapPanel.hidden = true;
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
    var btnMark = document.getElementById('btn-mark');
    var markPanel = document.getElementById('mark-panel');
    function exitMark() {
        markMode = false;
        markEditingId = null;
        if (btnMark) btnMark.classList.remove('active');
        if (markLayer) { map.removeLayer(markLayer); markLayer = null; }
        if (markLine) { map.removeLayer(markLine); markLine = null; }
        markPts = [];
    }
    // 载入已有道路为可编辑草稿（节点可拖动，完成后更新原记录）
    function loadUserRoadForEdit(r) {
        if (measure.mode) clearMeasure();
        markEditingId = r.id;
        markStreet = r.street || r.name;
        markPts = (r.coordinates || []).map(function (c) { return [c[1], c[0]]; });
        markMode = true;
        btnMark.classList.add('active');
        document.getElementById('mark-name').value = markStreet;
        document.getElementById('mark-ops').hidden = false;
        document.getElementById('mark-export').value = '';
        document.getElementById('mark-copy').hidden = true;
        markPanel.hidden = false;
        paintMarkDots();
        document.getElementById('mark-status').textContent =
            '编辑「' + markStreet + '」：拖动节点调整位置、点击可加点、撤销可删点，完成后更新原记录';
        toast('已载入「' + markStreet + '」进入编辑模式：拖动节点微调');
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
            markLine = L.polyline(markPts, { color: '#2563eb', weight: 3, opacity: .85, dashArray: '2 8' });
            map.addLayer(markLine);
        }
        map.addLayer(markLayer);
        document.getElementById('mark-status').textContent =
            '「' + markStreet + '」已打 ' + markPts.length + ' 个点' +
            (markPts.length >= 2 ? '，继续沿线点击加点（节点可拖动调整）' : '，继续沿道路点击添加节点');
    }
    map.on('click', function (e) {
        if (uiHit(e)) return; // v75：卡片/面板内点击不触发打点
        if (!markMode) return;
        markPts.push([e.latlng.lat, e.latlng.lng]);
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
            markPanel.hidden = !markPanel.hidden;
            if (markPanel.hidden && markMode) { exitMark(); toast('打点已退出'); }
        });
        document.getElementById('mark-close').addEventListener('click', function () {
            markPanel.hidden = true;
            if (markMode) { exitMark(); toast('打点已退出'); }
        });
        document.getElementById('mark-start').addEventListener('click', function () {
            var name = (document.getElementById('mark-name').value || '').trim();
            if (!name) { toast('请先输入街道名称', true); return; }
            if (measure.mode) clearMeasure();
            markStreet = name; markPts = []; markMode = true; markEditingId = null;
            btnMark.classList.add('active');
            document.getElementById('mark-ops').hidden = false;
            document.getElementById('mark-export').value = '';
            document.getElementById('mark-copy').hidden = true;
            paintMarkDots();
            toast('开始为「' + name + '」打点：单击地图沿线添加节点');
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
            toast('已清空当前打点节点（已入库的 ' + userRoads.length + ' 条标注道路仍保留，删除请用「清空全部」）');
        });
        document.getElementById('mark-done').addEventListener('click', function () {
            if (!markMode) return;
            if (markPts.length < 2) { toast('至少需要 2 个点才能构成道路线', true); return; }
            var coords = markPts.map(function (p) {
                return [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6];
            });
            var rec = {
                id: markEditingId || Date.now(),
                street: markStreet,
                crs: gcjMode ? 'GCJ-02' : 'WGS-84',
                basemap: TILE_CHAIN[tileIdx].name,
                ts: Date.now(),
                coordinates: coords
            };
            var isEdit = !!markEditingId;
            markEditingId = null;
            if (isEdit) {
                var idx = -1;
                for (var k = 0; k < userRoads.length; k++) { if (userRoads[k].id === rec.id) { idx = k; break; } }
                if (idx >= 0) userRoads[idx] = rec; else { isEdit = false; userRoads.push(rec); }
            } else {
                userRoads.push(rec);
            }
            saveUserRoads();
            markMode = false;
            btnMark.classList.remove('active');
            // 完成入库后自动清理草稿显示：序号点 + 蓝色预览线一并移除，只保留入库的紫色虚线
            if (markLayer) { map.removeLayer(markLayer); markLayer = null; }
            if (markLine) { map.removeLayer(markLine); markLine = null; }
            markPts = [];
            document.getElementById('mark-ops').hidden = true;
            if (layerState.road.visible) refreshLayer('road');
            updateCounts();
            renderMarkList();
            var txt = JSON.stringify(rec, null, 2);
            document.getElementById('mark-export').value = txt;
            document.getElementById('mark-copy').hidden = false;
            document.getElementById('mark-status').textContent =
                (isEdit ? '已更新「' : '「') + markStreet + (isEdit ? '」标注道路（' : '」已存入我的道路点库（共 ') + userRoads.length + ' 条），紫色虚线已显示在地图上；序号点已自动清除，可复制 JSON 或继续打点';
            toast((isEdit ? '已更新「' : '已存入「') + markStreet + '」，将自动合入网站正式数据');
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
            var sec = document.getElementById('mark-sec');
            var list = document.getElementById('mark-list');
            if (!sec || !list) return;
            document.getElementById('mark-sec-n').textContent = userRoads.length;
            list.innerHTML = '';
            if (!userRoads.length) {
                list.innerHTML = '<div class="mark-empty">暂无标注道路：输入名称 → 开始打点 → 完成即自动入库</div>';
                return;
            }
            userRoads.forEach(function (r, i) {
                var row = document.createElement('div');
                row.className = 'mark-item';
                var isMerged = mergedNames && mergedNames.indexOf(r.street || r.name) >= 0;
                row.innerHTML =
                    '<span class="mi-name">我的·' + esc(r.street || r.name) + '</span>' +
                    (isMerged ? '<span class="mi-badge">已合入</span>' : '<span class="mi-badge wait">待合入</span>') +
                    '<span class="mi-meta">' + (r.coordinates || []).length + '点·' + esc(r.crs || '') + '</span>' +
                    '<span class="mi-ops">' +
                    '<button data-act="edit" class="mi-btn" title="编辑这条道路（载入草稿，节点可拖动）">改</button>' +
                    '<button data-act="del" class="mi-btn" title="删除这条标注道路">删</button>' +
                    '<button data-act="exp" class="mi-btn" title="导出这条道路 JSON">导出</button>' +
                    '</span>';
                row.querySelector('[data-act=edit]').addEventListener('click', function () {
                    loadUserRoadForEdit(userRoads[i]);
                });
                row.querySelector('[data-act=del]').addEventListener('click', function () {
                    userRoads.splice(i, 1);
                    saveUserRoads();
                    if (layerState.road.visible) refreshLayer('road');
                    updateCounts();
                    renderMarkList();
                    toast('已删除「' + (r.street || r.name) + '」标注道路');
                });
                row.querySelector('[data-act=exp]').addEventListener('click', function () {
                    document.getElementById('mark-export').value = JSON.stringify(r, null, 2);
                    document.getElementById('mark-copy').hidden = false;
                    toast('「' + (r.street || r.name) + '」JSON 已生成，可复制');
                });
                list.appendChild(row);
            });
        }
        document.getElementById('mark-export-all').addEventListener('click', function () {
            if (!userRoads.length) { toast('暂无标注道路可导出', true); return; }
            var payload = {
                generated: new Date().toISOString(),
                crs_note: '高德底图下为GCJ-02（与 road.geojson 一致）；导出后可直接合并入库',
                roads: userRoads
            };
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '我的道路点库.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
            toast('已下载「我的道路点库.json」（' + userRoads.length + ' 条），发送给开发者即可合入数据');
        });
        document.getElementById('mark-clear-all').addEventListener('click', function () {
            if (!userRoads.length) return;
            if (!window.confirm('确定清空全部 ' + userRoads.length + ' 条标注道路？此操作不可恢复')) return;
            userRoads = [];
            saveUserRoads();
            if (layerState.road.visible) refreshLayer('road');
            updateCounts();
            renderMarkList();
            toast('已清空全部标注道路');
        });
        renderMarkList();
        ensureMergedNames();
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
                showMeasure(measure.pts.length >= 2 ? '距离：' + (measure.total / 1000).toFixed(3) + ' 公里（双击结束）' : '单击地图添加测量点（双击结束）', false);
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
        userRoads.forEach(function (r) {
            (r.coordinates || []).forEach(function (c) { bounds.extend(toMapCoord(c)); any = true; });
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
    function rebuildPetals() {
        var wrap = document.getElementById('petal-wrap');
        if (!wrap) return;
        var p = PACKS[themeState.pack];
        var r = themeState.rhythm;              // 1-10：越大越密越快
        var count = 6 + r * 2;                  // 8 ~ 26 片
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
                    if (l.setStyle) l.setStyle({ color: LAYER_CONFIG[key].color, fillColor: LAYER_CONFIG[key].color });
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
        night: '<path d="M12 2 L14.6 8.4 L21.4 8.4 L15.9 12.6 L18.4 19 L12 15 L5.6 19 L8.1 12.6 L2.6 8.4 L9.4 8.4 Z"/>'
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
        var cls = ['theme-peach', 'theme-osmanthus', 'theme-leaf', 'theme-rose', 'theme-night'];
        document.body.classList.remove.apply(document.body.classList, cls);
        document.body.classList.add('theme-' + packKey);
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
    function applyGlass() {
        var blur = setBlur.value, alpha = setAlpha.value, sat = setSat ? setSat.value : 150;
        // 可读性边界保护：低模糊度时自动提升背景不透明度，避免文字无法识别
        if (blur < 6 && alpha < 60) alpha = 60;
        document.documentElement.style.setProperty('--glass-blur', blur + 'px');
        document.documentElement.style.setProperty('--glass-alpha', (alpha / 100).toFixed(2));
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
        if (settingsPanel) settingsPanel.hidden = true;
        if (btnSettings) btnSettings.classList.remove('active');
        toggleSettingsBackdrop(false);
    });
    function jellyPulse() {
        if (!settingsPanel) return;
        settingsPanel.classList.remove('jelly');
        void settingsPanel.offsetWidth;
        settingsPanel.classList.add('jelly');
    }
    if (btnSettings && settingsPanel) {
        btnSettings.addEventListener('click', function () {
            settingsPanel.hidden = !settingsPanel.hidden;
            btnSettings.classList.toggle('active', !settingsPanel.hidden);
            if (!settingsPanel.hidden) {
                if (!isMobileDevice) jellyPulse();
                toggleSettingsBackdrop(true);
            } else {
                toggleSettingsBackdrop(false);
            }
        });
        document.getElementById('settings-close').addEventListener('click', function () {
            settingsPanel.hidden = true;
            btnSettings.classList.remove('active');
            toggleSettingsBackdrop(false);
            try { hideMeasureCard(); } catch (e) { }
        });
        setBlur.addEventListener('input', function () { applyGlass(); if (!isMobileDevice) jellyPulse(); });
        setAlpha.addEventListener('input', function () { applyGlass(); if (!isMobileDevice) jellyPulse(); });
        if (setSat) setSat.addEventListener('input', function () { applyGlass(); if (!isMobileDevice) jellyPulse(); });
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
            setBlur.value = 14; setAlpha.value = 85; if (setSat) setSat.value = 150;
            applyGlass();
            applyPack('peach');
            if (setRhythm) { setRhythm.value = 5; setRhythm.dispatchEvent(new Event('input', { bubbles: true })); }
            if (!isMobileDevice) jellyPulse();
            toast('已恢复默认（毛玻璃默认值 + 桃花材质包）');
        });
        try {
            var g = JSON.parse(localStorage.getItem('cd_glass') || 'null');
            if (g && g.blur !== undefined) { setBlur.value = g.blur; setAlpha.value = g.alpha; if (g.sat !== undefined && setSat) setSat.value = g.sat; applyGlass(); }
        } catch (e) { }
    }

    // ---------------- 13.5 更新日志（点击顶部版本号打开） ----------------
    var CHANGELOG = [
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
        { v: 'v99', t: '材质包→地图底图联动着色（tile-pane 主题色叠加）', pts: ['收到「地图还是其他材质的样子」——切换材质包只有 UI 变色、地图底图完全不变（此前仅夜间有 .45 深色遮罩）。v99 给每套材质包定义 --map-tint：桃花 rgba(216,93,140,.16) / 桂花 rgba(214,128,26,.14) / 绿叶 rgba(34,130,80,.13) / 玫瑰 rgba(210,32,92,.14) 低透明主题色，夜间沿用 .45 深色遮罩，综合透明', '实现：tile-pane 单层伪元素 background:var(--map-tint)——纯 CSS 一次合成、pointer-events none、z-index 10 只盖瓦片（POI/聚合/标注在上层不受影响）、零逐帧开销、切换 0.5s 平滑过渡；夜间特化规则（特异性更高）仍保证 .45 深色优先——切换材质包时地图底图可见地随主题染色'] }
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
                '<div class="cl-row-points">' + c.pts.map(function (p) { return '· ' + p; }).join('<br>') + '</div></div></div>';
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
        // 预设联动：强度 0% / 50% / 100% 三段锚点 → 轻薄半透 / Apple 中等通透 / 厚重磨砂高反光
        var P0 = { blur: 6, alpha: 70, sheen: 0.3, shadow: 0.3 };
        var P50 = { blur: 14, alpha: 85, sheen: 0.9, shadow: 1.0 };
        var P100 = { blur: 30, alpha: 97, sheen: 1.5, shadow: 1.6 };
        function clamp(v, mn, mx) { return Math.max(mn, Math.min(v, mx)); }
        function presetAt(g) {
            var a = g < 50 ? { from: P0, to: P50, t: g / 50 } : { from: P50, to: P100, t: (g - 50) / 50 };
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
            docEl.style.setProperty('--glass-alpha', (Math.max(v.alpha, v.blur < 6 ? 60 : v.alpha) / 100).toFixed(2)); // 可读性边界保护
            docEl.style.setProperty('--glass-sheen', v.sheen.toFixed(2));
            docEl.style.setProperty('--glass-shadow', v.shadow.toFixed(2));
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
        // 高级微调 → 写变量 + 反推主滑杆相对强度（双向联动）
        function applyAdv() {
            var v = {
                blur: clamp(parseFloat(adv.blur.value), 0, 40),
                alpha: clamp(parseFloat(adv.alpha.value), 25, 100),
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


    // ---------------- 14. 启动 ----------------
    loadTheme();
    applyPack(themeState.pack);
    if (themeState.on) document.getElementById('petal-wrap').classList.add('on');
    syncSetToggles();
    var loaders = GEO_KEYS.map(function (k) {
        return fetchOrEmbed(k).then(function () {
            layerState[k].data = (DATA[k] && DATA[k].features) || [];
        });
    });
    Promise.all(loaders).then(function () {
        buildSearchIndex();
        refreshAllLayers();
        fitDataView();
        map.invalidateSize();
        console.log('常德市城市公共服务WebGIS系统（Leaflet + OpenStreetMap）初始化完成');
    });
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

