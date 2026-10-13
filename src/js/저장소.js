// ══════════════════════════════════════════════════
// 저장소 — 브라우저 안(IndexedDB)에 자료를 저장한다
// 다른 파일이 쓰는 함수 이름·호출 모양(doc, getDoc, setDoc …)을 그대로 맞췄다.
// 저장칸은 하나(docs), 키는 '컬렉션/문서ID'.
// ══════════════════════════════════════════════════
const DB_NAME = 'eval-free';
const STORE = 'docs';
const EXPORT_FORMAT = 'eval-free';
const COLLECTIONS = ['persons', 'roster', 'scores', 'settings', 'templates'];

const db = { name: DB_NAME };

// 저장소를 못 쓰는 환경이면 화면 맨 위에 안내를 띄운다 (조용히 실패하지 않게)
function showStorageError(e) {
  console.error('저장소 오류:', e);
  if (document.getElementById('storage-error')) return;
  const el = document.createElement('div');
  el.id = 'storage-error';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#FFF3E0;border-bottom:1.5px solid #FFB74D;color:#E65100;font-weight:700;font-size:16px;padding:12px 16px;text-align:center;';
  el.textContent = '이 브라우저에서는 자료를 저장할 수 없습니다. 사생활 보호(시크릿) 창이면 일반 창으로 열거나, 크롬·엣지 최신 버전으로 열어 주세요.';
  (document.body || document.documentElement).appendChild(el);
}

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB를 쓸 수 없는 환경입니다');
      req = indexedDB.open(DB_NAME, 1);
    } catch(e) { reject(e); return; }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('저장소를 열 수 없습니다'));
    req.onblocked = () => reject(new Error('저장소가 다른 창에서 사용 중입니다'));
  });
  dbPromise.catch(showStorageError);
  return dbPromise;
}
openDB().catch(() => {});

// 트랜잭션 하나 안에서 fn(store)를 실행. 트랜잭션이 끝까지 성공해야 resolve (중간 실패 시 전부 취소)
async function withStore(mode, fn) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    let result;
    const tx = idb.transaction(STORE, mode);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('저장 실패'));
    tx.onabort = () => reject(tx._err || tx.error || new Error('저장이 취소되었습니다'));
    try {
      result = fn(tx.objectStore(STORE), tx);
    } catch(e) {
      try { tx.abort(); } catch(_) {}
      reject(e);
    }
  });
}

// ── 참조 ──
function doc(_db, col, id) {
  return { kind: 'doc', col, id: String(id), path: `${col}/${id}` };
}
function collection(_db, col) {
  return { kind: 'collection', col, filters: [] };
}
function where(field, op, value) {
  if (op !== '==') throw new Error('where는 == 만 지원합니다');
  return { field, value };
}
function query(colRef, ...filters) {
  return { kind: 'collection', col: colRef.col, filters: [...colRef.filters, ...filters] };
}

// ── 삭제 표시 ──
const DELETE_FIELD = { __deleteField: true };
function deleteField() { return DELETE_FIELD; }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
// merge 저장: 객체는 안쪽까지 합치고(다른 사람 담당자 등 기존 키 보존), 배열·값은 통째로 바꾼다
function mergeInto(target, src) {
  Object.keys(src).forEach(k => {
    const v = src[k];
    if (v === undefined) return;
    if (isPlainObject(v) && Object.keys(v).length > 0 && isPlainObject(target[k])) mergeInto(target[k], v);
    else target[k] = v;
  });
  return target;
}

// ── 스냅샷 ──
function docSnap(ref, data) {
  const has = data !== undefined;
  return { id: ref.id, ref, exists: () => has, data: () => (has ? data : undefined) };
}

// ── 읽기 ──
async function getDoc(ref) {
  const data = await withStore('readonly', store => {
    const box = {};
    store.get(ref.path).onsuccess = e => { box.v = e.target.result; };
    return box;
  });
  return docSnap(ref, data.v);
}

async function readCollection(colRef) {
  const range = IDBKeyRange.bound(colRef.col + '/', colRef.col + '/￿');
  const box = await withStore('readonly', store => {
    const b = { keys: [], vals: [] };
    store.getAllKeys(range).onsuccess = e => { b.keys = e.target.result; };
    store.getAll(range).onsuccess = e => { b.vals = e.target.result; };
    return b;
  });
  const docs = [];
  box.keys.forEach((key, i) => {
    const data = box.vals[i];
    if (colRef.filters.every(f => data && data[f.field] === f.value)) {
      const id = String(key).slice(colRef.col.length + 1);
      docs.push(docSnap(doc(db, colRef.col, id), data));
    }
  });
  return docs;
}

async function getDocs(colRef) {
  const docs = await readCollection(colRef);
  return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
}

async function getCountFromServer(colRef) {
  const docs = await readCollection(colRef);
  return { data: () => ({ count: docs.length }) };
}

