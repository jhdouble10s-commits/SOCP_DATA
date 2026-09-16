(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const state = { rows: [], zipBlob: null, failures: [], running: false };
  const extFromType = type => ({"image/jpeg":"jpg","image/jpg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/bmp":"bmp","image/tiff":"tiff","image/svg+xml":"svg","image/avif":"avif"}[type] || "");
  function syncTheme() { document.documentElement.setAttribute("data-theme", localStorage.getItem("socpTheme") || "light"); }
  syncTheme(); window.addEventListener("storage", syncTheme);
  function barcode(value) { return String(value ?? "").trim().replace(/^'/, ""); }
  function render() {
    const targets = state.rows.filter(r => r.valid);
    $("totalCount").textContent = state.rows.length;
    $("targetCount").textContent = targets.length;
    $("excludedCount").textContent = state.rows.length - targets.length;
    const duplicateCount = new Set(targets.filter(r => r.duplicate).map(r => r.barcode)).size;
    $("duplicateBox").hidden = !duplicateCount; $("duplicateCount").textContent = duplicateCount;
    $("duplicateNote").hidden = !duplicateCount;
    $("duplicateNote").textContent = duplicateCount ? `중복 바코드 ${duplicateCount}개가 있습니다. 다운로드 시 _2, _3 번호를 붙여 모두 저장합니다.` : "";
    $("previewRows").innerHTML = state.rows.slice(0, 100).map(r => `<tr><td>${esc(r.barcode || "-")}</td><td title="${esc(r.url)}">${esc(r.url || "-")}</td><td class="status-${r.status}">${esc(r.message)}</td></tr>`).join("") || '<tr><td colspan="3">읽을 데이터가 없습니다.</td></tr>';
    $("startBtn").disabled = !targets.length || state.running;
    $("resetBtn").disabled = !state.rows.length || state.running;
    $("failedBtn").disabled = !state.failures.length;
  }
  function parseFile(file) {
    if (!window.XLSX) return alert("엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    const reader = new FileReader();
    reader.onload = event => { try {
      const workbook = XLSX.read(event.target.result, { type: "array", cellText: true, cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const seen = new Set();
      state.rows = raw.slice(1).map((line, index) => {
        const code = barcode(line[0]), url = String(line[1] ?? "").trim();
        const valid = Boolean(code && url);
        const duplicate = valid && seen.has(code); if (valid) seen.add(code);
        return { sourceRow: index + 2, barcode: code, url, valid, duplicate, status: valid ? "wait" : "fail", message: valid ? "대기" : "제외 (바코드 또는 URL 없음)" };
      }).filter((r, index, list) => r.valid || r.barcode || r.url);
      state.zipBlob = null; state.failures = []; $("previewCard").hidden = false; $("progressCard").hidden = true; render();
    } catch (_) { alert("파일을 읽지 못했습니다. .xlsx, .xls 또는 .csv 형식을 확인해 주세요."); } };
    reader.readAsArrayBuffer(file);
  }
  function setDrop() { ["dragenter","dragover"].forEach(type => $("dropZone").addEventListener(type, e => { e.preventDefault(); $("dropZone").classList.add("drag"); })); ["dragleave","drop"].forEach(type => $("dropZone").addEventListener(type, e => { e.preventDefault(); $("dropZone").classList.remove("drag"); })); $("dropZone").addEventListener("drop", e => e.dataTransfer.files[0] && parseFile(e.dataTransfer.files[0])); }
  function fileExt(url, type) { const fromType = extFromType(type); if (fromType) return fromType; try { const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/); if (match) return match[1].toLowerCase(); } catch (_) {} return "jpg"; }
  async function fetchImage(row) {
    const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(row.url)}`);
    if (!response.ok) { let info; try { info = await response.json(); } catch (_) {} throw new Error(info?.error || `HTTP ${response.status}`); }
    const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    return { blob: await response.blob(), extension: fileExt(row.url, type) };
  }
  async function run() {
    if (!window.JSZip) return alert("ZIP 생성 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    state.running = true; state.zipBlob = null; state.failures = [];
    const targets = state.rows.filter(r => r.valid); const zip = new JSZip(); let done = 0; let cursor = 0; const names = new Map();
    $("progressCard").hidden = false; $("resultBox").hidden = true; $("zipBtn").disabled = true; render();
    const update = () => { $("progressCount").textContent = `${done} / ${targets.length}`; $("progressBar").style.width = `${targets.length ? done / targets.length * 100 : 0}%`; };
    const worker = async () => { while (cursor < targets.length) { const row = targets[cursor++]; row.status = "work"; row.message = "다운로드 중"; $("currentBarcode").textContent = row.barcode; render(); try { const image = await fetchImage(row); const base = `${row.barcode}.${image.extension}`; const count = (names.get(base) || 0) + 1; names.set(base, count); const name = count === 1 ? base : `${row.barcode}_${count}.${image.extension}`; zip.file(name, image.blob); row.status = "ok"; row.message = `성공 (${name})`; } catch (error) { row.status = "fail"; row.message = `실패: ${error.message}`; state.failures.push({ barcode: row.barcode, url: row.url, reason: error.message }); } finally { done++; update(); render(); } } };
    await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
    $("progressText").textContent = "ZIP 파일 생성 중"; $("currentBarcode").textContent = "-";
    const failedCsv = ["barcode,image_url,reason", ...state.failures.map(x => [x.barcode,x.url,x.reason].map(v => `"${String(v).replace(/"/g,'""')}"`).join(","))].join("\r\n");
    zip.file("failed_list.csv", "\uFEFF" + failedCsv);
    state.zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    state.running = false; $("progressText").textContent = "완료"; $("zipBtn").disabled = false;
    $("resultBox").hidden = false; $("resultBox").innerHTML = `<strong>완료: 성공 ${targets.length - state.failures.length}건 / 실패 ${state.failures.length}건</strong>${state.failures.length ? `<ul>${state.failures.map(x => `<li>${esc(x.barcode)} — ${esc(x.reason)}</li>`).join("")}</ul>` : ""}`; render(); downloadZip();
  }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function zipName() { const d = new Date(), p = n => String(n).padStart(2,"0"); return `product_images_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`; }
  function downloadZip() { if (state.zipBlob) download(state.zipBlob, zipName()); }
  $("fileInput").addEventListener("change", e => { if (e.target.files[0]) parseFile(e.target.files[0]); e.target.value = ""; }); setDrop();
  $("startBtn").addEventListener("click", run); $("zipBtn").addEventListener("click", downloadZip);
  $("failedBtn").addEventListener("click", () => { const body = ["barcode,image_url,reason", ...state.failures.map(x => [x.barcode,x.url,x.reason].map(v => `"${String(v).replace(/"/g,'""')}"`).join(","))].join("\r\n"); download(new Blob(["\uFEFF" + body], {type:"text/csv;charset=utf-8"}), "failed_list.csv"); });
  $("resetBtn").addEventListener("click", () => { state.rows=[]; state.zipBlob=null; state.failures=[]; $("previewCard").hidden=true; $("progressCard").hidden=true; render(); });
})();
