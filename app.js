// 접속 정보는 Vercel 환경변수에서 /api/config를 통해 제공된다.
// 브라우저 코드와 Git 저장소에는 실제 값이 남지 않는다.
let client = null;
const clientReady = fetch("/api/config")
  .then(async response => {
    if (!response.ok) throw new Error((await response.text()) || "설정 정보를 불러올 수 없습니다.");
    return response.json();
  })
  .then(({ supabaseUrl, supabasePublishableKey }) => {
    if (!supabaseUrl || !supabasePublishableKey) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
    client = supabase.createClient(supabaseUrl, supabasePublishableKey);
  });

const PAGE_SIZE = 1000;   // CSV 다운로드용 배치 크기
const status = document.getElementById("status");
const tableWrap = document.getElementById("tableWrap");
const toolbar = document.getElementById("toolbar");
const downloadBtn = document.getElementById("downloadBtn");
const pageSizeSel = document.getElementById("pageSizeSel");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageInfo = document.getElementById("pageInfo");
const filterCol = document.getElementById("filterCol");
const filterOp = document.getElementById("filterOp");
const filterVal = document.getElementById("filterVal");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const colsBtn = document.getElementById("colsBtn");
const colsPanel = document.getElementById("colsPanel");
const calcWrap = document.getElementById("calcWrap");
const calcBtn = document.getElementById("calcBtn");
const calcPanel = document.getElementById("calcPanel");
const csvPanel = document.getElementById("csvPanel");

// CSV 내보낼 컬럼 선택 (테이블별 Set, 없으면 전체)
const csvSelectedByTable = {};
// CSV 내보낼 행 선택 (테이블별 Map: rowKey -> row snapshot)
const selectedRowsByTable = {};

let currentTable = null;
let pageSize = 100;      // 페이지당 행 수
let currentPage = 0;     // 0-based
let totalRows = 0;
let sortCol = null;      // 정렬 기준 컬럼
let sortAsc = true;      // true=오름차순, false=내림차순
let searchCol = "";      // 검색 대상 컬럼
let searchOp = "";       // 검색 연산자
let searchVal = "";      // 검색 값

// 캐시: { tableName: { key: { data, count } } }  key = "page|size|sortCol|sortAsc|search"
const cache = {};

// 클라이언트 페이징 대상: 전체를 한 번만 받아 페이지·정렬·검색을 브라우저에서 즉시 처리
// (행 수가 적은 뷰에 적합. 큰 원본 테이블은 서버 페이징 유지)
const CLIENT_PAGED = new Set([
  "skuList",
  "@DN_상품 공급상태 관리",
  "@SC_SKU ID & Option ID",
  "@SC_rocketStock",
]);
// 테이블별 기본 정렬 (뷰의 order by를 대신해 브라우저에서 처리)
const DEFAULT_SORT = { "skuList": { col: "최근발주일", asc: false } };
const DOWNLOAD_ORDER_FALLBACK = {
  "skuList": ["SKU ID", "Product ID", "Option ID"],
  "@DN_SOCP_orderHistory": ["발주일", "SKU ID", "SKU Barcode"],
  "@DN_상품 공급상태 관리": ["SKU ID", "바코드"],
  "@SC_SKU ID & Option ID": ["SKU ID", "Option ID", "Product ID"],
  "@SC_rocketStock": ["SKU ID", "Option ID", "Product ID"],
};

const fullData = {};    // { tableName: [row, ...] }  전체 데이터 보관 (클라이언트 페이징)
const countCache = {};  // { tableName: { searchKey: 전체행수 } } 서버 페이징 count 재사용

// 컬럼 타입별 검색 연산자 (Supabase Studio 방식: 컬럼 타입에 맞는 연산자만 제공)
const FILTER_OPS = {
  text: [
    { v: "ilike_contains", label: "포함" },
    { v: "eq",             label: "일치" },
    { v: "in",             label: "여러개 (목록)" },
    { v: "ilike_starts",   label: "시작 문자" },
    { v: "ilike_ends",     label: "끝 문자" },
    { v: "is_empty",       label: "비어 있음" },
    { v: "is_not_empty",   label: "비어 있지 않음" },
  ],
  number: [
    { v: "eq",  label: "= (같음)" },
    { v: "in",  label: "여러개 (목록)" },
    { v: "neq", label: "≠ (다름)" },
    { v: "gt",  label: "> (초과)" },
    { v: "gte", label: "≥ (이상)" },
    { v: "lt",  label: "< (미만)" },
    { v: "lte", label: "≤ (이하)" },
    { v: "is_empty",     label: "비어 있음" },
    { v: "is_not_empty", label: "비어 있지 않음" },
  ],
  datetime: [
    { v: "gte", label: "이후 (≥)" },
    { v: "lte", label: "이전 (≤)" },
    { v: "eq",  label: "일치" },
    { v: "is_empty",     label: "비어 있음" },
    { v: "is_not_empty", label: "비어 있지 않음" },
  ],
};

// 테이블별 특정 컬럼 기본 너비 지정
const COL_WIDTH_OVERRIDES = {
  "@DN_SOCP_orderHistory": { "SKU 이름": 500, "SKU ID": 120, "SKU Barcode": 150 },
  "@DN_상품 공급상태 관리": { "상품명": 500, "SKU ID": 120, "바코드": 150 },
  "@SC_rocketStock": { "Item Name": 500, "Link": 400 },
  "skuList": { "상품명": 400, "Link": 80 },
};

// 테이블별 숨김 컬럼 설정 (localStorage에 저장되어 새로고침 후에도 유지)
const HIDDEN_COLS_KEY = "socpHiddenCols";
let hiddenColsByTable = {};
try { hiddenColsByTable = JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY)) || {}; } catch (e) { hiddenColsByTable = {}; }

function saveHiddenCols() {
  localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify(hiddenColsByTable));
}

function getHiddenSet(table) {
  return new Set(hiddenColsByTable[table] || []);
}

// 테이블별 컬럼 순서 (드래그로 변경, localStorage에 저장되어 유지)
const COL_ORDER_KEY = "socpColOrder";
let colOrderByTable = {};
try { colOrderByTable = JSON.parse(localStorage.getItem(COL_ORDER_KEY)) || {}; } catch (e) { colOrderByTable = {}; }

function saveColOrder() {
  localStorage.setItem(COL_ORDER_KEY, JSON.stringify(colOrderByTable));
}

// 저장된 순서를 실제 컬럼 목록에 적용 (없어진 컬럼 제거, 새 컬럼은 뒤에 추가)
function applyColOrder(table, allCols) {
  const saved = colOrderByTable[table];
  if (!saved || !saved.length) return allCols;
  const kept = saved.filter(c => allCols.includes(c));
  const added = allCols.filter(c => !kept.includes(c));
  return [...kept, ...added];
}

// 테이블별 컬럼 색상 지정 (컬럼 패널에서 설정, localStorage에 저장되어 유지)
// 구조: { tableName: { colName: "#rrggbb" } }
const COL_COLOR_KEY = "socpColColors";
let colColorByTable = {};
try { colColorByTable = JSON.parse(localStorage.getItem(COL_COLOR_KEY)) || {}; } catch (e) { colColorByTable = {}; }

function saveColColors() {
  localStorage.setItem(COL_COLOR_KEY, JSON.stringify(colColorByTable));
}

function getColColor(table, col) {
  return (colColorByTable[table] || {})[col] || null;
}

function setColColor(table, col, color) {
  if (!colColorByTable[table]) colColorByTable[table] = {};
  if (color) colColorByTable[table][col] = color;
  else delete colColorByTable[table][col];
  saveColColors();
}

