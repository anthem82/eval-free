import { doc, getDoc, setDoc, collection, query, where, getCountFromServer } from './저장소.js';
import { db, setTmplItems, tmplItems } from './공통.js';
import { methodItems, renderMethodList, setMethodItems } from './계획서.js';
import { esc } from './유틸.js';
import { setStatusLoadedAt, statusLoadedAt } from './현재상황.js';

// ══════════════════════════════════════════════════
// 평가지 탭
// ══════════════════════════════════════════════════
const DEFAULT_ITEMS = [];

function getTmplId() {
  const y = document.getElementById('tmpl-year-sel').value;
  const t = document.getElementById('tmpl-type-sel').value;
  return `${y}_${t}`;
}

// ★ 평가지 잠금: 이 연도+직무로 입력된 점수가 있으면 편집 잠금
let tmplLocked = false;
let tmplLockCache = {}; // 잠금 확인 캐시 {year_type: cnt} — saveScores 저장 시 비움
async function tmplHasScores(y, t) {
  const key = `${y}_${t}`;
  if (!(key in tmplLockCache)) {
    try {
      const c = await getCountFromServer(query(collection(db, 'scores'), where('year', '==', y), where('type', '==', t)));
      tmplLockCache[key] = c.data().count;
    } catch(e) { tmplLockCache[key] = 0; }
  }
  return tmplLockCache[key] > 0;
}
async function checkTmplLock() {
  const y = document.getElementById('tmpl-year-sel').value;
  const t = document.getElementById('tmpl-type-sel').value;
  tmplLocked = await tmplHasScores(y, t) && !window._tmplUnlocked;
  const tree = document.getElementById('tmpl-tree');
  const banner = document.getElementById('tmpl-lock-banner');
  if (tmplLocked) {
    if (tree) { tree.style.pointerEvents = 'none'; tree.style.opacity = '0.75'; }
    if (banner) { banner.style.display = ''; banner.textContent = `이 평가지로 입력된 자료가 있어 잠금 상태입니다 (보기 전용)`; }
  } else {
    if (tree) { tree.style.pointerEvents = ''; tree.style.opacity = ''; }
    if (banner) banner.style.display = 'none';
  }
}
// 평가지 탐색기 — 연도별로 묶어 평가지(직무) 목록을 보여준다. 상태 꼬리표는 (비어있음)/(잠김)만.
async function renderTmplExplorer() {
  const el = document.getElementById('tmpl-explorer');
  if (!el) return;
  const ySel = document.getElementById('tmpl-year-sel');
  const tSel = document.getElementById('tmpl-type-sel');
  const years = Array.from(ySel.options).map(o => o.value);
  const types = Array.from(tSel.options).map(o => o.value);
  const curY = ySel.value, curT = tSel.value;
  let html = '';
  for (const y of years) {
    html += `<div class="tx-year">${esc(y)}년</div>`;
    for (const t of types) {
      const tmpl = await getTmplData(y, t);                 // templates 캐시 사용
      const empty = !tmpl || !(tmpl.items || []).length;
      const locked = await tmplHasScores(y, t);              // 잠김 여부(집계, 캐시)
      const tags = [];
      if (empty) tags.push('(비어있음)');
      if (locked) tags.push('(잠김)');
      html += `<div class="person-card tx-item${y===curY && t===curT ? ' active' : ''}" onclick="pickTemplate('${y}','${t}')">
                 <div class="pname">${esc(t)}</div>
                 ${tags.length ? `<div class="pmeta">${tags.join(' ')}</div>` : ''}
               </div>`;
    }
  }
  el.innerHTML = html;
}
window.pickTemplate = function(y, t) {
  if (!confirmDiscardTmpl()) return;
  document.getElementById('tmpl-year-sel').value = y;
  document.getElementById('tmpl-type-sel').value = t;
  loadTemplate();          // 기존 로드 흐름 그대로 (안에서 checkTmplLock도 호출됨)
  renderTmplExplorer();    // 선택 표시 갱신
};
// 관리자용 잠금 해제: F12 콘솔에서 unlockTemplate() 실행 (새로고침하면 다시 잠김)
window.unlockTemplate = function() {
  window._tmplUnlocked = true;
  checkTmplLock();
  toast('잠금 해제됨 — 이번 세션 동안만 유효합니다');
};

