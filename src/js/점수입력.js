import { doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc } from './저장소.js';
import { currentPerson, currentScores, db, editingPersonId, persons, planData, prevItems, prevScores, reportData, setCurrentPerson, setCurrentScores, setEditingPersonId, setPersons, setPlanData, setPrevItems, setPrevScores, setReportData } from './공통.js';
import { DEFAULT_ITEMS, getTmplData, loadSelectors, setTmplLockCache, tmplLockCache } from './평가지관리.js';
import { copyPrompt, STYLE_RULES } from './AI.js';
import { esc } from './유틸.js';
import { setStatusLoadedAt, statusLoadedAt } from './현재상황.js';


// 사람 탭 직무/연도 목록을 평가지 탭과 동기화
window.syncFromTemplate = async function() {
  const tmplSel = document.getElementById('tmpl-type-sel');
  const evalSel = document.getElementById('eval-type-sel');
  const evalYear = document.getElementById('eval-year-sel');
  const tmplYear = document.getElementById('tmpl-year-sel');

  // 직무 동기화
  const existing = new Set(Array.from(evalSel.options).map(o => o.value));
  Array.from(tmplSel.options).forEach(opt => {
    if (!existing.has(opt.value)) {
      const newOpt = document.createElement('option');
      newOpt.value = opt.value; newOpt.textContent = opt.textContent;
      evalSel.appendChild(newOpt);
    }
  });

  // 연도 동기화
  const existingY = new Set(Array.from(evalYear.options).map(o => o.value));
  Array.from(tmplYear.options).forEach(opt => {
    if (!existingY.has(opt.value)) {
      const newOpt = document.createElement('option');
      newOpt.value = opt.value; newOpt.textContent = opt.textContent;
      evalYear.appendChild(newOpt);
    }
  });

  // 보고서/계획서 탭 셀렉터도 동기화
  ['rpt-type-sel','plan-type-sel'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const ex = new Set(Array.from(sel.options).map(o => o.value));
    Array.from(tmplSel.options).forEach(opt => {
      if (!ex.has(opt.value)) {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.textContent;
        sel.appendChild(o);
      }
    });
  });
  ['rpt-year-sel','plan-year-sel'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const ex = new Set(Array.from(sel.options).map(o => o.value));
    Array.from(tmplYear.options).forEach(opt => {
      if (!ex.has(opt.value)) {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.textContent;
        sel.appendChild(o);
      }
    });
  });

  // 연도/직무 목록 저장 — 기존 목록과 합쳐서(union) 저장.
  // (예전엔 통째로 덮어써서, 목록이 2025만 있던 순간 동기화하면 2024가 사라졌음)
  const yearsLocal = Array.from(document.getElementById('tmpl-year-sel').options).map(o => o.value);
  const typesLocal = Array.from(document.getElementById('tmpl-type-sel').options).map(o => o.value);
  let prevYears = [], prevTypes = [];
  try {
    const prev = await getDoc(doc(db, 'settings', 'selectors'));
    if (prev.exists()) { prevYears = prev.data().years || []; prevTypes = prev.data().types || []; }
  } catch(e) {}
  const years = Array.from(new Set([...prevYears, ...yearsLocal])).sort((a,b) => parseInt(b) - parseInt(a));
  const types = Array.from(new Set([...prevTypes, ...typesLocal]));
  await setDoc(doc(db, 'settings', 'selectors'), { years, types });
  await loadSelectors();
  toast('직무/연도 동기화 완료');
};

