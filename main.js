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
    function showMeasure(msg) {
        var el = document.getElementById('measure-result');
        if (!el) return;
        el.textContent = msg;
        el.hidden = false;
        clearTimeout(showMeasure._t);
        showMeasure._t = setTimeout(function () { el.hidden = true; }, 6000);
    }

    // ---------------- 3. 地图（Leaflet + OSM） ----------------
    var map = L.map('map', {
        center: [29.045, 111.69],
        zoom: 13,
        zoomControl: false,
        minZoom: 9,
        maxZoom: 19,
        attributionControl: true
    });
    // 主瓦片：OSM 官方；加载失败自动切换备用源（CartoDB Voyager）
    var OSM_URLS = [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
    ];
    var tile = L.tileLayer(OSM_URLS[0], {
        maxZoom: 19,
        subdomains: 'abc',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(map);
    var tileIdx = 0;
    tile.on('tileerror', function () {
        if (tileIdx < OSM_URLS.length - 1) {
            tileIdx++;
            map.removeLayer(tile);
            tile = L.tileLayer(OSM_URLS[tileIdx], { maxZoom: 19, subdomains: 'abc', attribution: tile.options.attribution });
            tile.on('tileerror', arguments.callee);
            tile.addTo(map);
        }
    });
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 140 }).addTo(map);
    // 自定义放大缩小按钮
    document.getElementById('btn-zoom-in').addEventListener('click', function () { map.zoomIn(); });
    document.getElementById('btn-zoom-out').addEventListener('click', function () { map.zoomOut(); });

    var INIT_CENTER = [29.045, 111.69], INIT_ZOOM = 13;

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
    // Leaflet 图层对象：pointsLayer[cluster|plain], linesLayer
    var pointsLayer = { cluster: null, plain: null };
    var linesLayer = null;
    var clusterEnabled = true;

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
            html: '<div class="poi-icon" style="background:' + c.color + '">' + (CAT_ICONS[key] || '') + '</div>',
            iconSize: [18, 18], iconAnchor: [9, 9]
        });
        return L.marker([coords[1], coords[0]], { icon: icon })
            .bindTooltip(p.name, { direction: 'top', offset: [0, -10], className: 'poi-tip' })
            .bindPopup(pointPopupHtml(key, p), { autoPan: true, maxWidth: 280 });
    }

    function buildPointLayers(key, useCluster) {
        var feats = layerState[key].data;
        if (useCluster) {
            var cg = L.markerClusterGroup({
                maxClusterRadius: 60,
                showCoverageOnHover: false,
                zoomToBoundsOnClick: true,
                spiderfyOnMaxZoom: true,
                disableClusteringAtZoom: 18
            });
            feats.forEach(function (f) { cg.addLayer(makePointMarker(key, f)); });
            return cg;
        }
        var g = L.layerGroup();
        feats.forEach(function (f) {
            var coords = f.geometry.coordinates;
            var p = f.properties;
            g.addLayer(L.circleMarker([coords[1], coords[0]], {
                radius: 5, color: LAYER_CONFIG[key].color, weight: 1.5,
                fillColor: LAYER_CONFIG[key].color, fillOpacity: 0.85
            }).bindTooltip(p.name, { direction: 'top', offset: [0, -8], className: 'poi-tip' })
                .bindPopup(pointPopupHtml(key, p), { autoPan: true, maxWidth: 280 }));
        });
        return g;
    }

    function buildLinesLayer() {
        var g = L.layerGroup();
        layerState.road.data.forEach(function (f) {
            var coords = f.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
            if (coords.length < 2) return;
            // 双层线：浅色底衬 + 琥珀主线（质感更佳）
            g.addLayer(L.polyline(coords, {
                color: '#ffffff', weight: 8.5, opacity: 0.4,
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
        return g;
    }

    function refreshLayer(key) {
        var vis = layerState[key].visible;
        if (key === 'road') {
            if (linesLayer) { map.removeLayer(linesLayer); linesLayer = null; }
            if (vis) { linesLayer = buildLinesLayer(); map.addLayer(linesLayer); }
            return;
        }
        if (pointsLayer.cluster) { map.removeLayer(pointsLayer.cluster); pointsLayer.cluster = null; }
        if (pointsLayer.plain) { map.removeLayer(pointsLayer.plain); pointsLayer.plain = null; }
        if (!vis) return;
        if (clusterEnabled) {
            pointsLayer.cluster = buildPointLayers(key, true);
            map.addLayer(pointsLayer.cluster);
        } else {
            pointsLayer.plain = buildPointLayers(key, false);
            map.addLayer(pointsLayer.plain);
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
                var any = f.geometry.coordinates.some(function (c) { return b.contains([c[1], c[0]]); });
                if (any) n++;
            });
            return n;
        }
        return layerState[key].data.filter(function (f) {
            var c = f.geometry.coordinates;
            return b.contains([c[1], c[0]]);
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
        var ll = [coords[1], coords[0]];
        map.setView(ll, Math.max(map.getZoom(), 15));
        var target = null;
        var container = pointsLayer.cluster || pointsLayer.plain;
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
    }
    map.on('click', function (e) {
        if (!measure.mode) return;
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
            showMeasure('距离：' + (measure.total / 1000).toFixed(3) + ' 公里（双击结束）');
        } else {
            if (measure.pts.length >= 2) {
                if (measure.line) map.removeLayer(measure.line);
                measure.line = L.polyline(measure.pts, { color: '#059669', weight: 2.5, dashArray: '6 6' });
                map.addLayer(measure.line);
            }
            showMeasure('已添加 ' + measure.pts.length + ' 个顶点（双击闭合求面积）');
        }
    });
    map.on('dblclick', function (e) {
        if (!measure.mode) return;
        e.originalEvent.preventDefault();
        if (measure.mode === 'dist') {
            showMeasure('总距离：' + (measure.total / 1000).toFixed(3) + ' 公里');
        } else if (measure.pts.length >= 3) {
            if (measure.line) map.removeLayer(measure.line);
            measure.poly = L.polygon(measure.pts, { color: '#059669', weight: 2, fillColor: '#059669', fillOpacity: 0.15 });
            map.addLayer(measure.poly);
            var area = polygonAreaM2(measure.pts);
            showMeasure('面积：' + (area / 1000000).toFixed(3) + ' 平方公里');
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
        showMeasure('单击地图添加测量点，双击结束并显示总距离');
    });
    document.getElementById('btn-area').addEventListener('click', function () {
        if (measure.mode) { clearMeasure(); return; }
        clearMeasure();
        measure.mode = 'area';
        this.classList.add('active');
        showMeasure('单击地图添加顶点，双击闭合计算面积');
    });
    document.getElementById('btn-clear').addEventListener('click', clearMeasure);

    // ---------------- 9. 复位 / 全景适配 ----------------
    document.getElementById('btn-home').addEventListener('click', function () {
        map.setView(INIT_CENTER, INIT_ZOOM);
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
                    coords.forEach(function (c) { bounds.extend([c[1], c[0]]); any = true; });
                } else {
                    bounds.extend([coords[1], coords[0]]); any = true;
                }
            });
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
        reverseAddr(ll, function (addr) {
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

    // ---------------- 11. 图例 / 花瓣 ----------------
    document.getElementById('btn-legend').addEventListener('click', function () {
        var p = document.getElementById('legend-panel');
        p.hidden = !p.hidden;
    });
    function initPetals() {
        var wrap = document.getElementById('petal-wrap');
        if (!wrap) return;
        for (var i = 0; i < 26; i++) {
            var d = document.createElement('i');
            d.className = 'petal';
            var l = Math.random() * 100, s = 0.55 + Math.random() * 0.75;
            var dur = 7 + Math.random() * 7, delay = Math.random() * 12;
            var sway = 30 + Math.random() * 60, rot = Math.random() * 360;
            var w = 8 + Math.random() * 8, h = 8 + Math.random() * 8;
            d.style.cssText = 'left:' + l + '%;--dur:' + dur + 's;--delay:-' + delay + 's;--sway:' + sway + 'px;--rot:' + rot + 'deg;width:' + w + 'px;height:' + h + 'px;transform:scale(' + s + ');';
            wrap.appendChild(d);
        }
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
        var on = w.classList.toggle('on');
        document.getElementById('btn-petal').classList.toggle('active', on);
        syncSetToggles();
    }
    document.getElementById('btn-petal').addEventListener('click', togglePetals);

    // ---------------- 12. 移动端抽屉 ----------------
    var sidebarEl = document.querySelector('.sidebar');
    var backdropEl = document.getElementById('sidebar-backdrop');
    function closeDrawer() {
        if (sidebarEl) sidebarEl.classList.remove('open');
        if (backdropEl) backdropEl.classList.remove('show');
    }
    var menuBtn = document.getElementById('btn-menu');
    if (menuBtn) menuBtn.addEventListener('click', function () {
        var open = sidebarEl ? sidebarEl.classList.toggle('open') : false;
        if (backdropEl) backdropEl.classList.toggle('show', open);
    });
    if (backdropEl) backdropEl.addEventListener('click', closeDrawer);
    var layerListEl = document.getElementById('layer-list');
    if (layerListEl) layerListEl.addEventListener('click', closeDrawer);
    if (searchResultEl) searchResultEl.addEventListener('click', closeDrawer);

    // ---------------- 13. 设置面板（玻璃调节，Apple glass-liquid） ----------------
    var settingsPanel = document.getElementById('settings-panel');
    var btnSettings = document.getElementById('btn-settings');
    var setBlur = document.getElementById('set-blur');
    var setAlpha = document.getElementById('set-alpha');
    function applyGlass() {
        var blur = setBlur.value, alpha = setAlpha.value;
        document.documentElement.style.setProperty('--glass-blur', blur + 'px');
        document.documentElement.style.setProperty('--glass-alpha', (alpha / 100).toFixed(2));
        document.getElementById('set-blur-val').textContent = blur + 'px';
        document.getElementById('set-alpha-val').textContent = alpha + '%';
        try { localStorage.setItem('cd_glass', JSON.stringify({ blur: blur, alpha: alpha })); } catch (e) { }
    }
    if (btnSettings && settingsPanel) {
        btnSettings.addEventListener('click', function () {
            settingsPanel.hidden = !settingsPanel.hidden;
            btnSettings.classList.toggle('active', !settingsPanel.hidden);
        });
        document.getElementById('settings-close').addEventListener('click', function () {
            settingsPanel.hidden = true;
            btnSettings.classList.remove('active');
        });
        setBlur.addEventListener('input', applyGlass);
        setAlpha.addEventListener('input', applyGlass);
        document.getElementById('set-petal').addEventListener('click', togglePetals);
        document.getElementById('set-cluster').addEventListener('click', function () {
            var c = document.getElementById('chk-cluster');
            c.checked = !c.checked;
            c.dispatchEvent(new Event('change', { bubbles: true }));
            syncSetToggles();
        });
        document.getElementById('set-reset').addEventListener('click', function () {
            setBlur.value = 12; setAlpha.value = 92;
            applyGlass();
        });
        try {
            var g = JSON.parse(localStorage.getItem('cd_glass') || 'null');
            if (g && g.blur !== undefined) { setBlur.value = g.blur; setAlpha.value = g.alpha; applyGlass(); }
        } catch (e) { }
    }

    // ---------------- 14. 启动 ----------------
    initPetals();
    syncSetToggles();
    var isMobileDevice = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    if (!isMobileDevice) {
        document.getElementById('petal-wrap').classList.add('on');
        document.getElementById('btn-petal').classList.add('active');
        syncSetToggles();
    }
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
