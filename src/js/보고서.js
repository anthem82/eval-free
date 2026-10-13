import { doc, getDoc, setDoc } from './저장소.js';
import { currentGroupStats, currentPerson, currentScores, db, planData, prevItems, prevScores, prevShortGoals, reportData, setCurrentGroupStats, setCurrentPerson, setCurrentScores, setPlanData, setPrevItems, setPrevScores, setPrevShortGoals, setReportData } from './공통.js';
import { DEFAULT_ITEMS, getTmplData } from './평가지관리.js';
import { calcSum, fetchPersonsAll, groupItems, scoreKeyOrder } from './점수입력.js';
import { copyPrompt, STYLE_RULES } from './AI.js';
import { esc, getGrade, gradeLabel } from './유틸.js';
import { setStatusLoadedAt, statusLoadedAt } from './현재상황.js';


// 보고서 탭 사람 목록
window.loadReportPersons = async function() {
  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;
  const rosterSnap = await getDoc(doc(db, 'roster', `${year}_${type}`));
  const personIds = rosterSnap.exists() ? (rosterSnap.data().personIds || []) : [];
  const mgrs = rosterSnap.exists() ? (rosterSnap.data().managers || {}) : {};
  const allList = await fetchPersonsAll();
  const list = [];
  allList.forEach(d => { if (personIds.includes(d.id) && !d.deleted) list.push({ ...d, manager: mgrs[d.id] !== undefined ? mgrs[d.id] : (d.manager || '') }); });
  list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  renderReportPersonList(list);
  if (currentPerson && list.find(p => p.id === currentPerson.id)) {
    await selectReportPerson(currentPerson.id, list);
  }
}

function renderReportPersonList(list) {
  const el = document.getElementById('report-person-list');
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
    div.onclick = () => { selectReportPerson(p.id, list); };
    el.appendChild(div);
  });
}

async function selectReportPerson(id, list) {
  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;
  setCurrentPerson(list.find(p => p.id === id));
  if (!currentPerson) return;
  renderReportPersonList(list);
  const scoreSnap = await getDoc(doc(db, 'scores', `${id}_${year}_${type}`));
  setCurrentScores(scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {});
  setReportData(scoreSnap.exists() ? (scoreSnap.data().report || {}) : {});
  window.reportData = reportData;
  setPlanData(scoreSnap.exists() ? (scoreSnap.data().plan || {}) : {});
  window.planData = planData;
  const prevYear = String(parseInt(year) - 1);
  const prevSnap = await getDoc(doc(db, 'scores', `${id}_${prevYear}_${type}`));
  setPrevScores(prevSnap.exists() ? (prevSnap.data().scores || {}) : {});
  setPrevShortGoals(prevSnap.exists() ? (prevSnap.data().report?.shortGoals || []) : []);
  const prevTmplData = await getTmplData(prevYear, type);
  setPrevItems(prevTmplData ? (prevTmplData.items || []) : []);
  // 현재 평가지 항목 로드
  const tmplData = await getTmplData(year, type);
  window._currentItems = tmplData ? (tmplData.items || []) : DEFAULT_ITEMS;
  renderReport();
}

window.filterReportPersons = function(q) {
  const els = document.querySelectorAll('#report-person-list .person-card');
  els.forEach(el => {
    el.style.display = el.textContent.includes(q) ? '' : 'none';
  });
};
window.goReport = async function() {
  // 사람탭 연도/직무를 보고서탭에 복사
  const ey = document.getElementById('eval-year-sel').value;
  const et = document.getElementById('eval-type-sel').value;
  const rySel = document.getElementById('rpt-year-sel');
  const rtSel = document.getElementById('rpt-type-sel');
  if (rySel) { for(let o of rySel.options) if(o.value===ey) { rySel.value=ey; break; } }
  if (rtSel) { for(let o of rtSel.options) if(o.value===et) { rtSel.value=et; break; } }
  showPane('pane-report', true);   // 아래에서 직접 불러오므로 중복 로드 방지
  await loadReportPersons();
  if (currentPerson) renderReport();
};

