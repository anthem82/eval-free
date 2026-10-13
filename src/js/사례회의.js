import { doc, getDoc, setDoc } from './저장소.js';
import { currentPerson, currentScores, db, planData, prevItems, prevScores, prevShortGoals, reportData, setCurrentPerson, setCurrentScores, setPlanData, setPrevItems, setPrevScores, setPrevShortGoals, setReportData } from './공통.js';
import { DEFAULT_ITEMS, getTmplData } from './평가지관리.js';
import { calcSum, fetchPersonsAll, groupItems } from './점수입력.js';
import { copyPrompt, STYLE_RULES } from './AI.js';
import { esc, getGrade, gradeLabel } from './유틸.js';
import { setStatusLoadedAt, statusLoadedAt } from './현재상황.js';

// 사례회의 탭
// ══════════════════════════════════════════════════
let conferenceData = {};
window.conferenceData = conferenceData;

window.loadConferencePersons = async function() {
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  const rosterSnap = await getDoc(doc(db, 'roster', `${year}_${type}`));
  const personIds = rosterSnap.exists() ? (rosterSnap.data().personIds || []) : [];
  const mgrs = rosterSnap.exists() ? (rosterSnap.data().managers || {}) : {};
  const allList = await fetchPersonsAll();
  const list = [];
  allList.forEach(d => { if (personIds.includes(d.id) && !d.deleted) list.push({ ...d, manager: mgrs[d.id] !== undefined ? mgrs[d.id] : (d.manager || '') }); });
  list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  renderConferencePersonList(list);
  if (currentPerson && list.find(p => p.id === currentPerson.id)) {
    await selectConferencePerson(currentPerson.id, list);
  }
};

function renderConferencePersonList(list) {
  const el = document.getElementById('conf-person-list');
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
    div.onclick = () => selectConferencePerson(p.id, list);
    el.appendChild(div);
  });
}

window.filterConferencePersons = function(q) {
  const els = document.querySelectorAll('#conf-person-list .person-card');
  els.forEach(el => { el.style.display = el.textContent.includes(q) ? '' : 'none'; });
};

async function selectConferencePerson(id, list) {
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  setCurrentPerson(list.find(p => p.id === id));
  if (!currentPerson) return;
  renderConferencePersonList(list);

  // 현재 연도 데이터
  const scoreSnap = await getDoc(doc(db, 'scores', `${id}_${year}_${type}`));
  setCurrentScores(scoreSnap.exists() ? (scoreSnap.data().scores || {}) : {});
  setReportData(scoreSnap.exists() ? (scoreSnap.data().report || {}) : {});
  window.reportData = reportData;
  setPlanData(scoreSnap.exists() ? (scoreSnap.data().plan || {}) : {});
  conferenceData = scoreSnap.exists() ? (scoreSnap.data().conference || {}) : {};
  window.conferenceData = conferenceData;
  window.planData = planData;

  // 전년도 데이터
  const prevYear = String(parseInt(year) - 1);
  const prevSnap = await getDoc(doc(db, 'scores', `${id}_${prevYear}_${type}`));
  setPrevScores(prevSnap.exists() ? (prevSnap.data().scores || {}) : {});
  setPrevShortGoals(prevSnap.exists() ? (prevSnap.data().report?.shortGoals || []) : []);
  const prevPlanData = prevSnap.exists() ? (prevSnap.data().plan || {}) : {};

  // 평가지 항목
  const tmplData = await getTmplData(year, type);
  window._currentItems = tmplData ? tmplData.items : DEFAULT_ITEMS;
  const prevTmplData = await getTmplData(prevYear, type);
  setPrevItems(prevTmplData ? (prevTmplData.items || []) : []);

  renderConference(year, type, prevYear, prevPlanData);
}

