import { doc, getDoc, collection, getDocs } from './저장소.js';
import { currentPerson, db, setCurrentPerson } from './공통.js';
import { fetchPersonsAll, loadPersons, selectPerson } from './점수입력.js';
import { renderReportPersonList, selectReportPerson } from './보고서.js';
import { renderPlanPersonList, selectPlanPerson } from './계획서.js';
import { esc } from './유틸.js';
import { renderConferencePersonList, selectConferencePerson } from './사례회의.js';


// ══════════════════════════════════════════════════
// 현재상황 탭
// ══════════════════════════════════════════════════
// 해당 연도·직무 명단(roster)에 등록된 사람 목록 (각 탭 로더와 동일한 필터)
async function rosterPersonList(year, type) {
  const rosterSnap = await getDoc(doc(db, 'roster', `${year}_${type}`));
  const personIds = rosterSnap.exists() ? (rosterSnap.data().personIds || []) : [];
  const mgrs = rosterSnap.exists() ? (rosterSnap.data().managers || {}) : {};
  const allList = await fetchPersonsAll();
  const list = [];
  allList.forEach(d => { if (personIds.includes(d.id) && !d.deleted) list.push({ ...d, manager: mgrs[d.id] !== undefined ? mgrs[d.id] : (d.manager || '') }); });
  list.sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  return list;
}

window.goToTab = async function(pane, pid, year, type) {
  const selMap = {
    'pane-person': ['eval-year-sel','eval-type-sel'],
    'pane-report': ['rpt-year-sel','rpt-type-sel'],
    'pane-conference': ['conf-year-sel','conf-type-sel'],
    'pane-plan': ['plan-year-sel','plan-type-sel']
  };
  const [ySel, tSel] = selMap[pane] || [];
  // 옵션에 있는 값만 선택 (goReport와 동일 방식)
  const setSel = (selId, val) => {
    const s = document.getElementById(selId);
    if (!s) return;
    for (const o of s.options) if (o.value === val) { s.value = val; break; }
  };
  if (ySel) setSel(ySel, year);
  if (tSel) setSel(tSel, type);
  // 공통 선택바도 같이 옮겨줘야 이후 탭 이동에서 값이 어긋나지 않는다
  setSel('g-year-sel', year);
  setSel('g-type-sel', type);
  setCurrentPerson(null);
  showPane(pane, true);

  if (pane === 'pane-person') { await loadPersons(); await selectPerson(pid); return; }

  const list = await rosterPersonList(year, type);
  if (pane === 'pane-report') { renderReportPersonList(list); await selectReportPerson(pid, list); }
  if (pane === 'pane-conference') { renderConferencePersonList(list); await selectConferencePerson(pid, list); }
  if (pane === 'pane-plan') { renderPlanPersonList(list); await selectPlanPerson(pid, list); }
  if (!currentPerson) toast('해당 연도·직무 명단에서 사람을 찾지 못했어요');
};


let statusGroups = [];   // 현재상황 표에 쓸 데이터 (다시 그릴 때 재조회 안 하려고 보관)
let statusLoadedAt = 0;          // 마지막 조회 시각 (0 = 아직 안 받음 / 캐시 버림)
const STATUS_TTL = 5 * 60 * 1000; // 5분