// #rrggbb → 은은한 배경용 rgba (텍스트는 지정 색, 배경은 옅게)
function hexToBg(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},0.14)`;
}

// ===== 계산(파생) 컬럼 : 컬럼끼리 연산하거나 컬럼×숫자 =====
// 이 기능을 허용할 테이블 (요청: skuList 전용)
const COMPUTED_ENABLED = new Set(["skuList"]);
const COMPUTED_COLS_KEY = "socpComputedCols";
let computedColsByTable = {};
try { computedColsByTable = JSON.parse(localStorage.getItem(COMPUTED_COLS_KEY)) || {}; } catch (e) { computedColsByTable = {}; }

function saveComputedCols() {
  localStorage.setItem(COMPUTED_COLS_KEY, JSON.stringify(computedColsByTable));
}
// 각 정의: { name, colA, op('+'|'-'|'*'|'/'), rightType('col'|'num'), colB, num, decimals }
function getComputedCols(table) {
  if (!COMPUTED_ENABLED.has(table)) return [];
  return computedColsByTable[table] || [];
}
function getComputedNames(table) {
  return getComputedCols(table).map(d => d.name);
}
function isComputedCol(table, col) {
  return getComputedCols(table).some(d => d.name === col);
}

// ===== 프리셋 공통 =====
// socp_column_presets 한 테이블을 kind로 나눠 쓴다: 'calc'=계산 컬럼, 'csv'=CSV 컬럼 선택
const PRESET_TABLE = "socp_column_presets";

// 지금 적용중인 프리셋 id. { 'calc|테이블명': id, 'csv|테이블명': id }
// 새로고침해도 어느 프리셋을 쓰던 중이었는지 유지된다.
const ACTIVE_PRESET_KEY = "socpActivePreset";
let activePresetMap = {};
try { activePresetMap = JSON.parse(localStorage.getItem(ACTIVE_PRESET_KEY)) || {}; } catch (e) { activePresetMap = {}; }

function activeKey(kind, table) { return `${kind}|${table}`; }
function getActivePresetId(kind, table) {
  const v = activePresetMap[activeKey(kind, table)];
  return v == null ? null : String(v);
}
function setActivePresetId(kind, table, id) {
  const k = activeKey(kind, table);
  if (id == null) delete activePresetMap[k];
  else activePresetMap[k] = String(id);
  localStorage.setItem(ACTIVE_PRESET_KEY, JSON.stringify(activePresetMap));
}

// 프리셋 config를 그대로 참조하면 이후 편집이 캐시된 프리셋까지 덮어쓴다. 항상 복사해서 쓴다.
function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

async function fetchPresets(kind, table) {
  const { data, error } = await client
    .from(PRESET_TABLE)
    .select("id,name,config,created_at")
    .eq("table_name", table)
    .eq("kind", kind)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// 이름이 겹치면 덮어쓸지 물어본다 (uq_presets_table_kind_name 제약).
// 화면의 프리셋 목록은 아직 안 불러왔을 수 있으므로 DB에 직접 확인한다.
async function savePresetAs(kind, table, name, config) {
  const { data: dup, error: findErr } = await client
    .from(PRESET_TABLE).select("id")
    .eq("table_name", table).eq("kind", kind).eq("name", name)
    .maybeSingle();
  if (findErr) { alert("저장 실패: " + findErr.message); return null; }

  if (dup) {
    if (!confirm(`"${name}" 프리셋이 이미 있습니다. 덮어쓸까요?`)) return null;
    const { error } = await client.from(PRESET_TABLE).update({ config }).eq("id", dup.id);
    if (error) { alert("저장 실패: " + error.message); return null; }
    return dup.id;
  }

  const { data, error } = await client
    .from(PRESET_TABLE)
    .insert({ name, table_name: table, kind, config })
    .select("id");
  if (error) {
    // 확인한 사이에 다른 사람이 같은 이름으로 만든 경우
    if (error.code === "23505") { alert(`"${name}" 프리셋이 방금 다른 곳에서 만들어졌습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.`); return null; }
    alert("저장 실패: " + error.message);
    return null;
  }
  return data && data[0] ? data[0].id : null;
}

const OP_SYMBOL = { "+": "+", "-": "−", "*": "×", "/": "÷" };

// 계산 컬럼 헤더 기본 색상 (일관된 단일 색)
const DEFAULT_CALC_HEADER_COLOR = "#6366f1";

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function roundTo(r, decimals) {
  if (r === null || r === undefined || !isFinite(r)) return null;
  const d = Number.isInteger(decimals) ? decimals : 2;
  const f = Math.pow(10, d);
  return Math.round(r * f) / f;
}

// 토큰 {컬럼}을 값으로 해석 — 계산 컬럼이면 재귀 계산(반올림 없이), 순환참조 방지
// 날짜 컬럼은 '일(day)' 숫자로 변환 → {날짜A}-{날짜B} = 일수 차이
const MS_PER_DAY = 86400000;
function resolveCellRaw(table, col, row, stack) {
  // 특수 토큰: 오늘 날짜(일 단위)
  if (col === "TODAY" || col === "오늘") return Date.now() / MS_PER_DAY;

  const def = getComputedCols(table).find(d => d.name === col);
  if (def) {
    if (stack.indexOf(col) !== -1) return null;   // 순환 참조
    if (def.formula) return evalFormulaRaw(def.formula, row, table, stack.concat(col));
    // 구형 정의는 계산값(반올림)으로 사용
    return toNum(computeLegacy(def, row));
  }
  // 날짜/시간 컬럼 → 일(day) 숫자
  if (DATETIME_COLS.includes(col)) {
    const t = Date.parse(row[col]);
    return isNaN(t) ? null : t / MS_PER_DAY;
  }
  return toNum(row[col]);
}

// 엑셀식 수식 계산(반올림 전 원값). {컬럼명} 토큰 + 사칙연산/괄호/숫자
// 예: "{쿠팡판매가(KRW)} - {매입가(KRW)}", "{원가} * {수량} * 1.1", "{마진} / {매입가(KRW)}"
function evalFormulaRaw(formula, row, table, stack) {
  if (!formula) return null;
  table = table || currentTable;
  stack = stack || [];
  // {컬럼명} → 값(괄호로 감싸 우선순위 보존), 값 없으면 NaN
  let expr = formula.replace(/\{([^}]+)\}/g, (m, col) => {
    const n = resolveCellRaw(table, col.trim(), row, stack);
    return n === null ? "(NaN)" : "(" + n + ")";
  });
  // 안전장치: NaN을 제외하면 숫자·연산자·괄호·공백만 남아야 함
  const check = expr.replace(/NaN/g, "");
  if (!/^[0-9+\-*/().eE\s]*$/.test(check)) return null;
  let r;
  try { r = Function('"use strict"; return (' + expr + ');')(); }
  catch (e) { return null; }
  return (r === null || !isFinite(r)) ? null : r;
}

// 반올림까지 적용한 수식 결과 (미리보기/테스트용)
function evalFormula(formula, row, decimals) {
  return roundTo(evalFormulaRaw(formula, row, currentTable, []), decimals);
}

// 구형 정의 계산 ({colA} op {colB|num})
function computeLegacy(def, row) {
  const a = toNum(row[def.colA]);
  const b = def.rightType === "num" ? toNum(def.num) : toNum(row[def.colB]);
  if (a === null || b === null) return null;
  let r;
  switch (def.op) {
    case "+": r = a + b; break;
    case "-": r = a - b; break;
    case "*": r = a * b; break;
    case "/": r = b === 0 ? null : a / b; break;
    default:  return null;
  }
  return roundTo(r, def.decimals);
}

// 일(day) 숫자 → 날짜 문자열 (결과 형식이 날짜일 때)
function formatDayNumber(dayNum, withTime) {
  if (dayNum === null || dayNum === undefined || !isFinite(dayNum)) return null;
  // 부동소수점 오차 방지: 분 단위로 반올림
  const ms = Math.round((dayNum * MS_PER_DAY) / 60000) * 60000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

// 한 행에 대한 계산 컬럼 값 (표시용). 결과 형식(outputType)에 따라 숫자/날짜로 변환
function computeCellValue(def, row) {
  const raw = def.formula
    ? evalFormulaRaw(def.formula, row, currentTable, [])
    : toNum(computeLegacy(def, row));
  if (raw === null) return null;
  const out = def.outputType || "num";
  if (out === "date") return formatDayNumber(raw, false);
  if (out === "datetime") return formatDayNumber(raw, true);
  return roundTo(raw, def.decimals);
}

function getRowKey(row) {
  const keys = Object.keys(row).filter(c => !c.startsWith("__")).sort();
  return keys.map(k => `${k}:${JSON.stringify(row[k])}`).join("|");
}

function getSelectedRows(table) {
  return selectedRowsByTable[table] || new Map();
}

function setRowSelected(table, row, checked) {
  if (!selectedRowsByTable[table]) selectedRowsByTable[table] = new Map();
  const map = selectedRowsByTable[table];
  const key = getRowKey(row);
  if (checked) map.set(key, row);
  else map.delete(key);
}

function selectedRowCount(table) {
  return getSelectedRows(table).size;
}

// 테이블별 전체 컬럼 목록(마지막으로 로드된 데이터 기준) + 마지막 렌더 인자(컬럼 패널 갱신/재렌더용)
const lastCols = {};       // { tableName: [col, ...] }
let lastRender = null;     // { table, data, count, from }

// 각 테이블별 뷰 상태 보존
const tableState = {};   // { tableName: { page, size, sortCol, sortAsc, search } }

function saveState() {
  if (!currentTable) return;
  tableState[currentTable] = { page: currentPage, size: pageSize, sortCol, sortAsc, searchCol, searchOp, searchVal };
}

function restoreState(name) {
  const s = tableState[name];
  if (s) {
    currentPage = s.page; pageSize = s.size; sortCol = s.sortCol; sortAsc = s.sortAsc;
    searchCol = s.searchCol || ""; searchOp = s.searchOp || ""; searchVal = s.searchVal || "";
    pageSizeSel.value = String(pageSize);
  } else {
    currentPage = 0; pageSize = 100;
    const d = DEFAULT_SORT[name];
    sortCol = d ? d.col : null;
    sortAsc = d ? d.asc : true;
    searchCol = ""; searchOp = ""; searchVal = "";
    pageSizeSel.value = "100";
  }
  // 필터 UI는 데이터 로드 후 syncFilterUI()에서 반영됨
}

async function loadTable(name) {
  saveState();            // 이전 테이블 상태 저장
  currentTable = name;
  restoreState(name);     // 이 테이블의 이전 상태 복원
  toolbar.style.display = "flex";
  await loadPage();
}

async function loadPage() {
  if (!currentTable) return;
  try {
    await clientReady;
  } catch (error) {
    status.style.display = "block";
    status.textContent = `설정 오류: ${error.message || error}`;
    tableWrap.style.display = "none";
    return;
  }
  // 클라이언트 페이징 대상은 별도 경로
  if (CLIENT_PAGED.has(currentTable)) return loadPageClient();

  status.style.display = "block";
  status.textContent = `"${currentTable}" 불러오는 중...`;
  tableWrap.style.display = "none";

  const from = currentPage * pageSize;
  const to = from + pageSize - 1;
  const cacheKey = `${currentPage}|${pageSize}|${sortCol}|${sortAsc}|${searchCol}|${searchOp}|${searchVal}`;

  // 캐시 히트 시 서버 요청 생략
  if (cache[currentTable] && cache[currentTable][cacheKey]) {
    const cached = cache[currentTable][cacheKey];
    renderTable(cached.data, cached.count, from);
    return;
  }

  // 전체 행 수(count)는 같은 검색 조건에서 한 번만 계산하고 재사용
  // (매 페이지 exact count 재계산이 로딩의 주범)
  const searchKey = `${searchCol}|${searchOp}|${searchVal}`;
  const cc = countCache[currentTable];
  const hasKnownCount = cc && Object.prototype.hasOwnProperty.call(cc, searchKey);
  const knownCount = hasKnownCount ? cc[searchKey] : undefined;

  let query = client
    .from(currentTable)
    .select("*", hasKnownCount ? {} : { count: "exact" });
  // 검색: 선택한 컬럼에 대해 연산자별 필터 적용
  if (hasActiveSearch()) {
    query = applyFilter(query, searchCol, searchOp, searchVal);
  }
  if (sortCol) query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });
  const { data, error, count } = await query.range(from, to);

  if (error) {
    status.textContent = `오류: ${error.message}`;
    updatePager();
    return;
  }

  const total = hasKnownCount ? knownCount : count;
  if (!hasKnownCount) {
    if (!countCache[currentTable]) countCache[currentTable] = {};
    countCache[currentTable][searchKey] = count;
  }

  // 캐시에 저장
  if (!cache[currentTable]) cache[currentTable] = {};
  cache[currentTable][cacheKey] = { data, count: total };

  renderTable(data, total, from);
}

// ===== 클라이언트 페이징 =====
// 전체를 한 번의 요청으로 받는 RPC. 무거운 뷰 전용.
// skuList는 발주이력 19.8만행을 집계하는 뷰라, 1000행씩 나눠 받으면 배치마다 집계를 처음부터 다시 한다.
// (PostgREST의 max-rows=1000은 뷰 읽기에만 걸리므로 json 한 덩어리로 반환해 우회.
//  jsonb는 키를 재정렬해 컬럼 순서가 깨지므로 반드시 json이어야 한다)
const FULL_FETCH_RPC = { "skuList": "get_skulist" };

// 전체 데이터를 모두 받아옴
async function fetchAllRows(table) {
  const rpc = FULL_FETCH_RPC[table];
  if (rpc) {
    const { data, error } = await client.rpc(rpc);
    if (error) throw error;
    return data || [];
  }
  // 그 외 테이블은 1000행 배치로 (Supabase 요청당 최대 1000행)
  let all = [];
  let from = 0;
  while (true) {
    let query = client.from(table).select("*");
    query = applyDownloadOrder(query, table);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function downloadOrderCols(table) {
  const cols = (lastCols[table] || []).filter(c => !c.startsWith("__") && !isComputedCol(table, c));
  const ordered = [];
  const add = c => { if (c && cols.includes(c) && !ordered.includes(c)) ordered.push(c); };
  if (sortCol && !isComputedCol(table, sortCol)) add(sortCol);
  (DOWNLOAD_ORDER_FALLBACK[table] || []).forEach(add);
  ["id", "ID", "created_at", "updated_at"].forEach(add);
  if (!ordered.length && cols.length) add(cols[0]);
  return ordered;
}

function applyDownloadOrder(query, table) {
  downloadOrderCols(table).forEach((col, i) => {
    const ascending = i === 0 && sortCol === col ? sortAsc : true;
    query = query.order(col, { ascending, nullsFirst: false });
  });
  return query;
}

async function loadPageClient() {
  const table = currentTable;
  // 전체 데이터가 없으면 한 번만 받아옴
  if (!fullData[table]) {
    status.style.display = "block";
    status.textContent = `"${table}" 전체 불러오는 중...`;
    tableWrap.style.display = "none";
    try {
      fullData[table] = await fetchAllRows(table);
    } catch (e) {
      status.textContent = `오류: ${e.message || e}`;
      updatePager();
      return;
    }
  }
  if (table !== currentTable) return;   // 로딩 중 테이블이 바뀌면 무시

  // 검색 → 정렬 → 페이지 슬라이스 (전부 클라이언트)
  let rows = fullData[table];
  if (hasActiveSearch()) rows = clientFilter(rows, searchCol, searchOp, searchVal);
  if (sortCol) rows = clientSort(rows, sortCol, sortAsc);
  const total = rows.length;
  const from = currentPage * pageSize;
  const pageRows = rows.slice(from, from + pageSize);
  renderTable(pageRows, total, from);
}

// 클라이언트 정렬 (숫자/날짜/문자 자동, null은 뒤로)
function clientSort(rows, col, asc) {
  const dir = asc ? 1 : -1;
  const isDate = DATETIME_COLS.includes(col);
  return rows.slice().sort((ra, rb) => {
    let a = ra[col], b = rb[col];
    const an = (a === null || a === undefined || a === "");
    const bn = (b === null || b === undefined || b === "");
    if (an && bn) return 0;
    if (an) return 1;                 // null은 항상 뒤
    if (bn) return -1;
    if (isDate) { a = new Date(a).getTime(); b = new Date(b).getTime(); }
    else {
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) { a = na; b = nb; }
      else { return String(a).localeCompare(String(b)) * dir; }
    }
    return (a < b ? -1 : a > b ? 1 : 0) * dir;
  });
}

// 클라이언트 검색 (서버 연산자와 동일 의미)
function clientFilter(rows, col, op, val) {
  const v = String(val);
  const lc = v.toLowerCase();
  const num = Number(v);
  const isDate = DATETIME_COLS.includes(col);
  const nums = cell => isDate
    ? { a: new Date(cell).getTime(), b: new Date(v).getTime() }
    : { a: Number(cell), b: num };
  const list = v.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
  return rows.filter(r => {
    let cell = r[col];
    const empty = cell === null || cell === undefined || String(cell).trim() === "";
    if (op === "is_empty") return empty;
    if (op === "is_not_empty") return !empty;
    if (cell === null || cell === undefined) cell = "";
    const s = String(cell).toLowerCase();
    switch (op) {
      case "ilike_contains": return s.includes(lc);
      case "ilike_starts":   return s.startsWith(lc);
      case "ilike_ends":     return s.endsWith(lc);
      case "eq":  return String(cell) === v;
      case "neq": return String(cell) !== v;
      case "in":  return list.includes(String(cell));
      case "gt":  { const { a, b } = nums(cell); return a > b; }
      case "gte": { const { a, b } = nums(cell); return a >= b; }
      case "lt":  { const { a, b } = nums(cell); return a < b; }
      case "lte": { const { a, b } = nums(cell); return a <= b; }
      default: return true;
    }
  });
}

function renderTable(data, count, from) {
  totalRows = count || 0;
  lastRender = { table: currentTable, data, count, from };

  if (!data || data.length === 0) {
    tableWrap.style.display = "none";
    status.textContent = "데이터가 없습니다.";
    updatePager();
    return;
  }

  // "__"로 시작하는 컬럼은 검색 전용 내부 컬럼이라 화면에는 항상 숨김
  const visibleRawCols = Object.keys(data[0]).filter(c => !c.startsWith("__"));
  // 계산(파생) 컬럼을 실제 컬럼 뒤에 합침
  const computedDefs = getComputedCols(currentTable);
  const computedByName = {};
  computedDefs.forEach(d => { computedByName[d.name] = d; });
  const allCols = applyColOrder(currentTable, [...visibleRawCols, ...computedDefs.map(d => d.name)]);
  lastCols[currentTable] = allCols;
  const hidden = getHiddenSet(currentTable);
  const cols = allCols.filter(c => !hidden.has(c));

  const selectedRows = getSelectedRows(currentTable);
  const pageRowKeys = data.map(row => getRowKey(row));
  const allPageSelected = pageRowKeys.length > 0 && pageRowKeys.every(k => selectedRows.has(k));
  const somePageSelected = pageRowKeys.some(k => selectedRows.has(k));

  let html = "<table><thead><tr>";
  html += `<th class="row-select-th"><input type="checkbox" id="rowSelectPage" title="현재 페이지 전체 선택" ${allPageSelected ? "checked" : ""} ${somePageSelected && !allPageSelected ? "data-indeterminate=\"1\"" : ""} /></th>`;
  cols.forEach(c => {
    const arrow = sortCol === c ? (sortAsc ? " ▲" : " ▼") : "";
    const def = computedByName[c];
    const compAttr = def ? ' data-computed="1"' : "";
    // 계산 컬럼 헤더 자동 색상
    const hStyle = def && def.headerColor ? ` style="background:${def.headerColor};color:#fff"` : "";
    html += `<th draggable="true" data-col="${escapeHtml(c)}"${compAttr}${hStyle}><span class="th-label">${escapeHtml(c)}<span class="sort-ind">${arrow}</span></span><div class="col-resizer"></div></th>`;
  });
  html += "</tr></thead><tbody>";
  // 컬럼별 지정 색상 → 셀 스타일 (텍스트=지정색, 배경=옅은 동일색)
  const colStyle = {};
  cols.forEach(c => {
    const hex = getColColor(currentTable, c);
    if (hex) colStyle[c] = ` class="has-color" style="--cell-fg:${hex};--cell-bg:${hexToBg(hex)}"`;
  });
  data.forEach((row, rowIdx) => {
    const rowKey = pageRowKeys[rowIdx];
    const checked = selectedRows.has(rowKey) ? "checked" : "";
    html += `<tr class="${checked ? "row-selected" : ""}">`;
    html += `<td class="row-select-td"><input type="checkbox" class="row-select" data-row-idx="${rowIdx}" ${checked} title="행 선택" /></td>`;
    cols.forEach(c => {
      const def = computedByName[c];
      const val = def ? computeCellValue(def, row) : row[c];
      html += `<td${colStyle[c] || ""}>${renderCellHtml(c, val)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";

  tableWrap.innerHTML = html;
  tableWrap.style.display = "block";
  status.textContent = `${from + 1}–${from + data.length} / 총 ${totalRows.toLocaleString()}행`;
  // 계산 컬럼 버튼은 허용된 테이블에서만 노출
  calcWrap.style.display = COMPUTED_ENABLED.has(currentTable) ? "inline-block" : "none";
  fitTableHeight();   // 스크롤 영역 높이를 화면에 맞춤 (헤더 sticky용) — fitColumns보다 먼저
  fitColumns();
  setupResizers();
  setupSort();
  setupColumnDrag();
  setupRowSelection(data);
  updatePager();
  syncFilterUI();
  saveState();
}

