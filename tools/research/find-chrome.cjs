/* 跨平台找 Chrome / Edge（Windows、macOS、Linux 都认），供 headless 检查工具共用。
 * 优先用环境变量 CHROME_PATH，其次常见安装路径，最后退回 PATH 里的命令名。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  // Windows
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
];

const CHROME = process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)
  ? process.env.CHROME_PATH
  : CANDIDATES.find((p) => fs.existsSync(p));

function requireChrome() {
  if (CHROME) return CHROME;
  console.error('找不到 Chrome/Chromium/Edge。请安装其一，或设置环境变量 CHROME_PATH 指向可执行文件，例如：');
  console.error('  macOS : export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"');
  console.error('  Windows: set CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  process.exit(1);
}

module.exports = { CHROME, requireChrome, CANDIDATES };
