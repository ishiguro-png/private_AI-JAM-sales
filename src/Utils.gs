/**
 * "¥1,234" や "-¥1,688" のような表記を数値に変換する。
 * 空文字・全角ハイフン("－")など数値化できないものは0を返す。
 */
function parseCurrencyToNumber(value) {
  if (value === null || value === undefined) return 0;
  var str = String(value).trim();
  if (str === '' || str === '－' || str === '-') return 0;

  var normalized = str.replace(/[¥,\s]/g, '');
  var num = Number(normalized);
  return Number.isNaN(num) ? 0 : num;
}

function formatYen(amount) {
  var sign = amount < 0 ? '-' : '';
  var digits = Math.abs(Math.round(amount)).toString();
  var withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '¥' + withCommas;
}
