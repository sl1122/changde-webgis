# 常德市城市公共服务 WebGIS 系统 · 接手说明（README）

> 这是项目的**接手入口文档**。新接手的人 / AI 请先通读本文件，再按需要翻阅同目录《项目交接说明.md》《数据说明.md》。所有结论以仓库内实际文件为准；本文档若与代码不一致，以代码为准并回头订正本文。

| 项 | 内容 |
|---|---|
| 作品 | 常德市城市公共服务 WebGIS 系统（WebGIS 开发课程作业） |
| 作者 | 佘磊　学号 202412040132　班级 地信24101 |
| 线上地址 | https://sl1122.github.io/changde-webgis/ |
| 当前版本 | **v133**（代码基线 commit `5f58b2c`；含 v132 衍生功能/性能/材质同步 `29b57b3` + v133 属性表贴边与滚轮修复） |
| 仓库 | https://github.com/sl1122/changde-webgis.git ，分支 `main`；本地 commit + push 即上线 GitHub Pages |
| 课程笔记（语雀，需登录） | 总笔记（作业任务与历次迭代语境）：https://www.yuque.com/u55073446/hwc5ho/lr0ut03vgnvtp0rr?singleDoc ；第 13 节：https://www.yuque.com/u55073446/hwc5ho/qgfom6puvqnkv7yq?singleDoc ；第 14 节：https://www.yuque.com/u55073446/hwc5ho/twgenhbxmce7adek ；第 15 节：https://www.yuque.com/u55073446/hwc5ho/ivwgnov43ddqnklg |
| 技术栈 | 原生 HTML/CSS/JS 三文件，无构建、无框架；地图引擎 Leaflet 1.9.4 + leaflet.markercluster 1.5.3（jsDelivr CDN）；字体自托管 `fonts/` |

---

## 一、快速开始

### 1. 本地预览（二选一）

- **离线双击**：直接用浏览器打开 `index.html`。内置 GeoJSON 已内嵌进 `index.html` 的 `<script id="geo-data">`，`file://` 下 `fetch` 本地文件被浏览器拦截时自动回退到内嵌数据，可离线跑通。
- **本地静态服务**：在仓库根目录起任意静态服务即可（原开发机用仓库外的 `_serve.py`，端口 8000）。
  > 注意：中文路径下不要用 `python -m http.server --directory <中文路径>`，命令行中文路径会被按 ANSI 解码，服务目录静默变空、页面 404。建议把服务根目录设为仓库根，或直接双击 `index.html`。

### 2. 无需安装依赖 / 无需构建

不打包、不编译、不跑 npm。改动 `index.html` / `style.css` / `main.js` 后刷新浏览器即可看到；部署靠 git push（见第六节工作流）。

### 3. 核对线上与本地是否一致

打开 `https://sl1122.github.io/changde-webgis/index.html?ts=<随机数>`（带随机参数避 Pages 缓存 40–60s），核对标题栏右侧版本号、`style.css?v=`、`main.js?v=` 三处一致。

---

## 二、目录结构（仓库内）

