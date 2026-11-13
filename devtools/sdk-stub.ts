export const FieldType = {
  Text: 1,
  Number: 2,
  SingleSelect: 3,
  MultiSelect: 4,
  DateTime: 5,
  Checkbox: 7,
  CreatedTime: 1001,
  ModifiedTime: 1002,
};

export const DashboardState = {
  Create: 'Create',
  Config: 'Config',
  View: 'View',
  FullScreen: 'FullScreen',
};

export const SourceType = { ALL: 'ALL', VIEW: 'VIEW', CUSTOM: 'CUSTOM' };
export const ViewType = { NotSupport: 0, Grid: 1, Kanban: 2, Form: 3, Gallery: 4, Gantt: 5, Hierarchy: 6, Calendar: 7, WidgetView: 100 };
export const GroupMode = { ENUMERATED: 'enumerated', INTEGRATED: 'integrated' };
export const ORDER = { ASCENDING: 1, DESCENDING: 2 };
export const DATA_SOURCE_SORT_TYPE = { VALUE: 'VALUE', VIEW: 'VIEW', GROUP: 'GROUP' };

const holder: {
  table: any;
  tables: any[];
  tableList: any[];
  ranges: any[];
  config: any;
  saved: any[];
  records: any[];
  dialog: any[];
  rendered: number;
  renderFails: boolean;
  state: string;
  fireConfig?: (ctx: { data: any }) => void;
} = {
  table: null,
  tables: [],
  tableList: [],
  ranges: [],
  config: null,
  saved: [],
  dialog: [],
  rendered: 0,
  renderFails: false,
  state: 'View',
};

export const bitable = {
  base: {
    getActiveTable: async () => holder.table,
    getTableById: async (id: string) => holder.tables.find(t => t.id === id) ?? holder.table,
    getTableMetaList: async () => holder.tableList,
    getTableList: async () => holder.tables,
  },
  bridge: {
    getBitableUrl: async ({ recordId }: any) => `https://mock.bitable.cn/feed?record=${recordId}`,
  },
};

export const ui = {
  showRecordDetailDialog: async (params: any) => {
    holder.dialog.push(params);
    return true;
  },
};

export const dashboard = {
  get state() {
    return holder.state;
  },
  getTableDataRange: async (tableId: string) => {
    if (!holder.ranges.length) throw new Error('宿主没有给出数据范围');
    void tableId;
    return holder.ranges;
  },
  getCategories: async (tableId: string) => (holder.tables.find(t => t.id === tableId) ?? holder.table)?.getFieldMetaList() ?? [],
  getConfig: async () => {
    if (!holder.config) throw new Error('仪表盘里没有已保存的配置');
    return holder.config;
  },
  saveConfig: async (config: any) => {
    holder.saved.push(config);
    holder.config = config;
    return true;
  },
  getPreviewData: async () => [],
  getData: async () => [],
  setRendered: async () => {
    if (holder.renderFails) throw new Error('宿主容器已关闭');
    holder.rendered++;
    return true;
  },
  getTheme: async () => ({ themePalette: [], labelColorTokenList: [], chartBgColor: '#fff' }),
  onDataChange: () => () => {},
  onConfigChange: (callback: (ctx: { data: any }) => void) => {
    holder.fireConfig = callback;
    return () => {
      holder.fireConfig = undefined;
    };
  },
  onThemeChange: () => () => {},
};

export const setTable = (t: any) => {
  holder.table = t;
  holder.tables = t?.id ? [t, ...holder.tables.filter(x => x.id !== t.id)] : holder.tables;
};

export const setTableList = (list: any[]) => {
  holder.tableList = list;
};

export const setDashboard = (patch: Partial<typeof holder>) => Object.assign(holder, patch);

export const lastSaved = () => holder.saved.at(-1);

export const savedList = () => holder.saved;

export const openedRecords = () => holder.dialog;

export const renderedCount = () => holder.rendered;

export const fireConfigChange = (config: any) => holder.fireConfig?.({ data: config });