// ══════════════════════════════════════════════════
// 보고서 탭
// ══════════════════════════════════════════════════
async function renderReport() {
  if (!currentPerson) return;
  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;

  // 보고서 헤더 뱃지 (없어도 무관)

  // 항목 및 점수 재수집
  const tmplData = await getTmplData(year, type);
  const items = tmplData ? tmplData.items : DEFAULT_ITEMS;

  const groups = groupItems(items);

  // 전년도 평가지 그룹 (pmax 계산용)
  const prevGroups = prevItems.length > 0 ? groupItems(prevItems) : groups;

  // 그룹별 점수 집계
  setCurrentGroupStats([]);
  const groupStats = groups.map(g => {
    const keys = g.items.map(it => String(it.no));
    const sum = calcSum(keys, currentScores);
    const max = g.items.length * 10;

    // 전년도: 텍스트 매칭으로 점수 합산 + 전년도 항목 수로 나누기
    const prevGroup = prevGroups.find(pg => pg.cat === g.cat);
    let psum = 0, pmax = 0;
    if (prevGroup && prevItems.length > 0) {
      prevGroup.items.forEach(pit => {
        const pkey = String(pit.no);
        const score = prevScores[pkey] !== undefined ? prevScores[pkey] : null;
        if (score !== null) psum += score;
      });
      pmax = prevGroup.items.length * 10;
    } else {
      // 전년도 평가지 없으면 같은 키로 계산
      psum = calcSum(keys, prevScores);
      pmax = g.items.length * 10;
    }

    return { cat: g.cat, sum, psum, max, pmax,
      pct: max>0?(sum/max*100):0,
      ppct: pmax>0?(psum/pmax*100):0 };
  });

  setCurrentGroupStats(groupStats);
  const totalSum = groupStats.reduce((s,g)=>s+g.sum,0);
  const totalMax = groupStats.reduce((s,g)=>s+g.max,0);
  const prevTotalSum = groupStats.reduce((s,g)=>s+g.psum,0);
  const prevTotalMax = groupStats.reduce((s,g)=>s+g.pmax,0);
  const totalPct = totalMax>0?(totalSum/totalMax*100):0;
  const prevTotalPct = prevTotalMax>0?(prevTotalSum/prevTotalMax*100):0;
  const grade = getGrade(totalPct);

  // 5점 이하 항목
  const lowItems = items.filter(it => {
    const v = currentScores[String(it.no)];
    return v !== undefined && v <= 5;
  });

  // 자동 서술문
  const autoLines = groupStats.map(g =>
    `▶ ${g.cat} 영역 : ${g.sum}점 / ${g.max}점 (수행률 ${g.pct.toFixed(1)}%)`
  );
  const progressLines = groupStats.map(g => {
    const d = (g.pct - g.ppct).toFixed(1);
    const sign = g.pct > g.ppct ? '▲ 상승' : g.pct < g.ppct ? '▼ 하락' : '변화없음';
    return `▶ ${g.cat} : 전년도 ${g.ppct.toFixed(1)}% → 당해 ${g.pct.toFixed(1)}% (${sign} ${Math.abs(d)}%p)`;
  });

  const rd = reportData;

  document.getElementById('report-body').innerHTML = `
  <div style="max-width:860px;">
    <h2 style="font-size:18px;font-weight:900;letter-spacing:2px;text-align:center;padding:10px 0 14px;color:var(--primary);">평가 종합 보고서</h2>
    <!-- 기본사항 -->
    <div class="report-section" style="padding:10px 14px;">
      <h3>[1] 기본사항</h3>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid var(--border);">
            <td rowspan="2" style="font-size:17px;font-weight:900;color:var(--primary);padding:4px 20px 4px 0;border-right:2px solid var(--border);width:90px;vertical-align:middle;text-align:center">${esc(currentPerson.name)}</td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">생년월일 : <b>${esc(currentPerson.birth||'-')}</b></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">장애명 : <b>${esc(currentPerson.disability||'-')}</b></td>
            <td></td>
          </tr>
          <tr>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가일 : <input class="form-inp" type="date" id="rpt-eval-date" value="${rd.evalDate||''}" style="width:140px;padding:3px 6px;"></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가파트 : <b>${type}</b></td>
            <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가자 : <b>${esc(currentPerson.manager||'-')}</b></td>
          </tr>
        </table>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;border-top:1.5px solid var(--primary);padding-top:10px;width:100%;">
          <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
            <span style="min-width:60px;color:var(--text2);font-weight:700;">평가목적 :</span>
            <input class="form-inp" style="flex:1;" placeholder="평가목적을 입력하세요"
              value="${esc(rd.evalPurpose||'')}"
              oninput="reportData.evalPurpose=this.value">
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
            <span style="min-width:60px;color:var(--text2);font-weight:700;">평가방법 :</span>
            <input class="form-inp" style="flex:1;" placeholder="평가방법을 입력하세요"
              value="${esc(rd.evalMethod||'')}"
              oninput="reportData.evalMethod=this.value">
          </div>
        </div>
      </div>
    </div>

    <!-- 배경정보 -->
    <div class="report-section">
      <h3>[2] 배경정보</h3>
      <div>
        ${[
          {key:'bg_behavior',   label:'행동관찰'},
          {key:'bg_disability', label:'장애관련(*)'},
          {key:'bg_family',     label:'가정환경관련(*)'},
          {key:'bg_education',  label:'교육 및 훈련관련(*)'},
          {key:'bg_learning',   label:'기초학습능력관련(*)'},
          {key:'bg_career',     label:'직업경력관련(*)'},
          {key:'bg_living',     label:'생활적응능력관련(*)'},
        ].map(item => `
          <div style="margin-bottom:8px;">
            <div style="font-size:11px;font-weight:700;margin-bottom:3px;">${item.label}</div>
            <div class="editable-block" contenteditable="true" id="rpt-${item.key}"
              oninput="reportData[this.dataset.key]=this.innerText" data-key="${item.key}"
              >${esc(rd[item.key]||'')}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 평가결과 -->
    <div class="report-section">
      <h3>[3] 평가결과</h3>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
        <div style="flex:1;min-width:300px;">
          <table class="result-table">
            <tr><th>영역</th><th>당해 수행률</th><th>전년도 수행률</th><th>등락</th></tr>
            ${groupStats.map(g => `
              <tr>
                <td>${esc(g.cat)}</td>
                <td><b>${g.pct.toFixed(1)}%</b></td>
                <td style="color:#888;">${g.ppct.toFixed(1)}%</td>
                <td class="${g.pct>=g.ppct?'up':'dn'}">${g.pct>=g.ppct?'▲':'▼'}${Math.abs(g.pct-g.ppct).toFixed(1)}%p</td>
              </tr>`).join('')}
            <tr style="background:#EDE7F6;">
              <td><b>합계</b></td>
              <td><b>${totalPct.toFixed(1)}%</b></td>
              <td style="color:#888;">${prevTotalPct.toFixed(1)}%</td>
              <td class="${totalPct>=prevTotalPct?'up':'dn'}">${totalPct>=prevTotalPct?'▲':'▼'}${Math.abs(totalPct-prevTotalPct).toFixed(1)}%p</td>
            </tr>
          </table>
        </div>
        <div style="text-align:center;padding:10px;">
          <div style="font-size:11px;color:var(--text2);margin-bottom:6px;">종합 등급</div>
          <div class="grade-badge g${grade}" style="width:60px;height:60px;line-height:60px;font-size:32px;">${grade}</div>
          <div style="font-size:11px;margin-top:6px;">${gradeLabel(grade)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:4px;">${totalSum}점 / ${totalMax}점</div>
        </div>
      </div>

    </div>

    <!-- 자동 서술 -->
    <!-- 종합소견 -->
    <div class="report-section">
      <h3>[4] 직업재활 방향</h3>
      <div style="margin-bottom:6px;font-size:11px;font-weight:700;">직업적 강점</div>
      <div class="editable-block" contenteditable="true" id="rpt-strength"
        oninput="reportData.strength=this.innerText"
        >${esc(rd.strength||'')}</div>
      <div style="margin:8px 0 6px;font-size:11px;font-weight:700;">직업적 제한점</div>
      <div class="editable-block" contenteditable="true" id="rpt-limitation"
        oninput="reportData.limitation=this.innerText"
        >${esc(rd.limitation||'')}</div>
      <div style="margin:8px 0 6px;font-size:11px;font-weight:700;">직업적 소견</div>
      <div class="editable-block" contenteditable="true" id="rpt-summary"
        oninput="reportData.summary=this.innerText"
        >${esc(rd.summary||'')}</div>
    </div>

    <div class="report-section">
      <h3>[5] 종합소견</h3>

      <!-- 영역별 점수 결과 -->
      <div style="font-size:12px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:6px;">영역별 점수 결과</div>
      <div class="auto-block" style="margin-bottom:12px;">
        ${autoLines.map(l=>`<div class="auto-line">${l}</div>`).join('')}
      </div>

      <!-- 문항별 결과 -->
      <div style="font-size:12px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:8px;">문항별 결과</div>
      ${groupStats.map((g,gi) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <div class="auto-line" style="flex:1;">${esc(g.cat)} 영역 : ${g.sum}점 / ${g.max}점 (수행률 ${g.pct.toFixed(1)}%)</div>
            
          </div>
          <div class="editable-block" contenteditable="true" id="rpt-group-${gi}"
            onkeydown="if(event.key==='Enter'){document.execCommand('insertLineBreak');event.preventDefault();}" oninput="if(!reportData.groupResults)reportData.groupResults=[];reportData.groupResults[${gi}]=this.innerText"
            >${esc((rd.groupResults||[])[gi]||'')}</div>
        </div>
      `).join('')}

      <!-- 진전도 비교 -->
      <div style="font-size:12px;font-weight:700;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:4px;margin:12px 0 6px;">진전도 비교</div>
      <div class="auto-block" style="margin-bottom:12px;">
        ${progressLines.map(l=>`<div class="auto-line">${l}</div>`).join('')}
      </div>

      <!-- 평가결과 소견 -->
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:6px;">
  <div style="font-size:12px;font-weight:700;color:var(--primary);">평가결과 소견</div>
  
</div>
      <div class="editable-block" contenteditable="true" id="rpt-eval-opinion"
        oninput="reportData.evalOpinion=this.innerText"
        >${esc(rd.evalOpinion||'')}</div>
    </div>

    <!-- 직업수준 및 목표 -->
    <div class="report-section">
      <h3>[6] 직업수준 및 목표</h3>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;">직업목표:</span>
        <input class="form-inp" id="rpt-joblevel" value="${esc(rd.jobLevel||'보호고용')}"
          oninput="reportData.jobLevel=this.value" style="width:150px;">
      </div>
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px;">장기목표</div>
        <div id="long-goal-list"></div>
        <button class="btn btn-outline btn-sm no-print" onclick="addGoal('long')" style="margin-top:4px;">+ 추가</button>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:4px;">단기목표</div>
        <div id="short-goal-list"></div>
        <button class="btn btn-outline btn-sm no-print" onclick="addGoal('short')" style="margin-top:4px;">+ 추가</button>
      </div>
    </div>
    
  </div>`;

  // 오른쪽 패널 업데이트
  window._lowItems = lowItems;
  renderLowPanel();
  renderGoals();
}

function renderLowPanel() {
  const lowItems = window._lowItems || [];
  const lowPanel = document.getElementById('low-items-list');
  if (!lowPanel) return;

  if (lowItems.length === 0) {
    lowPanel.innerHTML = '<div class="lp-empty">5점 이하 항목 없음</div>';
    return;
  }

  // 단기목표에 등록된 항목 내용 목록
  const registeredContents = new Set((reportData.shortGoals||[]).map(sg => {
    const m = sg.text.match(/\] (.+?) - /);
    return m ? m[1] : '';
  }));

  const catMap = {};
  lowItems.forEach(it => {
    if (!catMap[it.cat]) catMap[it.cat] = [];
    catMap[it.cat].push(it);
  });

  let html = '<div class="lp-hint">체크 후 향상 목표점수 입력 → 목표 자동 생성</div>';
  Object.keys(catMap).forEach(cat => {
    html += `<div style="margin-bottom:16px;">
      <div class="lp-cat">${esc(cat)}</div>`;
    catMap[cat].forEach(it => {
      const curScore = currentScores[String(it.no)] || 0;
      // 체크 여부: 사용자가 만진 적 있으면 그 상태 우선, 아니면 단기목표 등록 여부
      const inShortGoal = registeredContents.has(it.content);
      const lc = (reportData.lowChecks || {})[it.no];
      const isChecked = (lc && lc.checked !== undefined) ? lc.checked : inShortGoal;
      const tgtScore = (reportData.lowChecks || {})[it.no]?.target || '';
      html += `<div class="lp-item">
        <input type="checkbox" ${isChecked?'checked':''} onchange="onLowCheck(${it.no},this.checked)">
        <div style="flex:1;">
          <div class="lp-text">${esc(it.content)}</div>
          <div class="lp-sub">
            <span>현재 ${curScore}점 → 목표</span>
            <input class="lp-num" type="number" min="1" max="10" value="${tgtScore}" placeholder="목표점"
              oninput="onLowTarget(${it.no},this.value)">
            <span>점</span>
          </div>
          ${(() => {
            const prevGoal = prevShortGoals.find(sg => sg.text && sg.text.includes(it.content));
            return prevGoal ? `<div class="lp-prev">지난해 목표 : ${esc(prevGoal.text)}</div>` : '';
          })()}
        </div>
      </div>`;
    });
    html += '</div>';
  });

  lowPanel.innerHTML = html;
}

// 5점이하 체크 상태 저장
window.onLowCheck = function(no, checked) {
  if (!reportData.lowChecks) reportData.lowChecks = {};
  if (!reportData.lowChecks[no]) reportData.lowChecks[no] = {};
  reportData.lowChecks[no].checked = checked;
};

// 목표점수 저장
window.onLowTarget = function(no, val) {
  if (!reportData.lowChecks) reportData.lowChecks = {};
  if (!reportData.lowChecks[no]) reportData.lowChecks[no] = {};
  reportData.lowChecks[no].target = parseInt(val) || '';
};

// 장·단기 목표 번호를 목록 구조에서 다시 계산해 텍스트 앞에 붙인다
// (장기 = 목록 순서 1., 2., … / 단기 = 소속 장기번호-순번. 형식)
function renumberGoals() {
  if (!reportData.longGoals) reportData.longGoals = [];
  if (!reportData.shortGoals) reportData.shortGoals = [];
  reportData.longGoals = reportData.longGoals.map((g, i) => `${i + 1}. ${String(g).replace(/^\s*\d+\.\s*/, '')}`);
  const cnt = {};
  reportData.shortGoals
    .map(g => g)
    .sort((a, b) => (a.longIdx || 0) - (b.longIdx || 0))
    .forEach(g => {
      const li = g.longIdx || 0;
      cnt[li] = (cnt[li] || 0) + 1;
      g.text = `${li + 1}-${cnt[li]}. ${String(g.text || '').replace(/^\s*\d+(-\d+)?\.\s*/, '')}`;
    });
  // 저장 순서도 장기목표 순서에 맞춰 정렬
  reportData.shortGoals.sort((a, b) => (a.longIdx || 0) - (b.longIdx || 0));
}

// 목표에 적용 — 체크된 항목으로 장기(대분류당 1개)·단기(항목당 1개) 목표 생성, 번호는 구조에서 재계산
window.applyLowGoals = function() {
  if (!window._currentItems) { toast('먼저 사람을 선택하고 보고서를 로드하세요'); return; }
  if (!reportData.lowChecks) reportData.lowChecks = {};
  if (!reportData.longGoals) reportData.longGoals = [];
  if (!reportData.shortGoals) reportData.shortGoals = [];
  const checks = reportData.lowChecks;
  const lowItems = window._lowItems || [];

  // 항목 번호 → 대분류 (빈 cat 항목은 그룹 기준으로 보정)
  const catByNo = {};
  groupItems(window._currentItems).forEach(g => g.items.forEach(it => { catByNo[String(it.no)] = g.cat; }));

  // 자동 생성 목표 텍스트에서 항목 내용/대분류 추출
  const goalContent = sg => { const m = (sg.text || '').match(/\] (.+?) - /); return m ? m[1] : ''; };
  const longCatOf = g => { const m = (g || '').match(/^(?:\s*\d+\.\s*)?(.+?)의 수행률을/); return m ? m[1] : null; };
  const registered = new Set(reportData.shortGoals.map(goalContent));
  const isCheckedItem = it => {
    const lc = checks[it.no];
    return (lc && lc.checked !== undefined) ? lc.checked : registered.has(it.content);
  };

  const checkedItems = lowItems.filter(isCheckedItem);
  if (checkedItems.length === 0) { toast('체크된 항목이 없어요'); return; }

  // 목표점수 검증 (미입력이면 기존 목표 문구에서 복원 시도)
  const targetOf = {};
  for (const it of checkedItems) {
    const cur = currentScores[String(it.no)] || 0;
    let t = parseInt(checks[it.no]?.target);
    if (!t) {
      const ex = reportData.shortGoals.find(sg => goalContent(sg) === it.content);
      const m = ex && ex.text.match(/(\d+)점으로 향상/);
      t = m ? parseInt(m[1]) : NaN;
    }
    if (!t) { toast('목표점수를 입력하세요: ' + it.content); return; }
    if (t <= cur || t > 10) { toast(`목표점수는 현재점수(${cur}점)보다 크고 10점 이하여야 해요: ` + it.content); return; }
    targetOf[String(it.no)] = t;
    checks[it.no] = { checked: true, target: t };
  }

  // 체크 해제된 항목의 자동 생성 단기목표는 제거 (손으로 추가한 목표는 안 건드림)
  const uncheckedContents = new Set(lowItems.filter(it => !isCheckedItem(it)).map(it => it.content));
  reportData.shortGoals = reportData.shortGoals.filter(sg => {
    const c = goalContent(sg);
    return !(c && uncheckedContents.has(c));
  });

  // 대분류별로 묶기
  const catGroups = {};
  checkedItems.forEach(it => {
    const cat = catByNo[String(it.no)] || it.cat || '기타';
    (catGroups[cat] = catGroups[cat] || []).push(it);
  });

  // 장기목표: 대분류당 1개 (있으면 갱신, 없으면 추가)
  Object.keys(catGroups).forEach(cat => {
    const catStat = currentGroupStats.find(g => g.cat === cat);
    const curPct = catStat ? catStat.pct.toFixed(1) : '?';
    let newSum = catStat ? catStat.sum : 0;
    catGroups[cat].forEach(it => { newSum += targetOf[String(it.no)] - (currentScores[String(it.no)] || 0); });
    const newPct = catStat ? (newSum / catStat.max * 100).toFixed(1) : '?';
    const body = `${cat}의 수행률을 ${curPct}%에서 ${newPct}%로 향상`;
    const idx = reportData.longGoals.findIndex(g => longCatOf(g) === cat);
    if (idx === -1) reportData.longGoals.push(body); else reportData.longGoals[idx] = body;
  });

  // 단기목표: 항목당 1개 (내용이 정확히 같은 기존 목표는 갱신)
  Object.keys(catGroups).forEach(cat => {
    const longIdx = reportData.longGoals.findIndex(g => longCatOf(g) === cat);
    catGroups[cat].forEach(it => {
      const cur = currentScores[String(it.no)] || 0;
      const body = `[${cat}] ${it.content} - ${cur}점에서 ${targetOf[String(it.no)]}점으로 향상`;
      const idx = reportData.shortGoals.findIndex(sg => goalContent(sg) === it.content);
      if (idx === -1) reportData.shortGoals.push({ text: body, longIdx, manager: currentPerson?.manager || '' });
      else { reportData.shortGoals[idx].text = body; reportData.shortGoals[idx].longIdx = longIdx; }
    });
  });

  // 단기목표가 하나도 안 남은 자동 생성 장기목표는 제거
  for (let i = reportData.longGoals.length - 1; i >= 0; i--) {
    if (!longCatOf(reportData.longGoals[i])) continue;
    if (!reportData.shortGoals.some(sg => sg.longIdx === i)) {
      reportData.longGoals.splice(i, 1);
      reportData.shortGoals.forEach(sg => { if (sg.longIdx > i) sg.longIdx--; });
    }
  }

  // 장기목표를 평가지 영역 순서대로 정렬 (손으로 쓴 목표는 순서 유지한 채 뒤로)
  const catOrder = [];
  groupItems(window._currentItems).forEach(g => { if (!catOrder.includes(g.cat)) catOrder.push(g.cat); });
  const orderOf = g => {
    const c = longCatOf(g);
    const i = c ? catOrder.indexOf(c) : -1;
    return i === -1 ? 999 : i;
  };
  const entries = reportData.longGoals.map((g, i) => ({ g, i }));
  entries.sort((a, b) => orderOf(a.g) - orderOf(b.g) || a.i - b.i);
  const newIdxOf = {};
  entries.forEach((e, ni) => { newIdxOf[e.i] = ni; });
  reportData.longGoals = entries.map(e => e.g);
  reportData.shortGoals.forEach(sg => { if (newIdxOf[sg.longIdx] !== undefined) sg.longIdx = newIdxOf[sg.longIdx]; });

  renumberGoals();
  renderGoals();
  renderLowPanel();
  renderPlanIfActive();
  toast(`장기목표 ${Object.keys(catGroups).length}개, 단기목표 ${checkedItems.length}개 적용됨`);
};

function renderGoals() {
  const rd = reportData;
  if (!rd.longGoals) rd.longGoals = [];
  if (!rd.shortGoals) rd.shortGoals = [];
  // "새 단기목표" 자동 생성 항목 제거 (이전 버전 데이터 정리)
  rd.shortGoals = rd.shortGoals.filter(g => g.text !== '새 단기목표');

  const lgEl = document.getElementById('long-goal-list');
  if (!lgEl) return;
  lgEl.innerHTML = rd.longGoals.map((g,i) => `
    <div style="display:flex;gap:4px;margin:2px 0;align-items:center;">
      <input class="goal-inp" value="${esc(g)}" oninput="reportData.longGoals[${i}]=this.value;renderPlanIfActive()">
      <button class="btn btn-danger btn-sm no-print" onclick="removeGoal('long',${i})">✕</button>
    </div>`).join('');

  const sgEl = document.getElementById('short-goal-list');
  if (!sgEl) return;
  // longIdx 순서로 정렬해서 표시
  const sortedShort = rd.shortGoals.map((g,i) => ({...g, _origIdx:i})).sort((a,b) => a.longIdx - b.longIdx);
  // 장기목표별 단기목표 순번 계산
  const longSubCount = {};
  sgEl.innerHTML = sortedShort.map((g) => {
    const i = g._origIdx;
    if (longSubCount[g.longIdx] === undefined) longSubCount[g.longIdx] = 0;
    longSubCount[g.longIdx]++;
    const subNum = `${g.longIdx+1}-${longSubCount[g.longIdx]}.`;
    return `
    <div style="display:flex;gap:4px;margin:2px 0;padding:1px 0;align-items:center;">
      <select style="display:none;" onchange="reportData.shortGoals[${i}].longIdx=parseInt(this.value)">
        ${(rd.longGoals||[]).map((lg,li)=>`<option value="${li}" ${li==g.longIdx?'selected':''}>${li+1}번 장기목표</option>`).join('')}
      </select>
      <input class="goal-inp" value="${esc(g.text)}" style="flex:1;min-width:180px;" oninput="reportData.shortGoals[${i}].text=this.value;renderPlanIfActive()">
      <button class="btn btn-danger btn-sm no-print" onclick="removeGoal('short',${i})">✕</button>
    </div>`;
  }).join('');
}

window.addGoal = function(type) {
  if (!reportData.longGoals) reportData.longGoals = [];
  if (!reportData.shortGoals) reportData.shortGoals = [];
  if (type==='long') {
    reportData.longGoals.push('새 장기목표');
  } else {
    const lastLongIdx = reportData.longGoals.length > 0 ? reportData.longGoals.length - 1 : 0;
    reportData.shortGoals.push({text:'새 단기목표', longIdx:lastLongIdx, manager:currentPerson?.manager||''});
  }
  renumberGoals();
  renderGoals();
  renderPlanIfActive();
};
window.removeGoal = function(type,i) {
  if (type==='long') {
    // 해당 장기목표 연결 단기목표도 삭제 + lowChecks 체크 해제
    const removedSgs = reportData.shortGoals.filter(sg => sg.longIdx === i);
    removedSgs.forEach(sg => {
      const m = sg.text.match(/\] (.+?) - /);
      if (m && reportData.lowChecks) {
        const item = (window._currentItems||[]).find(it => it.content === m[1]);
        if (item) reportData.lowChecks[item.no] = { checked: false, target: '' };
      }
    });
    reportData.shortGoals = reportData.shortGoals.filter(sg => sg.longIdx !== i);
    reportData.shortGoals.forEach(sg => { if (sg.longIdx > i) sg.longIdx--; });
    reportData.longGoals.splice(i,1);
  } else {
    // 단기목표 삭제 시 lowChecks 체크 해제
    const sg = reportData.shortGoals[i];
    if (sg) {
      const m = sg.text.match(/\] (.+?) - /);
      if (m && reportData.lowChecks) {
        const item = (window._currentItems||[]).find(it => it.content === m[1]);
        if (item) reportData.lowChecks[item.no] = { checked: false, target: '' };
      }
    }
    reportData.shortGoals.splice(i,1);
    // 남은 단기목표 없으면 장기목표도 삭제
    if (reportData.longGoals && reportData.shortGoals.length === 0) {
      reportData.longGoals = [];
    }
  }
  renumberGoals();
  renderGoals();
  renderLowPanel();
  renderPlanIfActive();
};
window.renderPlanIfActive = function() {
  if (document.getElementById('pane-plan').classList.contains('active')) renderPlan();
};
window.generateAIOpinion = async function() {
  const el = document.getElementById('rpt-eval-opinion');
  if (!el) return;
  const prompt = `다음은 직업재활 평가 결과입니다. 2줄 이내로 간결하게 소견을 작성해주세요. 마크다운 기호 없이 일반 텍스트로만 쓰고, 수치에 근거해 자연스러운 한국어로 쓰세요. 대상자를 지칭할 때는 "${currentPerson?.name || '대상자'}씨"처럼 이름 뒤에 "씨"나 "님"을 붙이고 이름만 단독으로 쓰지 마세요.\n\n문체 지침(꼭 지킬 것):\n${STYLE_RULES}\n\n${currentGroupStats.map(g=>`${g.cat}: ${g.pct.toFixed(1)}%`).join('\n')}`;
  try {
    await copyPrompt(prompt, currentPerson?.name);
  } catch(e) { toast('복사 실패: ' + e.message); }
};