| 路径 | 职责 |
|---|---|
| `index.html` | 页面骨架、标题栏 / 侧栏 / 底部导航 / 各浮起面板 HTML；内嵌超长单行 `<script id="geo-data">`（内置点线 GeoJSON 兜底数据，**勿手工折行**） |
| `style.css` | 全部样式：布局、材质包令牌、玻璃拟态、纸笺覆盖、夜间、响应式断点、面板拖拽把手、动效降级 |
| `main.js` | 全部交互逻辑：数据加载、底图链、坐标转换、打点与聚合、测量、定位、自建要素模型、图层树与三态、导入导出、材质包、持久化、交互期降载 |
| `data/school.geojson` `data/hospital.geojson` `data/scenic.geojson` `data/road.geojson` | 内置四类要素 GeoJSON（GCJ-02 原始坐标） |
| `data/data/` | 历史遗留嵌套副本，冗余无碍，勿重复引用 |
| `fonts/` | 自托管 Inter（拉丁）+ Noto Sans SC（中文）woff2 |
| `数据说明.md` | 各图层要素数量、来源、坐标口径、范围收敛过程（静态数据档案） |
| `项目交接说明.md` | 完整技术档案：机制细节、版本主线、实测读数、踩坑记录、开放项（细节查它） |
| `移动端适配执行规划书.md` | v77→v78 历史规划书，仅作背景，不代表当前状态 |
| `v115执行规划书.html` | 历史过程稿，保留备查 |
| `单文件手机版.html` | **本地遗留，未纳入 git 跟踪**；停留在 v113，未同步 v116–v129，勿当作现行版本 |
| `.gitignore` | 忽略 `_vshot.html`、`_shots/`、`graphify-out/` |

> 仓库外、不随分发的本机附属物（原开发机才有）：回退备份 `_backup/`、回归截图 `_shots/`、探针脚本、本地预览 `_serve.py`、个人学习记忆库。接手后如需截图 / 备份，按自己的环境另建目录即可。

---

## 三、核心机制速览（细节见《项目交接说明.md》第三节）

1. **底图链**：高德矢量 / 栅格 + OSM / CartoDB / ArcGIS 等开源瓦片，多源切换；底图链与降级顺序以 `main.js` 中 `TILE_CHAIN` 为准。
2. **坐标系**：内置数据为高德原始 **GCJ-02**，高德底图下零转换直用；切到 WGS-84 开源底图时动态 GCJ-02 → WGS-84 转换；浏览器定位为 WGS-84，高德底图下转回 GCJ-02 显示。坐标口径详见《数据说明.md》。
3. **数据加载**：`fetch('data/<key>.geojson')` 优先，失败回退内嵌 `geo-data`；`GEO_KEYS = school/hospital/scenic/road`。
4. **材质包**：白天四包 `theme-peach / osmanthus / leaf / rose`，夜间 `theme-night`，纸笺 `theme-paper`，综合 `auto` 轮播（**不含夜间**）。颜色 / 圆角 / 字阶 / 玻璃参数全部走 CSS 变量（`:root` 令牌）。
5. **打点与聚合**：学校 / 医院 / 景点 / 道路 + 自建要素；divIcon 点 + `markercluster` 聚合；聚合态子点被气泡包裹时 DOM 未渲染，hover 挂不上（Leaflet 限制），点击联动走 `zoomToShowLayer` 兜底。
6. **测量**：点距 / 面积，单位自动换算（米 ↔ 千米 / 平方米 ↔ 公顷）。
7. **自建要素模型**：导入 GeoJSON 即图层；文件 → 地类两级树；全选 / 全隐 / 半选 indeterminate 三态；选中条实时汇总；可删除单文件；编辑权限开关。
8. **导出模型**：内置点与自建点均可导出，`collectBuiltinFeatures / collectCustomFeatures / buildExportGeoJSON / downloadGeoJSON` 自洽导出 GeoJSON，带坐标系备注。
9. **玻璃拟态**：浮起面板 `backdrop-filter` 磨砂 + 多层柔影 + 细白边；透明度 / 模糊 / 饱和度 / 折射四维滑杆联动。**纸笺包不跟随玻璃滑杆**。
10. **面板拖拽**：既有 `makeDraggable(panel, storageKey)`，按住标题栏拖动、位置持久化；六个浮起面板均已接入。
11. **交互期降载**：地图拖动 / 缩放期间临时关闭部分 `backdrop-filter` 以保帧率；浮起面板已豁免出该降载。**只关磨砂，不要顺手 `filter:none`**（否则气泡投影、夜间瓦片暗化突变）。
12. **持久化**：状态存 localStorage，键名与结构属红线（见第五节），新增键可以，**禁改名、禁改既有结构**。

---

