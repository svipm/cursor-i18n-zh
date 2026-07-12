'use strict';

const OpenCC = require('opencc-js');

const DEFAULT_LOCALE = 'zh-cn';
const OPENCC_TO_TRADITIONAL = OpenCC.Converter({ from: 'cn', to: 'twp' });

const PHRASES = [
  ['图形用户界面', '圖形使用者介面'], ['键盘快捷键', '鍵盤快速鍵'],
  ['通过命令行', '透過命令列'],
  ['命令行工具', '命令列工具'], ['开发者工具', '開發人員工具'],
  ['配置文件', '設定檔'], ['日志文件', '記錄檔'],
  ['代码片段', '程式碼片段'], ['代码补全', '程式碼補全'],
  ['环境变量', '環境變數'], ['异常处理', '例外處理'],
  ['包管理器', '套件管理員'], ['驱动程序', '驅動程式'],
  ['用户界面', '使用者介面'], ['文件路径', '檔案路徑'],
  ['文件名称', '檔案名稱'], ['文件类型', '檔案類型'],
  ['文件内容', '檔案內容'], ['代码仓库', '程式碼儲存庫'],
  ['源代码', '原始碼'], ['开发者', '開發人員'], ['命令行', '命令列'],
  ['快捷键', '快速鍵'], ['调试器', '偵錯工具'], ['断点', '中斷點'],
  ['运行时', '執行階段'], ['依赖项', '相依項'], ['依赖', '相依性'],
  ['软件包', '軟體套件'], ['软件', '軟體'], ['硬件', '硬體'],
  ['服务器', '伺服器'], ['缓存', '快取'], ['存储', '儲存'],
  ['线程', '執行緒'], ['进程', '處理序'], ['堆栈', '堆疊'],
  ['日志', '記錄'], ['消息', '訊息'], ['信息', '資訊'], ['响应', '回應'],
  ['字段', '欄位'], ['函数', '函式'], ['对象', '物件'], ['数组', '陣列'],
  ['字符串', '字串'], ['布尔值', '布林值'], ['返回值', '回傳值'],
  ['仓库', '儲存庫'], ['配置', '設定'], ['界面', '介面'], ['交互', '互動'],
  ['搜索', '搜尋'], ['程序', '程式'],
  ['简体中文', '簡體中文'], ['繁体中文', '繁體中文'], ['默认', '預設'],
  ['文件夹', '資料夾'], ['文件', '檔案'], ['编辑器', '編輯器'], ['编辑', '編輯'],
  ['视图', '檢視'], ['窗口', '視窗'], ['帮助', '說明'], ['设置', '設定'],
  ['扩展', '擴充功能'], ['插件', '外掛'], ['键绑定', '按鍵繫結'],
  ['代码', '程式碼'], ['源码', '原始碼'], ['工作区', '工作區'], ['项目', '專案'],
  ['打开', '開啟'], ['关闭', '關閉'], ['保存', '儲存'], ['另存为', '另存新檔'],
  ['复制', '複製'], ['粘贴', '貼上'], ['查找', '尋找'], ['替换', '取代'],
  ['撤销', '復原'], ['重做', '取消復原'], ['运行', '執行'], ['终端', '終端機'],
  ['调试', '偵錯'], ['输出', '輸出'], ['应用程序', '應用程式'],
  ['启动', '啟動'], ['加载', '載入'], ['刷新', '重新整理'], ['智能体', '智能體'],
  ['子智能体', '子智能體'], ['云端', '雲端'], ['规则', '規則'], ['会话', '工作階段'],
  ['历史记录', '歷程記錄'], ['登录', '登入'], ['注销', '登出'], ['账户', '帳戶'],
  ['用户', '使用者'], ['权限', '權限'], ['网络', '網路'], ['链接', '連結'],
  ['剪贴板', '剪貼簿'], ['屏幕', '螢幕'], ['鼠标', '滑鼠'], ['下载', '下載'],
  ['检测', '偵測'], ['禁用', '停用'], ['启用', '啟用'], ['安装', '安裝'],
  ['卸载', '解除安裝'], ['更改', '變更'], ['暂存', '暫存'], ['合并', '合併'],
  ['冲突', '衝突'], ['当前', '目前'], ['本地', '本機'], ['远程', '遠端'],
  ['全局', '全域'], ['只读', '唯讀'], ['模板', '範本'], ['模块', '模組'],
  ['数据', '資料'], ['数据库', '資料庫'], ['菜单栏', '選單列'], ['命令面板', '命令選擇區'],
];

const SORTED_PHRASES = [...PHRASES].sort((a, b) => b[0].length - a[0].length);


function replaceAllLiteral(text, from, to) {
  return text.split(from).join(to);
}

function toTraditional(value) {
  if (typeof value !== 'string' || value === '') return value;
  let text = value;
  for (const [from, to] of SORTED_PHRASES) text = replaceAllLiteral(text, from, to);
  return OPENCC_TO_TRADITIONAL(text);
}

const LANGUAGE_PROFILES = {
  'zh-cn': {
    locale: 'zh-cn',
    name: '简体中文',
    languagePackId: 'ms-ceintl.vscode-language-pack-zh-hans',
    languagePackFallbackIds: [],
    converter: null,
  },
  'zh-tw': {
    locale: 'zh-tw',
    name: '繁體中文',
    languagePackId: 'ms-ceintl.vscode-language-pack-zh-hant',
    languagePackFallbackIds: ['ms-ceintl.vscode-language-pack-zh-hans'],
    converter: toTraditional,
  },
};

function normalizeLocale(value) {
  const raw = String(value || DEFAULT_LOCALE).trim().toLowerCase().replace('_', '-');
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw === 'zh-sg') return 'zh-cn';
  if (raw === 'zh-tw' || raw === 'zh-hant' || raw === 'zh-hk' || raw === 'zh-mo') return 'zh-tw';
  throw new Error(`不支持的语言: ${value}. 可用: zh-cn, zh-tw`);
}

function getLanguageProfile(value) {
  return LANGUAGE_PROFILES[normalizeLocale(value)];
}

function listLanguageProfiles() {
  return Object.values(LANGUAGE_PROFILES).map((profile) => ({ ...profile }));
}

module.exports = {
  DEFAULT_LOCALE,
  LANGUAGE_PROFILES,
  normalizeLocale,
  getLanguageProfile,
  listLanguageProfiles,
  toTraditional,
};