// 문항별 결과 자동 채우기
window.fillGroupResult = function(gi) {
  const el = document.getElementById('rpt-group-' + gi);
  if (!el) return;
  // 해당 그룹의 5점 이하 항목 자동 서술
  const groups = groupItems(scoreKeyOrder.map((k,i) => ({no:k, _order:i})));
  // 실제 items 필요 - renderReport 시점의 groupStats 재활용 불가
  // 간단히 해당 그룹 수행률 정보만 넣기
  const badge = el.closest('.report-section')?.querySelectorAll('.auto-line')[gi];
  if (badge) {
    el.innerText = badge.innerText;
    if (!reportData.groupResults) reportData.groupResults = [];
    reportData.groupResults[gi] = el.innerText;
  }
};

// ── 전년도 보고서 내용 복사 ──
// 평가일(evalDate)·[6] 직업수준 및 목표(jobLevel/longGoals/shortGoals/lowChecks)와
// 점수 기반 종합의견(scoreOpinion)은 올해 것을 써야 하므로 제외한다.
window.copyPrevReport = async function() {
  if (!currentPerson) { toast('먼저 사람을 선택하세요'); return; }
  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;
  const prevYear = String(parseInt(year) - 1);
  let snap;
  try {
    snap = await getDoc(doc(db, 'scores', `${currentPerson.id}_${prevYear}_${type}`));
  } catch(e) { toast('불러오기 실패: ' + e.message); return; }
  const prevReport = snap.exists() ? (snap.data().report || {}) : {};
  const EXCLUDE = ['evalDate', 'jobLevel', 'longGoals', 'shortGoals', 'lowChecks', 'scoreOpinion'];
  const keys = Object.keys(prevReport).filter(k => !EXCLUDE.includes(k) && prevReport[k] !== '' && prevReport[k] !== null);
  if (keys.length === 0) { toast(`${prevYear}년 "${type}" 보고서 내용이 없어요`); return; }
  if (!confirm(`${currentPerson.name}씨의 ${prevYear}년 보고서 내용을 가져와 채웁니다.\n(평가일과 [6] 직업수준 및 목표는 가져오지 않음)\n\n지금 입력돼 있는 같은 항목은 덮어써집니다. 계속할까요?`)) return;
  keys.forEach(k => { reportData[k] = JSON.parse(JSON.stringify(prevReport[k])); });
  window.reportData = reportData;
  await renderReport();
  toast(`${prevYear}년 보고서 내용 복사됨 — 확인 후 "종합보고서 저장"을 눌러주세요`);
};