function setupRowSelection(data) {
  const pageCb = document.getElementById("rowSelectPage");
  if (pageCb) {
    pageCb.indeterminate = pageCb.dataset.indeterminate === "1";
    pageCb.addEventListener("change", () => {
      data.forEach(row => setRowSelected(currentTable, row, pageCb.checked));
      renderTable(data, totalRows, lastRender ? lastRender.from : 0);
    });
  }

  tableWrap.querySelectorAll(".row-select").forEach(cb => {
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", () => {
      const row = data[Number(cb.dataset.rowIdx)];
      if (!row) return;
      setRowSelected(currentTable, row, cb.checked);
      renderTable(data, totalRows, lastRender ? lastRender.from : 0);
    });
  });
}

// 헤더 클릭 → 정렬 (오름차순 → 내림차순 → 해제 순환)
function setupSort() {
  tableWrap.querySelectorAll("th[data-col]").forEach(th => {
    // 계산 컬럼은 DB 정렬 불가 (파생값이라) → 정렬 비활성화
    if (th.dataset.computed) { th.style.cursor = "default"; return; }
    th.style.cursor = "pointer";
    th.addEventListener("click", e => {
      if (e.target.classList.contains("col-resizer")) return;  // 폭 조절 핸들 클릭은 무시
      if (justResized) return;                                 // 드래그 직후 클릭 무시
      if (justDraggedCol) return;                              // 컬럼 순서 변경 직후 클릭 무시
      const col = th.dataset.col;
      if (sortCol !== col) { sortCol = col; sortAsc = true; }
      else if (sortAsc) { sortAsc = false; }
      else { sortCol = null; }                                 // 세 번째 클릭 시 정렬 해제
      currentPage = 0;
      loadPage();
    });
  });
}