window.loadStatusBoard = async function() {
  const board = document.getElementById('status-board');
  if (!board) return;
  board.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);">데이터 불러오는 중...</div>';

  try {
    // 설정/persons/roster/templates/scores 한 번에 동시 조회 (사람 수만큼 순차 조회하던 것 통합)
    const [selSnap, personsSnap, rosterSnap, tmplsSnap, scoresSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'selectors')),
      getDocs(collection(db, 'persons')),
      getDocs(collection(db, 'roster')),
      getDocs(collection(db, 'templates')),
      getDocs(collection(db, 'scores')),
    ]);
    const years = selSnap.exists() ? (selSnap.data().years || [String(new Date().getFullYear())]) : [String(new Date().getFullYear())];
    const types = selSnap.exists() ? (selSnap.data().types || ['기본']) : ['기본'];

    // 모든 persons 가져오기
    const personsMap = {};
    personsSnap.forEach(d => { personsMap[d.id] = d.data(); });

    const rosterMap = {};
    rosterSnap.forEach(d => { rosterMap[d.id] = d.data(); });
    const tmplMap = {};
    tmplsSnap.forEach(d => { tmplMap[d.id] = d.data(); });
    const scoresMap = {};
    scoresSnap.forEach(d => { scoresMap[d.id] = d.data(); });

    statusGroups = [];

    // 연도 내림차순 정렬
    const sortedYears = [...years].sort((a,b) => Number(b) - Number(a));

    for (const year of sortedYears) {
      for (const type of types) {
        // roster 가져오기
        const rosterData = rosterMap[`${year}_${type}`];
        const personIds = rosterData ? (rosterData.personIds || []) : [];
        const mgrs = rosterData ? (rosterData.managers || {}) : {};
        if (personIds.length === 0) continue;

        // template 존재 여부
        const tmplData = tmplMap[`${year}_${type}`];
        const tmplExists = !!(tmplData && (tmplData.items || []).length > 0);

        // 각 사람의 scores 확인
        const rows = [];
        for (const pid of personIds) {
          const base = personsMap[pid];
          if (!base || base.deleted) continue;
          const p = { ...base, manager: mgrs[pid] !== undefined ? mgrs[pid] : (base.manager || '') };
          const data = scoresMap[`${pid}_${year}_${type}`] || {};
          const scoreKeys = data.scores ? Object.keys(data.scores).length : 0;
          const tmplCount = tmplData ? (tmplData.items||[]).length : 41;
          const scorePct = tmplCount > 0 ? Math.round(scoreKeys/tmplCount*100) : 0;
          const hasScores = scoreKeys > 0;

          const rptChecks = [data.report?.strength, data.report?.limitation, data.report?.summary, data.report?.longGoals?.length>0, data.report?.shortGoals?.length>0];
          const rptPct = Math.round(rptChecks.filter(Boolean).length / rptChecks.length * 100);
          const hasReport = rptPct > 0;

          const confChecks = [data.conference?.strength||data.report?.strength, data.conference?.limitation||data.report?.limitation, data.conference?.summary||data.report?.summary, data.conference?.guardianNeeds, data.conference?.dialogueText, data.report?.longGoals?.length>0, data.report?.shortGoals?.length>0];
          const confPct = Math.round(confChecks.filter(Boolean).length / confChecks.length * 100);
          const hasConf = data.conference && Object.keys(data.conference).length > 0;

          const pl = data.plan || {};
          // 접수번호(receiptNo)·보호자(guardian)는 실무상 안 쓰는 칸이라 완료 조건에서 제외
          const planChecks = [pl.planDate, pl.user, pl.signRows?.length>0, pl.methods && Object.keys(pl.methods).length>0, pl.opinion];
          const planPct = Math.round(planChecks.filter(Boolean).length / planChecks.length * 100);
          const hasPlan = data.plan && Object.keys(data.plan).length > 0;

          rows.push({ name: p.name, manager: p.manager, hasScores, hasReport, hasConf, hasPlan, scorePct, rptPct, confPct, planPct, pid });
        }
        statusGroups.push({ year, type, tmplExists, rows });
      }
    }

    renderStatusBoard();
    statusLoadedAt = Date.now();

  } catch(e) {
    board.innerHTML = `<div style="color:#F44336;padding:20px;">오류: ${e.message}</div>`;
  }
};

// 탭 재진입용 — 5분 안이면 다시 조회하지 않고 그리기만 한다
window.showStatusBoard = async function() {
  if (statusLoadedAt && Date.now() - statusLoadedAt < STATUS_TTL) { renderStatusBoard(); return; }
  return loadStatusBoard();
};

