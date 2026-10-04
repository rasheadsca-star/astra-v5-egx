'use strict';

// ASTRA V5 — data hygiene validation: scraped-name sanitizer + retention policy + canonical file cleanliness.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanName, isCleanName, sanitizeMarketRow } = require('../data-engine/sanitize');

assert.strictEqual(cleanName('0],[300,100],[320,100],[320,480]] End AdSlot 1 --> --> --> --> Six of October Development and Investment'), 'Six of October Development and Investment');
assert.strictEqual(cleanName('Commercial International Bank'), 'Commercial International Bank');
assert.strictEqual(cleanName('  Extra   spaces   name '), 'Extra spaces name');
assert.strictEqual(cleanName('x],[ AdSlot 2 -->'), null);
assert.strictEqual(cleanName(null), null);
assert.strictEqual(isCleanName('AdSlot 1 -->'), false);
const row = sanitizeMarketRow({ symbol: 'OCDI', name_en: '[300,100] AdSlot 1 --> Six of October', name_ar: '[300,100] AdSlot 1 --> Six of October', price: 1 });
assert.strictEqual(row.name_en, 'Six of October'); assert.strictEqual(row.symbol, 'OCDI');

// الملف القانوني المنسوخ لا يحمل تلوثاً
const canonical = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'canonical-market.json'), 'utf8'));
const dirty = canonical.rows.filter((r) => !isCleanName(r.name_en) || !isCleanName(r.name_ar));
assert.strictEqual(dirty.length, 0, 'canonical rows still contain scraped ad-slot text: ' + dirty.length);

// سياسة الاحتفاظ بالتاريخ: لا أقل من 100 جلسة افتراضياً
const src = fs.readFileSync(path.join(__dirname, 'data-refresh.js'), 'utf8');
const m = src.match(/HISTORY_SESSIONS\s*=\s*Number\(process\.env\.ASTRA_HISTORY_SESSIONS \|\| (\d+)\)/);
assert.ok(m && Number(m[1]) >= 100, 'history retention default must be >= 100 sessions');

console.log('ASTRA data hygiene validation passed');