let tmplDocCache = {}; // 평가지 문서 캐시 — 평가지 저장 시 비움. 값 null = 문서 없음
async function getTmplData(year, type) {
  const key = `${year}_${type}`;
  if (key in tmplDocCache) return tmplDocCache[key];
  const snap = await getDoc(doc(db, 'templates', key));
  tmplDocCache[key] = snap.exists() ? snap.data() : null;
  return tmplDocCache[key];
}

async function loadSelectors() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'selectors'));
    let years, types;
    if (snap.exists()) {
      years = snap.data().years || []; types = snap.data().types || [];
    } else {
      // 처음 열었을 때: 올해 연도 하나 + 기본 평가지 하나로 시작 (해가 바뀌어도 남도록 저장해 둔다)
      years = [String(new Date().getFullYear())]; types = ['기본'];
      await setDoc(doc(db, 'settings', 'selectors'), { years, types });
    }
    const selIds = ['g-year-sel','tmpl-year-sel','eval-year-sel','rpt-year-sel','plan-year-sel','conf-year-sel'];
    const typeIds = ['g-type-sel','tmpl-type-sel','eval-type-sel','rpt-type-sel','plan-type-sel','conf-type-sel'];
    selIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const existing = new Set(Array.from(sel.options).map(o => o.value));
      years.forEach(y => {
        if (!existing.has(y)) {
          const opt = document.createElement('option');
          opt.value = y; opt.textContent = y + '년';
          sel.appendChild(opt);
        }
      });
      const sortedY = Array.from(sel.options).sort((a,b) => parseInt(b.value) - parseInt(a.value));
      sel.innerHTML = '';
      sortedY.forEach(o => sel.appendChild(o));
    });
    typeIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const existing = new Set(Array.from(sel.options).map(o => o.value));
      types.forEach(t => {
        if (!existing.has(t)) {
          const opt = document.createElement('option');
          opt.value = t; opt.textContent = t;
          sel.appendChild(opt);
        }
      });
    });
  } catch(e) { console.error('셀렉터 불러오기 실패:', e); }
}

async function loadMethodItems() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'methodItems'));
    if (snap.exists()) {
      setMethodItems(snap.data().items || []);
      renderMethodList();
    }
  } catch(e) { console.error('수행방법 불러오기 실패:', e); }
}

// ── 편집 상태 ──
// 대분류는 항목에 적힌 이름(cat)일 뿐이라, 편집하는 동안은 묶음마다 고유표 _g 를 붙여 구분한다.
// (이름으로 묶으면 이름이 잠깐 같아지는 순간 두 대분류가 합쳐진다.) _g·_idx 는 저장하지 않는다.
let tmplGSeq = 0;
let tmplDirty = false;                 // 저장 안 한 변경이 있는지
let tmplLoaded = { y: '', t: '' };     // 지금 화면에 올라와 있는 평가지 (select 되돌리기용)
window.markTmplDirty = function() { tmplDirty = true; };   // 인라인 oninput 에서 부르는 훅

// 연속된 같은 cat 구간마다 _g 를 매긴다 — 점수 화면 groupItems 와 같은 기준(빈 cat 은 앞 구간에 붙음)
function tagCatGroups(items) {
  let g = null, curCat = '';
  items.forEach(it => {
    const c = it.cat || '';
    if (g === null || (c && c !== curCat)) { g = ++tmplGSeq; curCat = c; }
    it._g = g;
    it.cat = curCat;
  });
  return items;
}