// 헤더 드래그 → 컬럼 순서 변경
let dragCol = null;
let justDraggedCol = false;   // 드롭 직후 헤더 클릭(정렬) 방지

function setupColumnDrag() {
  tableWrap.querySelectorAll("th[data-col]").forEach(th => {
    th.addEventListener("dragstart", e => {
      if (e.target.classList.contains("col-resizer")) { e.preventDefault(); return; }
      dragCol = th.dataset.col;
      e.dataTransfer.effectAllowed = "move";
      th.classList.add("dragging-col");
    });
    th.addEventListener("dragend", () => {
      dragCol = null;
      tableWrap.querySelectorAll("th").forEach(t => t.classList.remove("dragging-col", "drag-over"));
    });
    th.addEventListener("dragover", e => {
      if (!dragCol || dragCol === th.dataset.col) return;
      e.preventDefault();
      th.classList.add("drag-over");
    });
    th.addEventListener("dragleave", () => th.classList.remove("drag-over"));
    th.addEventListener("drop", e => {
      e.preventDefault();
      th.classList.remove("drag-over");
      const targetCol = th.dataset.col;
      if (!dragCol || dragCol === targetCol) return;
      reorderColumns(dragCol, targetCol);
      justDraggedCol = true;
      setTimeout(() => { justDraggedCol = false; }, 0);
    });
  });
}

function reorderColumns(fromCol, toCol) {
  const order = (lastCols[currentTable] || []).slice();
  const fromIdx = order.indexOf(fromCol);
  if (fromIdx === -1) return;
  order.splice(fromIdx, 1);
  const toIdx = order.indexOf(toCol);          // fromCol 제거 후 재계산
  if (toIdx === -1) return;
  order.splice(toIdx, 0, fromCol);             // 드롭 대상 앞에 삽입
  colOrderByTable[currentTable] = order;
  saveColOrder();
  if (lastRender && lastRender.table === currentTable) {
    renderTable(lastRender.data, lastRender.count, lastRender.from);
  }
}

// 컬럼 표시/숨김 패널
function renderColsPanel() {
  if (!currentTable) return;
  const cols = lastCols[currentTable] || [];
  const hidden = getHiddenSet(currentTable);
  let html = "";
  cols.forEach(c => {
    const ec = escapeHtml(c);
    const checked = hidden.has(c) ? "" : "checked";
    const color = getColColor(currentTable, c);
    const clearBtn = color
      ? `<button type="button" class="cp-color-clear" data-col="${ec}" title="색상 해제">✕</button>`
      : "";
    html += `<div class="cols-panel-item">`
          +   `<label class="cp-check"><input type="checkbox" data-col="${ec}" ${checked} /><span>${ec}</span></label>`
          +   `<input type="color" class="cp-color" data-col="${ec}" value="${color || '#6366f1'}" title="데이터 색상 지정" />`
          +   clearBtn
          + `</div>`;
  });
  const toggleLabel = hidden.size === 0 ? "전체해제" : "전체선택";
  html += `<div class="cols-panel-actions"><button type="button" id="colsResetOrder">순서 초기화</button><button type="button" id="colsToggleAll">${toggleLabel}</button></div>`;
  colsPanel.innerHTML = html;

  const rerender = () => {
    if (lastRender && lastRender.table === currentTable) {
      renderTable(lastRender.data, lastRender.count, lastRender.from);
    }
  };

  colsPanel.querySelectorAll('.cp-check input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const col = cb.dataset.col;
      const set = getHiddenSet(currentTable);
      if (cb.checked) set.delete(col); else set.add(col);
      hiddenColsByTable[currentTable] = Array.from(set);
      saveHiddenCols();
      renderColsPanel();
      rerender();
    });
  });

  // 컬럼별 색상 지정
  colsPanel.querySelectorAll('.cp-color').forEach(ci => {
    ci.addEventListener("input", () => {
      setColColor(currentTable, ci.dataset.col, ci.value);
      rerender();
    });
    ci.addEventListener("change", () => renderColsPanel());
  });
  // 색상 해제
  colsPanel.querySelectorAll('.cp-color-clear').forEach(btn => {
    btn.addEventListener("click", () => {
      setColColor(currentTable, btn.dataset.col, null);
      renderColsPanel();
      rerender();
    });
  });

  document.getElementById("colsToggleAll").addEventListener("click", () => {
    // 전체선택: 모든 컬럼 표시 / 전체해제: 모든 컬럼 숨김
    hiddenColsByTable[currentTable] = hidden.size === 0 ? cols.slice() : [];
    saveHiddenCols();
    renderColsPanel();
    rerender();
  });

  document.getElementById("colsResetOrder").addEventListener("click", () => {
    // 저장된 컬럼 순서를 지워 DB(뷰)의 원래 순서로 되돌림
    delete colOrderByTable[currentTable];
    saveColOrder();
    renderColsPanel();
    rerender();
  });
}

// 툴바 패널(컬럼/계산/CSV)은 한 번에 하나만 열림
function closeToolbarPanels() {
  colsPanel.classList.remove("open");
  calcPanel.classList.remove("open");
  csvPanel.classList.remove("open");
}

colsBtn.addEventListener("click", e => {
  e.stopPropagation();
  const wasOpen = colsPanel.classList.contains("open");
  closeToolbarPanels();
  if (wasOpen) return;
  renderColsPanel();
  colsPanel.classList.add("open");
});
colsPanel.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => colsPanel.classList.remove("open"));

// ===== 계산 컬럼 관리 패널 (엑셀식 수식 + 프리셋 저장/공유) =====
function rerenderCurrentTable() {
  if (lastRender && lastRender.table === currentTable) renderTable(lastRender.data, lastRender.count, lastRender.from);
}

// 수식 입력칸의 커서 위치에 텍스트 삽입
function insertIntoFormula(text) {
  const inp = document.getElementById("calcFormula");
  if (!inp) return;
  const s = inp.selectionStart ?? inp.value.length;
  const e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
  const pos = s + text.length;
  inp.setSelectionRange(pos, pos);
  inp.focus();
}

let calcEditIndex = null;   // 수정 중인 계산 컬럼 인덱스 (null이면 추가 모드)