function renderConference(year, type, prevYear, prevPlanData) {
  const p = currentPerson;
  const rd = reportData;
  const cd = conferenceData;

  // 영역별 통계 계산
  const items = window._currentItems || [];
  const groups = groupItems(items);
  const groupStats = groups.map(g => {
    const keys = g.items.map(it => String(it.no));
    const sum = calcSum(keys, currentScores);
    const max = g.items.length * 10;
    const pct = max > 0 ? (sum/max*100) : 0;
    const prevGroups = prevItems.length > 0 ? groupItems(prevItems) : groups;
    const pg = prevGroups.find(pg => pg.cat === g.cat);
    let psum = 0, pmax = 0;
    if (pg && prevItems.length > 0) {
      pg.items.forEach(pit => {
        const pkey = String(pit.no);
        const sc = prevScores[pkey] !== undefined ? prevScores[pkey] : null;
        if (sc !== null) psum += sc;
      });
      pmax = pg.items.length * 10;
    }
    const ppct = pmax > 0 ? (psum/pmax*100) : 0;
    return { cat: g.cat, sum, max, pct, psum, pmax, ppct };
  });

  const totalSum = groupStats.reduce((s,g)=>s+g.sum, 0);
  const totalMax = groupStats.reduce((s,g)=>s+g.max, 0);
  const totalPct = totalMax > 0 ? (totalSum/totalMax*100) : 0;
  const grade = getGrade(totalPct);

  // 전년도 목표 진전도 결과 초기화
  if (!conferenceData.prevResults) conferenceData.prevResults = [];
  prevShortGoals.forEach((sg, i) => { if (!conferenceData.prevResults[i]) conferenceData.prevResults[i] = { goal: sg.text, result: '', achieved: false }; });
  const prevResults = conferenceData.prevResults;

  // 사례회의 대화 초기화
  const dialogues = cd.dialogues || [];

  document.getElementById('conf-body').innerHTML = `
  <div style="max-width:900px;padding:4px 0;">
    <h2 style="font-size:18px;font-weight:900;letter-spacing:2px;text-align:center;padding:10px 0 14px;color:var(--primary);">사례회의록</h2>

    <!-- [1] 기본사항 -->
    <div class="report-section" style="padding:10px 14px;">
      <h3>[1] 기본사항</h3>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <tr style="border-bottom:1px solid var(--border);">
          <td rowspan="2" style="font-size:17px;font-weight:900;color:var(--primary);padding:4px 20px 4px 0;border-right:2px solid var(--border);width:90px;vertical-align:middle;text-align:center;">${esc(p.name)}</td>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">생년월일 : <b>${p.birth||'-'}</b></td>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">장애명 : <b>${esc(p.disability||'-')}</b></td>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">평가파트 : <b>${type}</b></td>
        </tr>
        <tr>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">회의일자 : <input class="form-inp" type="date" value="${esc(cd.meetingDate||'')}" style="width:140px;padding:3px 6px;flex:none;" oninput="conferenceData.meetingDate=this.value"></td>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">작성자 : <b>${esc(p.manager||'-')}</b></td>
          <td style="padding:4px 16px;font-size:12px;color:var(--text2);">직업목표 : <b>${esc(rd.jobLevel||'보호고용')}</b></td>
        </tr>
      </table>
    </div>

    <!-- [2] 평가결과 요약 -->
    <div class="report-section">
      <h3>[2] ${year}년도 상황 및 현장 평가 결과 요약</h3>
      <table class="result-table" style="margin-bottom:10px;">
        <tr><th>영역</th><th>${year}년 수행률</th><th>${prevYear}년 수행률</th><th>등락</th></tr>
        ${groupStats.map(g=>`
          <tr>
            <td>${esc(g.cat)}</td>
            <td><b>${g.pct.toFixed(1)}%</b> (${g.sum}/${g.max}점)</td>
            <td style="color:#888;">${g.ppct.toFixed(1)}% (${g.psum}/${g.pmax}점)</td>
            <td class="${g.pct>=g.ppct?'up':'dn'}">${g.pct>=g.ppct?'▲':'▼'}${Math.abs(g.pct-g.ppct).toFixed(1)}%p</td>
          </tr>`).join('')}
        <tr style="background:#EDE7F6;">
          <td><b>합계</b></td>
          <td><b>${totalPct.toFixed(1)}% (${totalSum}/${totalMax}점)</b></td>
          <td style="color:#888;">-</td>
          <td><span class="grade-badge g${grade}" style="width:28px;height:28px;line-height:28px;font-size:15px;">${grade}</span> ${gradeLabel(grade)}</td>
        </tr>
      </table>
      <div class="auto-block">
        ${groupStats.map(g=>`<div class="auto-line">${g.cat} : ${g.sum}점/${g.max}점 (수행률 ${g.pct.toFixed(1)}%, 전년도 ${g.ppct.toFixed(1)}%)</div>`).join('')}
      </div>
    </div>

    <!-- [3] ${year}년도 상황 및 현장 평가 종합소견 요약 -->
    <div class="report-section">
      <h3>[3] ${year}년도 상황 및 현장 평가 종합소견 요약</h3>
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">직업적 강점</div>
        <div class="editable-block" contenteditable="true" style="min-height:60px;"
          oninput="conferenceData.strength=this.innerText">${esc(cd.strength||rd.strength||'')}</div>
      </div>
      <div style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">직업적 제한점</div>
        <div class="editable-block" contenteditable="true" style="min-height:60px;"
          oninput="conferenceData.limitation=this.innerText">${esc(cd.limitation||rd.limitation||'')}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">직업적 소견</div>
        <div class="editable-block" contenteditable="true" style="min-height:80px;"
          oninput="conferenceData.summary=this.innerText">${esc(cd.summary||rd.summary||'')}</div>
      </div>
      <div style="margin-top:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">평가결과 소견</div>
        <div class="editable-block" contenteditable="true" style="min-height:80px;"
          oninput="conferenceData.evalOpinion=this.innerText">${esc(cd.evalOpinion||rd.evalOpinion||'')}</div>
      </div>
    </div>

<!-- [4] 전년도 목표 달성 여부 -->
    <div class="report-section">
      <h3>[4] 전년도 목표 달성 여부 </h3>
      ${prevShortGoals.length === 0
        ? `<div style="color:var(--text2);font-size:12px;padding:8px 0;">전년도(${prevYear}년) 단기목표 데이터가 없습니다.</div>`
        : `<table class="result-table">
            <tr><th style="text-align:left;">전년도 단기목표</th><th style="width:120px;">달성여부</th></tr>
            ${prevShortGoals.map((sg,i)=>`
              <tr>
                <td style="text-align:left;font-size:11px;">${esc(sg.text)}</td>
                <td style="text-align:center;">
                  <select class="form-inp" style="width:100%;padding:3px 4px;font-size:11px;"
                    onchange="if(!conferenceData.prevResults)conferenceData.prevResults=[];if(!conferenceData.prevResults[${i}])conferenceData.prevResults[${i}]={goal:'',result:'',achieved:false};conferenceData.prevResults[${i}].achieved=this.value==='true'">
                    <option value="false" ${!(cd.prevResults?.[i]?.achieved)?'selected':''}>미달성</option>
                    <option value="true" ${cd.prevResults?.[i]?.achieved?'selected':''}>달성</option>
                  </select>
                </td>
              </tr>`).join('')}
          </table>`}
    </div>

    <!-- [5] 장애인 및 보호자 의견 -->
    <div class="report-section">
      <h3>[5] 장애인 및 보호자 의견</h3>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">보호자 의견</div>
          <div class="editable-block" contenteditable="true" style="min-height:40px;"
            oninput="conferenceData.guardianNeeds=this.innerText">${esc(cd.guardianNeeds||'')}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">이용인 의견</div>
          <div class="editable-block" contenteditable="true" style="min-height:40px;"
            oninput="conferenceData.userNeeds=this.innerText">${esc(cd.userNeeds||'없음')}</div>
        </div>        
      </div>
    </div>

    <!-- [6] 사례회의 내용 요약 -->
    <div class="report-section">
      <h3>[6] 사례회의 내용 요약
        <button onclick="generateConferenceSummary()" id="btn-conf-summary" class="btn btn-primary btn-sm no-print" style="margin-left:10px;">프롬프트 복사</button>
      </h3>
      
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:4px;">요약 내용</div>
      <div class="editable-block" contenteditable="true" id="conf-summary-block" style="min-height:200px;white-space:pre-wrap;"
        oninput="conferenceData.dialogueText=this.innerText">${esc(cd.dialogueText||'')}</div>
    </div>

    <!-- [7] 결정 목표 -->
    <div class="report-section">
      <h3>[7] ${parseInt(year)+1}년도 결정 장기목표</h3>
      ${(rd.longGoals||[]).length === 0
        ? `<div style="color:var(--text2);font-size:12px;">보고서 탭에서 장기목표를 입력하세요</div>`
        : (rd.longGoals||[]).map((g,i)=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <div class="editable-block" contenteditable="true" style="flex:1;min-height:30px;padding:4px 8px;font-size:12px;"
                oninput="if(!conferenceData.finalLongGoals)conferenceData.finalLongGoals=[];conferenceData.finalLongGoals[${i}]=this.innerText"
                >${esc(conferenceData.finalLongGoals?.[i]||g)}</div>
            </div>`).join('')}
    </div>

    <div class="report-section">
      <h3>[8] ${parseInt(year)+1}년도 결정 단기목표</h3>
      ${(rd.shortGoals||[]).length === 0
        ? `<div style="color:var(--text2);font-size:12px;">보고서 탭에서 단기목표를 입력하세요</div>`
        : (rd.shortGoals||[]).map((sg,i)=>`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <div class="editable-block" contenteditable="true" style="flex:1;min-height:30px;padding:4px 8px;font-size:12px;"
                oninput="if(!conferenceData.finalShortGoals)conferenceData.finalShortGoals=[];conferenceData.finalShortGoals[${i}]=this.innerText"
                >${esc(conferenceData.finalShortGoals?.[i]||sg.text)}</div>
            </div>`).join('')}
    </div>

  <!-- [9] 서명 -->
    <div class="report-section">
      <h3>[9] 서명</h3>
      <div style="font-size:12px;margin-bottom:10px;">위의 사례회의 결과를 기록하며 승인합니다.</div>
      <div style="display:flex;flex-direction:column;gap:14px;font-size:12px;max-width:500px;">
        
        
        ${(()=>{ if(!conferenceData.signRows) conferenceData.signRows=[{label:'담 당',name:''},{label:'팀 장',name:''},{label:'원 장',name:''}]; return ''; })()}
        <div id="conf-sign-rows">
          ${conferenceData.signRows.map((row,i)=>`
            <div class="form-row" style="margin-bottom:14px;">
              <span contenteditable="true" style="min-width:70px;display:inline-block;cursor:text;border-bottom:1px dashed transparent;outline:none;"
                onmouseover="this.style.borderBottomColor='#90CAF9'"
                onmouseout="this.style.borderBottomColor='transparent'"
                onfocus="this.style.borderBottomColor='var(--primary)'"
                onblur="conferenceData.signRows[${i}].label=this.innerText;this.style.borderBottomColor='transparent'"
                title="클릭하여 직책 수정">${esc(row.label||'직책')} :</span>
              <input class="form-inp" value="${esc(row.name||'')}" placeholder="이름" style="width:100px;flex:none;" oninput="conferenceData.signRows[${i}].name=this.value">
              &nbsp;(인/서명)
              <button onclick="removeConfSignRow(${i})" class="no-print" style="background:none;border:none;color:#BDBDBD;cursor:pointer;font-size:15px;padding:0 4px;line-height:1;" title="삭제">✕</button>
            </div>`).join('')}
        </div>
        <div class="form-row no-print" style="margin-top:2px;">
          <button onclick="addConfSignRow()" style="background:none;border:1px dashed #90CAF9;color:#1565C0;border-radius:4px;padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit;">+ 결재라인 추가</button>
        </div>
      </div>
    </div>

  </div>`;
}

window.addDialogue = function() {
  if (!conferenceData.dialogues) conferenceData.dialogues = [];
  conferenceData.dialogues.push({ speaker: '', content: '' });
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  // re-render dialogue list only
  const list = document.getElementById('conf-dialogue-list');
  if (!list) return;
  const i = conferenceData.dialogues.length - 1;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;';
  div.innerHTML = `
    <input class="form-inp" value="" placeholder="발언자"
      style="width:80px;flex:none;font-weight:700;"
      oninput="conferenceData.dialogues[${i}].speaker=this.value">
    <span style="padding-top:6px;color:var(--text2);">:</span>
    <div class="editable-block" contenteditable="true" style="flex:1;min-height:36px;padding:5px 8px;"
      oninput="conferenceData.dialogues[${i}].content=this.innerText"></div>
    <button onclick="removeDialogue(${i})" class="no-print"
      style="background:none;border:none;color:#BDBDBD;cursor:pointer;font-size:16px;padding:4px;flex:none;">✕</button>`;
  list.appendChild(div);
  div.querySelector('input')?.focus();
};

window.removeDialogue = function(i) {
  if (!conferenceData.dialogues) return;
  conferenceData.dialogues.splice(i, 1);
  // re-render
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  const prevYear = String(parseInt(year) - 1);
  renderConference(year, type, prevYear, {});
};

window.generateConferenceSummary = async function() {
  const name = currentPerson?.name || '대상자';
  const year = document.getElementById('conf-year-sel').value;
  const rd = reportData;
  const cd = conferenceData;

  // 페이지 내용 수집
  const items = window._currentItems || [];
  const groups = groupItems(items);
  const groupLines = groups.map(g => {
    const keys = g.items.map(it => String(it.no));
    const sum = calcSum(keys, currentScores);
    const max = g.items.length * 10;
    const pct = max > 0 ? (sum/max*100).toFixed(1) : '0.0';
    return `- ${g.cat}: ${sum}점/${max}점 (${pct}%)`;
  }).join('\n');

  const totalSum = groups.reduce((s,g) => s + calcSum(g.items.map(it=>String(it.no)), currentScores), 0);
  const totalMax = groups.reduce((s,g) => s + g.items.length * 10, 0);
  const totalPct = totalMax > 0 ? (totalSum/totalMax*100).toFixed(1) : '0.0';

  const prevResults = cd.prevResults || [];
  const prevResultLines = prevShortGoals.map((sg,i) => {
    const achieved = prevResults[i]?.achieved ? '달성' : '미달성';
    return `- ${sg.text} → ${achieved}`;
  }).join('\n');

  const longGoals = (rd.longGoals||[]).join('\n');
  const shortGoals = (rd.shortGoals||[]).map(sg=>sg.text).join('\n');

  const prompt = `당신은 발달장애인 직업재활 전문가입니다. 아래 데이터를 바탕으로 ${name}씨의 ${year}년도 직업재활 사례회의록 요약문을 작성해주세요.