// 연도/직무 변경 시 사람 목록 새로 로드
window.onEvalSelChange = async function() {
  setCurrentPerson(null);
  setCurrentScores({});
  setPrevScores({});
  document.getElementById('btn-save-scores').disabled = true;
  document.getElementById('score-area').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text2);">
      ← 왼쪽에서 사람을 선택하세요
    </div>`;
  const prevPanel = document.getElementById('prev-score-list');
  if (prevPanel) prevPanel.innerHTML = '<div style="text-align:center;color:#999;font-size:11px;padding:20px 8px;">사람을 선택하면<br>전년도 점수가<br>표시됩니다</div>';

  // 보고서·계획서 탭 셀렉터 동기화
  const year = document.getElementById('eval-year-sel').value;
  const type = document.getElementById('eval-type-sel').value;
  ['rpt-year-sel','plan-year-sel'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.value = year;
  });
  ['rpt-type-sel','plan-type-sel'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.value = type;
  });

  await loadPersons();
  await loadReportPersons();
  await loadPlanPersons();
};

// ══════════════════════════════════════════════════
// 사람 탭
// ══════════════════════════════════════════════════
window.openAddPerson = () => {
  setEditingPersonId(null);
  document.getElementById('new-name').value = '';
  document.getElementById('new-birth').value = '';
  document.getElementById('new-disability').value = '';
  document.getElementById('new-manager').value = '';
  document.querySelector('#modal-add-person h3').textContent = '새 평가 대상 추가';
  document.querySelector('#modal-add-person .btn-primary').textContent = '추가';
  openModal('modal-add-person');
};

window.addPerson = async function() {
  const name = document.getElementById('new-name').value.trim();
  if (!name) { toast('이름을 입력하세요'); return; }
  const year = document.getElementById('eval-year-sel').value;
  const type = document.getElementById('eval-type-sel').value;
  const birth = document.getElementById('new-birth').value;
  const disability = document.getElementById('new-disability').value;
  const manager = document.getElementById('new-manager').value;

  // 수정 모드
  if (editingPersonId) {
    try {
      await updateDoc(doc(db, 'persons', editingPersonId), { name, birth, disability });
      await setDoc(doc(db, 'roster', `${year}_${type}`), { managers: { [editingPersonId]: manager } }, { merge: true });
      personsCacheAll = null;
      setEditingPersonId(null);
      closeModal('modal-add-person');
      toast(`${name} 수정 완료`);
      await loadPersons();
    } catch(e) { toast('수정 실패: '+e.message); }
    return;
  }

  try {
    // ★ 기존 persons에서 같은 이름 검색
    const allList = await fetchPersonsAll(true);
    let existingId = null;
    allList.forEach(d => {
      if (d.name === name) existingId = d.id;
    });

    let personId;
    if (existingId) {
      // 이미 있는 사람 → roster에만 추가
      personId = existingId;
      toast(`기존 사람 "${name}"을 이 목록에 추가했어요`);
    } else {
      // 새 사람 생성

    const ref = await addDoc(collection(db, 'persons'), {
        name, birth, disability,
        createdAt: new Date().toISOString()
      });
      personId = ref.id;
      personsCacheAll = null;
    }

    await registerToRoster(personId, year, type, manager);
    closeModal('modal-add-person');
    await loadPersons();
    selectPerson(personId);
  } catch(e) { toast('추가 실패: '+e.message); }
};

// roster에 personId 등록
async function registerToRoster(personId, year, type, manager) {
  const rosterId = `${year}_${type}`;
  const rosterRef = doc(db, 'roster', rosterId);
  const snap = await getDoc(rosterRef);
  const ids = snap.exists() ? (snap.data().personIds || []) : [];
  if (!ids.includes(personId)) ids.push(personId);
  const payload = { personIds: ids, year, type };
  if (manager !== undefined) payload.managers = { [personId]: manager };
  await setDoc(rosterRef, payload, { merge: true });
}

let personsCacheAll = null; // persons 전체 캐시 (삭제된 사람 포함) — 사람 추가·수정·삭제 시 비움
async function fetchPersonsAll(force) {
  if (!force && personsCacheAll) return personsCacheAll;
  const snap = await getDocs(collection(db, 'persons'));
  const list = [];
  snap.forEach(d => list.push({ id: d.id, ...d.data() }));
  personsCacheAll = list;
  return list;
}

async function loadPersons() {
  const year = document.getElementById('eval-year-sel').value;
  const type = document.getElementById('eval-type-sel').value;
  const rosterId = `${year}_${type}`;

  try {
    // roster에서 해당 연도+직무 personId 목록 조회
    const rosterSnap = await getDoc(doc(db, 'roster', rosterId));
    const personIds = rosterSnap.exists() ? (rosterSnap.data().personIds || []) : [];
    const mgrs = rosterSnap.exists() ? (rosterSnap.data().managers || {}) : {};

    if (personIds.length === 0) {
      setPersons([]);
      renderPersonList([]);
      return;
    }

    // 해당 person들만 로드
    const allList = await fetchPersonsAll();
    setPersons([]);
    allList.forEach(d => {
      if (personIds.includes(d.id) && !d.deleted) persons.push({ ...d, manager: mgrs[d.id] !== undefined ? mgrs[d.id] : (d.manager || '') });
    });
    persons.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
    renderPersonList(persons);
  } catch(e) {
    console.error(e);
    setPersons([]);
    renderPersonList([]);
  }
}

window.filterPersons = function(q) {
  const filtered = q ? persons.filter(p => p.name.includes(q)) : persons;
  renderPersonList(filtered);
};

function renderPersonList(list) {
  const el = document.getElementById('person-list');
  el.innerHTML = '';
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px 0;">이 연도+직무에<br>등록된 사람이 없어요<br><br>+ 사람 추가로 등록하세요</div>';
    return;
  }
  list.forEach(p => {
    const div = document.createElement('div');
    div.className = 'person-card' + (currentPerson?.id === p.id ? ' active' : '');
    div.style.position = 'relative';
    div.innerHTML = `
      <div class="pname">${esc(p.name)}</div>
      <div class="pmeta">${esc(p.disability||'')} ${p.birth||''}</div>
      <button onclick="editPerson('${p.id}',event)" style="position:absolute;top:6px;right:28px;background:none;border:none;color:#90CAF9;cursor:pointer;font-size:14px;padding:0 2px;" title="수정">수정</button>
      <button onclick="deletePerson('${p.id}','${esc(p.name)}',event)"
        style="position:absolute;top:6px;right:6px;background:none;border:none;color:#BDBDBD;cursor:pointer;font-size:14px;padding:0 2px;line-height:1;"
        title="삭제">✕</button>`;
    div.onclick = (e) => { if (!e.target.closest('button')) selectPerson(p.id); };
    el.appendChild(div);
  });
}

// 사람 삭제 (현재 연도+직무에서만 제거 or 완전 삭제)
window.editPerson = function(id, e) {
  e.stopPropagation();
  const p = persons.find(p => p.id === id);
  if (!p) return;
  document.getElementById('new-name').value = p.name || '';
  document.getElementById('new-birth').value = p.birth || '';
  document.getElementById('new-disability').value = p.disability || '';
  document.getElementById('new-manager').value = p.manager || '';
  setEditingPersonId(id);
  document.querySelector('#modal-add-person h3').textContent = '평가 대상 수정';
  document.querySelector('#modal-add-person .btn-primary').textContent = '수정';
  openModal('modal-add-person');
};


window.deletePerson = async function(id, name, e) {
  e.stopPropagation();
  const confirmed = confirm(`"${name}"을(를) 휴지통으로 이동합니다.\n\n데이터는 보존되며, 휴지통에서 복원하거나 완전삭제할 수 있습니다.`);
  if (!confirmed) return;

  try {
    await setDoc(doc(db, 'persons', id), { deleted: true }, { merge: true });
    personsCacheAll = null;

    if (currentPerson?.id === id) {
      setCurrentPerson(null);
      setCurrentScores({});
      document.getElementById('btn-save-scores').disabled = true;
      document.getElementById('score-area').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text2);">← 왼쪽에서 사람을 선택하세요</div>';
    }

    toast(`"${name}" 휴지통으로 이동`);
    await loadPersons();
    loadReportPersons();
    loadPlanPersons();
    loadConferencePersons();
  } catch(err) { toast('삭제 실패: ' + err.message); }
};

async function selectPerson(id) {
  setCurrentPerson(persons.find(p => p.id === id));
  if (!currentPerson) return;
  renderPersonList(persons);

  document.getElementById('btn-save-scores').disabled = false;

  const year = document.getElementById('eval-year-sel').value;
  const type = document.getElementById('eval-type-sel').value;

  // 평가지 항목 로드
  const tmplData = await getTmplData(year, type);
  const items = tmplData ? tmplData.items : DEFAULT_ITEMS;
  if (!items || items.length === 0) toast('평가지 관리에서 평가지를 먼저 만드세요');

  // 당해 점수 로드
  const scoreRef = doc(db, 'scores', `${id}_${year}_${type}`);
  const scoreSnap = await getDoc(scoreRef);
  setCurrentScores(scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {});
  setReportData(scoreSnap.exists() ? (scoreSnap.data().report || {}) : {});
  window.reportData = reportData;
  setPlanData(scoreSnap.exists() ? (scoreSnap.data().plan || {}) : {});
  window.planData = planData;

  // 전년도 점수 + 평가지 항목 로드
  const prevYear = String(parseInt(year) - 1);
  const prevRef = doc(db, 'scores', `${id}_${prevYear}_${type}`);
  const prevSnap = await getDoc(prevRef);
  setPrevScores(prevSnap.exists() ? (prevSnap.data().scores || {}) : {});

  // 전년도 평가지 항목 로드 (텍스트 매칭용)
  const prevTmplData = await getTmplData(prevYear, type);
  setPrevItems(prevTmplData ? (prevTmplData.items || []) : []);

  renderScoreInput(items, year, type);
}

// 점수 입력 순서대로 key 배열 (붙여넣기 순서 기준)
let scoreKeyOrder = [];

// 전년도 대분류별 소계: 전년도 평가지+점수로 직접 계산 (항목 내용이 바뀌어도 대분류 합계는 표시)
function buildPrevCatStats() {
  const stats = {};
  if (!prevItems || prevItems.length === 0) return stats;
  groupItems(prevItems).forEach(pg => {
    let sum = 0, scored = 0;
    pg.items.forEach(it => {
      const v = prevScores[String(it.no)];
      if (v !== undefined) { sum += v; scored++; }
    });
    stats[pg.cat] = { sum, max: pg.items.length * 10, scored };
  });
  return stats;
}

// 전년도 점수 매핑: 항목 "내용"이 정확히 같은 것끼리만 연결
// (내용이 바뀐 항목은 전년도 점수를 표시하지 않음 — 다른 내용의 점수를 참고하면 안 되므로)
function buildPrevMap(currentItems) {
  const map = {};
  if (!prevItems || prevItems.length === 0) {
    currentItems.forEach(it => {
      const ps = prevScores[String(it.no)];
      if (ps !== undefined) map[String(it.no)] = ps;
    });
    return map;
  }
  const prevByContent = {};
  prevItems.forEach(pit => {
    const key = (pit.content || '').trim();
    if (key && prevByContent[key] === undefined) prevByContent[key] = String(pit.no);
  });
  currentItems.forEach(it => {
    const key = (it.content || '').trim();
    const pno = prevByContent[key];
    if (pno !== undefined && prevScores[pno] !== undefined) {
      map[String(it.no)] = prevScores[pno];
    }
  });
  return map;
}

function renderScoreInput(items, year, type) {
  const p = currentPerson;
  const el = document.getElementById('score-area');
  const prevYear = parseInt(year) - 1;
  scoreKeyOrder = items.map(it => String(it.no));
  const prevCatStats = buildPrevCatStats();
  const prevMap = buildPrevMap(items);

  el.innerHTML = `
    <div id="score-wrap-outer" style="padding:4px 0;max-width:900px;">
      <h2 style="font-size:18px;font-weight:900;letter-spacing:2px;text-align:center;padding:10px 0 14px;color:var(--primary);">상황 및 현장 평가지</h2>
      <div class="report-section" style="padding:10px 14px;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid var(--border);">
            <td rowspan="2" style="font-size:17px;font-weight:900;color:var(--primary);padding:4px 20px 4px 0;border-right:2px solid var(--border);width:90px;vertical-align:middle;text-align:center">${esc(p.name)}</td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">생년월일 : <b>${p.birth||'-'}</b></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">장애명 : <b>${esc(p.disability||'-')}</b></td>
            <td></td>
          </tr>
          <tr>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가일 : <b>${reportData.evalDate||'-'}</b></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가파트 : <b>${type}</b></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가자 : <b>${esc(p.manager||'-')}</b></td>
          </tr>
        </table>
      </div>
      <div class="xl-wrap" id="score-wrap">
        <table class="xl-table" id="score-table" style="width:100%;">
          <thead>
            <tr>
              <th style="width:30px;">번호</th>
              <th>평가항목</th>
              <th style="width:80px;background:#FAFAFA;">${year}년<br>평가점수</th>
              <th style="width:70px;background:#FAFAFA;">${year}년<br>수행률</th>
              <th class="prev-year-col" style="width:80px;background:#FAFAFA;">${prevYear}년<br>점수</th>
            </tr>
          </thead>
          <tbody id="score-body"></tbody>
        </table>
      </div>
    </div>`;

  const tbody = document.getElementById('score-body');

  const groups = groupItems(items);
  let rowIdx = 0;

  groups.forEach(group => {
    group.items.forEach((item, gi) => {
      const key = String(item.no);
      const currVal = currentScores[key] !== undefined ? currentScores[key] : '';
      const prevVal = prevScores[key] !== undefined ? prevScores[key] : '';
      const pctTxt = currVal !== '' ? (currVal/10*100).toFixed(0)+'%' : '-';

      const tr = document.createElement('tr');
      tr.dataset.key = key;

      // 대분류 제목 행 (그룹 첫 항목 앞에 삽입)
      if (gi === 0) {
        const catTr = document.createElement('tr');
        catTr.className = 'cat-title-row';
        const catTd = document.createElement('td');
        catTd.colSpan = 5;
        catTd.style.cssText = 'background:#FAFAFA;color:#37474F;font-weight:700;font-size:12px;padding:5px 10px;';
        catTd.textContent = '' + (group.cat || '');
        catTr.appendChild(catTd);
        tbody.appendChild(catTr);
      }


      // 번호
      const noTd = document.createElement('td');
      noTd.className = 'idx'; noTd.textContent = rowIdx + 1;
      tr.appendChild(noTd);

      // 내용
      const contentTd = document.createElement('td');
      contentTd.style.cssText = 'font-size:12px;padding:5px 8px;white-space:nowrap;';
      contentTd.textContent = item.content;
      tr.appendChild(contentTd);

      // ★ 점수 셀 (핵심)
      const scoreTd = document.createElement('td');
      scoreTd.className = 'score-cell';
      scoreTd.style.background = '';

      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = 10;
      inp.className = 'score-inp' + (currVal === '' ? ' empty' : '');
      inp.value = currVal;
      inp.placeholder = '-';
      inp.dataset.key = key;
      inp.dataset.order = rowIdx; // 순서 인덱스

      // 입력 이벤트
      inp.addEventListener('input', () => onScoreInput(inp));

      // 키보드 네비게이션 (Tab/Enter → 다음 셀, 화살표 → 이전/다음)
      inp.addEventListener('keydown', (e) => {
        const order = parseInt(inp.dataset.order);
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          focusScoreByOrder(e.shiftKey ? order - 1 : order + 1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault(); focusScoreByOrder(order + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault(); focusScoreByOrder(order - 1);
        }
      });

      // 포커스 시 하이라이트
      inp.addEventListener('focus', () => {
        inp.style.background = '#BBDEFB';
        inp.select();
      });
      inp.addEventListener('blur', () => {
        inp.style.background = '';
      });

      // ★ 붙여넣기 이벤트 (이 셀부터 아래로 채움)
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        handlePaste(text, parseInt(inp.dataset.order));
      });

      scoreTd.appendChild(inp);
      tr.appendChild(scoreTd);

      // 수행률
      const rateTd = document.createElement('td');
      rateTd.className = 'rate-cell';
      rateTd.id = 'rate-' + key;
      rateTd.textContent = pctTxt;
      tr.appendChild(rateTd);

      // 전년도 점수 (같은 대분류 안 같은 순서끼리 매칭)
      const prevTd = document.createElement('td');
      prevTd.className = 'prev-year-col';
      prevTd.style.cssText = 'text-align:center;background:none;font-size:12px;color:#546E7A;font-weight:600;';
      let pVal = prevMap[key] !== undefined ? prevMap[key] : null;
      prevTd.textContent = pVal !== null ? pVal : '-';
      tr.appendChild(prevTd);

      tbody.appendChild(tr);
      rowIdx++;
    });

    // 소계 행
    const subKeys = group.items.map(it => String(it.no));
    const subSum = calcSum(subKeys, currentScores);
    const subMax = group.items.length * 10;
    const subPct = subMax > 0 ? (subSum/subMax*100).toFixed(1) : '0.0';
    const subtr = document.createElement('tr');
    subtr.className = 'subtotal-row';
    subtr.id = 'sub-' + group.cat;
    const pcs = prevCatStats[group.cat];
    const prevSubTxt = (pcs && pcs.scored > 0) ? `${pcs.sum} / ${pcs.max}점` : '-';
    subtr.innerHTML = `
      <td colspan="2" style="text-align:left;padding-left:8px;font-size:11px;">${esc(group.cat||'')} 소계</td>
      <td id="sub-sum-${esc(group.cat)}" style="text-align:center;white-space:nowrap;">${subSum} / ${subMax}점</td>
      <td id="sub-pct-${esc(group.cat)}" style="text-align:center;">${subPct}%</td>
      <td class="prev-year-col" style="text-align:center;background:none;color:#546E7A;font-weight:700;">${prevSubTxt}</td>`;
    tbody.appendChild(subtr);
  });

  // 총계
  const allKeys = items.map(it => String(it.no));
  const total = calcSum(allKeys, currentScores);
  const maxTotal = items.length * 10;
  const totalPct = maxTotal > 0 ? (total/maxTotal*100).toFixed(1) : '0.0';
  const totaltr = document.createElement('tr');
  totaltr.className = 'total-row';
  totaltr.id = 'total-row';
  const prevCatsArr = Object.values(prevCatStats);
  const prevTotalSum2 = prevCatsArr.reduce((s,c) => s + c.sum, 0);
  const prevTotalMax2 = prevCatsArr.reduce((s,c) => s + c.max, 0);
  const prevScoredCnt = prevCatsArr.reduce((s,c) => s + c.scored, 0);
  const prevTotalTxt = prevScoredCnt > 0 ? `${prevTotalSum2} / ${prevTotalMax2}점` : '-';
  totaltr.innerHTML = `
    <td colspan="2" style="font-size:12px;">총 계</td>
    <td id="total-sum-cell" style="text-align:center;white-space:nowrap;">${total} / ${maxTotal}점</td>
    <td id="total-pct-cell" style="text-align:center;white-space:nowrap;">${totalPct}%</td>
    <td class="prev-year-col" style="text-align:center;background:none;color:#546E7A;font-weight:700;white-space:nowrap;">${prevTotalTxt}</td>`;
  tbody.appendChild(totaltr);

  // 평가결과 종합 의견 섹션
  const opinionDiv = document.createElement('div');
  opinionDiv.style.cssText = 'margin-top:16px;';
  opinionDiv.innerHTML = `
    <div class="report-section">
      <h3 style="font-size:13px;font-weight:700;color:var(--primary);border-bottom:1.5px solid var(--primary);padding-bottom:5px;margin-bottom:10px;">
        평가결과 종합 의견
        <button onclick="generateScoreOpinion()" id="btn-score-opinion" class="btn btn-primary btn-sm no-print" style="margin-left:10px;">프롬프트 복사</button>
      </h3>
      <div class="editable-block" contenteditable="true" id="score-opinion"
        oninput="reportData.scoreOpinion=this.innerText"
        style="min-height:120px;">${esc(reportData.scoreOpinion||'')}</div>
    </div>`;
  const wrapOuter = document.getElementById('score-wrap-outer') || el;
  wrapOuter.appendChild(opinionDiv);

  // 전년도 패널 렌더링 (대분류+순서 매핑으로 표시)
  window._currentItems = items;
  renderPrevPanel(items);
}

// ★ 엑셀 붙여넣기 처리
function handlePaste(text, startOrder) {
  // 탭/줄바꿈으로 나누기 (엑셀 복사 형식)
  const rows = text.trim().split(/\r?\n/);
  const values = [];
  rows.forEach(row => {
    // 탭으로 구분된 경우 첫 번째 열만 사용 (점수 열만 복사한 경우 그냥 한 열)
    const cols = row.split('\t');
    const val = cols[0].trim();
    if (val !== '') values.push(val);
  });

  if (values.length === 0) return;

  const inputs = document.querySelectorAll('#score-body .score-inp');
  const inputArr = Array.from(inputs);

  let filled = 0;
  values.forEach((val, i) => {
    const targetIdx = startOrder + i;
    const inp = inputArr[targetIdx];
    if (!inp) return;
    const n = parseInt(val);
    if (!isNaN(n) && n >= 0 && n <= 10) {
      inp.value = n;
      inp.classList.remove('empty');
      currentScores[inp.dataset.key] = n;
      const rateEl = document.getElementById('rate-' + inp.dataset.key);
      if (rateEl) rateEl.textContent = (n/10*100).toFixed(0) + '%';
      filled++;
    }
  });

  updateAllSubtotals();
  toast(`${filled}개 점수 붙여넣기 완료`);

  // 마지막으로 채운 셀 다음으로 포커스
  focusScoreByOrder(startOrder + filled);
}

// order 인덱스로 셀 포커스
function focusScoreByOrder(order) {
  const inputs = document.querySelectorAll('#score-body .score-inp');
  const inp = Array.from(inputs)[order];
  if (inp) inp.focus();
}

// 전년도 점수 패널 렌더링
function renderPrevPanel(items) {
  const panel = document.getElementById('prev-score-list');
  if (!panel) return;

  if (Object.keys(prevScores).length === 0) {
    panel.innerHTML = '<div style="text-align:center;color:#999;font-size:11px;padding:16px 8px;">전년도 데이터 없음</div>';
    return;
  }

  const groups = groupItems(items);
  const prevMap = buildPrevMap(items);
  let html = '';
  let rowIdx = 0;

  groups.forEach(group => {
    // 대분류 소제목
    html += `<div style="background:#FFCCBC;font-size:10px;font-weight:700;padding:4px 8px;color:#BF360C;border-top:1px solid #FFAB91;">${group.cat}</div>`;
    group.items.forEach(item => {
      const key = String(item.no);
      const val = prevMap[key] !== undefined ? prevMap[key] : '-';
      const pct = val !== '-' ? (val/10*100).toFixed(0)+'%' : '-';
      const color = val === '-' ? '#bbb' : val >= 8 ? '#2E7D32' : val >= 5 ? '#E65100' : '#C62828';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 8px;border-bottom:1px solid #E3F2FD;font-size:11px;">
        <span style="color:#555;flex:0 0 18px;text-align:center;">${rowIdx+1}</span>
        <span style="color:${color};font-weight:700;font-size:13px;min-width:20px;text-align:center;">${val}</span>
        <span style="color:#888;font-size:10px;">${pct}</span>
      </div>`;
      rowIdx++;
    });
    // 소계
    const subKeys = group.items.map(it => String(it.no));
    const subSum = subKeys.reduce((s,k) => s + (prevMap[k] !== undefined ? prevMap[k] : 0), 0);
    const subMax = group.items.length * 10;
    html += `<div style="background:#FFE0B2;display:flex;justify-content:space-between;padding:3px 8px;font-size:10px;font-weight:700;color:#BF360C;">
      <span>소계</span><span>${subSum}/${subMax}</span>
    </div>`;
  });

  // 총계
  const allKeys = items.map(it => String(it.no));
  const total = allKeys.reduce((s,k) => s + (prevMap[k] !== undefined ? prevMap[k] : 0), 0);
  const maxTotal = items.length * 10;
  html += `<div style="background:#E64A19;color:white;display:flex;justify-content:space-between;padding:5px 8px;font-size:11px;font-weight:700;margin-top:4px;">
    <span>총계</span><span>${total}/${maxTotal}</span>
  </div>`;

  panel.innerHTML = html;
}

