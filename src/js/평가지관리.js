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

window.loadTemplate = async function() {
  document.getElementById('tmpl-saving').textContent = '불러오는 중...';
  try {
    const ref = doc(db, 'templates', getTmplId());
    const snap = await getDoc(ref);
    if (snap.exists()) {
      setTmplItems(snap.data().items || []);
    } else {
      setTmplItems(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    }
    renderTemplateTree();
    if (document.getElementById('pane-template')?.classList.contains('active')) checkTmplLock();
    document.getElementById('tmpl-saving').textContent = '';
  } catch(e) {
    toast('불러오기 실패: '+e.message);
    setTmplItems(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    renderTemplateTree();
  }
};

window.saveTemplate = async function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  collectTreeData();
  // 번호 자동 재부여 (순서대로 1, 2, 3...)
  tmplItems.forEach((item, i) => { item.no = i + 1; });
  document.getElementById('tmpl-saving').textContent = '저장 중...';
  try {
    await setDoc(doc(db, 'templates', getTmplId()), { items: tmplItems, updatedAt: new Date().toISOString() });
    setStatusLoadedAt(0);
    tmplDocCache = {};
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
  renderTemplateTree();
};

// ── 연도 추가 ──
window.addYear = function() {
  const year = prompt('추가할 연도를 입력하세요 (예: 2027)');
  if (!year || isNaN(parseInt(year))) return;
  const sel = document.getElementById('tmpl-year-sel');
  for (let opt of sel.options) {
    if (opt.value === year) { toast('이미 있는 연도예요'); sel.value = year; return; }
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
  setTmplItems(JSON.parse(JSON.stringify(prevItems2)));
  renderTemplateTree();
  toast(`${prevYear}년 평가지 ${prevItems2.length}개 항목 복사됨 — 확인 후 "평가지 저장"을 눌러주세요`);
};

// ── 직무 추가 ──
window.addJobType = function() {
  const name = prompt('추가할 직무 이름을 입력하세요 (예: 데이터라벨링)');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const sel = document.getElementById('tmpl-type-sel');
  for (let opt of sel.options) {
    if (opt.value === trimmed) { toast('이미 있는 직무예요'); sel.value = trimmed; loadTemplate(); return; }
  }
  const opt = document.createElement('option');
  opt.value = trimmed; opt.textContent = trimmed;
  sel.appendChild(opt);
  sel.value = trimmed;
  // 빈 평가지로 시작
  setTmplItems([]);
  renderTemplateTree();
  syncFromTemplate();
  renderTmplExplorer();
  toast(`"${trimmed}" 직무 추가됨`);
};

// ── 직무 삭제 ──
window.deleteJobType = function() {
  if (tmplLocked) { toast('점수가 입력된 평가지라 잠겨 있어요'); return; }
  const sel = document.getElementById('tmpl-type-sel');
  const val = sel.value;
  if (sel.options.length <= 1) { toast('마지막 직무는 삭제할 수 없어요'); return; }
  if (!confirm(`"${val}" 직무를 목록에서 삭제할까요?
(저장된 데이터는 유지됩니다)`)) return;
  sel.remove(sel.selectedIndex);
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

  catGroups.forEach((catGroup, catIdx) => {
    const catDiv = document.createElement('div');
    catDiv.className = 'tree-cat';

    // ── 대분류 헤더 ──
    const catHeader = document.createElement('div');
    catHeader.className = 'tree-cat-header';
    const totalItems = catGroup.items.length;
    catHeader.innerHTML = `
      <span class="chevron open">▶</span>
      <input class="tree-cat-name-inp" value="${escHtml(catGroup.cat)}"
        placeholder="대분류 이름 (예: 직무기능-현수막)" data-catidx="${catIdx}" oninput="onCatRename(this)">
      <span style="font-size:11px;color:#546E7A;margin-left:4px;">${totalItems}문항</span>
      <div class="cat-actions" style="margin-left:auto;display:flex;gap:4px;">
        <button class="btn btn-danger btn-sm" onclick="deleteCat(${catIdx},event)">삭제</button>
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
    catBody.appendChild(buildItemsTable(catGroup.items, catIdx));
    catBody.appendChild(buildAddRow(catIdx));

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

// tmplItems → catGroups 변환
function buildCatGroups(items) {
  const catMap = [];
  items.forEach((item, idx) => {
    item._idx = idx;
    const cat = item.cat || '';
    let cg = catMap.find(c => c.cat === cat);
    if (!cg) {
      cg = { cat, items: [] };
      catMap.push(cg);
    }
    cg.items.push(item);
  });
  return catMap;
}

function buildItemsTable(items, catIdx) {
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
        oninput="tmplItems[${item._idx}]&&(tmplItems[${item._idx}].content=this.value)"></td>
      <td style="text-align:center;">
        <button class="btn btn-danger btn-sm" onclick="deleteTreeItem(${item._idx})">✕</button>
      </td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildAddRow(catIdx) {
  const div = document.createElement('div');
  div.className = 'tree-add-row';
  div.innerHTML = `<button class="tree-add-btn"
    onclick="addItem(${catIdx},event)">+ 항목 추가</button>
    <span style="font-size:11px;color:#bbb;">내용 셀에서 Ctrl+V로 엑셀 복붙 가능</span>`;
  return div;
}

// ── 이벤트 핸들러들 ──

window.onCatRename = function(inp) {
  collectTreeData();
  const catIdx = parseInt(inp.dataset.catidx);
  const cats = buildCatGroups(tmplItems);
  const cg = cats[catIdx];
  if (!cg) return;
  const oldCat = cg.cat;
  const newCat = inp.value;
  tmplItems.forEach(it => { if ((it.cat||'') === oldCat) it.cat = newCat; });
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
  const newCat = '새 대분류';
  tmplItems.push({ cat: newCat, no: tmplItems.length+1, content: '새 항목' });
  renderTemplateTree();
  const inps = document.querySelectorAll('.tree-cat-name-inp');
  if (inps.length) { inps[inps.length-1].focus(); inps[inps.length-1].select(); }
};

window.addItem = function(catIdx, e) {
  if (e) e.stopPropagation();
  const cats = buildCatGroups(tmplItems);
  const cg = cats[catIdx];
  if (!cg) return;

  // 이 대분류에 해당하는 마지막 tmplItems 인덱스를 직접 탐색
  const targetCat = cg.cat;
  let lastIdx = -1;
  tmplItems.forEach((it, i) => {
    if ((it.cat||'') === targetCat) {
      lastIdx = i;
    }
  });

  if (lastIdx < 0) lastIdx = tmplItems.length - 1;
  const newItem = { cat: targetCat, no: lastIdx + 2, content: '' };
  tmplItems.splice(lastIdx + 1, 0, newItem);
  renderTemplateTree();

  // 새로 추가된 항목 포커스 (lastIdx+1 위치)
  const all = document.querySelectorAll('.tree-cell[data-field="content"]');
  const targetInp = Array.from(all).find(el => parseInt(el.dataset.idx) === lastIdx + 1);
  if (targetInp) targetInp.focus();
  else if (all.length) all[all.length-1].focus();
};

window.deleteTreeItem = function(idx) {
  if (tmplItems.length <= 1) { toast('마지막 항목은 삭제할 수 없어요'); return; }
  tmplItems.splice(idx, 1);
  renderTemplateTree();
};

window.deleteCat = function(catIdx, e) {
  if (e) e.stopPropagation();
  const cats = buildCatGroups(tmplItems);
  const cg = cats[catIdx];
  if (!cg) return;
  const total = cg.items.length;
  if (!confirm(`"${cg.cat}" 대분류와 항목 ${total}개를 모두 삭제할까요?`)) return;
  const idxSet = new Set(cg.items.map(it => it._idx));
  setTmplItems(tmplItems.filter((_, i) => !idxSet.has(i)));
  renderTemplateTree();
};

// ★ 붙여넣기
function bindTreePaste() {
  document.querySelectorAll('.tree-cell[data-field="content"]').forEach(inp => {
    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      handleTreePaste(text, parseInt(inp.dataset.idx));
    });
  });
}

function handleTreePaste(text, startIdx) {
  const baseItem = tmplItems[startIdx];
  if (!baseItem) return;
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trimEnd().split('\n');
  let insertIdx = startIdx;
  let filled = 0;
  lines.forEach((line, i) => {
    const val = line.split('\t')[0].trim();
    if (!val) return;
    if (i === 0) {
      tmplItems[insertIdx].content = val;
    } else {
      insertIdx++;
      tmplItems.splice(insertIdx, 0, {
        cat: baseItem.cat,
        no: insertIdx+1, content: val
      });
    }
    filled++;
  });
  renderTemplateTree();
  toast(`${filled}개 항목 붙여넣기 완료`);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function setTmplLockCache(v) { tmplLockCache = v; }

export { DEFAULT_ITEMS, checkTmplLock, getTmplData, loadMethodItems, loadSelectors, renderTmplExplorer, setTmplLockCache, tmplLockCache };