function confirmDiscardTmpl() {
  return !tmplDirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');
}

window.addEventListener('beforeunload', (e) => {
  if (tmplDirty) { e.preventDefault(); e.returnValue = ''; }
});

// 평가지 탭의 연도/직무 select 를 직접 바꿨을 때
window.onTmplSelChange = function() {
  if (!confirmDiscardTmpl()) {
    document.getElementById('tmpl-year-sel').value = tmplLoaded.y;
    document.getElementById('tmpl-type-sel').value = tmplLoaded.t;
    return;
  }
  loadTemplate();
};

function markTmplLoaded() {
  tmplLoaded = { y: document.getElementById('tmpl-year-sel').value, t: document.getElementById('tmpl-type-sel').value };
  tmplDirty = false;
}

window.loadTemplate = async function() {
  document.getElementById('tmpl-saving').textContent = '불러오는 중...';
  try {
    const ref = doc(db, 'templates', getTmplId());
    const snap = await getDoc(ref);
    if (snap.exists()) {
      setTmplItems(tagCatGroups(snap.data().items || []));
    } else {
      setTmplItems(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    }
    markTmplLoaded();
    renderTemplateTree();
    if (document.getElementById('pane-template')?.classList.contains('active')) checkTmplLock();
    document.getElementById('tmpl-saving').textContent = '';
  } catch(e) {
    toast('불러오기 실패: '+e.message);
    setTmplItems(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    markTmplLoaded();
    renderTemplateTree();
  }
};

// 저장 전 검사 — 걸리면 { msg, el(포커스할 칸) } 을 돌려준다. 통과면 null.
// (점수·보고서가 대분류 이름으로 소계를 맞추고, 전년도 점수는 항목 내용 글자로 맞추므로 중복을 막는다)
function checkTemplate() {
  const groups = buildCatGroups(tmplItems);
  const catInp = g => document.querySelector(`.tree-cat-name-inp[data-g="${g}"]`);
  const cellInp = idx => document.querySelector(`.tree-cell[data-field="content"][data-idx="${idx}"]`);
  const short = t => t.length > 30 ? t.slice(0, 30) + '…' : t;

  const emptyCat = groups.find(cg => !cg.cat.trim());
  if (emptyCat) return { msg: '대분류 이름을 적어 주세요', el: catInp(emptyCat.g) };
  const seenCat = new Set();
  for (const cg of groups) {
    const name = cg.cat.trim();
    if (seenCat.has(name)) return { msg: `같은 이름의 대분류가 있습니다: ${name}`, el: catInp(cg.g) };
    seenCat.add(name);
  }
  const empties = tmplItems.filter(it => !(it.content || '').trim());
  if (empties.length) return { msg: `내용이 빈 항목이 ${empties.length}개 있습니다`, el: cellInp(empties[0]._idx) };
  const seen = new Set();
  for (const it of tmplItems) {
    const c = it.content.trim();
    if (seen.has(c)) return { msg: `같은 내용의 항목이 있습니다: ${short(c)}`, el: cellInp(it._idx) };
    seen.add(c);
  }
  return null;
}

window.saveTemplate = async function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  collectTreeData();
  const bad = checkTemplate();
  if (bad) { toast(bad.msg, 3500); if (bad.el) bad.el.focus(); return; }
  // 앞뒤 공백 정리 + 번호 자동 재부여 (순서대로 1, 2, 3...)
  tmplItems.forEach((item, i) => { item.cat = (item.cat || '').trim(); item.content = (item.content || '').trim(); item.no = i + 1; });
  // 편집용 표(_g, _idx)는 빼고 저장
  const items = tmplItems.map(({ _g, _idx, ...rest }) => rest);
  document.getElementById('tmpl-saving').textContent = '저장 중...';
  try {
    await setDoc(doc(db, 'templates', getTmplId()), { items, updatedAt: new Date().toISOString() });
    tmplDirty = false;
    setStatusLoadedAt(0);
    tmplDocCache = {};
    renderTemplateTree();
    renderTmplExplorer();
    document.getElementById('tmpl-saving').textContent = '저장됨';
    toast('평가지 저장 완료');
    setTimeout(() => document.getElementById('tmpl-saving').textContent = '', 3000);
  } catch(e) { toast('저장 실패: '+e.message); }
};

window.initDefaultTemplate = function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  if (!confirm('평가지를 초기화하시겠습니까? 모든 항목이 삭제됩니다.')) return;
  setTmplItems([]);
  tmplDirty = true;
  renderTemplateTree();
};

