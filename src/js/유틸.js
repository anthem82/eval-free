// ── 유틸 ──────────────────────────────────────────
function getGrade(pct) {
  if(pct>=95) return 'A';
  if(pct>=80) return 'B';
  if(pct>=50) return 'C';
  if(pct>=20) return 'D';
  return 'E';
}
function gradeLabel(g) {
  return {A:'우수함',B:'양호함',C:'부족함',D:'매우부족',E:'훈련부적합'}[g]||'';
}
function esc(s) {
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export { esc, getGrade, gradeLabel };