## 四、代码地图（行号会漂移，按关键词检索）

### `index.html`
- 版本号三处之一：`<link rel="stylesheet" href="style.css?v=129">`、`<script src="main.js?v=129">`、`<span class="ver-tag" id="ver-tag">v129</span>`。
- 各面板 id / 标题类名：`#settings-panel.settings-panel`（`.settings-title`）、`#basemap-panel.basemap-panel`、`#mark-panel.mark-panel`、`#export-panel.settings-panel.export-panel`、`#legend-panel.legend-panel`（`.legend-title`）、`#records-panel.records-panel`（`.rp-head`，内含 `.rp-actions` 按钮组 + `.rp-close`）。
- 侧栏常驻：`.sidebar` 内 `.panel-title`（图层管理 / 地点搜索 / 数据说明），**质感恒定，不跟随玻璃滑杆漂移**。
- 面板显示：`el.hidden=false` + `el.classList.add('open')`；`[hidden]{display:block!important}` 覆盖。

### `main.js`（约 4600 行，IIFE 包裹，`'use strict'`）
- `TILE_CHAIN`（底图链）→ `fetchOrEmbed` / `DATA` / `EMBED`（数据加载）→ 工具函数 `havMeters / esc`。
- 导入文件即图层：搜 `v122：导入文件即图层`；自建渲染 `renderCustom`；导出 `buildExportGeoJSON`；材质包 `applyPack`；更新日志 `CHANGELOG`；交互期降载与动画减负搜 `v123：地图交互期`、`v93：卡片/面板过渡动画减负`。
- 控制台调试钩子（上线保留）：`window.__appMode()` 读自建层状态（返回 JSON 字符串）；`window.__cfImport(text, name)` 手动导入；`window.__cfExportAll()` 函数返回内置 + 自建全部导出结构；`window.__cfExport` 为当前自建图层导出结构**对象**（非函数）。

### `style.css`（约 4100 行）
- `:root` 令牌：`--radius / --radius-md / --radius-sm`、`--fs-title / --fs-body / --fs-aux`、`--glass-blur / --glass-alpha / --glass-sat / --glass-shadow / --glass-sheen / --glass-edge`、`--sb-*`、`--header-h`。
- 语义色：`--school #2563eb / --hospital #dc2626 / --scenic #059669 / --road #d97706`；自建四类 `--cf-facility / --cf-bus / --cf-park / --cf-area`（白天 / 夜间 / 纸笺三套）。
- 纸笺覆盖段：搜 `theme-paper`；纸底直角、墨棕边、宋体、`backdrop-filter:none`，**不被玻璃基线污染**。

---

## 五、红线约束（改动前必须遵守）

1. **纸笺（宣纸）包保持独立**：直角、宋体、墨棕，不跟随玻璃透明度 / 模糊滑杆，不被新玻璃基线污染；白天四包 + 夜间可自由改。
2. **左栏常驻图层管理质感恒定**，不跟随玻璃滑杆漂移。
3. **localStorage 键名与既有结构禁改名 / 禁改结构**，只允许新增键。既有键：
   `cd_user_roads`、`cd_records_v1`、`cd_theme`、`cd_glass`、`cd_glass72`、`cd_adv_open`、`cd_fab_anchor77`、`cd_basemap`、`cd_refract`、`cd_custom_features`、`cd_edit_geom`、`cd_layer_gone`、`cd_layer_fold`、`cd_layer_order`、`cd_cf_order`、`cd_poi_gone`，以及六个面板位置键 `cd_panel_settings / cd_panel_basemap / cd_panel_mark / cd_panel_export / cd_panel_legend / cd_panel_records`。`cd_fab_pos` 已作废，勿复加。
