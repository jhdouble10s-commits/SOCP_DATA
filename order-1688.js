(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const core = window.Order1688;
  const state = { workbook: null, result: null, file: "", view: "included", page: 0, reading: false };
  const pageSize = 50;
  const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
  function syncTheme() {
    document.documentElement.setAttribute("data-theme", localStorage.getItem("socpTheme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }
  syncTheme();
  window.addEventListener("storage", syncTheme);
  function clearResult() {
    state.result = null;
    $("results").hidden = true;
    $("downloadBtn").disabled = true;
    $("error").hidden = true;
    $("searchInput").value = "";
    state.view = "included"; state.page = 0;
    $("previewBody").replaceChildren();
  }
  function showError(error) {
    clearResult();
    $("error").textContent = error.message || "파일을 처리하지 못했습니다. 원본 엑셀 형식을 확인해 주세요.";
    $("error").hidden = false;
    $("status").textContent = "원본을 확인한 뒤 다시 선택해 주세요.";
  }
  function processSheet() {
    clearResult();
    try {
      state.result = core.processRows(core.readSheet(state.workbook.Sheets[$("sheetSelect").value], XLSX));
      const { stats } = state.result;
      for (const [id, value] of [["inputCount", stats.input], ["step1Count", stats.step1], ["step2Count", stats.step2], ["finalCount", stats.final]]) $(id).textContent = value.toLocaleString("ko-KR");
      $("step1Note").textContent = `${stats.noDownstream.toLocaleString()}행 제외`;
      $("step2Note").textContent = `${stats.shipping.toLocaleString()}행 제외`;
      $("step3Note").textContent = `${stats.ratio.toLocaleString()}행 제외`;
      $("resultNote").textContent = `메모 있음 ${stats.memo}건 · 메모 없음 ${stats.noMemo}건 · 중복 판매자 ${stats.duplicateSellers}곳`;
      $("results").hidden = false;
      $("downloadBtn").disabled = !stats.step1;
      $("status").textContent = stats.step1 ? `가공 완료 · 첫 번째 시트 ${stats.final}건 / 두 번째 시트 ${stats.step1}건을 한 파일로 다운로드합니다.` : "하위 주문번호가 있는 행이 없습니다. 제외된 행에서 사유를 확인해 주세요.";
      renderPreview();
    } catch (error) { showError(error); }
  }
  async function readFile(file) {
    if (state.reading) return;
    clearResult(); state.workbook = null; state.file = "";
    $("sheetControls").hidden = true;
    $("resetBtn").disabled = false;
    try {
      if (!window.XLSX) throw new Error("엑셀 처리 도구를 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error(".xlsx 또는 .xls 파일을 선택해 주세요.");
      if (file.size > 20 * 1024 * 1024) throw new Error("20MB 이하의 파일을 선택해 주세요.");
      state.reading = true; $("fileInput").disabled = true; $("resetBtn").disabled = true;
      $("status").textContent = "엑셀을 읽고 있습니다…";
      const buffer = await file.arrayBuffer();
      state.workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      if (!state.workbook.SheetNames.length) throw new Error("읽을 수 있는 시트가 없습니다.");
      state.file = file.name;
      $("fileName").textContent = file.name;
      $("sheetSelect").replaceChildren(...state.workbook.SheetNames.map(name => new Option(name, name)));
      $("sheetControls").hidden = false;
      processSheet();
    } catch (error) { showError(error); }
    finally { state.reading = false; $("fileInput").disabled = false; $("fileInput").value = ""; $("resetBtn").disabled = false; }
  }
  function renderPreview() {
    if (!state.result) return;
    const included = state.view === "included";
    $("includedBtn").setAttribute("aria-pressed", String(included));
    $("excludedBtn").setAttribute("aria-pressed", String(!included));
    const query = $("searchInput").value.trim().toLowerCase();
    const rows = state.result[state.view].filter(row => !query || [row.order, row.seller, row.values[27]].some(value => String(value).toLowerCase().includes(query)));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.page = Math.min(state.page, pages - 1);
    const headings = included ? ["순번", "주문번호", "판매자", "배송비 (元)", "실결제액 (元)", "배송비 비율", "구매자 메모", "하위 주문번호", "판매자 연락"] : ["원본 행", "주문번호", "판매자", "제외 사유"];
    const head = document.createElement("tr");
    headings.forEach(text => { const th = document.createElement("th"); th.textContent = text; th.scope = "col"; head.append(th); });
    $("previewHead").replaceChildren(head);
    const fragment = document.createDocumentFragment();
    rows.slice(state.page * pageSize, (state.page + 1) * pageSize).forEach(row => {
      const tr = document.createElement("tr");
      const values = included ? [state.result.included.indexOf(row) + 1, row.order, row.seller, money.format(row.shipping), money.format(row.paid), `${(row.ratio * 100).toFixed(1)}%`, row.values[26] || "—", row.values[27]] : [row.sourceRow, row.order || "—", row.seller || "—", row.reason];
      values.forEach((value, i) => {
        const td = document.createElement("td"); td.textContent = value; td.title = String(value);
        if (included && i >= 3 && i <= 5) td.className = "numeric";
        if (included && i === 2 && row.duplicate) { td.className = "duplicate"; td.title = `${row.seller} · 여러 주문이 있는 판매자`; }
        tr.append(td);
      });
      if (included) {
        const td = document.createElement("td");
        if (row.chatUrl) { const a = document.createElement("a"); a.href = row.chatUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "채팅"; a.setAttribute("aria-label", `${row.seller} 채팅 새 창 열기`); td.append(a, " "); }
        const button = document.createElement("button"); button.textContent = "문구 복사";
        button.setAttribute("aria-label", `${row.order} 요청 문구 복사`);
        button.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(row.message); button.textContent = "복사 완료"; }
          catch (_) { window.prompt("아래 문구를 복사해 주세요.", row.message); }
        });
        td.append(button); tr.append(td);
      }
      fragment.append(tr);
    });
    if (!rows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = headings.length; td.textContent = "표시할 행이 없습니다."; tr.append(td); fragment.append(tr); }
    $("previewBody").replaceChildren(fragment);
    $("pageInfo").textContent = `${rows.length.toLocaleString()}행 · ${state.page + 1} / ${pages}페이지`;
    $("prevBtn").disabled = state.page === 0; $("nextBtn").disabled = state.page >= pages - 1;
  }
  $("fileInput").addEventListener("change", event => { if (event.target.files[0]) readFile(event.target.files[0]); });
  ["dragenter", "dragover"].forEach(type => $("dropZone").addEventListener(type, event => { event.preventDefault(); $("dropZone").classList.add("drag"); }));
  ["dragleave", "drop"].forEach(type => $("dropZone").addEventListener(type, event => { event.preventDefault(); $("dropZone").classList.remove("drag"); }));
  $("dropZone").addEventListener("drop", event => { if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]); });
  $("sheetSelect").addEventListener("change", processSheet);
  $("searchInput").addEventListener("input", () => { state.page = 0; renderPreview(); });
  for (const view of ["included", "excluded"]) $(`${view}Btn`).addEventListener("click", () => { state.view = view; state.page = 0; renderPreview(); });
  $("prevBtn").addEventListener("click", () => { state.page--; renderPreview(); });
  $("nextBtn").addEventListener("click", () => { state.page++; renderPreview(); });
  $("resetBtn").addEventListener("click", () => {
    clearResult(); state.workbook = null; state.file = ""; $("sheetControls").hidden = true; $("fileInput").value = ""; $("resetBtn").disabled = true;
    $("status").textContent = "원본 주문 파일을 선택하면 자동으로 가공합니다.";
  });
  $("downloadBtn").addEventListener("click", () => {
    if (!state.result?.downstream.length) return;
    try {
      XLSX.writeFile(core.createWorkbook(state.result, XLSX), `${state.file.replace(/\.(xlsx|xls)$/i, "")}_가공.xlsx`, { compression: true });
      $("status").textContent = `첫 번째 시트 ${state.result.stats.final}건 / 두 번째 시트 ${state.result.stats.step1}건이 담긴 엑셀 다운로드를 시작했습니다.`;
    } catch (error) { $("error").textContent = `다운로드에 실패했습니다: ${error.message}`; $("error").hidden = false; }
  });
})();
