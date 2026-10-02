'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DECLARATION_PATTERN = /^(?:function|var)\s+([A-Za-z_$][\w$]*)/gm;

function declaredNames(code) {
  const names = [];
  let match;
  while ((match = DECLARATION_PATTERN.exec(code)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Apps Script の .gs ファイルはグローバルスコープを共有する前提で書かれているため、
 * まとめて1つの関数本体として評価し、トップレベルで宣言された関数/変数をオブジェクトとして返す。
 *
 * vm.createContext() ではなく vm.compileFunction() を使うのがポイント:
 * createContext は新しいV8レルム(Array/Object等の組み込みが別物)を作ってしまい、
 * そこから返った配列が node:assert/strict の deepStrictEqual で
 * 「構造は同じだが参照として同一realmではない」という誤判定を起こす。
 * compileFunction は現在のコンテキスト(=テストを実行しているNode本体と同じrealm)で
 * コンパイルされるため、返り値をそのままassertできる。
 */
function loadGasModule(filenames) {
  const sources = filenames.map((filename) => {
    const filePath = path.join(__dirname, '..', '..', 'src', filename);
    return fs.readFileSync(filePath, 'utf8');
  });

  const names = Array.from(new Set(sources.flatMap(declaredNames)));
  const body = sources.join('\n') + '\nreturn { ' + names.join(', ') + ' };';

  const fn = vm.compileFunction(body, [], { filename: 'gas-bundle.js' });
  return fn();
}

module.exports = { loadGasModule };