window.onScoreInput = function(inp) {
  let v = parseInt(inp.value);
  if (isNaN(v) || inp.value === '') {
    inp.classList.add('empty');
    delete currentScores[inp.dataset.key];
  } else {
    v = Math.max(0, Math.min(10, v));
    inp.value = v;
    inp.classList.remove('empty');
    currentScores[inp.dataset.key] = v;
  }
  const key = inp.dataset.key;
  const rateEl = document.getElementById('rate-' + key);
  if (rateEl) rateEl.textContent = currentScores[key] !== undefined ? (currentScores[key]/10*100).toFixed(0)+'%' : '-';
  updateAllSubtotals();
};

function updateAllSubtotals() {
  if (!currentPerson) return;
  const inputs = document.querySelectorAll('#score-body .score-inp');

  // 그룹별 소계
  const groups = groupItems(scoreKeyOrder.map((k,i) => ({ no: k, _order: i })));
  // 대신 DOM 기반으로 소계 행 업데이트
  document.querySelectorAll('.subtotal-row').forEach(row => {
    const catName = row.id.replace('sub-', '');
    const sumEl = document.getElementById('sub-sum-' + catName);
    const pctEl = document.getElementById('sub-pct-' + catName);
    if (!sumEl) return;
    // 이 소계 행 바로 위에 있는 점수 입력들을 찾기
    let sibling = row.previousElementSibling;
    const keys = [];
    while (sibling && !sibling.classList.contains('subtotal-row') && !sibling.classList.contains('total-row')) {
      const inp = sibling.querySelector('.score-inp');
      if (inp) keys.push(inp.dataset.key);
      sibling = sibling.previousElementSibling;
    }
    const sum = calcSum(keys, currentScores);
    const max = keys.length * 10;
    const pct = max > 0 ? (sum/max*100).toFixed(1) : '0.0';
    sumEl.textContent = `${sum} / ${max}점`;
    pctEl.textContent = `${pct}%`;
  });

  // 총계
  const allKeys = [];
  inputs.forEach(inp => allKeys.push(inp.dataset.key));
  const total = calcSum(allKeys, currentScores);
  const maxTotal = allKeys.length * 10;
  const totalPct = maxTotal > 0 ? (total/maxTotal*100).toFixed(1) : '0.0';
  const sumEl = document.getElementById('total-sum-cell');
  const pctEl = document.getElementById('total-pct-cell');
  if (sumEl) sumEl.textContent = `${total} / ${maxTotal}점`;
  if (pctEl) pctEl.textContent = `${totalPct}%`;
}

