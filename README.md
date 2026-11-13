# 临床试验三线表插件

在多维表格仪表盘的图表区块里，对 AE 之类的记录做**多级分组计数 + 去重计数**，输出三线表，点数字看该组记录，再点「详情」用宿主原生记录卡片打开那条数据。纯前端，不需要后端。

## 扩展形态

装在仪表盘上，占据一个图表区块，和飞书自带图表一样有配置态与展示态。

早前一版这里写的结论是「`@lark-base-open/js-sdk` 没有 dashboard / chart API，只能做边栏插件」——那是当时装的 `^0.3.0` 的结论，错的。`1.0.2` 起有 `bitable.dashboard` 整套消息模块，本插件已升到 1.0.2 并改成仪表盘形态。

状态由 URL hash 的 query 决定（SDK 从 `location.href` 读）：

| 场景 | URL |
| --- | --- |
| 新建图表 | `#/?isCreate=1` |
| 编辑配置 | `#/?isConfig=1` |
| 全屏 | `#/?isFullScreen=1` |
| 展示态 | 无参数 |

配置态显示配置面板，展示态只渲染表；`dashboard.state` 决定这条分支。

「点数据点弹出数据项列表」在这里的正解是 `ui.showRecordDetailDialog({ tableId, recordId, fieldIdList })`——弹的就是宿主自带的记录卡片，不再靠 `bridge.getBitableUrl` 拼深链。

## 使用流程

1. 仪表盘「添加图表」选本插件，进入配置态：左边是三线表预览，右边 350px 是配置面板。
2. 表头配置（可选）：选一张表头表单（如 DM）。不选列变量就用它的记录数当一个「总计」列的分母；选了列变量（如 `TRT01P`）就每个取值一列。
3. 连接变量（配了表头列变量才生效）：指定表头表单与数据表里代表同一含义的变量（如两侧的 `SUBJECT`），明细按它归到各列。两侧只认字段名，不认 fieldId。
4. 数据表配置：选数据表和数据范围（全部数据或某个视图），再配汇总层级——第一层 `AESOC`、第二层 `AEPT`，层数不限。每层可勾「去重」并选去重变量（如 `SUBJECT`）出例数，可勾「百分比」出 n (%)。
5. 点「保存配置」，配置写回宿主，退出配置态后展示态按同一份配置渲染。
6. 三线表按例次降序展示，父层可折叠；一格里是「例次（例数）百分比」，三个数字属同一个数据块，点任意一个都弹出该组该列的例次记录列表，点行打开宿主原生记录卡片。

变量下拉的顺序跟数据表里的列顺序一致（表级 `getFieldMetaList` 不保证顺序，插件按视图的有序字段列表校正）。

## 配置怎么存

`dashboard.saveConfig` 存两份，宿主浅合并 `{...已有, ...payload}`：

- `dataConditions`：`tableId`、`dataRange`、每层 `groups`（`GroupMode.ENUMERATED` 多选拆开统计）、`series: 'COUNTA'`。这让宿主的数据源和分组跟插件保持一致。
- `customConfig.aeThreeLine`：`{ version: 2, tableId, dataRange, levels, header?, join? }`，`levels` 是 `{ fieldId, dedupe, distinctFieldId, percent }`，`header` 是 `{ tableId, fieldId? }`，`join` 是两侧的 fieldId。全部用 **fieldId** 而不是字段名，字段改名不丢配置。

跨表连接和去重宿主都算不了，所以只存在于 `customConfig`；`dataConditions` 里没有表头表的痕迹。读回来时 `customConfig` 优先，缺了就退回 `dataConditions[0].groups`（丢失去重、分列与百分比口径），两者都没有 `tableId` 才算未配置。v1 配置会自动迁移：v1 没有去重开关，配了 `distinctFieldId` 就视作勾选去重。

**计数为什么必须本地读记录**：宿主的 `Rollup` 只有 `SUM / AVERAGE / MAX / MIN`，没有去重计数，而且 `getData` 返回的 `IDataItem` 不带 `recordId`。所以例数和钻取都要求插件自己持有记录集合，不能只信宿主算好的聚合值。

## 计数口径

- 列来自表头配置：不配表头只有一列「全部」且没有分母；配了表头不选列变量是一列「总计」（分母=表头表记录数）；选了列变量就是每个取值一列（分母=该列表头记录数）。
- **例次** = 该组该列内的记录条数，一条 AE 记录算一次。
- **例数** = 该组该列内去重字段的不同取值个数，只有勾了「去重」的层才出这个括号。
- **百分比** = 分子是勾了去重时的例数、否则例次，分母是该列的 total；所以同组各列之和可能超 100%（多选展开）。没配表头时没有分母，百分比不显示，勾选框也会禁用。
- 父层的例数是父层自身记录集合去重的结果，**不是**把各子层的例数相加。所以同一个受试者在同一 AESOC 下的两个 AEPT 各发生一次，父层仍算 1 人。
- 去重字段为空的记录不计入例数（无法归属到具体对象），但仍计入例次。
- 分组字段是多选时，一条记录同时计入它的每个取值，因此各组之和可以大于总例数——这是 AE 汇总的常规口径。
- 分组字段为空归到「缺失」组，固定排在最后。
- 分列时按连接变量归列，连接不上表头表的记录不进任何一列，表格上方会提示有多少条。

## 单元格到分组的转换

读表阶段就把单元格归一化成文本，界面与汇总只看字段名，不接触原始结构：

| 字段类型 | 取值方式 |
| --- | --- |
| 单选 | 取 `text` |
| 多选、人员、群 | 逐项取 `text` / `name`，展开成多个值 |
| 日期、创建/修改时间 | 毫秒戳格式化成 `YYYY-MM-DD`，带时分时补时间 |
| 复选框 | 是 / 否 |
| 自动编号 | 取 `value` |
| 文本、数字、URL、电话 | 原样 |
| 空值 | 空数组，归到「缺失」 |

