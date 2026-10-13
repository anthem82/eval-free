import { doc, getDoc, setDoc } from './저장소.js';
import { currentPerson, currentScores, db, planData, reportData, setCurrentPerson, setCurrentScores, setPlanData, setReportData } from './공통.js';
import { fetchPersonsAll } from './점수입력.js';
import { esc } from './유틸.js';
import { setStatusLoadedAt, statusLoadedAt } from './현재상황.js';
import { conferenceData, renderConference, setConferenceData } from './사례회의.js';


// 계획서 탭 사람 목록
// 계획서 인쇄 전용: 표가 빽빽해 상하 여백이 좁아 보여서, 인쇄 순간에만 위아래 여백을 넓힌다
window.printPlan = function() {
  const st = document.createElement('style');
  st.textContent = '@media print { @page { size: A4 portrait; margin: 14mm 10mm; } }';
  document.head.appendChild(st);
  window.print();
  setTimeout(() => st.remove(), 500);
};

window.loadPlanPersons = async function() {
  const year = document.getElementById('plan-year-sel').value;
  const type = document.getElementById('plan-type-sel').value;
  const rosterSnap = await getDoc(doc(db, 'roster', `${year}_${type}`));
  const personIds = rosterSnap.exists() ? (rosterSnap.data().personIds || []) : [];
  const mgrs = rosterSnap.exists() ? (rosterSnap.data().managers || {}) : {};
  const allList = await fetchPersonsAll();
  const list = [];
  allList.forEach(d => { if (personIds.includes(d.id) && !d.deleted) list.push({ ...d, manager: mgrs[d.id] !== undefined ? mgrs[d.id] : (d.manager || '') }); });
  list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  renderPlanPersonList(list);
  if (currentPerson && list.find(p => p.id === currentPerson.id)) {
    await selectPlanPerson(currentPerson.id, list);
  }
}

function renderPlanPersonList(list) {
  const el = document.getElementById('plan-person-list');
  if (!el) return;
  el.innerHTML = '';
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px 0;">등록된 사람이 없어요</div>';
    return;
  }
  list.forEach(p => {
    const div = document.createElement('div');
    div.className = 'person-card' + (currentPerson?.id === p.id ? ' active' : '');
    div.innerHTML = `<div class="pname">${esc(p.name)}</div><div class="pmeta">${esc(p.disability||'')} ${p.birth||''}</div>`;
    div.onclick = () => { selectPlanPerson(p.id, list); };
    el.appendChild(div);
  });
}

async function selectPlanPerson(id, list) {
  const year = document.getElementById('plan-year-sel').value;
  const type = document.getElementById('plan-type-sel').value;
  setCurrentPerson(list.find(p => p.id === id));
  if (!currentPerson) return;
  renderPlanPersonList(list);
  const scoreSnap = await getDoc(doc(db, 'scores', `${id}_${year}_${type}`));
  setCurrentScores(scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {});
  setReportData(scoreSnap.exists() ? (scoreSnap.data().report || {}) : {});
  window.reportData = reportData;
  setPlanData(scoreSnap.exists() ? (scoreSnap.data().plan || {}) : {});
  setConferenceData(scoreSnap.exists() ? (scoreSnap.data().conference || {}) : {});
  if (!planData.evalDatePlan && reportData.evalDate) planData.evalDatePlan = reportData.evalDate.replace(/-/g, '. ');
  if (!planData.meetingDate && conferenceData.meetingDate) planData.meetingDate = conferenceData.meetingDate.replace(/-/g, '. ');
  window.planData = planData;
  window.conferenceData = conferenceData;
  renderPlan();
}

window.filterPlanPersons = function(q) {
  const els = document.querySelectorAll('#plan-person-list .person-card');
  els.forEach(el => {
    el.style.display = el.textContent.includes(q) ? '' : 'none';
  });
};


