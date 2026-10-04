// ASTRA V4 data validation layer

export function validateMarketRow(row) {
  if (!row || !row.symbol) return false;
  if (typeof row.price !== 'number') return false;
  if (!Number.isFinite(row.price) || row.price <= 0) return false;

  return true;
}

export function validateSnapshot(snapshot) {
  const rows = snapshot?.rows || [];
  const validRows = rows.filter(validateMarketRow);

  return {
    valid: validRows.length === rows.length && rows.length > 0,
    totalRows: rows.length,
    validRows: validRows.length,
    coverage: rows.length ? (validRows.length / rows.length) * 100 : 0
  };
}
