/**
 * Money formatting utility.
 * All monetary amounts from the backend are represented as integer paise.
 * Never perform floating-point business calculations.
 */

export function formatPaise(paise: number | null | undefined, options?: { showZero?: boolean; compact?: boolean }): string {
  if (paise === null || paise === undefined || typeof paise !== 'number' || Number.isNaN(paise) || !Number.isFinite(paise)) {
    return '—';
  }

  if (paise === 0) {
    return options?.showZero === false ? '—' : '₹0';
  }

  const safePaise = Math.round(paise);
  const rupees = Math.floor(safePaise / 100);
  const remainderPaise = safePaise % 100;

  if (remainderPaise === 0 || options?.compact) {
    return `₹${rupees.toLocaleString('en-IN')}`;
  }

  const decimalPart = remainderPaise.toString().padStart(2, '0');
  return `₹${rupees.toLocaleString('en-IN')}.${decimalPart}`;
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}
