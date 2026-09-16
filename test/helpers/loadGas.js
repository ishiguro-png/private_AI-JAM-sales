'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Apps Script の .gs ファイルはグローバルスコープを共有する前提で書かれているため、
 * Node の require() (CommonJS) ではなく vm でまとめて評価し、
 * 実際のGAS実行環境に近い形でテストする。
 */
function loadGasModule(filenames) {
  const context = { console: console };
  vm.createContext(context);

  filenames.forEach((filename) => {
    const filePath = path.join(__dirname, '..', '..', 'src', filename);
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context, { filename: filePath });
  });

  return context;
}

module.exports = { loadGasModule };
