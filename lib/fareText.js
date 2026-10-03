/*
 * A fare as words, in its own currency: "¥209", "¥209–252" where it may be
 * either, "€2.90". Apart from lib/fares so that what shows a fare does not
 * load the registry behind it.
 */

const formats = new Map();
function formatOf(currency) {
  if (!formats.has(currency)) {
    let f = null;
    try {
      f = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
    } catch { /* not a currency Intl knows */ }
    formats.set(currency, f);
  }
  return formats.get(currency);
}

/**
 *   fare      { total } or { yen } (a part of one), with `upTo` where it may be more
 *   currency  the fare's currency where the fare does not carry it; yen by default
 */
export function fareText(fare, currency = null) {
  if (!fare) return '';
  const f = formatOf(fare.currency || currency || 'JPY');
  const value = fare.total ?? fare.yen;
  const one = (x) => (f ? f.format(Math.abs(x)) : String(Math.abs(x)));
  // The upper fare without its symbol: "¥209–252".
  const bare = (x) => one(x).replace(/^[^\d]+/, '');
  return `${value < 0 ? '−' : ''}${one(value)}${fare.upTo ? `–${bare(fare.upTo)}` : ''}`;
}