function renderCalcPanel() {
  if (!currentTable || !COMPUTED_ENABLED.has(currentTable)) { calcPanel.innerHTML = ""; return; }
  // 토큰으로 쓸 수 있는 컬럼: 실제 컬럼 + 기존 계산 컬럼(다른 계산에 재사용 가능)
  const tokenCols = lastCols[currentTable] || [];
  const defs = getComputedCols(currentTable);
  if (calcEditIndex != null && !defs[calcEditIndex]) calcEditIndex = null;   // 방어
  const editing = calcEditIndex != null;
  const editDef = editing ? defs[calcEditIndex] : null;

  let html = "";

  // ── 프리셋 (공유 저장/불러오기) ──
  html += `
    <div class="calc-section">
      <div class="calc-sec-title">프리셋 (공유)</div>
      <div class="calc-row">
        <select id="presetSel" class="calc-sel"><option value="">불러오는 중...</option></select>
        <button type="button" id="presetLoad" class="calc-mini">적용</button>
        <button type="button" id="presetDel" class="calc-mini calc-mini-danger">삭제</button>
      </div>
      <div class="preset-active" id="presetActive"></div>
      <div class="calc-row">
        <input type="text" id="presetName" class="calc-in" placeholder="새 프리셋 이름 (예: 타입1)" />
        <button type="button" id="presetSave" class="calc-mini calc-mini-primary">새로 저장</button>
      </div>
    </div>`;

  // ── 현재 계산 컬럼 목록 ──
  html += `<div class="calc-sec-title">계산 컬럼</div>`;
  if (defs.length) {
    html += `<div class="calc-list">`;
    defs.forEach((d, i) => {
      const swatch = d.headerColor ? `<span class="calc-swatch" style="background:${d.headerColor}"></span>` : "";
      const formulaText = d.formula ? d.formula : `{${d.colA}} ${OP_SYMBOL[d.op] || ""} ${d.rightType === "num" ? d.num : "{" + d.colB + "}"}`;
      const editingThis = editing && calcEditIndex === i ? " editing" : "";
      html += `<div class="calc-item${editingThis}">${swatch}<span class="calc-formula" title="${escapeAttr(formulaText)}">${escapeHtml(d.name)} = ${escapeHtml(formulaText)}</span><button type="button" class="calc-edit" data-idx="${i}" title="수정">✎</button><button type="button" class="calc-del" data-idx="${i}" title="삭제">✕</button></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="calc-empty">아직 계산 컬럼이 없습니다.</div>`;
  }

  // ── 새 계산 컬럼 / 수정 (엑셀식 수식) ──
  html += `
    <div class="calc-form">
      <div class="calc-sec-title">${editing ? `✎ "${escapeHtml(editDef.name)}" 수정` : "새 계산 컬럼"}</div>
      <input type="text" id="calcName" class="calc-in" placeholder="컬럼 이름 (선택)" value="${editing ? escapeAttr(editDef.name) : ""}" />
      <input type="text" id="calcFormula" class="calc-in calc-formula-in" placeholder="예: {A} * {B} * 1.1" value="${editing ? escapeAttr(editDef.formula || "") : ""}" />
      <select id="calcColSelect" class="calc-sel">
        <option value="">＋ 컬럼 추가...</option>
        <option value="TODAY">📅 오늘(TODAY)</option>
        ${tokenCols.map(c => `<option value="${escapeAttr(c)}">${isComputedCol(currentTable, c) ? "ƒ " : ""}${escapeHtml(c)}</option>`).join("")}
      </select>
      <div class="calc-ops">
        ${["(", ")", "+", "-", "*", "/"].map(o => `<button type="button" class="calc-op-btn" data-op="${o}">${o === "*" ? "×" : o === "/" ? "÷" : o === "-" ? "−" : o}</button>`).join("")}
        <button type="button" class="calc-op-btn calc-clear" id="calcClear">지우기</button>
      </div>
      <div class="calc-row calc-dec-row">
        <label class="calc-dec-label">결과 형식
          <select id="calcOutType" class="calc-sel">
            ${[["num", "숫자"], ["date", "날짜"], ["datetime", "날짜+시간"]].map(([v, t]) =>
              `<option value="${v}"${(editing ? (editDef.outputType || "num") : "num") === v ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="calc-row calc-dec-row">
        <label class="calc-dec-label">소수점 자리
          <input type="number" id="calcDecimals" class="calc-in calc-dec-in" min="0" max="10" step="1"
                 value="${editing ? (Number.isInteger(editDef.decimals) ? editDef.decimals : 2) : 2}" />
          <span class="calc-dec-hint">숫자 형식일 때만</span>
        </label>
      </div>
      <div class="calc-row">
        <button type="button" id="calcAdd" class="btn-primary calc-add">${editing ? "수정 저장" : "계산 컬럼 추가"}</button>
        ${editing ? `<button type="button" id="calcCancelEdit" class="calc-mini">취소</button>` : ""}
      </div>
    </div>`;

  calcPanel.innerHTML = html;

  // 컬럼 선택(드롭다운) → 수식에 토큰 삽입
  const colSelect = document.getElementById("calcColSelect");
  colSelect.addEventListener("change", () => {
    if (colSelect.value) { insertIntoFormula(`{${colSelect.value}}`); colSelect.value = ""; }
  });
  // 연산자 삽입
  calcPanel.querySelectorAll(".calc-op-btn[data-op]").forEach(b =>
    b.addEventListener("click", () => insertIntoFormula(b.dataset.op)));
  document.getElementById("calcClear").addEventListener("click", () => {
    document.getElementById("calcFormula").value = "";
    document.getElementById("calcFormula").focus();
  });

  // 삭제
  calcPanel.querySelectorAll(".calc-del").forEach(b => b.addEventListener("click", () => {
    const i = parseInt(b.dataset.idx, 10);
    computedColsByTable[currentTable].splice(i, 1);
    if (!computedColsByTable[currentTable].length) delete computedColsByTable[currentTable];
    if (calcEditIndex === i) calcEditIndex = null;
    saveComputedCols();
    renderCalcPanel();
    rerenderCurrentTable();
  }));

  // 수정 시작
  calcPanel.querySelectorAll(".calc-edit").forEach(b => b.addEventListener("click", () => {
    calcEditIndex = parseInt(b.dataset.idx, 10);
    renderCalcPanel();
    document.getElementById("calcFormula").focus();
  }));
  // 수정 취소
  const cancelBtn = document.getElementById("calcCancelEdit");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { calcEditIndex = null; renderCalcPanel(); });

  // 추가
  document.getElementById("calcAdd").addEventListener("click", () => {
    const formula = document.getElementById("calcFormula").value.trim();
    if (!formula) { alert("수식을 입력하세요. 컬럼 버튼을 눌러 {컬럼}을 넣고 연산자를 조합하세요."); return; }
    if (!/\{[^}]+\}/.test(formula) && !/^[0-9+\-*/(). ]+$/.test(formula)) { alert("수식 형식이 올바르지 않습니다."); return; }
    // 유효성: 표본 행으로 계산 시도
    const sample = (lastRender && lastRender.data && lastRender.data[0]) || {};
    const testVal = evalFormula(formula, sample, 2);
    if (testVal === null) {
      if (!confirm("현재 첫 행 기준으로 계산 결과가 비어 있습니다(값 없음/0나누기 가능). 그래도 추가할까요?")) return;
    }
    let name = document.getElementById("calcName").value.trim();
    if (!name) name = formula.replace(/\{|\}/g, "").replace(/\s+/g, "");
    let decimals = parseInt(document.getElementById("calcDecimals").value, 10);
    if (isNaN(decimals) || decimals < 0) decimals = 0;
    if (decimals > 10) decimals = 10;   // 과도한 자릿수 방지
    const outputType = document.getElementById("calcOutType").value;
    const list = computedColsByTable[currentTable] || [];

    if (calcEditIndex != null && list[calcEditIndex]) {
      // ── 수정 저장 ── (자기 이름은 중복검사에서 제외, 헤더색상 유지)
      const editIdx = calcEditIndex;
      const selfName = list[editIdx].name;
      const others = new Set((lastCols[currentTable] || []).filter(c => c !== selfName));
      let finalName = name, k = 2;
      while (others.has(finalName)) { finalName = `${name}(${k++})`; }
      list[editIdx] = { ...list[editIdx], name: finalName, formula, decimals, outputType };
      // 이름이 바뀌면, 이 컬럼을 참조하던 다른 계산 컬럼의 {옛이름} → {새이름} 자동 갱신
      if (finalName !== selfName) {
        list.forEach((d, idx) => {
          if (idx === editIdx || !d.formula) return;
          d.formula = d.formula.replace(/\{([^}]+)\}/g, (m, inner) =>
            inner.trim() === selfName ? `{${finalName}}` : m);
        });
      }
      calcEditIndex = null;
    } else {
      // ── 새로 추가 ──
      const existing = new Set(lastCols[currentTable] || []);
      let finalName = name, k = 2;
      while (existing.has(finalName)) { finalName = `${name}(${k++})`; }
      if (!computedColsByTable[currentTable]) computedColsByTable[currentTable] = [];
      computedColsByTable[currentTable].push({
        name: finalName, formula, decimals, outputType, headerColor: DEFAULT_CALC_HEADER_COLOR,
      });
    }
    saveComputedCols();
    renderCalcPanel();
    rerenderCurrentTable();
  });

  // ── 프리셋 로직 ──
  wireCalcPresets();
}

// 계산 컬럼 프리셋의 현재 내용
function calcConfigNow(table) {
  return {
    computed: deepCopy(getComputedCols(table)),
    colColors: deepCopy(colColorByTable[table] || {}),
  };
}

// 적용중인 프리셋과 지금 상태가 다른지 (저장 안 된 변경이 있는지)
function calcPresetDirty(table, preset) {
  if (!preset) return false;
  const cfg = preset.config || {};
  const now = calcConfigNow(table);
  const saved = {
    computed: Array.isArray(cfg.computed) ? cfg.computed : [],
    colColors: cfg.colColors && typeof cfg.colColors === "object" ? cfg.colColors : {},
  };
  return JSON.stringify(now) !== JSON.stringify(saved);
}

// 프리셋 내용을 현재 상태로 적용
function applyCalcPreset(table, preset) {
  const cfg = preset.config || {};
  const computed = Array.isArray(cfg.computed) ? deepCopy(cfg.computed) : [];
  if (computed.length) computedColsByTable[table] = computed;
  else delete computedColsByTable[table];
  colColorByTable[table] = cfg.colColors && typeof cfg.colColors === "object" ? deepCopy(cfg.colColors) : {};
  setActivePresetId("calc", table, preset.id);
  calcEditIndex = null;   // 편집 중이던 인덱스는 다른 프리셋에선 의미 없음
  saveComputedCols();
  saveColColors();
}

// "적용중: 이름 · 변경됨" 줄 + 프리셋에 저장/되돌리기
function renderCalcPresetActive() {
  const el = document.getElementById("presetActive");
  if (!el) return;
  const p = (calcPanel._presets || []).find(x => String(x.id) === getActivePresetId("calc", currentTable));
  if (!p) { el.innerHTML = ""; return; }
  const dirty = calcPresetDirty(currentTable, p);
  // 컬럼 수는 '저장된' 프리셋 기준이라, 변경 중엔 아래 목록과 어긋나 보인다. 그땐 숨긴다.
  const n = (p.config && Array.isArray(p.config.computed) ? p.config.computed.length : 0);
  const count = dirty ? "" : ` <span class="preset-count">(계산컬럼 ${n}개)</span>`;
  el.innerHTML =
    `<div class="preset-active-row">`
  +   `<span class="preset-dot${dirty ? " dirty" : ""}"></span>`
  +   `<span class="preset-active-name">적용중: <b>${escapeHtml(p.name)}</b>${count}</span>`
  +   (dirty ? `<span class="preset-dirty-tag">저장 안 됨</span>` : "")
  + `</div>`
  + (dirty
      ? `<div class="calc-row preset-save-row">`
      +   `<button type="button" id="presetUpdate" class="calc-mini calc-mini-primary">「${escapeHtml(p.name)}」에 저장</button>`
      +   `<button type="button" id="presetRevert" class="calc-mini">되돌리기</button>`
      + `</div>`
      : "");

  const upd = document.getElementById("presetUpdate");
  if (upd) upd.addEventListener("click", async () => {
    const config = calcConfigNow(currentTable);
    const { error } = await client.from(PRESET_TABLE).update({ config }).eq("id", p.id);
    if (error) { alert("저장 실패: " + error.message); return; }
    p.config = config;          // 캐시도 맞춰야 '변경됨'이 바로 사라진다
    renderCalcPanel();
  });
  const rev = document.getElementById("presetRevert");
  if (rev) rev.addEventListener("click", () => {
    if (!confirm(`저장 안 된 변경을 버리고 "${p.name}" 내용으로 되돌릴까요?`)) return;
    applyCalcPreset(currentTable, p);
    renderCalcPanel();
    rerenderCurrentTable();
  });
}

// 프리셋 select 채우기 + 저장/적용/삭제 이벤트
function wireCalcPresets() {
  const sel = document.getElementById("presetSel");
  if (!sel) return;
  const table = currentTable;   // 비동기 도중 테이블이 바뀔 수 있으므로 고정

  // 테이블이 바뀌면 이전 테이블의 선택/목록은 버린다
  if (calcPanel._selTable !== table) {
    calcPanel._selTable = table;
    calcPanel._selValue = null;
    calcPanel._presets = [];
  }
  // 드롭다운에서 고른 값을 기억해 둔다 (아래 선택 복원에서 씀)
  sel.addEventListener("change", () => { calcPanel._selValue = sel.value; renderCalcPresetActive(); });

  // 목록 그리기 + 선택 복원.
  // 선택 복원이 없으면 매 렌더마다 첫 프리셋으로 되돌아가서,
  // 다른 프리셋을 적용해도 처음 프리셋이 적용된 것처럼 보였다.
  const paint = () => {
    const data = calcPanel._presets || [];
    sel.innerHTML = data.length
      ? data.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
      : `<option value="">저장된 프리셋 없음</option>`;
    const want = calcPanel._selValue ?? getActivePresetId("calc", table);
    if (want != null && [...sel.options].some(o => o.value === String(want))) sel.value = String(want);
    calcPanel._selValue = sel.value;
    renderCalcPresetActive();
  };

  if ((calcPanel._presets || []).length) paint();   // 캐시로 즉시 (재렌더 때 깜빡임 방지)

  // 목록 갱신은 비동기로 하되, 버튼 이벤트는 먼저(동기) 연결한다
  (async () => {
    try {
      const data = await fetchPresets("calc", table);
      if (table !== currentTable || !sel.isConnected) return;   // 늦게 온 응답이 새 화면을 덮어쓰지 않게
      calcPanel._presets = data;
      paint();
    } catch (e) {
      if (!(calcPanel._presets || []).length) sel.innerHTML = `<option value="">불러오기 실패</option>`;
    }
  })();

  // 적용
  document.getElementById("presetLoad").addEventListener("click", () => {
    const p = (calcPanel._presets || []).find(x => String(x.id) === String(sel.value));
    if (!p) { alert("적용할 프리셋을 선택하세요."); return; }
    const cur = (calcPanel._presets || []).find(x => String(x.id) === getActivePresetId("calc", currentTable));
    if (cur && cur.id !== p.id && calcPresetDirty(currentTable, cur)
        && !confirm(`"${cur.name}"에 저장 안 된 변경이 있습니다. 버리고 "${p.name}"을(를) 적용할까요?`)) return;
    calcPanel._selValue = String(p.id);
    applyCalcPreset(currentTable, p);
    renderCalcPanel();
    rerenderCurrentTable();
  });

  // 삭제
  document.getElementById("presetDel").addEventListener("click", async () => {
    const p = (calcPanel._presets || []).find(x => String(x.id) === String(sel.value));
    if (!p) { alert("삭제할 프리셋을 선택하세요."); return; }
    if (!confirm(`프리셋 "${p.name}" 을(를) 삭제할까요? (모든 사용자에게서 사라집니다)`)) return;
    const { error } = await client.from(PRESET_TABLE).delete().eq("id", p.id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    if (getActivePresetId("calc", currentTable) === String(p.id)) setActivePresetId("calc", currentTable, null);
    if (calcPanel._selValue === String(p.id)) calcPanel._selValue = null;
    calcPanel._presets = (calcPanel._presets || []).filter(x => x.id !== p.id);
    renderCalcPanel();
  });

  // 새로 저장
  document.getElementById("presetSave").addEventListener("click", async () => {
    const nameEl = document.getElementById("presetName");
    const name = nameEl.value.trim();
    if (!name) { alert("새 프리셋 이름을 입력하세요 (예: 타입1)."); return; }
    const id = await savePresetAs("calc", currentTable, name, calcConfigNow(currentTable));
    if (id == null) return;
    nameEl.value = "";
    setActivePresetId("calc", currentTable, id);
    calcPanel._selValue = String(id);
    calcPanel._presets = await fetchPresets("calc", currentTable);
    renderCalcPanel();
    alert(`프리셋 "${name}" 저장 완료 (모든 사용자 공유).`);
  });
}

calcBtn.addEventListener("click", e => {
  e.stopPropagation();
  const wasOpen = calcPanel.classList.contains("open");
  closeToolbarPanels();
  if (wasOpen) return;
  renderCalcPanel();
  calcPanel.classList.add("open");
});
calcPanel.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => calcPanel.classList.remove("open"));

function totalPages() {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

function updatePager() {
  const tp = totalPages();
  pageInfo.textContent = `${currentPage + 1} / ${tp} 페이지`;
  prevBtn.disabled = currentPage <= 0;
  nextBtn.disabled = currentPage >= tp - 1;
}

prevBtn.addEventListener("click", () => {
  if (currentPage > 0) { currentPage--; loadPage(); }
});
nextBtn.addEventListener("click", () => {
  if (currentPage < totalPages() - 1) { currentPage++; loadPage(); }
});
pageSizeSel.addEventListener("change", () => {
  pageSize = parseInt(pageSizeSel.value, 10);
  currentPage = 0;
  loadPage();
});

// 선택한 컬럼/연산자/값으로 PostgREST 필터 적용
// (공백·괄호·& 등 특수문자 컬럼명은 큰따옴표로 감싸야 PostgREST가 올바르게 인식)
function applyFilter(query, col, op, val) {
  const c = `"${col}"`;
  const isText = getColType(col) === "text";
  switch (op) {
    case "is_empty":
      return isText ? query.or(`${c}.is.null,${c}.eq.`) : query.is(c, null);
    case "is_not_empty": {
      const q = query.not(c, "is", null);
      return isText ? q.neq(c, "") : q;
    }
    case "ilike_contains": return query.ilike(c, `%${val}%`);
    case "ilike_starts":   return query.ilike(c, `${val}%`);
    case "ilike_ends":     return query.ilike(c, `%${val}`);
    case "eq":  return query.eq(c, val);
    case "in": {
      // 여러 값 한 번에 조회: 쉼표 / 공백 / ", " 로 구분
      const list = String(val).split(/[\s,]+/).map(s => s.trim()).filter(s => s !== "");
      return list.length ? query.in(c, list) : query;
    }
    case "neq": return query.neq(c, val);
    case "gt":  return query.gt(c, val);
    case "gte": return query.gte(c, val);
    case "lt":  return query.lt(c, val);
    case "lte": return query.lte(c, val);
    default:    return query;
  }
}

function filterNeedsValue(op) {
  return op !== "is_empty" && op !== "is_not_empty";
}

function hasActiveSearch() {
  return !!(searchCol && searchOp && (!filterNeedsValue(searchOp) || searchVal !== ""));
}

// 컬럼 타입 추론: 날짜/시간 컬럼 우선, 그 외엔 로드된 데이터 샘플로 판단
function getColType(col) {
  if (DATETIME_COLS.includes(col)) return "datetime";
  const rows = (lastRender && lastRender.data) || [];
  for (const r of rows) {
    const v = r[col];
    if (v !== null && v !== undefined) return typeof v === "number" ? "number" : "text";
  }
  return "text";
}

// 연산자 드롭다운을 컬럼 타입에 맞게 채움 (selected가 유효하면 유지)
function fillOperators(col, selected) {
  const ops = FILTER_OPS[getColType(col)] || FILTER_OPS.text;
  filterOp.innerHTML = ops.map(o => `<option value="${o.v}">${o.label}</option>`).join("");
  filterOp.value = selected && ops.some(o => o.v === selected) ? selected : ops[0].v;
}

// "여러개(in)" 연산자일 때 값 입력칸 안내문 변경
function updateValPlaceholder() {
  const needsValue = filterNeedsValue(filterOp.value);
  filterVal.disabled = !needsValue;
  filterVal.placeholder = !needsValue
    ? "값 입력 불필요"
    : filterOp.value === "in"
      ? "여러 값: 쉼표 또는 공백으로 구분"
      : "값 입력...";
  if (!needsValue) filterVal.value = "";
}

// 현재 상태(searchCol/Op/Val)를 필터 UI에 반영 (렌더 후 호출)
function syncFilterUI() {
  // 계산 컬럼은 DB 검색이 불가하므로 검색 대상 목록에서 제외
  const cols = (lastCols[currentTable] || []).filter(c => !isComputedCol(currentTable, c));
  filterCol.innerHTML = `<option value="">컬럼 선택...</option>` +
    cols.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  // 저장된 검색 컬럼이 현재 목록에 없으면 초기화
  if (searchCol && !cols.includes(searchCol)) { searchCol = ""; searchOp = ""; searchVal = ""; }
  filterCol.value = searchCol;
  if (searchCol) {
    fillOperators(searchCol, searchOp);
    searchOp = filterOp.value;
    filterOp.disabled = false;
    filterVal.disabled = false;
    filterVal.value = searchVal;
    updateValPlaceholder();
  } else {
    filterOp.innerHTML = "";
    filterOp.disabled = true;
    filterVal.disabled = true;
    filterVal.value = "";
  }
}

// 컬럼 선택 변경 → 연산자 목록 갱신 + 값 입력 활성화
filterCol.addEventListener("change", () => {
  searchCol = filterCol.value;
  if (searchCol) {
    fillOperators(searchCol, "");
    searchOp = filterOp.value;
    filterOp.disabled = false;
    filterVal.disabled = false;
    updateValPlaceholder();
    filterVal.focus();
  } else {
    filterOp.innerHTML = ""; filterOp.disabled = true;
    filterVal.value = ""; filterVal.disabled = true;
    searchOp = ""; searchVal = "";
  }
});
filterOp.addEventListener("change", () => { searchOp = filterOp.value; updateValPlaceholder(); });

function runSearch() {
  if (!filterCol.value) { alert("검색할 컬럼을 먼저 선택하세요."); filterCol.focus(); return; }
  searchCol = filterCol.value;
  searchOp = filterOp.value;
  searchVal = filterVal.value.trim();
  if (filterNeedsValue(searchOp) && searchVal === "") { alert("검색 값을 입력하세요."); filterVal.focus(); return; }
  currentPage = 0;
  loadPage();
}
searchBtn.addEventListener("click", runSearch);
filterVal.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
clearSearchBtn.addEventListener("click", () => {
  searchCol = ""; searchOp = ""; searchVal = "";
  filterCol.value = "";
  filterOp.innerHTML = ""; filterOp.disabled = true;
  filterVal.value = ""; filterVal.disabled = true;
  currentPage = 0;
  loadPage();
});

// 기본 너비: 데이터 내용 폭에 맞추되, 전체 합이 화면을 넘으면 비율대로 줄여 잘리게 함
const MIN_W = 80;
const ROW_SELECT_W = 42;
// 표 스크롤 영역 높이를 화면 하단까지 채움 → 헤더(sticky)가 표 안에서 고정됨
function fitTableHeight() {
  if (tableWrap.style.display === "none") return;
  const top = tableWrap.getBoundingClientRect().top;   // 표 상단의 뷰포트 기준 위치
  tableWrap.style.maxHeight = Math.max(200, Math.floor(window.innerHeight - top - 16)) + "px";
}

// 창 크기 변경 시 높이·컬럼폭 재조정
window.addEventListener("resize", () => {
  if (tableWrap.style.display !== "none") { fitTableHeight(); fitColumns(); }
});

function fitColumns() {
  const table = tableWrap.querySelector("table");
  if (!table) return;
  const avail = tableWrap.clientWidth;           // 화면(컨테이너) 폭
  // auto 레이아웃으로 각 컬럼 자연 폭 측정
  table.style.tableLayout = "auto";
  table.style.width = "auto";
  const ths = Array.from(table.querySelectorAll("th"));
  const overrides = COL_WIDTH_OVERRIDES[currentTable] || {};
  let widths = ths.map(th => {
    if (th.classList.contains("row-select-th")) return ROW_SELECT_W;
    const col = th.dataset.col;
    if (overrides[col]) return overrides[col];
    return Math.ceil(th.offsetWidth);
  });
  const total = widths.reduce((a, b) => a + b, 0);

  // 화면보다 넓으면 override 컬럼은 유지하고 나머지를 비율 축소
  if (total > avail) {
    const fixedSum = ths.reduce((s, th, i) => {
      if (th.classList.contains("row-select-th")) return s + widths[i];
      return overrides[th.dataset.col] ? s + widths[i] : s;
    }, 0);
    const flexTotal = total - fixedSum;
    const flexAvail = avail - fixedSum;
    if (flexAvail > 0 && flexTotal > 0) {
      widths = widths.map((w, i) => {
        if (ths[i].classList.contains("row-select-th")) return ROW_SELECT_W;
        if (overrides[ths[i].dataset.col]) return w;
        return Math.max(MIN_W, Math.floor(w / flexTotal * flexAvail));
      });
    }
  }

  // 고정 레이아웃으로 전환 후 적용 (넘치는 셀 내용은 잘림)
  table.style.tableLayout = "fixed";
  ths.forEach((th, i) => { th.style.width = widths[i] + "px"; });
  syncTableWidth();  // 표 폭 = 컬럼 합으로 고정
}

// 표 전체 폭을 컬럼 너비 합으로 고정 → 한 컬럼을 바꿔도 다른 컬럼은 그대로
function syncTableWidth() {
  const table = tableWrap.querySelector("table");
  if (!table) return;
  let sum = 0;
  table.querySelectorAll("th").forEach(th => { sum += parseFloat(th.style.width) || th.offsetWidth; });
  table.style.width = sum + "px";
}

// 컬럼 너비 드래그 조절 (document 리스너는 최초 1회만 등록)
let resizeTh = null, resizeStartX = 0, resizeStartW = 0, resizeHandle = null;
let justResized = false;   // 드래그 직후 헤더 클릭(정렬) 방지

function setupResizers() {
  tableWrap.querySelectorAll(".col-resizer").forEach(res => {
    res.addEventListener("mousedown", e => {
      resizeTh = res.parentElement;
      resizeHandle = res;
      resizeStartX = e.pageX;
      resizeStartW = resizeTh.offsetWidth;
      resizeHandle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      e.preventDefault();
    });
  });
}

document.addEventListener("mousemove", e => {
  if (!resizeTh) return;
  resizeTh.style.width = Math.max(MIN_W, resizeStartW + (e.pageX - resizeStartX)) + "px";
  syncTableWidth();
  justResized = true;
});
document.addEventListener("mouseup", () => {
  if (resizeHandle) resizeHandle.classList.remove("dragging");
  resizeTh = null; resizeHandle = null;
  document.body.style.cursor = "";
  // 클릭 이벤트가 처리된 뒤 플래그 해제
  setTimeout(() => { justResized = false; }, 0);
});

// 날짜/시간 컬럼 표시 형식 지정
const DATETIME_COLS = ["발주일", "최근발주일"];
function formatCell(col, v) {
  if (DATETIME_COLS.includes(col) && v) {
    const d = new Date(v);
    if (!isNaN(d)) {
      const p = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  return v;
}

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 속성값(href 등) 이스케이프 — 따옴표까지 처리
function escapeAttr(v) {
  return escapeHtml(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// 테이블별 "링크 컬럼": 셀에 표시할 라벨 지정
// 원본 값(URL)은 그대로 두고, 화면에만 라벨을 보여주며 클릭 시 URL로 이동
const LINK_COLS = {
  "skuList": { "Link": "쿠팡" },
};

// 테이블별 "이미지 컬럼": URL을 라벨로 표시 + 호버 미리보기 + 클릭 확대
const IMAGE_COLS = {
  "skuList": { "Image URL": "이미지" },
};

// 셀 HTML 생성 (이미지/링크 컬럼이면 <a>, 아니면 이스케이프된 텍스트)
function renderCellHtml(col, v) {
  const hasVal = v != null && String(v).trim() !== "";
  const url = hasVal ? String(v).trim() : "";
  const safeUrl = hasVal && /^https?:\/\//i.test(url);

  // 이미지 컬럼
  const imgMap = IMAGE_COLS[currentTable];
  if (imgMap && imgMap[col] && safeUrl) {
    return `<a class="cell-img" href="${escapeAttr(url)}" data-img="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="클릭하면 크게 보기">${escapeHtml(imgMap[col])}</a>`;
  }

  // 링크 컬럼
  const linkMap = LINK_COLS[currentTable];
  if (linkMap && linkMap[col] && safeUrl) {
    return `<a class="cell-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(url)}">${escapeHtml(linkMap[col])}</a>`;
  }

  return escapeHtml(formatCell(col, v));
}

// ===== 이미지 컬럼: 호버 미리보기(150×150) + 클릭 라이트박스 =====
(function setupImagePreview() {
  // 호버 미리보기 요소
  const preview = document.createElement("div");
  preview.id = "imgPreview";
  preview.style.display = "none";
  preview.innerHTML = `<img alt="미리보기">`;
  document.body.appendChild(preview);
  const previewImg = preview.querySelector("img");
  previewImg.onerror = () => { preview.style.display = "none"; };

  // 라이트박스
  const lb = document.createElement("div");
  lb.id = "imgLightbox";
  lb.style.display = "none";
  lb.innerHTML = `<span class="lb-close" title="닫기">✕</span><img alt="이미지">`;
  document.body.appendChild(lb);
  const lbImg = lb.querySelector("img");
  const closeLb = () => { lb.style.display = "none"; lbImg.src = ""; };
  lb.addEventListener("click", closeLb);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLb(); });

  // 표에 위임 리스너 (tableWrap은 유지되고 내부 innerHTML만 갱신됨)
  tableWrap.addEventListener("mouseover", e => {
    const a = e.target.closest(".cell-img");
    if (!a) return;
    previewImg.src = a.dataset.img;
    preview.style.display = "block";
  });
  tableWrap.addEventListener("mouseout", e => {
    if (e.target.closest(".cell-img")) preview.style.display = "none";
  });
  tableWrap.addEventListener("mousemove", e => {
    if (preview.style.display === "none") return;
    const pad = 16, box = 164;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + box > window.innerWidth) x = e.clientX - box - pad;
    if (y + box > window.innerHeight) y = e.clientY - box - pad;
    preview.style.left = Math.max(4, x) + "px";
    preview.style.top = Math.max(4, y) + "px";
  });
  tableWrap.addEventListener("click", e => {
    const a = e.target.closest(".cell-img");
    if (!a) return;
    e.preventDefault();                 // 새 탭 이동 대신 사이트 내 확대
    preview.style.display = "none";
    lbImg.src = a.dataset.img;
    lb.style.display = "flex";
  });
})();