// ── 연도 추가 ──
window.addYear = function() {
  if (!confirmDiscardTmpl()) return;
  const input = prompt('추가할 연도를 입력하세요 (예: 2027)');
  if (!input) return;
  // 숫자만 뽑아 정리 ("2027년" → "2027")
  const n = parseInt(input.replace(/[^0-9]/g, ''));
  if (isNaN(n)) return;
  if (n < 2000 || n > 2100) { toast('연도는 2000~2100 사이로 적어 주세요'); return; }
  const year = String(n);
  const sel = document.getElementById('tmpl-year-sel');
  for (let opt of sel.options) {
    if (opt.value === year) { toast('이미 있는 연도예요'); sel.value = year; loadTemplate(); renderTmplExplorer(); return; }
  }
  const opt = document.createElement('option');
  opt.value = year; opt.textContent = year + '년';
  sel.appendChild(opt);
  // 연도 내림차순 정렬
  const opts = Array.from(sel.options).sort((a,b) => parseInt(b.value) - parseInt(a.value));
  sel.innerHTML = '';
  opts.forEach(o => sel.appendChild(o));
  sel.value = year;
  setTmplItems([]);
  markTmplLoaded();
  renderTemplateTree();
  syncFromTemplate();
  renderTmplExplorer();
  toast(`${year}년 추가됨`);
};

// ── 전년도 평가지 복사 ──
// 항목 문구가 한 글자라도 다르면 전년도 점수 비교가 안 붙으므로, 그대로 복사해서 시작하게 한다.
window.copyPrevTemplate = async function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  const year = document.getElementById('tmpl-year-sel').value;
  const type = document.getElementById('tmpl-type-sel').value;
  const prevYear = String(parseInt(year) - 1);
  let snap;
  try {
    snap = await getDoc(doc(db, 'templates', `${prevYear}_${type}`));
  } catch(e) { toast('불러오기 실패: ' + e.message); return; }
  const prevItems2 = snap.exists() ? (snap.data().items || []) : [];
  if (prevItems2.length === 0) { toast(`${prevYear}년 "${type}" 평가지가 없어요`); return; }
  if (tmplItems.length > 0 && !confirm(`지금 편집 중인 항목 ${tmplItems.length}개를 지우고 ${prevYear}년 "${type}" 평가지(${prevItems2.length}개 항목)를 가져옵니다. 계속할까요?`)) return;
  setTmplItems(tagCatGroups(JSON.parse(JSON.stringify(prevItems2))));
  tmplDirty = true;
  renderTemplateTree();
  toast(`${prevYear}년 평가지 ${prevItems2.length}개 항목 복사됨 — 확인 후 "평가지 저장"을 눌러주세요`);
};