// ══════════════════════════════════════════════════
// 계획서 탭
// ══════════════════════════════════════════════════
window.renderPlan = function() {
  if (!currentPerson) return;
  const year = document.getElementById('plan-year-sel').value;
  const p = currentPerson;
  const rd = reportData;
  // plan-person-badge 제거됨

  const longGoals = rd.longGoals || [];
  const shortGoals = rd.shortGoals || [];
  // planData에 저장된 수행방법 복원
  if (planData.methods) {
    shortGoals.forEach((sg, i) => {
      if (planData.methods[i]) sg.method = planData.methods[i];
    });
  }

  document.getElementById('plan-body').innerHTML = `
  <div style="max-width:860px;">
    <div style="text-align:center;margin-bottom:12px;">
      <h2 style="font-size:20px;font-weight:900;letter-spacing:3px;margin:0 0 8px;">직업재활계획서</h2>
      <div style="display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:6px;padding:6px 16px;font-size:12px;background:#fff;width:fit-content;">
        <span>접수번호 :</span>
        <input class="form-inp" style="width:120px;padding:3px 6px;" 
          value="${esc(planData.receiptNo||'')}" oninput="planData.receiptNo=this.value">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" ${planData.isInitial!==false?'checked':''} onchange="planData.isInitial=this.checked;"> 초기
        </label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" ${planData.isRevised?'checked':''} onchange="planData.isRevised=this.checked;"> 수정
        </label>
      </div>
    </div>

    <div class="plan-section">
      <h3>1. 장애인 인적사항</h3>
      <table class="plan-table">
        <tr><td style="width:80px;background:#BBDEFB;font-weight:700;text-align:center;">성 명</td><td style="width:140px;">${esc(p.name)}</td>
            <td style="width:80px;background:#BBDEFB;font-weight:700;text-align:center;">생년월일</td><td style="width:140px;">${esc(p.birth||'')}</td></tr>
        <tr><td style="background:#BBDEFB;font-weight:700;text-align:center;">장애유형</td><td style="width:140px;">${esc(p.disability||'')}</td>
            <td style="background:#BBDEFB;font-weight:700;text-align:center;">계획기간</td><td style="width:140px;">${parseInt(year)+1}-01-01 ~ ${parseInt(year)+1}-12-31</td></tr>
        <tr><td style="font-size:10px;">직업상담 실시일자</td>
            <td colspan="3"><input class="form-inp" type="text" placeholder="예) 2026. 01. 01" value="${esc(planData.counselingDate||'')}" oninput="planData.counselingDate=this.value" style="width:400px;flex:none;"></td></tr>
        <tr><td style="font-size:10px;">직업평가 실시일자</td>
            <td colspan="3"><input class="form-inp" type="text" placeholder="예) 2026. 01. 01" value="${esc(planData.evalDatePlan||'')}" oninput="planData.evalDatePlan=this.value" style="width:400px;flex:none;"></td></tr>
        <tr><td style="font-size:10px;">사례회의 실시일자</td>
            <td colspan="3"><input class="form-inp" type="text" placeholder="예) 2026. 01. 01" value="${esc(planData.meetingDate||'')}" oninput="planData.meetingDate=this.value" style="width:400px;flex:none;"></td></tr>
        <tr><td colspan="4" style="font-size:10px;color:var(--text2);padding:6px 8px;">
            ※ 장애인의 배경정보, 직업평가결과는 초기면접지, 직업평가보고서, 사례회의록 등을 참조
        </td></tr>
      </table>
    </div>

    <div class="plan-section">
      <h3>2. 장애인 및 보호자 의견</h3>
      <div class="editable-block" contenteditable="true" style="min-height:50px;"
        oninput="planData.opinion=this.innerText"
        >${esc(planData.opinion||'없음')}</div>
    </div>

    <div class="plan-section">
      <h3>3. 직업목표</h3>
      <div style="font-size:12px;font-weight:600;padding:6px 0;">${esc(rd.jobLevel||'보호고용')}</div>
    </div>

    <div class="plan-section">
      <h3>4. 장기목표</h3>
      ${longGoals.map(g=>`<div style="padding:3px 0;font-size:12px;">${esc(g)}</div>`).join('')||'<div style="color:var(--text2);font-size:12px;">보고서에서 장기목표를 입력하세요</div>'}
    </div>

    <div class="plan-section">
      <h3>5. 단기목표</h3>
      ${shortGoals.map(g=>`<div style="padding:3px 0;font-size:12px;">${esc(g.text)}</div>`).join('')||'<div style="color:var(--text2);font-size:12px;">보고서에서 단기목표를 입력하세요</div>'}
    </div>

    <div class="plan-section plan-page2">
      <h3>6. 직업재활계획 수행</h3>
      <table class="plan-table">
        <tr>
          <th style="width:20%;">장기목표</th>
          <th style="width:25%;">단기목표</th>
          <th style="width:10%;">기간</th>
          <th style="width:10%;">담당자</th>
          <th style="width:25%;">수행방법</th>
          <th style="width:10%;">달성</th>
        </tr>
        ${(() => {
          // 장기목표별 rowspan 계산
          const rowspanMap = {};
          shortGoals.forEach(sg => {
            const idx = sg.longIdx;
            rowspanMap[idx] = (rowspanMap[idx] || 0) + 1;
          });
          const renderedLong = new Set();
          return shortGoals.map(sg => {
            const lg = longGoals[sg.longIdx] || '';
            const isFirst = !renderedLong.has(sg.longIdx);
            if (isFirst) renderedLong.add(sg.longIdx);
            const rowspan = rowspanMap[sg.longIdx] || 1;
            return `<tr>
              ${isFirst ? `<td style="font-size:11px;vertical-align:middle;" rowspan="${rowspan}">${esc(lg)}</td>` : ''}
              <td style="font-size:11px;">${esc(sg.text)}</td>
              <td style="text-align:center;font-size:11px;">${parseInt(year)+1}.01~${parseInt(year)+1}.12</td>
              <td style="text-align:center;"><input type="text" maxlength="5" value="${esc(planData.methods&&planData.methods['manager_'+shortGoals.indexOf(sg)]||'')}" oninput="if(!planData.methods)planData.methods={};planData.methods['manager_'+${shortGoals.indexOf(sg)}]=this.value" style="width:52px;border:1px solid var(--border);border-radius:3px;padding:3px 4px;font-size:12px;text-align:center;font-family:inherit;"></td>
              <td id="method-td-${shortGoals.indexOf(sg)}" style="font-size:11px;cursor:pointer;position:relative;transition:background .15s;" onclick="openMethodPicker(${shortGoals.indexOf(sg)})" title="클릭하여 수행방법 선택">
                <span id="method-cell-${shortGoals.indexOf(sg)}" style="color:${sg.method?'inherit':'#BDBDBD'};white-space:pre-wrap;">${sg.method||'클릭하여 선택'}</span>
              </td>
              <td style="text-align:center;"><input type="checkbox" ${planData.achieved&&planData.achieved[shortGoals.indexOf(sg)]?'checked':''} onchange="if(!planData.achieved)planData.achieved={};planData.achieved[${shortGoals.indexOf(sg)}]=this.checked;"></td>
            </tr>`;
          }).join('');
        })()}
      </table>
    </div>

    <div class="plan-section">
      <h3>7. 서명</h3>
      <div style="font-size:11px;margin-bottom:10px;">위의 직업재활계획을 검토하였고 이를 성취하기 위한 최대한의 협력에 동의합니다.</div>
      <div style="display:flex;flex-direction:column;gap:14px;font-size:12px;max-width:500px;">
        <div class="form-row"><span style="min-width:70px;">작성일 :</span>
          <input class="form-inp" type="date" value="${esc(planData.planDate||'')}" style="width:150px;flex:none;" oninput="planData.planDate=this.value"></div>
        <div class="form-row"><span style="min-width:70px;">이용자 :</span><input class="form-inp" value="${esc(planData.user||'')}" style="width:100px;flex:none;" oninput="planData.user=this.value">&nbsp;(인/서명)</div>
        <div class="form-row"><span style="min-width:70px;">보호자 :</span><input class="form-inp" value="${esc(planData.guardian||'')}" style="width:100px;flex:none;" oninput="planData.guardian=this.value">&nbsp;(인/서명)</div>
        ${(()=>{ if(!planData.signRows) planData.signRows=[{label:'담 당',name:''},{label:'팀 장',name:''},{label:'원 장',name:''}]; return ''; })()}
        <div id="sign-extra-rows">
          ${planData.signRows.map((row,i)=>`
            <div class="form-row" style="margin-bottom:14px;">
              <span contenteditable="true" style="min-width:70px;display:inline-block;cursor:text;border-bottom:1px dashed transparent;outline:none;"
                onmouseover="this.style.borderBottomColor='#90CAF9'"
                onmouseout="this.style.borderBottomColor='transparent'"
                onfocus="this.style.borderBottomColor='var(--primary)'"
                onblur="planData.signRows[${i}].label=this.innerText;this.style.borderBottomColor='transparent'"
                title="클릭하여 직책 수정">${esc(row.label||'직책')} :</span>
              <input class="form-inp" value="${esc(row.name||'')}" placeholder="이름" style="width:100px;flex:none;" oninput="planData.signRows[${i}].name=this.value">
              &nbsp;(인/서명)
              <button onclick="removeSignRow(${i})" class="no-print" style="background:none;border:none;color:#BDBDBD;cursor:pointer;font-size:15px;padding:0 4px;line-height:1;" title="삭제">✕</button>
            </div>`).join('')}
        </div>
        <div class="form-row no-print" style="margin-top:2px;">
          <button onclick="addSignRow()" style="background:none;border:1px dashed #90CAF9;color:#1565C0;border-radius:4px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit;">+ 결재라인 추가</button>
        </div>
      </div>
    </div>
  </div>`;
} ;

