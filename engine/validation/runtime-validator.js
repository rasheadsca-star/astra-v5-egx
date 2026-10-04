// ASTRA V4 Runtime Validator
// Validates incoming market snapshots before analysis.

function validateSnapshot(snapshot) {
  const result = {
    valid: true,
    errors: [],
    checkedAt: new Date().toISOString()
  };

  if (!snapshot || typeof snapshot !== 'object') {
    result.valid = false;
    result.errors.push('INVALID_SNAPSHOT');
    return result;
  }

  if (!snapshot.symbols || !Array.isArray(snapshot.symbols)) {
    result.valid = false;
    result.errors.push('MISSING_SYMBOLS');
  }

  return result;
}

module.exports = { validateSnapshot };