function calcSum(keys, scores) {
  return keys.reduce((s, k) => s + (scores[k] !== undefined ? scores[k] : 0), 0);
}

function groupItems(items) {
  const groups = [];
  let current = null;
  items.forEach(item => {
    if (item.cat && item.cat !== (current?.cat||'')) {
      current = { cat: item.cat, items: [] };
      groups.push(current);
    } else if (!current) {
      current = { cat: '', items: [] };
      groups.push(current);
    }
    current.items.push(item);
  });
  return groups;
}


window.generateScoreOpinion = async function() {
  const el = document.getElementById('score-opinion');
  if (!el) return;

  const name = currentPerson?.name || '대상자';
  const allKeys = scoreKeyOrder;
  const total = calcSum(allKeys, currentScores);
  const maxTotal = allKeys.length * 10;
  const totalPct = maxTotal > 0 ? (total/maxTotal*100).toFixed(1) : '0.0';

  const groups = groupItems(window._currentItems || []);
  const groupLines = groups.map(g => {
    const keys = g.items.map(it => String(it.no));
    const sum = calcSum(keys, currentScores);
    const max = g.items.length * 10;
    const pct = max > 0 ? (sum/max*100).toFixed(1) : '0.0';
    const lowItems = g.items.filter(it => {
      const v = currentScores[String(it.no)];
      return v !== undefined && v <= 5;
    }).map(it => `${it.content}(${currentScores[String(it.no)]}점)`).join(', ');
    return `- ${g.cat}: ${sum}점/${max}점 (${pct}%)${lowItems ? `\n  5점 이하 항목: ${lowItems}` : ''}`;
  }).join('\n');

  const prompt = `당신은 발달장애인 직업재활 전문가, 직업재활시설 직업훈련교사입니다. 아래 평가 결과를 바탕으로 소견을 작성해주세요.

대상자: ${name}
전체 수행률: ${totalPct}% (${total}점/${maxTotal}점)
영역별 결과:
${groupLines}

아래 형식으로 작성해주세요. 마크다운 기호(**, ##, --, * 등)는 절대 사용하지 마세요. 일반 텍스트로만 작성해주세요.

문체 지침(꼭 지킬 것):
- 대상자를 지칭할 때는 이름 뒤에 반드시 "씨"나 "님"을 붙일 것(예: "${name}씨"). 이름만 단독으로 쓰지 말 것.
${STYLE_RULES}
- 문장 길이에 변화를 줄 것(짧은 문장과 긴 문장을 섞기). 같은 종결어미를 네 문장 넘게 잇달아 쓰지 말고, "~하고 있다"는 "~한다"로 줄일 것.

[평가 전체적 요약]
점수 결과 위주로 사실에 근거하여 작성. 수치를 명확히 포함할 것.

[영역별 세부 요약]
각 영역별 점수 결과 위주로 사실에 근거하여 작성. 수치를 명확히 포함할 것.

[중점지도 및 목표 계획]
5점 이하 항목 중 가장 낮은 항목 2~3개를 언급하고 그에 대한 지도 방향에 대해 대분류 수준으로 간략히 추천할 것(추천사항이라서 지도방향을 꼭 따라야 할 필요가 없음).`;

  try {
    await copyPrompt(prompt, currentPerson?.name);
  } catch(e) { toast('복사 실패: ' + e.message); }
};

window.saveScores = async function() {
  if (!currentPerson) return;
  const year = document.getElementById('eval-year-sel').value;
  const type = document.getElementById('eval-type-sel').value;
  const docId = `${currentPerson.id}_${year}_${type}`;
  document.getElementById('score-saving').textContent = '저장 중...';
  try {
    await setDoc(doc(db, 'scores', docId), {
      personId: currentPerson.id,
      personName: currentPerson.name,
      year, type,
      scores: currentScores,
      report: reportData,
      plan: planData,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    // roster에도 등록 (처음 저장 시 자동 등록)
    await registerToRoster(currentPerson.id, year, type);
    setStatusLoadedAt(0);
    setTmplLockCache({});
    document.getElementById('score-saving').textContent = '저장됨';
    toast('점수 저장 완료');
    setTimeout(() => document.getElementById('score-saving').textContent = '', 3000);
  } catch(e) { toast('저장 실패: '+e.message); }
};

function setPersonsCacheAll(v) { personsCacheAll = v; }

export { calcSum, fetchPersonsAll, groupItems, loadPersons, personsCacheAll, scoreKeyOrder, selectPerson, setPersonsCacheAll };