let methodItems = [];
let pickingIdx = null;

window.addMethodItem = async function() {
  const mEl = document.getElementById('method-inp-method');
  const cEl = document.getElementById('method-inp-content');
  const sEl = document.getElementById('method-inp-session');
  const method = mEl.value.trim(), content = cEl.value.trim(), session = sEl.value.trim();
  if (!method) { toast('방법을 적어 주세요'); mEl.focus(); return; }
  if (methodItems.some(it => it.method === method && it.content === content && it.session === session)) {
    toast('같은 내용이 이미 목록에 있어요'); return;
  }
  methodItems.push({ method, content, session, title: method, full: '방법: ' + method + '\n내용: ' + content + '\n회기: ' + session });

  // 저장
  try {
    await setDoc(doc(db, 'settings', 'methodItems'), { items: methodItems });
    toast(`추가됨 (총 ${methodItems.length}개)`);
    mEl.value = ''; cEl.value = ''; sEl.value = '';
    mEl.focus();
  } catch(e) {
    toast(`추가 (저장 실패: ${e.message})`);
  }
  renderMethodList();
};

// 목록 설명 줄: "내용: … / 회기: …" (빈 값은 생략). 예전 모양({title, full}만 있는 항목)은 full 에서 제목을 뺀 나머지.
function methodDesc(item) {
  if (item.method === undefined) return (item.full || '').substring((item.title || '').length).trim();
  const parts = [];
  if (item.content) parts.push('내용: ' + item.content);
  if (item.session) parts.push('회기: ' + item.session);
  return parts.join(' / ');
}