// 현재상황 표 그리기 — 정렬만 바꿀 땐 다시 조회하지 않고 이 함수만 다시 부른다
function statusGroupHtml(g) {
  const { year, type, tmplExists } = g;
  const rows = g.rows;

  const icon = (ok) => ok
    ? '<span class="st-badge st-done">있음</span>'
    : '<span class="st-badge st-none">없음</span>';

  // 완료 = 초록 / 진행중 = 노랑(진행률) / 미작성 = 회색
  const mark = (has, pct) => !has
    ? '<span class="st-badge st-none">미작성</span>'
    : (pct >= 100 ? '<span class="st-badge st-done">완료</span>'
                  : `<span class="st-badge st-part">${pct}%</span>`);

  return `
        <div class="st-group">
          <div class="st-group-head">
            <span class="st-group-title">${year}년 ${type}</span>
            <span class="st-cnt" style="font-size:14px;">${rows.length}명</span>
          </div>
          <table>
            ${(()=>{
              // 제목줄 — 담당자가 바뀔 때마다 그 아래에 다시 넣는다
              const headRow = `<tr>
                <th style="width:66px;"></th>
                <th style="width:86px;">이름</th>
                <th>현장평가지</th>
                <th>종합보고서</th>
                <th>사례회의</th>
                <th>직업재활계획서</th>
                <th class="st-div" style="width:66px;"></th>
                <th style="width:86px;">이름</th>
                <th>현장평가지</th>
                <th>종합보고서</th>
                <th>사례회의</th>
                <th>직업재활계획서</th>
              </tr>`;
              // 담당자별로 묶어서 보여준다 (담당자 가나다순, 미지정은 맨 뒤)
              const byMgr = {};
              for (const r of rows) { const m = r.manager || '담당 미지정'; (byMgr[m] = byMgr[m] || []).push(r); }
              const mgrNames = Object.keys(byMgr).sort((a,b) => {
                if (a === '담당 미지정') return 1;
                if (b === '담당 미지정') return -1;
                return a.localeCompare(b, 'ko');
              });
              let trs='';
              for (const m of mgrNames) {
              const list = byMgr[m].sort((a,b) => a.name.localeCompare(b.name, 'ko'));
              trs+=`<tr class="st-mgr-row"><td colspan="12">${esc(m)} <span class="st-cnt">· ${list.length}명</span></td></tr>` + headRow;
              for(let j=0;j<list.length;j+=2){
                const r=list[j];
                const r2=list[j+1];
                trs+=`<tr>
                  <td class="st-mgr"></td>
                  <td class="st-name">${esc(r.name)}</td>
                  <td class="st-cell" onclick="goToTab('pane-person','${r.pid}','${year}','${type}')">${mark(r.hasScores,r.scorePct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-report','${r.pid}','${year}','${type}')">${mark(r.hasReport,r.rptPct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-conference','${r.pid}','${year}','${type}')">${mark(r.hasConf,r.confPct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-plan','${r.pid}','${year}','${type}')">${mark(r.hasPlan,r.planPct)}</td>
                  ${r2?`
                  <td class="st-mgr st-div"></td>
                  <td class="st-name">${esc(r2.name)}</td>
                  <td class="st-cell" onclick="goToTab('pane-person','${r2.pid}','${year}','${type}')">${mark(r2.hasScores,r2.scorePct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-report','${r2.pid}','${year}','${type}')">${mark(r2.hasReport,r2.rptPct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-conference','${r2.pid}','${year}','${type}')">${mark(r2.hasConf,r2.confPct)}</td>
                  <td class="st-cell" onclick="goToTab('pane-plan','${r2.pid}','${year}','${type}')">${mark(r2.hasPlan,r2.planPct)}</td>
                  `:`<td colspan="6" class="st-div"></td>`}
                </tr>`;
              }
              }
              return trs;
            })()}
          </table>
        </div>`;
}

function renderStatusBoard() {
  const board = document.getElementById('status-board');
  if (!board) return;
  let html = '';
  for (const g of statusGroups) html += statusGroupHtml(g);
  if (!html) html = '<div style="text-align:center;padding:40px;color:var(--text2);">등록된 데이터가 없습니다.</div>';
  board.innerHTML = html;
}

// ※ 데이터 로드는 공통.js 의 "처음 자료 로드"에서 호출함.

// ══════════════════════════════════════════════════

function setStatusLoadedAt(v) { statusLoadedAt = v; }

export { setStatusLoadedAt, statusLoadedAt };