async function downloadCsv(options) {
  if (!currentTable) return;
  const selectedOnly = options && options.selectedOnly;
  const table = currentTable;
  downloadBtn.disabled = true;
  const original = downloadBtn.textContent;

  try {
    let allRows = [];
    if (selectedOnly) {
      allRows = Array.from(getSelectedRows(table).values());
      downloadBtn.textContent = `선택 행 준비 중... ${allRows.length}행`;
    } else if (CLIENT_PAGED.has(table)) {
      downloadBtn.textContent = `전체 데이터 준비 중...`;
      if (!fullData[table]) fullData[table] = await fetchAllRows(table);
      allRows = fullData[table].slice();
    } else {
      let from = 0;
      while (true) {
        downloadBtn.textContent = `내려받는 중... ${allRows.length}행`;
        let query = client
          .from(table)
          .select("*");
        query = applyDownloadOrder(query, table);
        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    if (allRows.length === 0) {
      alert(selectedOnly ? "선택한 행이 없습니다." : "데이터가 없습니다.");
      return;
    }

    const rawCols = Object.keys(allRows[0]).filter(c => !c.startsWith("__"));
    // 계산 컬럼도 CSV에 포함
    const computedDefs = getComputedCols(table);
    const computedByName = {};
    computedDefs.forEach(d => { computedByName[d.name] = d; });
    // 표시 순서(있으면)대로, 없으면 원본+계산 순서
    const displayOrder = (lastCols[table] || []).filter(c => !c.startsWith("__"));
    let cols = displayOrder.length ? displayOrder.slice() : [...rawCols, ...computedDefs.map(d => d.name)];
    // 선택된 컬럼만 (CSV 컬럼 선택 패널)
    const sel = csvSelectedByTable[table];
    if (sel) cols = cols.filter(c => sel.has(c));
    if (cols.length === 0) { alert("내보낼 컬럼을 하나 이상 선택하세요."); return; }
    const csvLines = [cols.map(csvCell).join(",")];
    allRows.forEach(row => {
      csvLines.push(cols.map(c => {
        const def = computedByName[c];
        return csvCell(def ? computeCellValue(def, row) : row[c]);
      }).join(","));
    });
    // BOM 추가 (엑셀 한글 깨짐 방지)
    const blob = new Blob(["﻿" + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedOnly ? `${table}_selected.csv` : `${table}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("다운로드 오류: " + (e.message || e));
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = original;
  }
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ===== CSV 컬럼 선택 패널 =====
function csvAllCols() {
  return (lastCols[currentTable] || []).filter(c => !c.startsWith("__"));
}
function renderCsvPanel() {
  if (!currentTable) { csvPanel.innerHTML = ""; return; }
  const all = csvAllCols();
  if (!csvSelectedByTable[currentTable]) csvSelectedByTable[currentTable] = new Set(all);
  const sel = csvSelectedByTable[currentTable];
  const rowCount = selectedRowCount(currentTable);
  // 없어진 컬럼 정리 + 새 컬럼은 선택에 추가
  [...sel].forEach(c => { if (!all.includes(c)) sel.delete(c); });

  // ── 프리셋 (다운로드1, 다운로드2 ... 자주 쓰는 컬럼 조합) ──
  let html = `
    <div class="csv-section">
      <div class="calc-sec-title">다운로드 프리셋 (공유)</div>
      <div class="calc-row">
        <select id="csvPresetSel" class="calc-sel"><option value="">불러오는 중...</option></select>
        <button type="button" id="csvPresetLoad" class="calc-mini">적용</button>
        <button type="button" id="csvPresetDel" class="calc-mini calc-mini-danger">삭제</button>
      </div>
      <div class="calc-row">
        <input type="text" id="csvPresetName" class="calc-in" placeholder="이름 (예: 다운로드1)" />
        <button type="button" id="csvPresetSave" class="calc-mini calc-mini-primary">현재 선택 저장</button>
      </div>
    </div>`;

  html += `<div class="csv-section">
      <div class="calc-sec-title">다운로드 범위</div>
      <div class="csv-scope-row">
        <span>선택된 행 ${rowCount.toLocaleString()}개</span>
        <button type="button" id="csvClearRows" class="calc-mini" ${rowCount ? "" : "disabled"}>선택 해제</button>
      </div>
    </div>`;

  html += `<div class="csv-hint">내보낼 컬럼 선택 (${sel.size}/${all.length})</div>`;
  all.forEach(c => {
    const ec = escapeHtml(c);
    const checked = sel.has(c) ? "checked" : "";
    html += `<label class="cols-panel-item"><input type="checkbox" data-col="${ec}" ${checked} /><span>${ec}</span></label>`;
  });
  const allOn = sel.size === all.length && all.length > 0;
  html += `<div class="cols-panel-actions">`
        +   `<button type="button" id="csvToggleAll">${allOn ? "전체취소" : "전체선택"}</button>`
        +   `<button type="button" id="csvDownloadSelected" class="csv-dl csv-dl-secondary" ${rowCount ? "" : "disabled"}>선택 행 다운로드</button>`
        +   `<button type="button" id="csvDownload" class="csv-dl">${sel.size}개 컬럼 전체 다운로드</button>`
        + `</div>`;
  csvPanel.innerHTML = html;

  csvPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) sel.add(cb.dataset.col); else sel.delete(cb.dataset.col);
      renderCsvPanel();
    });
  });
  wireCsvPresets();
  document.getElementById("csvToggleAll").addEventListener("click", () => {
    if (sel.size === all.length) sel.clear();          // 전체취소
    else all.forEach(c => sel.add(c));                 // 전체선택
    renderCsvPanel();
  });
  document.getElementById("csvClearRows").addEventListener("click", () => {
    if (!selectedRowsByTable[currentTable]) return;
    selectedRowsByTable[currentTable].clear();
    renderCsvPanel();
    if (lastRender && lastRender.table === currentTable) {
      renderTable(lastRender.data, lastRender.count, lastRender.from);
    }
  });
  document.getElementById("csvDownloadSelected").addEventListener("click", () => {
    if (sel.size === 0) { alert("내보낼 컬럼을 하나 이상 선택하세요."); return; }
    if (!selectedRowCount(currentTable)) { alert("선택한 행이 없습니다."); return; }
    csvPanel.classList.remove("open");
    downloadCsv({ selectedOnly: true });
  });
  document.getElementById("csvDownload").addEventListener("click", () => {
    if (sel.size === 0) { alert("내보낼 컬럼을 하나 이상 선택하세요."); return; }
    csvPanel.classList.remove("open");
    downloadCsv();
  });
}

// CSV 컬럼 프리셋: 자주 쓰는 컬럼 조합을 저장해 두고 바로 적용
function wireCsvPresets() {
  const sel = document.getElementById("csvPresetSel");
  if (!sel) return;
  const table = currentTable;

  if (csvPanel._selTable !== table) {
    csvPanel._selTable = table;
    csvPanel._selValue = null;
    csvPanel._presets = [];
  }
  sel.addEventListener("change", () => { csvPanel._selValue = sel.value; });

  const paint = () => {
    const data = csvPanel._presets || [];
    sel.innerHTML = data.length
      ? data.map(p => {
          const n = (p.config && Array.isArray(p.config.cols)) ? p.config.cols.length : 0;
          return `<option value="${p.id}">${escapeHtml(p.name)} (${n}개)</option>`;
        }).join("")
      : `<option value="">저장된 프리셋 없음</option>`;
    const want = csvPanel._selValue ?? getActivePresetId("csv", table);
    if (want != null && [...sel.options].some(o => o.value === String(want))) sel.value = String(want);
    csvPanel._selValue = sel.value;
  };

  if ((csvPanel._presets || []).length) paint();

  (async () => {
    try {
      const data = await fetchPresets("csv", table);
      if (table !== currentTable || !sel.isConnected) return;
      csvPanel._presets = data;
      paint();
    } catch (e) {
      if (!(csvPanel._presets || []).length) sel.innerHTML = `<option value="">불러오기 실패</option>`;
    }
  })();

  // 적용: 저장된 컬럼만 체크 (지금 없는 컬럼은 건너뜀)
  document.getElementById("csvPresetLoad").addEventListener("click", () => {
    const p = (csvPanel._presets || []).find(x => String(x.id) === String(sel.value));
    if (!p) { alert("적용할 프리셋을 선택하세요."); return; }
    const cols = (p.config && Array.isArray(p.config.cols)) ? p.config.cols : [];
    const all = csvAllCols();
    const hit = cols.filter(c => all.includes(c));
    const miss = cols.filter(c => !all.includes(c));
    csvSelectedByTable[currentTable] = new Set(hit);
    setActivePresetId("csv", currentTable, p.id);
    csvPanel._selValue = String(p.id);
    renderCsvPanel();
    if (miss.length) alert(`"${p.name}" 적용됨.\n지금 없는 컬럼은 건너뛰었습니다: ${miss.join(", ")}`);
  });

  // 삭제
  document.getElementById("csvPresetDel").addEventListener("click", async () => {
    const p = (csvPanel._presets || []).find(x => String(x.id) === String(sel.value));
    if (!p) { alert("삭제할 프리셋을 선택하세요."); return; }
    if (!confirm(`다운로드 프리셋 "${p.name}" 을(를) 삭제할까요? (모든 사용자에게서 사라집니다)`)) return;
    const { error } = await client.from(PRESET_TABLE).delete().eq("id", p.id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    if (getActivePresetId("csv", currentTable) === String(p.id)) setActivePresetId("csv", currentTable, null);
    if (csvPanel._selValue === String(p.id)) csvPanel._selValue = null;
    csvPanel._presets = (csvPanel._presets || []).filter(x => x.id !== p.id);
    renderCsvPanel();
  });

  // 현재 선택 저장. 컬럼 순서도 화면 순서대로 보존한다.
  document.getElementById("csvPresetSave").addEventListener("click", async () => {
    const nameEl = document.getElementById("csvPresetName");
    const name = nameEl.value.trim();
    if (!name) { alert("프리셋 이름을 입력하세요 (예: 다운로드1)."); return; }
    const chosen = csvSelectedByTable[currentTable] || new Set();
    if (!chosen.size) { alert("컬럼을 하나 이상 선택한 뒤 저장하세요."); return; }
    const cols = csvAllCols().filter(c => chosen.has(c));
    const id = await savePresetAs("csv", currentTable, name, { cols });
    if (id == null) return;
    nameEl.value = "";
    setActivePresetId("csv", currentTable, id);
    csvPanel._selValue = String(id);
    csvPanel._presets = await fetchPresets("csv", currentTable);
    renderCsvPanel();
    alert(`다운로드 프리셋 "${name}" 저장 완료 (${cols.length}개 컬럼, 모든 사용자 공유).`);
  });
}

downloadBtn.addEventListener("click", e => {
  e.stopPropagation();
  const wasOpen = csvPanel.classList.contains("open");
  closeToolbarPanels();
  if (wasOpen) return;
  renderCsvPanel();
  csvPanel.classList.add("open");
});
csvPanel.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => csvPanel.classList.remove("open"));

// 상단 탭(원본데이터 / 조회 / 도구) 전환
const subnavByView = { raw: document.getElementById("subnav-raw"), lookup: document.getElementById("subnav-lookup") };
const barcodeView = document.getElementById("barcodeView");
const imageNameChangeView = document.getElementById("imageNameChangeView");
const imageDownloadView = document.getElementById("imageDownloadView");
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    if (tab.classList.contains("active")) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    Object.entries(subnavByView).forEach(([view, el]) => { el.style.display = view === tab.dataset.view ? "flex" : "none"; });
    const isToolView = ["barcode", "image-name-change", "image-download"].includes(tab.dataset.view);
    barcodeView.style.display = tab.dataset.view === "barcode" ? "block" : "none";
    imageNameChangeView.style.display = tab.dataset.view === "image-name-change" ? "block" : "none";
    imageDownloadView.style.display = tab.dataset.view === "image-download" ? "block" : "none";
    document.querySelectorAll(".table-card").forEach(i => i.classList.remove("active"));
    currentTable = null;
    toolbar.style.display = "none";
    tableWrap.style.display = "none";
    status.style.display = isToolView ? "none" : "block";
    if (!isToolView) status.textContent = "테이블을 선택하면 데이터가 여기에 표시됩니다.";
  });
});

document.querySelectorAll(".table-card").forEach(el => {
  el.addEventListener("click", e => {
    if (e.target.classList.contains("refresh-btn")) return;  // 새로고침 버튼은 별도 처리
    document.querySelectorAll(".table-card").forEach(i => i.classList.remove("active"));
    el.classList.add("active");
    loadTable(el.dataset.table);
  });
});

// ===== 다크/라이트 테마 =====
const THEME_KEY = "socpTheme";
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const icon = themeToggle && themeToggle.querySelector(".material-icons-round");
  if (icon) icon.textContent = theme === "dark" ? "light_mode" : "dark_mode";
  themeToggle && themeToggle.setAttribute("title", theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
}

let savedTheme = localStorage.getItem(THEME_KEY);
if (!savedTheme) {
  savedTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
applyTheme(savedTheme);

themeToggle && themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// 새로고침 버튼: 해당 테이블 캐시 삭제 후 다시 불러오기
document.querySelectorAll(".refresh-btn").forEach(btn => {
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const item = btn.closest(".table-card");
    const name = item.dataset.table;
    delete cache[name];                // 캐시 비우기
    delete fullData[name];             // 클라이언트 페이징 전체 데이터도 비우기
    delete countCache[name];           // count 캐시 비우기
    delete tableState[name];           // 상태 초기화 → restoreState가 기본값 적용
    delete selectedRowsByTable[name];  // 행 선택 스냅샷도 초기화
    // 선택 안 된 테이블이면 탭 전환도 함께
    if (currentTable !== name) {
      document.querySelectorAll(".table-card").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      currentTable = name;
      toolbar.style.display = "flex";
    }
    restoreState(name);                // 기본 정렬(DEFAULT_SORT) 포함해 초기 상태로
    loadPage();
  });
});