4. 设施点保持语义色可区分，不与学校蓝撞色；综合轮播不含夜间。
5. 不加字号调节滑杆；一套尺寸 / 圆角族说话；过渡短、无回弹。
6. 交互期降载**只关 `backdrop-filter`**，不要顺手 `filter:none`。
7. 改完必须多端验证：桌面 1440×900 + 手机 390×844 双截图，标题栏 / 侧栏 / 底部导航不丢不遮。
8. 改完必须 push GitHub Pages，并核验线上三处版本号（`style.css`、`main.js`、标题 `ver-tag`）一致。
9. 交接说明 / README 随版本同步版本主线、当前状态与开放项，不留旧版本号。

---

## 五-A、用户反复强调的协作与交付要求（高频，勿遗漏）

> 以下是用户在多轮迭代中反复强调的习惯与底线，接手模型每次响应前对照一遍。技术红线见第五节，本节是协作 / 交付口径。

1. **先规划，后执行**：拿到新需求或笔记更新，先读笔记、盘点已有功能、出执行规划书与优化建议，**先不着急改代码**；规划经用户看过、拍板后再动手。优先保留已有功能，不推翻重写既有链路。
2. **数据真实，禁止编造**：学校 / 医院 / 景点 / 道路点位必须来自高德开放平台真实 POI 返回与周边复核，坐标不得手工虚构；新增要素走导入 / 打点链路，不往 GeoJSON 里手编坐标。
3. **直接给成品与实证**：回复用中文，先结论后原理，结构化交付；改动要附可核验的证据（探针读数 / 双端截图 / 线上版本号），拒绝空泛铺垫与纯理论。
4. **新功能先对照已有实现**：笔记里要求的能力，先在代码里找是否已具备（按第四节代码地图关键词检索），避免重复造轮子、避免两套监听 / 两套状态打架。
5. **保留既有交互与持久化**：不随意删既有功能、不改名 localStorage 键；废弃功能需用户确认后再移除。
6. **视觉一致性**：设施点保持语义色可区分、不与学校蓝撞色；不加字号调节滑杆；一套尺寸 / 圆角族说话；过渡短、无回弹；综合轮播不含夜间。
7. **文档同步义务**：每轮迭代结束同步更新 README、《项目交接说明.md》的版本主线 / 当前状态 / 开放项，不得残留旧版本号。

---

## 六、接手模型的规划与执行流程

### 阶段一：规划（先出方案，不改代码，等拍板）

1. **读文档对现状**：先读本 README →《项目交接说明.md》→《数据说明.md》；带随机 `?ts=` 打开线上对一遍三处版本号，确认本地与线上一致。
2. **读课程笔记**：打开头部信息表里的语雀总笔记 / 对应节子文档，读最新更新部分；记录笔记提出的功能点与验收口径。
3. **盘点已有功能**：按第四节代码地图逐条对照——笔记要求的能力哪些已实现、落在哪个函数 / 面板 / 变量；哪些缺失、哪些有缺陷。聚合态 hover 挂不上等 Leaflet 固有限制要标注清楚。
4. **差距分级出规划书**：把待办分成 P0（缺陷 / 报错 / 功能不闭环）、P1（体验 / 联动 / 一致性）、P2（优化 / 性能 / 预留）。每条写清：改哪个文件、影响哪条机制、方案要点、风险与回退、是否触碰第五节红线。
5. **交用户拍板**：规划书先给用户看，不直接动代码；确认范围、取舍与开放项后再进入阶段二。

### 阶段二：执行（拍板后落地）