function renderMethodList() {
  const el = document.getElementById('method-list');
  if (!el) return;
  if (methodItems.length === 0) {
    el.innerHTML = '<div class="mp-empty">방법·내용·회기를 적고 [추가]를 누르세요</div>';
    return;
  }
  el.innerHTML = methodItems.map((item, i) => `
    <div class="mp-item" onclick="selectMethod(${i})">
      <button class="mp-del" onclick="event.stopPropagation();deleteMethodItem(${i})" title="삭제">✕</button>
      <div class="mp-title">${esc(item.title)}</div>
      <div class="mp-desc">${esc(methodDesc(item))}</div>
    </div>`).join('');
}

window.deleteMethodItem = async function(i) {
  const item = methodItems[i];
  if (!confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
  methodItems.splice(i, 1);
  try {
    await setDoc(doc(db, 'settings', 'methodItems'), { items: methodItems });
    toast('삭제됨');
  } catch(e) {
    toast(`삭제 (저장 실패: ${e.message})`);
  }
  renderMethodList();
};

window.openMethodPicker = function(idx) {
  // 이전 선택 셀 초기화
  document.querySelectorAll('td[id^="method-td-"]').forEach(td => {
    td.style.background = '';
    td.style.outline = '';
  });
  pickingIdx = idx;
  // 선택된 셀 강조
  const td = document.getElementById('method-td-' + idx);
  if (td) {
    td.style.background = '#E3F2FD';
    td.style.outline = '2px solid var(--primary)';
  }
  // 수행방법 패널 활성화 표시
  const panel = document.getElementById('method-panel');
  if (panel) {
    panel.style.borderLeft = '1px solid var(--primary)';
    panel.scrollTop = 0;
  }
  const header = panel?.querySelector('div:first-child');
  if (header) {
    header.style.background = 'var(--primary)';
    header.style.color = '#fff';
    header.textContent = '수행방법을 골라보세요!';
  }
};

window.selectMethod = function(methodIdx) {
  applyMethodItem(methodItems[methodIdx]);
};

// 고른 항목({title, full})을 수행방법 칸에 넣는다
function applyMethodItem(item) {
  if (pickingIdx === null) { toast('먼저 수행방법 셀을 클릭하세요'); return; }
  if (!item) return;

  // reportData의 shortGoals 업데이트
  if (reportData.shortGoals && reportData.shortGoals[pickingIdx] !== undefined) {
    reportData.shortGoals[pickingIdx].method = item.full;
  }
  if (!planData.methods) planData.methods = {};
  planData.methods[pickingIdx] = item.full;

  // DOM 업데이트
  const cell = document.getElementById('method-cell-' + pickingIdx);
  if (cell) {
    cell.textContent = item.full;
    cell.style.whiteSpace = 'pre-wrap';
    cell.style.color = 'inherit';
  }

  // 강조 해제
  document.querySelectorAll('td[id^="method-td-"]').forEach(td => {
    td.style.background = '';
    td.style.outline = '';
  });
  // 패널 원래대로
  const panel = document.getElementById('method-panel');
  if (panel) {
    panel.style.borderLeft = '1px solid #dee3e9';
  }
  const header = panel?.querySelector('div:first-child');
  if (header) {
    header.style.background = '#fff';
    header.style.color = '#0a1317';
    header.textContent = '수행방법 목록';
  }
  toast(`"${item.title}" 적용됨`);
  pickingIdx = null;
}

function initSignRows() {
  if (!planData.signRows) {
    planData.signRows = [{label:'담 당',name:''},{label:'팀 장',name:''},{label:'원 장',name:''}];
  }
}

window.addConfSignRow = function() {
  if (!conferenceData.signRows) conferenceData.signRows = [{label:'담 당',name:''},{label:'팀 장',name:''},{label:'원 장',name:''}];
  conferenceData.signRows.push({ label: '', name: '' });
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  renderConference(year, type, String(parseInt(year)-1), {});
};

window.removeConfSignRow = function(i) {
  if (!conferenceData.signRows) return;
  if (conferenceData.signRows.length <= 1) { toast('최소 1개는 있어야 해요'); return; }
  conferenceData.signRows.splice(i, 1);
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  renderConference(year, type, String(parseInt(year)-1), {});
};

window.addSignRow = function() {
  initSignRows();
  planData.signRows.push({ label: '', name: '' });
  renderPlan();
};

window.removeSignRow = function(i) {
  initSignRows();
  if (planData.signRows.length <= 1) { toast('최소 1개는 있어야 해요'); return; }
  planData.signRows.splice(i, 1);
  renderPlan();
};

window.savePlan = async function() {
  if (!currentPerson) return;
  const year = document.getElementById('plan-year-sel').value;
  const type = document.getElementById('plan-type-sel').value;
  try {
    await setDoc(doc(db, 'scores', `${currentPerson.id}_${year}_${type}`),
      { plan: planData }, { merge: true });
    setStatusLoadedAt(0);
    toast('계획서 저장 완료');
  } catch(e) { toast('저장 실패: '+e.message); }
};


function setMethodItems(v) { methodItems = v; }

export { applyMethodItem, methodItems, renderMethodList, renderPlanPersonList, selectPlanPerson, setMethodItems };