// ── 같은 연도 다른 평가지 복사 ──
// 점수·평가일·[6] 직업수준 및 목표는 평가지마다 달라야 하므로, 사람 고유 정보(배경·직업재활 방향)만 골라 가져온다.
window.copySameYearReport = async function() {
  if (!currentPerson) { toast('먼저 사람을 선택하세요'); return; }
  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;
  const INCLUDE = ['evalPurpose','evalMethod','bg_behavior','bg_disability','bg_family','bg_education','bg_learning','bg_career','bg_living','strength','limitation','summary'];
  const others = [...document.getElementById('rpt-type-sel').options].map(o => o.value).filter(v => v !== type);
  const candidates = [];
  for (const t of others) {
    let snap;
    try {
      snap = await getDoc(doc(db, 'scores', `${currentPerson.id}_${year}_${t}`));
    } catch(e) { toast('불러오기 실패: ' + e.message); return; }
    const rpt = snap.exists() ? (snap.data().report || {}) : {};
    const keys = INCLUDE.filter(k => rpt[k] !== '' && rpt[k] !== null && rpt[k] !== undefined);
    if (keys.length > 0) candidates.push({ type: t, report: rpt, keys });
  }
  if (candidates.length === 0) { toast(`${year}년에 작성된 다른 평가지 보고서가 없어요`); return; }
  let chosen;
  if (candidates.length === 1) {
    chosen = candidates[0];
    if (!confirm(`${currentPerson.name}씨의 ${year}년 "${chosen.type}" 보고서에서 배경정보·직업재활 방향 등 사람 정보를 가져와 채웁니다.\n(점수·평가일·직업수준 및 목표는 가져오지 않음)\n\n지금 입력돼 있는 같은 항목은 덮어써집니다. 계속할까요?`)) return;
  } else {
    const list = candidates.map((c, i) => `${i + 1}. ${c.type}`).join('\n');
    const ans = prompt(`가져올 평가지 번호를 입력하세요:\n${list}`);
    if (ans === null) return;
    const idx = parseInt(ans, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= candidates.length) return;
    chosen = candidates[idx];
  }
  chosen.keys.forEach(k => { reportData[k] = JSON.parse(JSON.stringify(chosen.report[k])); });
  window.reportData = reportData;
  await renderReport();
  toast(`${year}년 "${chosen.type}" 보고서 내용 복사됨 — 확인 후 "종합보고서 저장"을 눌러주세요`);
};