1. **明确改动范围**：先判断改哪个文件、影响哪些机制（底图链 / 材质包 / 打点 / 测量 / 玻璃参数 / 自建要素 / 图层管理）。
2. **改前备份**：把将改的 `index.html / style.css / main.js` 复制到本机备份目录（原机 `_backup/v###-pre-*`）。
3. **改代码**：遵循第五节红线；版本号三处一并 +1（CSS `?v=`、JS `?v=`、`ver-tag` 文字）；`main.js` 顶部 `CHANGELOG` 顶部插新版本条目。
4. **本地校验**：`node --check main.js`；CSS 花括号配平；本地双端截图回归（桌面 + 手机）；重点复核纸笺包与夜间态未被污染。
5. **提交推送**：在仓库根 `git add -A && git commit`，再 push `origin main`。
   > 原开发机 git 不在 PATH，用绝对路径；push 需走本机代理。换机器按自身环境调整：
   > ```powershell
   > $repo = '<仓库根目录>'
   > $git  = '<git 可执行路径，若已在 PATH 则用 git>'
   > & $git -C $repo add -A
   > & $git -C $repo commit -m "v###: <一句话变更>"
   > & $git -C $repo -c http.proxy=http://127.0.0.1:7897 push origin main
   > ```
6. **线上核验**：带随机 `?ts=` 打开线上，确认三处版本号一致、新规则随资源上线、双端渲染正常。
7. **同步文档**：更新本 README 与《项目交接说明.md》的版本主线、当前状态、开放项。

---

## 七、已知坑与不可用手段（勿重试）

- `git diff index.html` 因 geo-data 单行超长会爆超大输出，用 `git diff --stat` 看概览。
- 中文路径下 `python -m http.server --directory` 静默空目录 404（见第一节）。
- 浏览器 `file://` 下 `fetch` 本地 JSON 必被拦截，靠内嵌 `geo-data` 兜底。
- 合成 `WheelEvent` 触发不了 Leaflet 缩放；纯合成 `MouseEvent` 驱动不了 `L.Draggable`；聚合态被包裹子点 `getElement()` 返回 null，hover 挂不上。
- 本地记忆 API `http://localhost:8051` 在原机超时不可达；截图以 headless 脚本为准，浏览器内嵌截图 / 桌面截图工具可能全白或不回传。
- `data/data/` 嵌套冗余目录无碍；历史废弃目录 / 旧副本 / 单文件版均勿走（见交接说明第二节「废弃路径」）。

---

## 八、当前状态与开放待拍板项（v129）

**已闭环（v129，commit `7055549`）**：浮起卡片玻璃对齐参考样（乳白系数 1.0、双层柔影、blur 10px）；导出 / 图例 / 记录三面板接入既有拖拽；修复点击 / 拖地图时面板透明度与磨砂跳变（交互期降载豁免浮起面板，移除点击触发的去磨砂监听）；纸笺补齐导出 / 记录面板纸底直角分支。

**以下为用户尚未拍板的开放项，接手后勿擅自改动，先与用户确认：**

1. 两级图层树是否恢复拖动排序（v122 已删 kind 行拖拽，`cd_cf_order` 现仅决定文件内地类先后）。
2. 手机端低缩放下 9 个自建点永久标签互相压叠，是否加等级门槛。
3. `单文件手机版.html` 停 v113，未同步 v116–v129，是否继续维护。
4. 道路（线要素）单条删除未做，删点链路只覆盖学校 / 医院 / 景点。
5. 夜间材质下「文件→地类」两级树与选择条尚未截图实测。
6. 真机拖动若仍发飘，可再压大面板 blur 10→6–8px；夜间是否改乘算覆盖层替代 41 块瓦片 brightness 滤镜，待取舍。
7. 内置点多选行为语义待确认（手机无 Shift 下普通点击是追加还是取消；选择条文案口径；500+ 点标签策略）。
8. 手机触摸拖动降载未单独压测（原探针只发鼠标事件，未加触摸模拟）。

---

## 九、文档导航

| 文档 | 用途 |
|---|---|
| `README.md`（本文件） | 接手入口：项目定位、快速开始、红线、工作流、开放项 |
| `项目交接说明.md` | 完整技术档案：机制逐条、版本主线表、各版实测读数、踩坑明细 |
| `数据说明.md` | 数据来源、数量、坐标口径与范围收敛过程 |
| `移动端适配执行规划书.md` | 历史背景稿，非当前状态 |