작성 지침:
- 마크다운 기호(**, ##, * 등) 절대 사용 금지. 일반 텍스트만 사용.
- 제3자 서술 형식 (대화체 금지). 
- 간결체(개조식) 문체 사용: 문장 어미를 "~함.", "~임.", "~됨.", "~없음.", "~요함." 으로 통일
- "${name}씨의 ${year}년도 사례회의에서는..." 으로 시작
- 평가결과 → 전년도 목표 진전도 → 보호자 욕구 → 결정 목표 순서로 서술
- 3~5문단, 수치를 명확히 포함
- 전년도 목표 달성여부와 비교하여 미달성일 경우 현 계획을 유지한다는 표현으로 서술
- 결정 장기목표와 결정 단기목표를 확인하여 늘어난 항목은 추가한다는 표현으로, 줄어든 항목에 대해서는 삭제한다는 표현으로 서술
- 대상자를 지칭할 때는 항상 "${name}씨" 또는 "${name}님"으로 쓰고 이름만 단독으로 쓰지 말 것
${STYLE_RULES}

[평가결과]
전체 수행률: ${totalPct}% (${totalSum}/${totalMax}점)
${groupLines}

[전년도 목표 진전도]
${prevResultLines || '전년도 데이터 없음'}

[종합소견]
강점: ${cd.strength || rd.strength || ''}
제한점: ${cd.limitation || rd.limitation || ''}
소견: ${cd.summary || rd.summary || ''}

[보호자 욕구]
${cd.guardianNeeds || ''}

[근로인 욕구]
${cd.userNeeds || ''}

[결정 장기목표]
${longGoals}

[결정 단기목표]
${shortGoals}`;

  try {
    await copyPrompt(prompt, currentPerson?.name);
  } catch(e) { toast('복사 실패: ' + e.message); }
};

window.saveConference = async function() {
  if (!currentPerson) return;
  const year = document.getElementById('conf-year-sel').value;
  const type = document.getElementById('conf-type-sel').value;
  try {
    await setDoc(doc(db, 'scores', `${currentPerson.id}_${year}_${type}`),
      { conference: conferenceData }, { merge: true });
    setStatusLoadedAt(0);
    toast('사례회의록 저장 완료');
  } catch(e) { toast('저장 실패: ' + e.message); }
};

function setConferenceData(v) { conferenceData = v; }

export { conferenceData, renderConference, renderConferencePersonList, selectConferencePerson, setConferenceData };
