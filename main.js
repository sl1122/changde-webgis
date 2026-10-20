/* ===== 常德市城市公共服务WebGIS系统 - 主逻辑（高德地图 JS API 2.0） ===== */
(function () {
    'use strict';

    // ---------- 配置 ----------
    var MAP_CENTER = [111.6938, 29.0303];   // 常德市中心
    var MAP_ZOOM = 12;

    var LAYER_CONFIG = {
        school:   { file: 'data/school.geojson',   color: '#2563eb', label: '学校', geom: 'point' },
        hospital: { file: 'data/hospital.geojson', color: '#dc2626', label: '医院', geom: 'point' },
        scenic:   { file: 'data/scenic.geojson',   color: '#059669', label: '景点', geom: 'point' },
        road:     { file: 'data/road.geojson',     color: '#d97706', label: '道路', geom: 'line' }
    };

    // ---------- 地图初始化 ----------
    var map = new AMap.Map('map', {
        viewMode: '2D',
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        resizeEnable: true,
        rotateEnable: false,
        pitchEnable: false
    });

    map.addControl(new AMap.Scale({ position: 'LB' }));
    map.addControl(new AMap.MapType({ showTraffic: false, showRoad: true, position: 'RB', offset: new AMap.Pixel(10, 12) }));
    // 缩放改用自定义大按钮（右下角），未启用默认 ToolBar

    // ---------- 工具 ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function pinIcon(color) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="40" viewBox="0 0 34 40">' +
            '<path fill="' + color + '" stroke="#ffffff" stroke-width="1.5" d="M17 2C9.8 2 4 7.8 4 15c0 9.8 13 23 13 23s13-13.2 13-23C30 7.8 24.2 2 17 2z"/>' +
            '<circle cx="17" cy="15" r="6.5" fill="#ffffff"/></svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    var layerState = {};   // key -> {clusterer|markers, features, data}
    var clusterEnabled = true;   // 聚合气泡总开关
    var infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -34), autoMove: true });

    function buildInfoHTML(layer, feat) {
        var p = feat.properties || {};
        var region = p.region;
        if (!region) {
            var parts = [];
            if (p.pname) parts.push(p.pname);
            if (p.adname && parts.indexOf(p.adname) < 0) parts.push(p.adname);
            region = parts.join('·') || p.cityname || '';
        }
        var typeTag = '<span class="iw-type" style="background:' + layer.color + '">' + esc(layer.label) + '</span>';
        var rows = '';
        if (p.name)      rows += '<div class="iw-row"><span class="iw-label">名称：</span>' + esc(p.name) + '</div>';
        if (region)      rows += '<div class="iw-row"><span class="iw-label">区域：</span>' + esc(region) + '</div>';
        if (p.address)   rows += '<div class="iw-row"><span class="iw-label">地址：</span>' + esc(p.address) + '</div>';
        if (p.type)      rows += '<div class="iw-row"><span class="iw-label">类别：</span>' + esc(p.type) + '</div>';
        if (p.level)     rows += '<div class="iw-row"><span class="iw-label">等级：</span>' + esc(p.level) + '</div>';
        if (p.length_km) rows += '<div class="iw-row"><span class="iw-label">长度：</span>' + esc(p.length_km) + ' 公里</div>';
        if (p.nodes)     rows += '<div class="iw-row"><span class="iw-label">节点数：</span>' + esc(p.nodes) + '</div>';
        if (p.source)    rows += '<div class="iw-row"><span class="iw-label">来源：</span>' + esc(p.source) + '</div>';
        return '<div class="iw-card"><div class="iw-title">' + typeTag + esc(p.name || layer.label) + '</div>' + rows + '</div>';
    }

    function openInfo(layer, feat, lnglat) {
        infoWindow.setContent(buildInfoHTML(layer, feat));
        infoWindow.open(map, lnglat);
    }

    // ---------- 实时计数（当前视野内可见数量） ----------
    function countInView(key) {
        var st = layerState[key];
        if (!st || !st.features) return 0;
        var box = map.getBounds();
        if (!box) return st.features.length;
        var sw = box.getSouthWest(), ne = box.getNorthEast();
        var padLng = (ne.lng - sw.lng) * 0.08;
        var padLat = (ne.lat - sw.lat) * 0.08;
        var minX = sw.lng - padLng, maxX = ne.lng + padLng;
        var minY = sw.lat - padLat, maxY = ne.lat + padLat;
        var n = 0;
        if (LAYER_CONFIG[key].geom === 'line') {
            st.features.forEach(function (f) {
                var coords = (f.geometry && f.geometry.coordinates) || [];
                for (var i = 0; i < coords.length; i++) {
                    var c = coords[i];
                    if (c && c.length >= 2 && c[0] >= minX && c[0] <= maxX && c[1] >= minY && c[1] <= maxY) { n++; break; }
                }
            });
        } else {
            st.features.forEach(function (f) {
                var c = (f.geometry && f.geometry.coordinates) || [];
                if (c.length >= 2 && c[0] >= minX && c[0] <= maxX && c[1] >= minY && c[1] <= maxY) n++;
            });
        }
        return n;
    }

    function updateCounts() {
        Object.keys(LAYER_CONFIG).forEach(function (key) {
            var el = document.getElementById('cnt-' + key);
            var box = document.getElementById('chk-' + key);
            if (box && !box.checked) {
                el.textContent = '0';
                el.classList.add('off');
                return;
            }
            el.classList.remove('off');
            el.textContent = countInView(key);
        });
    }
    map.on('moveend', updateCounts);
    map.on('zoomend', updateCounts);

    // ---------- 地图操作提示 ----------
    var toastTimer = null;
    function showToast(msg, isErr) {
        var el = document.getElementById('map-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('error', !!isErr);
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
    }

    // ---------- 自定义缩放按钮 ----------
    document.getElementById('btn-zoom-in').addEventListener('click', function () { map.zoomIn(); });
    document.getElementById('btn-zoom-out').addEventListener('click', function () { map.zoomOut(); });

    // ---------- 复位：返回初始视图（功能9 地图导航） ----------
    document.getElementById('btn-home').addEventListener('click', function () {
        map.setZoomAndCenter(MAP_ZOOM, MAP_CENTER);
        infoWindow.close();
        showToast('已复位到初始视图');
    });

    // ---------- 图例开关（功能9） ----------
    var legendPanel = document.getElementById('legend-panel');
    document.getElementById('btn-legend').addEventListener('click', function () {
        legendPanel.hidden = !legendPanel.hidden;
        this.classList.toggle('active', !legendPanel.hidden);
    });

    // ---------- 桃花花瓣飘落（可开关） ----------
    function initPetals() {
        var wrap = document.getElementById('petal-wrap');
        if (!wrap) return;
        var isM = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
        var petals = isM ? 8 : 18;   // 移动端减少花瓣数量，降低渲染压力
        for (var i = 0; i < petals; i++) {
            var p = document.createElement('div');
            p.className = 'petal';
            var dur = 9 + Math.random() * 8;
            var size = 9 + Math.random() * 7;
            var rot = Math.random() * 360;
            var hue = Math.random() > 0.5 ? 'rgba(244,144,177,.85)' : 'rgba(250,184,203,.9)';
            p.style.cssText =
                'left:' + (Math.random() * 100).toFixed(1) + '%;' +
                'width:' + size.toFixed(1) + 'px;height:' + (size * 0.72).toFixed(1) + 'px;' +
                '--dur:' + dur.toFixed(1) + 's;' +
                '--delay:-' + (Math.random() * 18).toFixed(1) + 's;' +
                '--sway:' + (30 + Math.random() * 50).toFixed(0) + 'px;' +
                '--rot:' + rot.toFixed(0) + 'deg;' +
                '--hue:' + hue + ';';
            wrap.appendChild(p);
        }
    }
    document.getElementById('btn-petal').addEventListener('click', function () {
        var wrap = document.getElementById('petal-wrap');
        var on = wrap.classList.toggle('on');
        this.classList.toggle('active', on);
        this.title = on ? '关闭桃花花瓣飘落' : '开启桃花花瓣飘落';
    });

    // ---------- 图层加载 ----------
    // 读取内嵌数据（双击 index.html 直接打开时，file:// 下 fetch 不可用，走此兜底）
    function tryEmbedded(key) {
        try {
            var el = document.getElementById('geo-data');
            if (!el) return null;
            var all = JSON.parse(el.textContent);
            return all && all[key] ? all[key] : null;
        } catch (e) { return null; }
    }

    function loadLayer(key) {
        var cfg = LAYER_CONFIG[key];
        var tip = document.createElement('div');
        tip.className = 'loading-tip';
        tip.textContent = '正在加载' + cfg.label + '图层…';
        document.getElementById('map').appendChild(tip);

        // file://（双击打开）场景：fetch 本地文件会被浏览器拦截，直接使用内嵌数据，避免报错
        if (location.protocol === 'file:') {
            var embeddedNow = tryEmbedded(key);
            if (embeddedNow && embeddedNow.features) {
                tip.remove();
                var featuresF = embeddedNow.features.filter(function (f) { return f.geometry; });
                layerState[key] = { features: featuresF };
                if (cfg.geom === 'line') renderRoads(key, featuresF);
                else renderPoints(key, featuresF);
                updateCounts();
                buildSearchIndex();
                return;
            }
        }

        fetch(cfg.file + (cfg.file.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now())
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (geojson) {
                tip.remove();
                var features = (geojson.features || []).filter(function (f) { return f.geometry; });
                layerState[key] = { features: features };
                if (cfg.geom === 'line') renderRoads(key, features);
                else renderPoints(key, features);
                updateCounts();
                buildSearchIndex();   // 图层加载完成后重建搜索索引（避免大文件晚于地图complete）
            })
            .catch(function (err) {
                // 网络文件加载失败时，尝试内嵌数据（file:// 直接打开场景）
                var embedded = tryEmbedded(key);
                if (embedded && embedded.features) {
                    tip.remove();
                    var features2 = embedded.features.filter(function (f) { return f.geometry; });
                    layerState[key] = { features: features2 };
                    if (cfg.geom === 'line') renderRoads(key, features2);
                    else renderPoints(key, features2);
                    updateCounts();
                    buildSearchIndex();
                    return;
                }
                tip.remove();
                var el = document.getElementById('cnt-' + key);
                el.textContent = '!';
                var errTip = document.createElement('div');
                errTip.className = 'loading-tip';
                errTip.textContent = cfg.label + '图层加载失败：' + err.message + '（请用本地服务器访问，如 python -m http.server 8000）';
                document.getElementById('map').appendChild(errTip);
                setTimeout(function () { errTip.remove(); }, 8000);
                console.warn(cfg.label + ' 加载失败', err);
            });
    }

    function renderPoints(key, features) {
        var cfg = LAYER_CONFIG[key];
        // 2.0 点聚合：数据项必须含 lnglat 字段（AMap.MarkerCluster）
        var data = features.map(function (feat) {
            var c = feat.geometry.coordinates;
            var p = feat.properties || {};
            var region = [];
            if (p.pname) region.push(p.pname);
            if (p.adname && p.adname !== p.pname) region.push(p.adname);
            return {
                lnglat: [c[0], c[1]],
                name: p.name || '',
                address: p.address || '',
                region: region.join('·') || (p.cityname || ''),
                type: p.type || '',
                source: '高德POI'
            };
        }).filter(function (d) { return d.lnglat && d.lnglat.length >= 2; });
        layerState[key].data = data;
        // 保留一份纯净副本供"单个小圆点"模式使用（AMap.MarkerCluster 可能改写数据项，不能复用同一份）
        layerState[key].points = data.map(function (it) {
            return {
                lnglat: [it.lnglat[0], it.lnglat[1]],
                name: it.name, address: it.address,
                region: it.region, type: it.type, source: it.source
            };
        });
        applyPointRender(key);
    }

    function buildCluster(key) {
        var cfg = LAYER_CONFIG[key];
        var st = layerState[key];
        if (!st || !st.data || st.clusterer) return;
        var data = st.data;
        // 位置索引：渲染回调只有 marker，通过坐标反查数据
        var posIndex = {};
        data.forEach(function (d) {
            var k = Math.round(d.lnglat[0] * 1e6) / 1e6 + ',' + Math.round(d.lnglat[1] * 1e6) / 1e6;
            posIndex[k] = d;
        });

        var cluster = new AMap.MarkerCluster(map, data, {
            gridSize: 70,
            maxZoom: 16,
            averageCenter: true,
            clusterByZoomChange: true,
            renderClusterMarker: function (context) {
                try {
                    var n = context.count;
                    // 更小更通透的聚合圆球：尺寸上限 34px、半透明、轻阴影，减少对底图的遮挡
                    var size = Math.min(34, 18 + Math.round(Math.sqrt(n) * 2.2));
                    var div = document.createElement('div');
                    div.className = 'cluster-bubble';
                    div.style.cssText = 'background:' + cfg.color + ';opacity:.88;color:#fff;width:' + size + 'px;height:' + size + 'px;border-radius:50%;line-height:' + (size - 2) + 'px;text-align:center;font-weight:700;font-size:' + (n >= 100 ? 10 : 11) + 'px;border:1.5px solid rgba(255,255,255,.75);box-shadow:0 1px 5px rgba(0,0,0,.20);cursor:pointer;';
                    div.textContent = n;
                    context.marker.setOffset(new AMap.Pixel(-size / 2, -size / 2));
                    context.marker.setContent(div);
                } catch (e) { /* 自定义样式失败则回退默认样式 */ }
            },
            renderMarker: function (context) {
                try {
                    var m = context.marker;
                    var pos = m.getPosition();
                    var k = Math.round(pos.lng * 1e6) / 1e6 + ',' + Math.round(pos.lat * 1e6) / 1e6;
                    var item = posIndex[k];
                    if (!item) {
                        // 坐标可能有微小偏差导致反查失败：宽松匹配最近点，避免点击只显示图层名（如"学校"）
                        var bi = -1, bd = 1e-4, bd2 = 0;
                        for (var i2 = 0; i2 < data.length; i2++) {
                            var dd = data[i2];
                            var dx = dd.lnglat[0] - pos.lng, dy = dd.lnglat[1] - pos.lat;
                            var ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
                            if (ax < bd && ay < bd) {
                                var d2 = ax * ax + ay * ay;
                                if (bi < 0 || d2 < bd2) { bi = i2; bd2 = d2; }
                            }
                        }
                        item = bi >= 0 ? data[bi] : {};
                    }
                    var div = document.createElement('div');
                    div.className = 'point-pin';
                    // 深放大时用更小圆点，减少与底图POI文字重叠
                    var z = map.getZoom() || 12;
                    var px = z >= 17 ? 10 : 12;
                    div.style.cssText = 'width:' + px + 'px;height:' + px + 'px;border-radius:50%;background:' + cfg.color + ';border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;';
                    m.setOffset(new AMap.Pixel(-px / 2, -px / 2));
                    m.setContent(div);
                    if (!m._hwBound) {
                        m._hwBound = true;
                        // 聚合框架会复用标记对象：点击时必须按"当前坐标"实时反查数据，
                        // 不能使用渲染时闭包捕获的旧 pos/item（否则会显示错点/只显示图层名）
                        m.on('click', function () {
                            var cur = m.getPosition();
                            var ck = Math.round(cur.lng * 1e6) / 1e6 + ',' + Math.round(cur.lat * 1e6) / 1e6;
                            var it = posIndex[ck];
                            if (!it) {
                                var bi2 = -1, bd2b = 1e-4, bd22 = 0;
                                for (var i3 = 0; i3 < data.length; i3++) {
                                    var dd2 = data[i3];
                                    var dx2 = dd2.lnglat[0] - cur.lng, dy2 = dd2.lnglat[1] - cur.lat;
                                    var ax2 = dx2 < 0 ? -dx2 : dx2, ay2 = dy2 < 0 ? -dy2 : dy2;
                                    if (ax2 < bd2b && ay2 < bd2b) {
                                        var d22 = ax2 * ax2 + ay2 * ay2;
                                        if (bi2 < 0 || d22 < bd22) { bi2 = i3; bd22 = d22; }
                                    }
                                }
                                it = bi2 >= 0 ? data[bi2] : {};
                            }
                            map.setZoomAndCenter(Math.max(map.getZoom(), 15), cur);
                            openInfo(cfg, {
                                properties: { name: it.name, address: it.address, region: it.region, type: it.type || cfg.label, source: it.source }
                            }, cur);
                        });
                    }
                } catch (e) { /* 忽略单个标记渲染异常 */ }
            }
        });
        cluster.on('click', function () {
            if (map.getZoom() < 17) map.zoomIn();
        });
        st.clusterer = cluster;
    }

    // 无聚合模式：单个小圆点（总开关关闭时使用），大幅减少对底图的遮挡
    function buildPlainMarkers(key) {
        var cfg = LAYER_CONFIG[key];
        var st = layerState[key];
        if (!st || !st.points || st.markers) return;
        var markers = [];
        st.points.forEach(function (item) {
            if (!item.lnglat || !isFinite(item.lnglat[0]) || !isFinite(item.lnglat[1])) return;
            try {
                var m = new AMap.Marker({
                    position: new AMap.LngLat(item.lnglat[0], item.lnglat[1]),
                    offset: new AMap.Pixel(-3, -3),
                    zIndex: 50,
                    title: item.name
                });
                var div = document.createElement('div');
                div.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + cfg.color + ';opacity:.9;border:1px solid rgba(255,255,255,.95);box-shadow:0 0 3px rgba(0,0,0,.25);cursor:pointer;';
                m.setContent(div);
                m.on('click', function () {
                    map.setZoomAndCenter(Math.max(map.getZoom(), 15), m.getPosition());
                    openInfo(cfg, {
                        properties: { name: item.name, address: item.address, region: item.region, type: item.type || cfg.label, source: item.source }
                    }, m.getPosition());
                });
                markers.push(m);
            } catch (e) { /* 跳过单个异常点 */ }
        });
        st.markers = markers;
        markers.forEach(function (m) { try { m.setMap(map); } catch (e) { /* 忽略 */ } });
    }

    // 按聚合开关状态渲染点图层
    function applyPointRender(key) {
        teardownPoints(key);
        if (clusterEnabled) buildCluster(key);
        else buildPlainMarkers(key);
    }

    function teardownPoints(key) {
        var st = layerState[key];
        if (!st) return;
        // 2.0 聚类器 setMap(null) 摘除后内部可能抛 "LngLat(NaN,NaN)" 兼容性异常，
        // 逐项 try/catch 隔离，确保多图层切换时不被单个异常中断
        try { if (st.clusterer) st.clusterer.setMap(null); } catch (e) { /* 忽略聚类器摘除异常 */ }
        st.clusterer = null;
        if (st.markers) {
            st.markers.forEach(function (m) { try { m.setMap(null); } catch (e) { /* 忽略 */ } });
            st.markers = null;
        }
    }

    function renderRoads(key, features) {
        var cfg = LAYER_CONFIG[key];
        var polylines = [];
        features.forEach(function (feat) {
            var coords = feat.geometry.coordinates || [];
            if (!coords.length) return;
            var path = coords.map(function (c) { return new AMap.LngLat(c[0], c[1]); });
            var line = new AMap.Polyline({
                path: path,
                strokeColor: cfg.color,
                strokeWeight: 4,
                strokeOpacity: 0.8,
                strokeStyle: 'solid',
                lineJoin: 'round',
                lineCap: 'round',
                zIndex: 60
            });
            var name = (feat.properties && feat.properties.name) || '';
            if (name) {
                line.on('click', function (e) {
                    openInfo(cfg, feat, e.lnglat);
                });
            }
            polylines.push(line);
        });
        layerState[key].polylines = polylines;
        polylines.forEach(function (l) { l.setMap(map); });
    }

    // ---------- 图层显隐联动 ----------
    function setLayerVisible(key, visible) {
        var st = layerState[key];
        if (!st) return;
        if (visible) {
            // 开启：按聚合开关状态渲染（重建聚类器或单个点位，避免复用损坏）
            applyPointRender(key);
            if (st.polylines) st.polylines.forEach(function (l) { l.setMap(map); });
        } else {
            // 关闭：摘除并销毁，下次开启时重建
            teardownPoints(key);
            if (st.polylines) st.polylines.forEach(function (l) { l.setMap(null); });
        }
    }

    // 聚合气泡总开关：关闭后所有点图层改显单个小圆点，不再显示数字圆球
    var clusterSwitchTimer = null;
    document.getElementById('chk-cluster').addEventListener('change', function () {
        clusterEnabled = this.checked;
        var keys = [];
        Object.keys(LAYER_CONFIG).forEach(function (key) {
            if (LAYER_CONFIG[key].geom !== 'point') return;
            var box = document.getElementById('chk-' + key);
            if (box && box.checked) keys.push(key);
        });
        // 逐图层串行切换（间隔 350ms + 独立 try/catch），避免聚类器快速拆建相互干扰
        clearTimeout(clusterSwitchTimer);
        keys.forEach(function (key, i) {
            clusterSwitchTimer = setTimeout(function () {
                try { applyPointRender(key); }
                catch (e) { console.warn('聚合切换异常：' + key, e); }
            }, i * 350);
        });
    });

    document.querySelectorAll('.layer-item input[type="checkbox"]').forEach(function (box) {
        if (box.id === 'chk-cluster') return;
        box.addEventListener('change', function () {
            setLayerVisible(box.closest('.layer-item').dataset.layer, box.checked);
            updateCounts();
        });
    });

    document.getElementById('btn-all').addEventListener('click', function () {
        document.querySelectorAll('.layer-item input[type="checkbox"]').forEach(function (b) { b.checked = true; setLayerVisible(b.closest('.layer-item').dataset.layer, true); });
        updateCounts();
    });
    document.getElementById('btn-none').addEventListener('click', function () {
        document.querySelectorAll('.layer-item input[type="checkbox"]').forEach(function (b) { b.checked = false; setLayerVisible(b.closest('.layer-item').dataset.layer, false); });
        updateCounts();
    });

    // ---------- 搜索 ----------
    var searchIndex = [];
    function buildSearchIndex() {
        searchIndex = [];
        Object.keys(LAYER_CONFIG).forEach(function (key) {
            var st = layerState[key];
            if (!st || !st.features) return;
            st.features.forEach(function (feat) {
                var p = feat.properties || {};
                if (!p.name) return;
                var kws = [p.name].concat(p.aliases || []);
                kws.forEach(function (kw) {
                    searchIndex.push({ key: key, feat: feat, name: String(kw).toLowerCase() });
                });
            });
        });
    }

    var searchResult = document.getElementById('search-result');
    var searchType = document.getElementById('search-type');

    function runSearch() {
        var kw = document.getElementById('search-input').value.trim().toLowerCase();
        var type = searchType ? searchType.value : '';
        searchResult.innerHTML = '';
        if (!kw) return;
        var hits = searchIndex.filter(function (it) {
            if (type && it.key !== type) return false;
            return it.name.indexOf(kw) >= 0;
        }).slice(0, 6);
        if (!hits.length) {
            searchResult.innerHTML = '<div class="search-empty">未找到匹配地点</div>';
            return;
        }
        hits.forEach(function (it) {
            var cfg = LAYER_CONFIG[it.key];
            var div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = '<span class="tag" style="background:' + cfg.color + '">' + esc(cfg.label) + '</span>' + esc(it.feat.properties.name);
            div.addEventListener('click', function () {
                // 若该图层处于隐藏，自动打开
                var box = document.getElementById('chk-' + it.key);
                if (box && !box.checked) { box.checked = true; setLayerVisible(it.key, true); }
                var c = it.feat.geometry.coordinates || [];
                var lnglat;
                if (Array.isArray(c[0]) && Array.isArray(c[0][0])) {
                    // MultiLineString：取第一条线中点
                    var line0 = c[0];
                    var mid = line0[Math.floor(line0.length / 2)];
                    lnglat = new AMap.LngLat(mid[0], mid[1]);
                } else if (Array.isArray(c[0])) {
                    // LineString：取线中点
                    var mid2 = c[Math.floor(c.length / 2)];
                    lnglat = new AMap.LngLat(mid2[0], mid2[1]);
                } else {
                    // Point
                    lnglat = new AMap.LngLat(c[0], c[1]);
                }
                map.setZoomAndCenter(15, lnglat);
                openInfo(cfg, it.feat, lnglat);
            });
            searchResult.appendChild(div);
        });
    }
    document.getElementById('search-input').addEventListener('input', runSearch);
    if (searchType) searchType.addEventListener('change', runSearch);

    // ---------- 工具栏 ----------
    var mouseTool = new AMap.MouseTool(map);
    var measureResult = document.getElementById('measure-result');
    var drawnOverlays = [];

    function clearMeasure() {
        mouseTool.close(true);   // 关闭并移除鼠标工具绘制的覆盖物
        drawnOverlays = [];
        measureResult.hidden = true;
        // 仅熄灭测量按钮，不影响花瓣 / 图例开关高亮
        document.querySelectorAll('.toolbar button').forEach(function (b) {
            if (b.id === 'btn-legend' || b.classList.contains('petal-btn')) return;
            b.classList.remove('active');
        });
    }

    function showMeasure(text) {
        measureResult.textContent = text;
        measureResult.hidden = false;
    }

    // 定位：适配全部数据范围（武陵区 + 鼎城区全景）
    function fitDataView() {
        var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        var any = false;
        Object.keys(LAYER_CONFIG).forEach(function (key) {
            var st = layerState[key];
            if (!st || !st.features) return;
            st.features.forEach(function (f) {
                var g = f.geometry;
                if (!g || !g.coordinates) return;
                var pts = [];
                if (g.type === 'Point') { pts.push(g.coordinates); }
                else if (g.type === 'LineString') { pts = g.coordinates; }
                else if (g.type === 'MultiLineString') {
                    g.coordinates.forEach(function (l) { pts = pts.concat(l); });
                }
                pts.forEach(function (p) {
                    if (p && p.length >= 2) {
                        minLng = Math.min(minLng, p[0]); maxLng = Math.max(maxLng, p[0]);
                        minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
                        any = true;
                    }
                });
            });
        });
        if (!any) return;
        if (minLng === maxLng) { minLng -= 0.004; maxLng += 0.004; }
        if (minLat === maxLat) { minLat -= 0.004; maxLat += 0.004; }
        map.setBounds(new AMap.Bounds([minLng, minLat], [maxLng, maxLat]), false, [70, 70, 40, 70]);
    }
    document.getElementById('btn-locate').addEventListener('click', function () {
        fitDataView();
        showToast('已定位到常德市区全景（武陵区 + 鼎城区）');
    });

    // ---------- WGS-84 → GCJ-02 坐标转换（开源 coordtransform 算法） ----------
    // 浏览器 GPS 返回 WGS-84（国际坐标），高德底图为 GCJ-02（火星坐标），必须转换才能对齐
    var _a = 6378245.0, _ee = 0.00669342162296594323;
    function outOfChina(lng, lat) { return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55); }
    function _tLat(x, y) {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
        return ret;
    }
    function _tLng(x, y) {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
        ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
        ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
        ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
        return ret;
    }
    function wgs84togcj02(lng, lat) {
        if (outOfChina(lng, lat)) return [lng, lat];
        var dLat = _tLat(lat - 35.0, lng - 105.0);
        var dLng = _tLng(lat - 35.0, lng - 105.0);
        var radLat = lat / 180.0 * Math.PI;
        var magic = Math.sin(radLat);
        magic = 1 - _ee * magic * magic;
        var sqrtMagic = Math.sqrt(magic);
        dLat = (dLat * 180.0) / ((_a * (1 - _ee)) / (magic * sqrtMagic) * Math.PI);
        dLng = (dLng * 180.0) / (_a / sqrtMagic * Math.cos(radLat) * Math.PI);
        return [lng + dLng, lat + dLat];
    }

    // ---------- 我的位置：高德定位组件优先 + 持续收敛（纯定位追踪，无手动移动/校正） ----------
    var geoMarker = null, geoCircle = null;

    function makeGeoCircle(center, radius) {
        return new AMap.Circle({
            center: center,
            radius: radius || 15,
            strokeColor: '#1677ff', strokeOpacity: 0.4, strokeWeight: 1,
            fillColor: '#1677ff', fillOpacity: 0.12, zIndex: 70
        });
    }
    // 自动定位结果附近最近的地标（学校/医院/景点），用于提示辅助判断
    function nearestLandmark(lnglat) {
        var best = null, bestD = 1200;
        ['school', 'hospital', 'scenic'].forEach(function (k) {
            var arr = (layerState[k] && layerState[k].data) || [];
            arr.forEach(function (it) {
                if (!it.lnglat || !isFinite(it.lnglat[0]) || !isFinite(it.lnglat[1])) return;
                var dLng = (it.lnglat[0] - lnglat.lng) * 85000;
                var dLat = (it.lnglat[1] - lnglat.lat) * 110000;
                var d = Math.sqrt(dLng * dLng + dLat * dLat);
                if (d < bestD) { bestD = d; best = it.name; }
            });
        });
        return best ? { name: best, dist: Math.round(bestD) } : null;
    }

    // 蓝色定位点：纯定位追踪标记（不可拖动，也不支持点击地图手动移动）
    function makeGeoMarker(lnglat, title) {
        return new AMap.Marker({
            position: lnglat,
            content: '<div class="geo-marker"></div>',
            offset: new AMap.Pixel(-8, -8),
            zIndex: 80,
            title: title
        });
    }

    // 强制重新自动定位：高德定位组件优先（自动处理坐标系与国产手机纠偏，内部含IP兜底），多次采样取精度最优
    function doAutoLocate(btn) {
        btn.disabled = true;
        // 国产/系统浏览器定位能力受限检测（小米浏览器/UC/夸克等）：提前提醒换 Chrome
        try {
            var ua = navigator.userAgent || '';
            if (/MiuiBrowser|UCBrowser|Quark|baiduboxapp|Coolpad|DingTalk|MicroMessenger/i.test(ua)) {
                showToast('检测到系统/国产浏览器，定位能力受限。建议用手机 Chrome 打开本页后重试（当前仍继续定位，但精度可能不理想）', true);
            }
        } catch (e) { /* 忽略 */ }
        showToast('正在定位当前位置…');
        var MAX_TRIES = 3, tries = 0, best = null, settled = false;

        // ① 高德定位组件（推荐）：返回已是 GCJ-02 高德坐标，无需手动转换，
        //    且能识别国产手机浏览器返回的错误坐标系并自动纠偏，避免二次偏移
        function viaAmap() {
            if (!window.AMap || !AMap.Geolocation) { nativeOnly(); return; }
            var geo = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0, zoomToAccuracy: false });
            function onResult(status, result) {
                if (status === 'complete' && result.position) {
                    var acc = (result.accuracy && result.accuracy > 0) ? result.accuracy : 9999;
                    if (acc > 8000) acc = 9999;                      // 过滤离谱结果（城市级）
                    if (!best || acc < best.accuracy) {
                        best = { position: result.position, accuracy: acc, source: result.locationType || 'unknown' };
                    }
                }
                tries++;
                if (tries < MAX_TRIES && (!best || best.accuracy > 150)) {
                    setTimeout(function () { geo.getCurrentPosition(onResult); }, 800);
                } else {
                    tryConverge();
                }
            }
            geo.getCurrentPosition(onResult);
        }

        // ② 双保险：高德组件不可用时，退回手写原生 GPS（WGS-84 → GCJ-02）
        function nativeOnly() {
            if (!navigator.geolocation) { failOut(); return; }
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    var acc = pos.coords.accuracy || 9999;
                    if (!best || acc < best.accuracy) {
                        var g = wgs84togcj02(pos.coords.longitude, pos.coords.latitude);
                        best = { position: new AMap.LngLat(g[0], g[1]), accuracy: acc, source: 'gps' };
                    }
                    tryConverge();
                },
                failOut,
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
        }

        // ③ 精度收敛：GPS 冷启动时 getCurrentPosition 只拿到"第一秒的粗定位"（几百米），
        //    用 watchPosition 持续监听几秒，等设备收敛到更小精度圆（类似苹果的持续定位）。
        //    仅在当前精度仍较粗（>80m）时启用；精确到 40m 内或超时即收工。
        function tryConverge() {
            if (best && best.accuracy <= 80) { finish(); return; }       // 已经很准，不再校准
            if (!navigator.geolocation) { finish(); return; }
            showToast('精度不足，持续校准中…（约几秒）');
            var t0 = Date.now();
            var wid = navigator.geolocation.watchPosition(
                function (pos) {
                    var acc = pos.coords.accuracy || 9999;
                    var g = wgs84togcj02(pos.coords.longitude, pos.coords.latitude);
                    // 交叉校验（参考开源方案）：部分国产手机浏览器返回的已是 GCJ-02，
                    // 再转一次会造成数百米双转偏移。与高德权威结果距离过大时视为异常样本丢弃。
                    if (best && acc < best.accuracy) {
                        var d = distanceMeters(best.position, new AMap.LngLat(g[0], g[1]));
                        if (d > 1500) { return; }   // 疑似双转/异常样本，忽略继续等下一个
                    }
                    if (acc > 0 && acc < 8000 && acc < (best ? best.accuracy : 9999)) {
                        best = { position: new AMap.LngLat(g[0], g[1]), accuracy: acc, source: 'gps' };
                    }
                    if ((best && best.accuracy <= 40) || (Date.now() - t0 > 12000)) {
                        navigator.geolocation.clearWatch(wid);
                        finish();
                    }
                },
                function () { finish(); },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
            // 兜底：watch 无回调也无报错时，14 秒后强制收工（settled 守卫避免重复渲染）
            setTimeout(function () {
                navigator.geolocation.clearWatch(wid);
                finish();
            }, 14000);
        }

        // 两坐标间近似距离（米），用于定位交叉校验
        function distanceMeters(a, b) {
            var dLng = (a.lng - b.lng) * 85000;
            var dLat = (a.lat - b.lat) * 110000;
            return Math.sqrt(dLng * dLng + dLat * dLat);
        }

        function failOut() {
            btn.disabled = false;
            showToast('定位失败：请允许浏览器"精确位置"权限（Android 设置→应用→浏览器→权限→位置→选"精确"），并开启 WiFi/蓝牙增强定位后重试', true);
        }

        function finish() {
            if (settled) return;
            settled = true;
            btn.disabled = false;
            if (!best) { failOut(); return; }
            var lnglat = best.position;
            var src = best.source === 'gps' ? '卫星/GPS' : (best.source === 'network' ? '网络(WiFi/基站)' : 'IP 网络');
            var isIp = (best.source === 'ip') || best.accuracy >= 9999;
            // 清理旧定位
            if (geoMarker) geoMarker.setMap(null);
            if (geoCircle) geoCircle.setMap(null);
            geoMarker = makeGeoMarker(lnglat, '我的位置（' + src + '，精度约±' + Math.round(best.accuracy) + ' 米）');
            geoMarker.setMap(map);
            var radius = Math.max(best.accuracy, 20);
            geoCircle = makeGeoCircle(lnglat, radius);
            geoCircle.setMap(map);
            map.setZoomAndCenter(16, lnglat);
            var accText = best.accuracy > 0 ? '，精度约±' + Math.round(best.accuracy) + ' 米' : '';
            var lm = nearestLandmark(lnglat);
            var lmText = lm ? '；附近地标：' + lm.name + '（约' + lm.dist + ' 米）' : '';
            // 精度差时的诊断引导（小米/国产浏览器常见：粗略权限或自带浏览器弱定位）
            var poorHint = '';
            if (isIp || best.accuracy > 500) {
                poorHint = '；定位偏粗，建议①用手机 Chrome 打开本页 ②授"精确位置"权限（小米：设置→应用设置→应用管理→Chrome→权限→位置→精确）③开启"位置信息增强"（WiFi/蓝牙扫描）';
            }
            if (isIp) {
                showToast('已定位到当前位置（IP 网络定位，仅供参考' + accText + '）' + lmText + poorHint);
            } else {
                showToast('已定位到当前位置（' + src + '定位' + accText + '）' + lmText + poorHint);
            }
        }

        viaAmap();
    }

    document.getElementById('btn-geoloc').addEventListener('click', function () {
        // 单击 = 立即重新定位（纯定位追踪：每次点击都重新定位并显示最新结果，无手动移动干扰）
        doAutoLocate(this);
    });
    document.getElementById('btn-distance').addEventListener('click', function () {
        // 再次点击：取消测量
        if (this.classList.contains('active')) { clearMeasure(); return; }
        clearMeasure();
        this.classList.add('active');
        // 2.0 的 MouseTool 测距方法为 rule（distance 已移除），自带逐段距离显示
        mouseTool.rule({ strokeColor: '#2563eb', strokeWeight: 3, cursor: 'pointer' });
        showMeasure('单击地图添加测量点，双击或右键结束测量');
    });
    document.getElementById('btn-area').addEventListener('click', function () {
        // 再次点击：取消测量
        if (this.classList.contains('active')) { clearMeasure(); return; }
        clearMeasure();
        this.classList.add('active');
        mouseTool.measureArea({ strokeColor: '#059669', strokeWeight: 3, fillColor: '#059669', fillOpacity: 0.15, cursor: 'pointer' });
        showMeasure('在地图上依次单击顶点围合面积，双击或右键结束');
    });
    document.getElementById('btn-clear').addEventListener('click', clearMeasure);

    mouseTool.on('draw', function (e) {
        var o = e.obj;
        if (!o) return;
        if (typeof o.getLength === 'function') {
            var len = o.getLength();
            showMeasure('距离：' + (len / 1000).toFixed(3) + ' 公里');
        } else if (typeof o.getArea === 'function') {
            var area = o.getArea();
            showMeasure('面积：' + (area / 1000000).toFixed(3) + ' 平方公里');
        }
        drawnOverlays.push(o);
    });
    mouseTool.on('drawend', function () { /* 结果由 draw 事件持续更新 */ });

    // ---------- 移动端：侧边栏抽屉开关（手机/平板） ----------
    var sidebarEl = document.querySelector('.sidebar');
    var backdropEl = document.getElementById('sidebar-backdrop');
    function closeDrawer() {
        if (sidebarEl) sidebarEl.classList.remove('open');
        if (backdropEl) backdropEl.classList.remove('show');
    }
    var menuBtn = document.getElementById('btn-menu');
    if (menuBtn) {
        menuBtn.addEventListener('click', function () {
            var open = sidebarEl ? sidebarEl.classList.toggle('open') : false;
            if (backdropEl) backdropEl.classList.toggle('show', open);
        });
    }
    if (backdropEl) backdropEl.addEventListener('click', closeDrawer);
    var layerListEl = document.getElementById('layer-list');
    var searchResultEl = document.getElementById('search-result');
    if (layerListEl) layerListEl.addEventListener('click', closeDrawer);
    if (searchResultEl) searchResultEl.addEventListener('click', closeDrawer);

    // ---------- 启动 ----------
    initPetals();
    var isMobileDevice = window.matchMedia && window.matchMedia('(max-width:768px)').matches;
    if (!isMobileDevice) {   // 移动端默认关闭花瓣特效：地图滑动更流畅（可点"花瓣"按钮手动开启）
        document.getElementById('petal-wrap').classList.add('on');
        document.getElementById('btn-petal').classList.add('active');
    }
    Object.keys(LAYER_CONFIG).forEach(loadLayer);
    map.on('complete', function () {
        buildSearchIndex();
        updateCounts();
        console.log('常德市城市公共服务WebGIS系统初始化完成');
    });
})();
