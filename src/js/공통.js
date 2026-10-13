import { db } from './저장소.js';
import { checkTmplLock, loadMethodItems, loadSelectors, renderTmplExplorer } from './평가지관리.js';
import { loadPersons, selectPerson } from './점수입력.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 화면 배율 — 모니터에서만 확대, 인쇄는 @media print에서 1로 되돌린다
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function applyZoom(z) {
  document.documentElement.style.setProperty('--ui-zoom', z);
  const a = document.getElementById('zoom-100'), b = document.getElementById('zoom-125');
  if (a) a.classList.toggle('on', z < 1.25);
  if (b) b.classList.toggle('on', z >= 1.25);
}
window.setZoom = function(z) {
  localStorage.setItem('eval_zoom', String(z));
  applyZoom(z);
};
applyZoom(parseFloat(localStorage.getItem('eval_zoom') || '1'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 처음 자료 로드 — 로그인이 없으므로 페이지가 열리면 바로 시작한다
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 연도·평가지 목록이 채워진 뒤에 평가지·대상자를 읽는다 (목록이 비어 있으면 빈 이름으로 읽게 되므로)
// 다른 파일이 window 에 함수를 다 붙인 뒤(모듈 전체 실행 후)에 돌도록 한 박자 미룬다
setTimeout(async () => {
  await loadSelectors();
  loadTemplate();
  loadPersons();
  loadMethodItems();
}, 0);

// ── 상태 ──────────────────────────────────────────
let tmplItems = [];       // 현재 평가지 항목
window.tmplItems = tmplItems; // 평가지 관리 항목 칸의 인라인 oninput 핸들러(전역 스코프)에서 접근용
let persons = [];         // 사람 목록
let currentPerson = null; // 선택된 사람
let currentScores = {};   // 현재 입력 점수 {itemId: score}
let prevScores = {};      // 전년도 점수
let prevItems = [];       // 전년도 평가지 항목 (텍스트 매칭용)
let prevShortGoals = [];  // 전년도 단기목표
let currentGroupStats = []; // 현재 보고서 groupStats (AI 소견용)
let editingPersonId = null;
let reportData = {};      // 보고서 편집 데이터
window.reportData = reportData; // 인라인 oninput 핸들러(전역 스코프)에서 접근용
window.planData = {};     // 계획서 데이터
let planData = window.planData;

// ── 탭 전환 ──────────────────────────────────────
// ── 공통 선택바 ───────────────────────────────────
// 연도·평가지는 상단 바에서 한 번만 고른다. 각 탭의 (감춰둔) 선택기에 값을 밀어넣어
// 기존 함수들이 그대로 그 값을 읽게 하는 방식 — 탭별 로직은 건드리지 않는다.
const PANE_SELS = {
  'pane-person':     ['eval-year-sel','eval-type-sel'],
  'pane-report':     ['rpt-year-sel','rpt-type-sel'],
  'pane-conference': ['conf-year-sel','conf-type-sel'],
  'pane-plan':       ['plan-year-sel','plan-type-sel'],
};

function applyGlobalSel() {
  const y = document.getElementById('g-year-sel')?.value;
  const t = document.getElementById('g-type-sel')?.value;
  if (!y || !t) return;
  Object.values(PANE_SELS).forEach(([yId, tId]) => {
    const ys = document.getElementById(yId), ts = document.getElementById(tId);
    if (ys && Array.from(ys.options).some(o => o.value === y)) ys.value = y;
    if (ts && Array.from(ts.options).some(o => o.value === t)) ts.value = t;
  });
}

window.onGlobalSelChange = function() {
  applyGlobalSel();
  const active = document.querySelector('.pane.active');
  if (!active) return;
  // 평가지 탭은 점수 화면까지 초기화해야 해서 기존 핸들러를 그대로 쓴다
  if (active.id === 'pane-person') return onEvalSelChange();
  reloadPane(active.id);
};

async function reloadPane(id) {
  if (id === 'pane-person') {
    await loadPersons();
    if (currentPerson && persons.find(p => p.id === currentPerson.id)) await selectPerson(currentPerson.id);
    return;
  }
  if (id === 'pane-report') return loadReportPersons();
  if (id === 'pane-conference') return loadConferencePersons();
  if (id === 'pane-plan') return loadPlanPersons();
  if (id === 'pane-status') return showStatusBoard();
  if (id === 'pane-template') { checkTmplLock(); return renderTmplExplorer(); }
}

window.showPane = function(id, skipReload) {
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const btn = document.querySelector(`.tab-btn[data-pane="${id}"]`);
  if (btn) btn.classList.add('active');
  if (skipReload) return;            // goToTab이 직접 목록을 그릴 땐 중복 로드 방지
  applyGlobalSel();
  reloadPane(id);
};

// ── 토스트 ────────────────────────────────────────
window.toast = function(msg, dur=2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
};

// ── 모달 ──────────────────────────────────────────
window.openModal = id => document.getElementById(id).classList.add('show');
window.closeModal = id => document.getElementById(id).classList.remove('show');


function setCurrentGroupStats(v) { currentGroupStats = v; }
function setCurrentPerson(v) { currentPerson = v; }
function setCurrentScores(v) { currentScores = v; }
function setEditingPersonId(v) { editingPersonId = v; }
function setPersons(v) { persons = v; }
function setPlanData(v) { planData = v; }
function setPrevItems(v) { prevItems = v; }
function setPrevScores(v) { prevScores = v; }
function setPrevShortGoals(v) { prevShortGoals = v; }
function setReportData(v) { reportData = v; }
function setTmplItems(v) { tmplItems = v; window.tmplItems = v; }

export { currentGroupStats, currentPerson, currentScores, db, editingPersonId, persons, planData, prevItems, prevScores, prevShortGoals, reportData, setCurrentGroupStats, setCurrentPerson, setCurrentScores, setEditingPersonId, setPersons, setPlanData, setPrevItems, setPrevScores, setPrevShortGoals, setReportData, setTmplItems, tmplItems };