// ── 쓰기 ──
// (읽고-고쳐-쓰기는 트랜잭션 하나 안에서 한다 — 도중에 끊겨도 반만 써지지 않는다)
async function setDoc(ref, data, options) {
  const next = clone(data);
  await withStore('readwrite', store => {
    if (options && options.merge) {
      store.get(ref.path).onsuccess = e => {
        store.put(mergeInto(e.target.result || {}, next), ref.path);
      };
    } else {
      store.put(next, ref.path);
    }
  });
}

async function updateDoc(ref, data) {
  const patch = {};
  Object.keys(data).forEach(k => { patch[k] = data[k] === DELETE_FIELD ? DELETE_FIELD : clone(data[k]); });
  await withStore('readwrite', (store, tx) => {
    store.get(ref.path).onsuccess = e => {
      const cur = e.target.result;
      if (cur === undefined) { tx._err = new Error('없는 문서입니다: ' + ref.path); tx.abort(); return; }
      Object.keys(patch).forEach(key => {
        // 점 표기 경로('managers.abc')는 안쪽 값만 바꾼다
        const parts = key.split('.');
        let obj = cur;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!isPlainObject(obj[parts[i]])) {
            if (patch[key] === DELETE_FIELD) return;
            obj[parts[i]] = {};
          }
          obj = obj[parts[i]];
        }
        const last = parts[parts.length - 1];
        if (patch[key] === DELETE_FIELD) delete obj[last];
        else if (patch[key] !== undefined) obj[last] = patch[key];
      });
      store.put(cur, ref.path);
    };
  });
}

async function addDoc(colRef, data) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const ref = doc(db, colRef.col, id);
  const next = clone(data);
  await withStore('readwrite', store => { store.add(next, ref.path); });
  return ref;
}

async function deleteDoc(ref) {
  await withStore('readwrite', store => { store.delete(ref.path); });
}

// ══════════════════════════════════════════════════
// 자료 내보내기 / 불러오기 (JSON 파일 하나)
// ══════════════════════════════════════════════════
async function exportAll() {
  const box = await withStore('readonly', store => {
    const b = { keys: [], vals: [] };
    store.getAllKeys().onsuccess = e => { b.keys = e.target.result; };
    store.getAll().onsuccess = e => { b.vals = e.target.result; };
    return b;
  });
  const docs = {};
  box.keys.forEach((k, i) => { docs[k] = box.vals[i]; });
  return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), docs };
}

// 형식 검사 — 이 앱이 내보낸 파일이 아니면 이유를 돌려준다 (맞으면 null)
function checkImport(obj) {
  if (!isPlainObject(obj) || obj.format !== EXPORT_FORMAT || obj.version !== 1 || !isPlainObject(obj.docs)) {
    return '이 프로그램에서 내보낸 파일이 아닙니다';
  }
  for (const key of Object.keys(obj.docs)) {
    const slash = key.indexOf('/');
    const col = key.slice(0, slash);
    if (slash < 1 || slash === key.length - 1 || !COLLECTIONS.includes(col) || !isPlainObject(obj.docs[key])) {
      return '파일 내용이 올바르지 않습니다 (' + key + ')';
    }
  }
  return null;
}

// 전부 지우고 파일 내용으로 교체 — 트랜잭션 하나라서 중간에 실패하면 원래 자료가 그대로 남는다
async function importAll(obj) {
  const err = checkImport(obj);
  if (err) throw new Error(err);
  await withStore('readwrite', store => {
    store.clear();
    Object.keys(obj.docs).forEach(key => store.put(obj.docs[key], key));
  });
}

window.exportData = async function() {
  try {
    const data = await exportAll();
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `직업재활평가_자료_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`자료 ${Object.keys(data.docs).length}건을 파일로 내보냈습니다`);
  } catch(e) { alert('내보내기 실패: ' + e.message); }
};

window.importData = async function(input) {
  const file = input.files && input.files[0];
  input.value = '';   // 같은 파일을 다시 골라도 동작하게
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch(e) { alert('불러오기 실패: 자료 파일(.json)이 아닙니다.'); return; }
  const err = checkImport(obj);
  if (err) { alert('불러오기 실패: ' + err); return; }
  const cnt = Object.keys(obj.docs).length;
  if (!confirm(`지금 자료를 이 파일 내용으로 바꿉니다.\n\n파일: ${file.name} (자료 ${cnt}건)\n지금 이 브라우저에 있는 자료는 모두 지워집니다. 계속할까요?`)) return;
  try {
    await importAll(obj);
  } catch(e) { alert('불러오기 실패: ' + e.message + '\n\n기존 자료는 그대로입니다.'); return; }
  alert('불러오기 완료. 화면을 새로 엽니다.');
  location.reload();
};

export { db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, deleteField, collection, getDocs, query, where, getCountFromServer };