// ── 직무 추가 ──
window.addJobType = function() {
  if (!confirmDiscardTmpl()) return;
  const name = prompt('추가할 직무 이름을 입력하세요 (예: 데이터라벨링)');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  // 왼쪽 목록의 onclick 과 문서 경로에 그대로 쓰이는 이름이라 깨지는 문자는 받지 않는다
  if (/['"\/\\<>]/.test(trimmed)) { toast('직무 이름에 \' " / \\ < > 는 쓸 수 없어요', 3500); return; }
  const sel = document.getElementById('tmpl-type-sel');
  for (let opt of sel.options) {
    if (opt.value === trimmed) { toast('이미 있는 직무예요'); sel.value = trimmed; loadTemplate(); renderTmplExplorer(); return; }
  }
  const opt = document.createElement('option');
  opt.value = trimmed; opt.textContent = trimmed;
  sel.appendChild(opt);
  sel.value = trimmed;
  // 빈 평가지로 시작
  setTmplItems([]);
  markTmplLoaded();
  renderTemplateTree();
  syncFromTemplate();
  renderTmplExplorer();
  toast(`"${trimmed}" 직무 추가됨`);
};

// ── 직무 삭제 ──
// 저장된 목록(settings/selectors)과 모든 직무 select 에서 뺀다. 평가지·점수 문서는 지우지 않는다.
window.deleteJobType = async function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  const sel = document.getElementById('tmpl-type-sel');
  const val = sel.value;
  if (sel.options.length <= 1) { toast('마지막 직무는 삭제할 수 없어요'); return; }
  if (!confirmDiscardTmpl()) return;
  if (!confirm(`"${val}" 직무를 목록에서 삭제할까요?
(저장된 데이터는 유지됩니다)`)) return;
  try {
    const ref = doc(db, 'settings', 'selectors');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(ref, { years: snap.data().years || [], types: (snap.data().types || []).filter(t => t !== val) });
    }
  } catch(e) { toast('삭제 실패: ' + e.message); return; }
  ['g-type-sel','tmpl-type-sel','eval-type-sel','rpt-type-sel','plan-type-sel','conf-type-sel'].forEach(id => {
    const s = document.getElementById(id);
    if (!s) return;
    Array.from(s.options).forEach(o => { if (o.value === val) o.remove(); });
  });
  tmplDirty = false;
  loadTemplate();
  renderTmplExplorer();
  toast(`"${val}" 직무 삭제됨`);
};

// DOM → tmplItems 동기화 (번호/내용만)
function collectTreeData() {
  document.querySelectorAll('.tree-cell[data-field]').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    const field = inp.dataset.field;
    if (!tmplItems[idx]) return;
    if (field === 'no') tmplItems[idx].no = parseInt(inp.value) || (idx+1);
    if (field === 'content') tmplItems[idx].content = inp.value;
  });
}

// ★ 2단계 트리 렌더링
// 구조: 대분류 → 항목
function renderTemplateTree() {
  const container = document.getElementById('tmpl-tree');
  if (!container) return;
  container.innerHTML = '';

  // 대분류 그룹 추출
  const catGroups = buildCatGroups(tmplItems);

  catGroups.forEach((catGroup) => {
    const catDiv = document.createElement('div');
    catDiv.className = 'tree-cat';

    // ── 대분류 헤더 ──
    const catHeader = document.createElement('div');
    catHeader.className = 'tree-cat-header';
    const totalItems = catGroup.items.length;
    catHeader.innerHTML = `
      <span class="chevron open">▶</span>
      <input class="tree-cat-name-inp" value="${escHtml(catGroup.cat)}"
        placeholder="대분류 이름 (예: 직무기능-현수막)" data-g="${catGroup.g}" oninput="onCatRename(this)">
      <span style="font-size:11px;color:#546E7A;margin-left:4px;">${totalItems}문항</span>
      <div class="cat-actions" style="margin-left:auto;display:flex;gap:4px;">
        <button class="btn btn-danger btn-sm" onclick="deleteCat(${catGroup.g},event)">삭제</button>
      </div>`;
    catHeader.addEventListener('click', (e) => {
      if (e.target.closest('.cat-actions,.tree-cat-name-inp')) return;
      const body = catDiv.querySelector('.tree-cat-body');
      const ch = catHeader.querySelector('.chevron');
      body.classList.toggle('open');
      ch.classList.toggle('open');
    });
    catDiv.appendChild(catHeader);

    // ── 대분류 바디 ──
    const catBody = document.createElement('div');
    catBody.className = 'tree-cat-body open';
    catBody.appendChild(buildItemsTable(catGroup.items));
    catBody.appendChild(buildAddRow(catGroup.g));

    catDiv.appendChild(catBody);
    container.appendChild(catDiv);
  });

  // 대분류 추가 버튼
  const addCatDiv = document.createElement('div');
  addCatDiv.style.cssText = 'margin-top:8px;display:flex;gap:8px;';
  addCatDiv.innerHTML = `
    <button class="tree-add-cat-btn" onclick="addCat()">＋ 대분류 추가</button>`;
  container.appendChild(addCatDiv);

  bindTreePaste();
}

