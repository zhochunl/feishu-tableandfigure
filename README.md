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

1. 仪表盘「添加图表」选本插件，进入配置态。
2. 选数据表和数据范围（全部数据或某个视图）。
3. 配汇总层级：第一层选 `AESOC`，需要按人计数就把去重字段设为 `SUBJECT`；「添加层级」继续加 `AEPT` 等，层数不限。
4. 点「保存配置」，配置写回宿主，退出配置态后展示态按同一份配置渲染。
5. 三线表按例次降序展示，父层可折叠；点数字弹出该组记录，点「详情」打开记录卡片。

## 配置怎么存

`dashboard.saveConfig` 存两份，宿主浅合并 `{...已有, ...payload}`：

- `dataConditions`：`tableId`、`dataRange`、每层 `groups`（`GroupMode.ENUMERATED` 多选拆开统计）、`series: 'COUNTA'`。这让宿主的数据源和分组跟插件保持一致。
- `customConfig.aeThreeLine`：`{ version, tableId, dataRange, levels }`，`levels` 用 **fieldId** 而不是字段名，字段改名不丢配置。

读回来时 `customConfig` 优先，缺了就退回 `dataConditions[0].groups`，两者都没有 `tableId` 才算未配置。

**计数为什么必须本地读记录**：宿主的 `Rollup` 只有 `SUM / AVERAGE / MAX / MIN`，没有去重计数，而且 `getData` 返回的 `IDataItem` 不带 `recordId`。所以例数和钻取都要求插件自己持有记录集合，不能只信宿主算好的聚合值。

## 计数口径

- **例次** = 该组内的记录条数，一条 AE 记录算一次。
- **例数** = 该组内去重字段的不同取值个数，只有配了去重字段的层才有这一列，没配则显示 `—`。
- 父层的例数是父层自身记录集合去重的结果，**不是**把各子层的例数相加。所以同一个受试者在同一 AESOC 下的两个 AEPT 各发生一次，父层仍算 1 人。
- 去重字段为空的记录不计入例数（无法归属到具体对象），但仍计入例次。
- 分组字段是多选时，一条记录同时计入它的每个取值，因此各组之和可以大于总例数——这是 AE 汇总的常规口径。
- 分组字段为空归到「缺失」组，固定排在最后。

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

联调台在 `http://127.0.0.1:4173/devtools/mock-host.html`：它模拟仪表盘宿主，内置一张 mock AE 表（单选 AESOC、多选 AEPTMOD、日期、两个视图、2% 空值）和一张 DM 表，可以调记录数、受试者数、AESOC 数、多选占比，还能把宿主单页上限调小来验证分页降档。改完参数点「重建数据并重载」。

状态切换靠重设 iframe 的 hash，联调台选「新建配置 / 修改配置 / 全屏 / 展示态」即是切 `#/?isCreate=1` 等；`savedConfig` 是宿主唯一的配置来源，「查看」能把 `saveConfig` 收到的 payload 打出来核对往返。「记录卡片」计数验证钻取走的是 `UI.showRecordDetailDialog`。

SDK 的 key 形如 `bitable.Dashboard_getConfig`，所以 mock 宿主先取最后一个 `.` 之后的串，再按第一个 `_` 拆模块和方法。

## 已知限制

- 分组维度只有「选哪个字段」，没有治疗组分列、没有 n (%) 的分母、没有暴露人数（DM 表关联）。要做按治疗组展开的列联表，需要先加跨表关联。
- 数据是一次性快照，不订阅表变更；宿主在图表上配的独立筛选器对本插件无效。改完记录要重新进配置态保存或刷新。
- 每次数据源变化都整表重读一遍，大表在配置态来回切会慢。
- 弹窗列表最多渲染前 200 条。
- 展示态的表名来自 `listTables()`；宿主换了表又没重新保存配置时，标题会退回显示 `tableId`。
