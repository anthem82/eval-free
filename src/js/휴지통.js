import { doc, setDoc, collection, getDocs, updateDoc, deleteDoc, deleteField } from './저장소.js';
import { db } from './공통.js';
import { fetchPersonsAll, loadPersons, personsCacheAll, setPersonsCacheAll } from './점수입력.js';
import { esc } from './유틸.js';

window.openTrash = async function() {
  document.getElementById('modal-trash').style.display = 'flex';
  const el = document.getElementById('trash-list');
  el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px;">불러오는 중...</div>';
  const allList = await fetchPersonsAll();
  const deleted = [];
  allList.forEach(d => { if (d.deleted) deleted.push({ ...d }); });
  if (deleted.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px;">휴지통이 비어있습니다</div>';
    return;
  }
  el.innerHTML = deleted.map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;">
      <div style="flex:1;">
        <div style="font-weight:700;">${esc(p.name)}</div>
        <div style="font-size:11px;color:var(--text2);">${esc(p.disability||'')} ${p.birth||''}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="restorePerson('${p.id}','${esc(p.name)}')">복원</button>
      <button class="btn btn-sm" style="background:#F44336;color:#fff;" onclick="permanentDelete('${p.id}','${esc(p.name)}')">완전삭제</button>
    </div>`).join('');
};

window.restorePerson = async function(id, name) {
  try {
    await setDoc(doc(db, 'persons', id), { deleted: false }, { merge: true });
    setPersonsCacheAll(null);
    toast(`"${name}" 복원 완료`);
    openTrash();
    loadPersons();
    loadReportPersons();
    loadPlanPersons();
    loadConferencePersons();
  } catch(e) { toast('복원 실패: ' + e.message); }
};

window.permanentDelete = async function(id, name) {
  if (!confirm(`"${name}"의 모든 데이터를 완전히 삭제합니다.\n\n• 인적사항\n• 모든 연도·직무의 점수/보고서/회의록/계획서\n\n이 작업은 되돌릴 수 없습니다!`)) return;
  try {
    const rosterSnap = await getDocs(collection(db, 'roster'));
    for (const rDoc of rosterSnap.docs) {
      const ids = (rDoc.data().personIds || []).filter(pid => pid !== id);
      await setDoc(doc(db, 'roster', rDoc.id), { personIds: ids }, { merge: true });
      const mgrs = rDoc.data().managers || {};
      if (Object.prototype.hasOwnProperty.call(mgrs, id)) {
        await updateDoc(doc(db, 'roster', rDoc.id), { [`managers.${id}`]: deleteField() });
      }
    }
    const scoresSnap = await getDocs(collection(db, 'scores'));
    for (const sDoc of scoresSnap.docs) {
      if (sDoc.id.startsWith(id + '_')) await deleteDoc(sDoc.ref);
    }
    await deleteDoc(doc(db, 'persons', id));
    setPersonsCacheAll(null);
    toast(`"${name}" 완전 삭제 완료`);
    openTrash();
    loadPersons();
  } catch(e) { toast('삭제 실패: ' + e.message); }
};
