export function splitBudget(total, memberIds, currency = 'SGD') {
  const ids = [...new Set(memberIds)].sort();
  if (!ids.length) return [];
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const unit = 10 ** digits;
  const units = Math.round(Math.max(0, Number(total) || 0) * unit);
  const each = Math.floor(units / ids.length);
  const remainder = units % ids.length;
  return ids.map((id, i) => ({ id, amount: (each + (i < remainder ? 1 : 0)) / unit }));
}