## 数据读取

- 字段元信息用一次 `getFieldMetaList` 拿全，不逐字段 `getName`/`getType` 往返。
- **变量下拉的顺序按表内列顺序**：`table.getFieldMetaList()` 不保证顺序，插件改问 `view.getFieldMetaList()`（SDK 注明有序），表级那份只用来补全视图里没显示的字段；问不到视图时退回表级顺序。
- 表头表是独立的一次读取（字段 + 全表记录），只用来算列和分母；换表头表不会重读明细表。
- 数据范围是视图时，`viewId` 直接透传给 `getRecords`，筛选交给宿主做；`filterInfo` 原样保存在配置里。
- 记录用 `getRecords` 分页读，单页从 1000 起步；只有单页条数被拒时才沿 1000 → 500 → 200 → 100 降档重试，其它错误直接抛出。
- 读完只保留归一化后的文本，钻取用的明细也来自这份内存数据，**点数字不会再回宿主取记录**。
- 行内存活上限受多维表格版本限制（基础版/商业标准版 2000 行，商业专业版 2 万行，商业旗舰版/企业版 5 万行），但读多少行就占多少浏览器内存，几万行的 AE 表请留意。
- 每次渲染完调 `dashboard.setRendered()`；独立打开页面（没有宿主）时这个调用会失败，吞掉。

## 技术栈

- Vite + React 18 + TypeScript + `@lark-base-open/js-sdk` 1.0.2
- 主包约 980 KB，其中绝大部分是 SDK 自带的 antd，`importdata` 也一样，不是本插件引入的。

## 目录结构

```
tableandfigure/
├── src/
│   ├── App.tsx                      # 仪表盘状态机：配置态/展示态、读数据、汇总
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── ConfigPanel.tsx          # 表 / 数据范围 / 层级与去重字段 / 保存
│   │   ├── ThreeLineTable.tsx       # 三线表：缩进分层 + 可折叠 + 数字可点
│   │   └── DrillDownModal.tsx       # 组内记录列表 + 宿主原生记录卡片
│   └── lib/
│       ├── types.ts                 # ChartConfig / StoredLevel / LevelConfig / DataRow / GroupRow
│       ├── config.ts                # fieldId 与字段名翻译、saveConfig payload、配置解析
│       ├── cellText.ts              # 单元格 → 文本数组
│       ├── bitable.ts               # 表/字段/范围/分页读记录、saveConfig、记录卡片
│       └── aeAggregate.ts           # 多级分组与去重
├── devtools/                        # 仅开发用，不打进 dist
│   ├── mock-host.html               # 按 JS SDK postMessage 协议模拟仪表盘宿主
│   ├── sdk-stub.ts                  # 回归测试用的 SDK 替身
│   ├── agg-test.ts                  # 计数与去重口径
│   ├── pipe-test.ts                 # 读取通路：fieldId 映射、类型归一化、降档、5 万行、viewId 透传
│   ├── config-test.ts               # 配置往返、层级解析、范围回退、setRendered 吞异常
│   ├── render-test.tsx              # 界面结构与弹窗
│   └── run-tests.mjs                # 四个套件的入口
├── index.html
├── package.json
└── vite.config.ts
```

## 本地开发

```bash
npm install
npm run dev      # http://127.0.0.1:4173
npm test         # 跑四个回归套件
npm run build    # 产物在 dist/
```

联调台在 `http://127.0.0.1:4173/devtools/mock-host.html`：它模拟仪表盘宿主，内置一张 mock AE 表（单选 AESOC、多选 AEPTMOD、日期、两个视图、2% 空值）和一张 DM 表（含 `TRT01P` 试验组/对照组，用来验证表头分列与连接变量），可以调记录数、受试者数、AESOC 数、多选占比，还能把宿主单页上限调小来验证分页降档。改完参数点「重建数据并重载」。

字段顺序也做了专门处理：`WidgetTable.getFieldMetaList` 故意倒着返回，只有 `WidgetView.getFieldMetaList` 给有序列，插件要靠视图拿顺序、再用表元信息补全隐藏字段；下拉乱了或少列，先看 mock 日志里 `WidgetView.getFieldMetaList` 有没有被调到。

状态切换靠重设 iframe 的 hash，联调台选「新建配置 / 修改配置 / 全屏 / 展示态」即是切 `#/?isCreate=1` 等；`savedConfig` 是宿主唯一的配置来源，「查看」能把 `saveConfig` 收到的 payload 打出来核对往返。「记录卡片」计数验证钻取走的是 `UI.showRecordDetailDialog`。

SDK 的 key 形如 `bitable.Dashboard_getConfig`，所以 mock 宿主先取最后一个 `.` 之后的串，再按第一个 `_` 拆模块和方法。

## 已知限制

- 分列只支持「一张表头表 + 一个连接变量」的关联，连接按**字段名**匹配（两张表的 fieldId 体系不同），两侧字段名任一个被删掉就整体退回不分列，不静默错算。
- 表头表只取全表记录算列与分母，不受数据表的视图筛选影响。
- 一列的 total 是该列表头记录数；如果同一受试者在表头表里出现多行，分母会按记录数而不是人数。
- 数据是一次性快照，不订阅表变更；宿主在图表上配的独立筛选器对本插件无效。改完记录要重新进配置态保存或刷新。
- 每次数据源变化都整表重读一遍，大表在配置态来回切会慢。
- 弹窗列表最多渲染前 200 条。
- 展示态的表名来自 `listTables()`；宿主换了表又没重新保存配置时，标题会退回显示 `tableId`。