// tmplItems → catGroups 변환 (이름이 아니라 고유표 _g 로 묶는다, 등장 순서 유지)
function buildCatGroups(items) {
  const catMap = [];
  items.forEach((item, idx) => {
    item._idx = idx;
    if (item._g === undefined) item._g = ++tmplGSeq;
    let cg = catMap.find(c => c.g === item._g);
    if (!cg) {
      cg = { g: item._g, cat: item.cat || '', items: [] };
      catMap.push(cg);
    }
    cg.items.push(item);
  });
  return catMap;
}

function buildItemsTable(items) {
  const table = document.createElement('table');
  table.className = 'tree-items-table';
  table.innerHTML = `<thead><tr>
    <th style="width:36px;text-align:center;">번호</th>
    <th>평가 내용</th>
    <th style="width:46px;"></th>
  </tr></thead>`;
  const tbody = document.createElement('tbody');
  items.forEach((item, ii) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = item._idx;
    tr.innerHTML = `
      <td style="text-align:center;color:#555;font-size:12px;font-weight:600;padding:4px;width:36px;">${ii+1}</td>
      <td><input class="tree-cell" value="${escHtml(item.content)}"
        placeholder="평가 내용" data-idx="${item._idx}" data-field="content"
        onkeydown="onTreeItemKey(event,${item._idx})"
        oninput="tmplItems[${item._idx}]&&(tmplItems[${item._idx}].content=this.value);markTmplDirty()"></td>
      <td style="text-align:center;">
        <button class="btn btn-danger btn-sm" onclick="deleteTreeItem(${item._idx})">✕</button>
      </td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildAddRow(g) {
  const div = document.createElement('div');
  div.className = 'tree-add-row';
  div.innerHTML = `<button class="tree-add-btn"
    onclick="addItem(${g},event)">+ 항목 추가</button>
    <span style="font-size:11px;color:#bbb;">내용 셀에서 Ctrl+V로 엑셀 복붙 가능</span>`;
  return div;
}

// ── 이벤트 핸들러들 ──

// 이 칸의 대분류(_g)에 속한 항목만 이름을 바꾼다
window.onCatRename = function(inp) {
  const g = parseInt(inp.dataset.g);
  tmplItems.forEach(it => { if (it._g === g) it.cat = inp.value; });
  tmplDirty = true;
};

window.onTreeItemKey = function(e, idx) {
  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
    e.preventDefault();
    const all = Array.from(document.querySelectorAll('.tree-cell[data-field="content"]'));
    const cur = all.findIndex(el => parseInt(el.dataset.idx) === idx);
    if (cur < all.length - 1) all[cur+1].focus();
  } else if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    const all = Array.from(document.querySelectorAll('.tree-cell[data-field="content"]'));
    const cur = all.findIndex(el => parseInt(el.dataset.idx) === idx);
    if (cur > 0) all[cur-1].focus();
  }
};

window.addCat = function() {
  collectTreeData();
  // 기존과 겹치지 않는 이름: 새 대분류, 새 대분류 2, …
  const names = new Set(tmplItems.map(it => (it.cat || '').trim()));
  let newCat = '새 대분류';
  for (let n = 2; names.has(newCat); n++) newCat = '새 대분류 ' + n;
  const g = ++tmplGSeq;
  tmplItems.push({ cat: newCat, no: tmplItems.length+1, content: '', _g: g });
  tmplDirty = true;
  renderTemplateTree();
  const inp = document.querySelector(`.tree-cat-name-inp[data-g="${g}"]`);
  if (inp) { inp.focus(); inp.select(); }
};

window.addItem = function(g, e) {
  if (e) e.stopPropagation();
  collectTreeData();

  // 이 대분류의 마지막 항목 뒤에 넣는다 (한 대분류의 항목은 항상 붙어 있게)
  let lastIdx = -1;
  tmplItems.forEach((it, i) => {
    if (it._g === g) {
      lastIdx = i;
    }
  });
  if (lastIdx < 0) return;

  const newItem = { cat: tmplItems[lastIdx].cat, no: lastIdx + 2, content: '', _g: g };
  tmplItems.splice(lastIdx + 1, 0, newItem);
  tmplDirty = true;
  renderTemplateTree();

  // 새로 추가된 항목 포커스 (lastIdx+1 위치)
  const all = document.querySelectorAll('.tree-cell[data-field="content"]');
  const targetInp = Array.from(all).find(el => parseInt(el.dataset.idx) === lastIdx + 1);
  if (targetInp) targetInp.focus();
  else if (all.length) all[all.length-1].focus();
};

window.deleteTreeItem = function(idx) {
  if (tmplItems.length <= 1) { toast('마지막 항목은 삭제할 수 없어요'); return; }
  collectTreeData();
  tmplItems.splice(idx, 1);
  tmplDirty = true;
  renderTemplateTree();
};

window.deleteCat = function(g, e) {
  if (e) e.stopPropagation();
  collectTreeData();
  const cg = buildCatGroups(tmplItems).find(c => c.g === g);
  if (!cg) return;
  const total = cg.items.length;
  if (!confirm(`"${cg.cat}" 대분류와 항목 ${total}개를 모두 삭제할까요?`)) return;
  setTmplItems(tmplItems.filter(it => it._g !== g));
  tmplDirty = true;
  renderTemplateTree();
};

// ★ 붙여넣기
// 여러 줄(엑셀에서 여러 칸 복사)일 때만 가로채서 항목 여러 개로 넣는다.
// 한 줄이면 브라우저 기본 붙여넣기에 맡긴다 (글 중간에 낱말을 끼워 넣을 수 있게).
function bindTreePaste() {
  document.querySelectorAll('.tree-cell[data-field="content"]').forEach(inp => {
    inp.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\r\n]/.test(text.replace(/[\r\n]+$/, ''))) return;
      e.preventDefault();
      handleTreePaste(text, parseInt(inp.dataset.idx));
    });
  });
}

function handleTreePaste(text, startIdx) {
  collectTreeData();
  const baseItem = tmplItems[startIdx];
  if (!baseItem) return;
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trimEnd().split('\n');
  let insertIdx = startIdx;
  let filled = 0;
  lines.forEach((line) => {
    const val = line.split('\t')[0].trim();
    if (!val) return;
    if (filled === 0) {
      tmplItems[insertIdx].content = val;
    } else {
      insertIdx++;
      tmplItems.splice(insertIdx, 0, {
        cat: baseItem.cat, _g: baseItem._g,
        no: insertIdx+1, content: val
      });
    }
    filled++;
  });
  tmplDirty = true;
  renderTemplateTree();
  toast(`${filled}개 항목 붙여넣기 완료`);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function setTmplLockCache(v) { tmplLockCache = v; }

export { DEFAULT_ITEMS, checkTmplLock, getTmplData, loadMethodItems, loadSelectors, renderTmplExplorer, setTmplLockCache, tmplLockCache };