window.saveReport = async function() {
  if (!currentPerson) return;
  // 단기목표에 없는 항목 체크 해제
  if (reportData.lowChecks && reportData.shortGoals) {
    const registeredContents = new Set((reportData.shortGoals).map(sg => {
      const m = sg.text.match(/\] (.+?) - /);
      return m ? m[1] : '';
    }));
    Object.keys(reportData.lowChecks).forEach(no => {
      const item = (window._currentItems||[]).find(it => String(it.no) === String(no));
      if (item && !registeredContents.has(item.content)) {
        reportData.lowChecks[no].checked = false;
        reportData.lowChecks[no].target = '';
      }
    });
  }
  reportData.evalDate = document.getElementById('rpt-eval-date')?.value || '';
  reportData.evalPurpose = document.querySelector('input[placeholder="평가목적을 입력하세요"]')?.value || reportData.evalPurpose || '';
  reportData.evalMethod = document.querySelector('input[placeholder="평가방법을 입력하세요"]')?.value || reportData.evalMethod || '';
  reportData.strength = document.getElementById('rpt-strength')?.innerText || reportData.strength || '';
  reportData.limitation = document.getElementById('rpt-limitation')?.innerText || reportData.limitation || '';
  reportData.summary = document.getElementById('rpt-summary')?.innerText || reportData.summary || '';
  reportData.jobLevel = document.getElementById('rpt-joblevel')?.value || reportData.jobLevel || '';
  ['bg_behavior','bg_disability','bg_family','bg_education','bg_learning','bg_career','bg_living'].forEach(key => {
    const el = document.getElementById('rpt-' + key);
    if (el) reportData[key] = el.innerText;
  });
  // 문항별 결과
  if (!reportData.groupResults) reportData.groupResults = [];
  document.querySelectorAll('[id^="rpt-group-"]').forEach(el => {
    const gi = parseInt(el.id.replace('rpt-group-', ''));
    reportData.groupResults[gi] = el.innerText;
  });
  // 평가결과 소견
  const evalOpinionEl = document.getElementById('rpt-eval-opinion');
  if (evalOpinionEl) reportData.evalOpinion = evalOpinionEl.innerText;

  const year = document.getElementById('rpt-year-sel').value;
  const type = document.getElementById('rpt-type-sel').value;
  try {
    await setDoc(doc(db, 'scores', `${currentPerson.id}_${year}_${type}`),
      { report: reportData }, { merge: true });
    setStatusLoadedAt(0);
    toast('보고서 저장 완료');
  } catch(e) { toast('저장 실패: '+e.message); }
};

export { renderReportPersonList, selectReportPerson };
