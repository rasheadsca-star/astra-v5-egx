'use strict';

// تنظيف أسماء الشركات المنسوخة من صفحات الويب: تحتوي أحياناً على بقايا مواضع إعلانات
// مثل "0],[300,100],[320,100] End AdSlot 1 --> --> Six of October Development".

const JUNK = /AdSlot|-->|\]\s*,\s*\[|\[\s*\d+\s*,\s*\d+\s*\]/;

function cleanName(value) {
  if (value === null || value === undefined) return null;
  let text = String(value);
  if (JUNK.test(text)) {
    const arrow = text.lastIndexOf('-->');
    if (arrow >= 0) text = text.slice(arrow + 3);
    else text = text.replace(/^.*\]\s*\]/, '').replace(/^.*AdSlot\s*\d*/i, '');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text || null;
}

function isCleanName(value) {
  return value === null || value === undefined || !JUNK.test(String(value));
}

function sanitizeMarketRow(row = {}) {
  return {
    ...row,
    name_ar: cleanName(row.name_ar),
    name_en: cleanName(row.name_en)
  };
}

module.exports = { cleanName, isCleanName, sanitizeMarketRow };
