/* Shared by the browser and Node regression tests. No source formulas are executed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Order1688 = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const HEADERS = ["订单编号", "买家公司名", "买家会员名", "卖家公司名", "卖家会员名", "货品总价(元)", "运费(元)", "涨价或折扣(元)", "实付款(元)", "订单状态", "订单创建时间", "订单付款时间", "发货方", "收货人姓名", "收货地址", "邮编", "联系电话", "联系手机", "货品标题", "单价(元)", "数量", "单位", "货号", "型号", "Offer ID", "SKU ID", "买家留言", "下游订单号"];
  const MESSAGE = "你好，麻烦你给一下价格好么？改完之后给我回复一下，谢谢";
  const CHAT_BASE = "https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html?touid=cnalichn";
  const blank = value => value == null || String(value).trim() === "";
  function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value !== "string" || !/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) return NaN;
    return Number(value.trim().replace(/,/g, ""));
  }
  function processRows(matrix) {
    if (!matrix.length) throw new Error("시트가 비어 있습니다.");
    const headers = matrix[0].map(value => String(value ?? "").trim());
    const missing = HEADERS.filter(name => !headers.includes(name));
    if (missing.length) throw new Error(`필수 컬럼이 없습니다: ${missing.join(", ")}. 1688 원본 주문 파일을 선택해 주세요.`);
    if (HEADERS.some(name => headers.indexOf(name) !== headers.lastIndexOf(name))) throw new Error("같은 이름의 컬럼이 중복되어 있습니다.");
    const indexes = HEADERS.map(name => headers.indexOf(name));
    const stats = { input: 0, noDownstream: 0, step1: 0, shipping: 0, step2: 0, ratio: 0, final: 0, memo: 0, noMemo: 0, duplicateSellers: 0 };
    const included = [], excluded = [], downstream = [], errors = [];
    matrix.slice(1).forEach((line, index) => {
      if (line.every(blank)) return;
      stats.input++;
      const values = indexes.map(i => line[i] ?? "");
      const sourceRow = index + 2;
      const row = { values, sourceRow, order: String(values[0]), seller: String(values[4]), memo: !blank(values[26]) };
      const exclude = (reason, counter) => { stats[counter]++; excluded.push({ ...row, reason }); };
      // Intentionally do not fill merged cells: filter the actual cells, as in the sample.
      if (blank(values[27])) { exclude("1단계 · 下游订单号 없음", "noDownstream"); return; }
      stats.step1++;
      const sourceValues = indexes.map(i => (matrix.rawRows?.[index + 1] || line)[i] ?? "");
      for (const col of [0, 24, 25, 27]) {
        if (typeof values[col] === "number" && !Number.isSafeInteger(values[col])) errors.push(`${sourceRow}행: ${HEADERS[col]}가 큰 숫자로 저장되어 있습니다. 원본에서 텍스트로 저장한 파일이 필요합니다.`);
        sourceValues[col] = blank(sourceValues[col]) ? "" : String(sourceValues[col]);
      }
      downstream.push([...sourceValues.slice(0, 26), sourceValues[27]]);
      const shipping = number(values[6]);
      if (!Number.isFinite(shipping) || shipping < 0) { errors.push(`${sourceRow}행: 배송비가 유효한 0 이상의 숫자가 아닙니다.`); return; }
      if (!row.memo && shipping <= 15) { exclude("2단계 · 메모 없음, 배송비 ≤ 15", "shipping"); return; }
      stats.step2++;
      const paid = number(values[8]);
      if (!Number.isFinite(paid) || paid <= 0) { errors.push(`${sourceRow}행: 실결제액이 유효한 0 초과 숫자가 아닙니다.`); return; }
      // Compare amounts, without display rounding. Equality at 10% is retained.
      const tolerance = Number.EPSILON * Math.max(shipping * 10, paid) * 4;
      if (!row.memo && shipping * 10 < paid - tolerance) { exclude("3단계 · 메모 없음, 배송비 비율 < 10%", "ratio"); return; }
      if (blank(values[0])) { errors.push(`${sourceRow}행: 주문번호가 없습니다.`); return; }
      for (const col of [0, 24, 25, 27]) {
        values[col] = blank(values[col]) ? "" : String(values[col]);
      }
      values[6] = shipping; values[8] = paid;
      row.shipping = shipping; row.paid = paid; row.ratio = shipping / paid;
      row.chatUrl = blank(row.seller) ? "" : CHAT_BASE + encodeURIComponent(row.seller);
      row.message = row.order + MESSAGE;
      included.push(row);
    });
    if (errors.length) throw new Error(`확인이 필요한 데이터 ${errors.length}건이 있습니다.\n${errors.slice(0, 8).join("\n")}${errors.length > 8 ? "\n… 나머지 오류도 원본에서 확인해 주세요." : ""}`);
    const counts = new Map();
    included.forEach(row => { if (!blank(row.seller)) counts.set(row.seller, (counts.get(row.seller) || 0) + 1); });
    included.forEach(row => { row.duplicate = (counts.get(row.seller) || 0) > 1; });
    included.sort((a, b) => Number(b.duplicate) - Number(a.duplicate) || (a.seller < b.seller ? -1 : a.seller > b.seller ? 1 : a.sourceRow - b.sourceRow));
    stats.final = included.length;
    stats.memo = included.filter(row => row.memo).length;
    stats.noMemo = stats.final - stats.memo;
    stats.duplicateSellers = [...counts.values()].filter(count => count > 1).length;
    return { included, excluded, downstream, stats };
  }
  function readSheet(sheet, XLSX) {
    if (!sheet || !sheet["!ref"]) throw new Error("시트가 비어 있습니다.");
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r > 100000 || range.e.c > 200) throw new Error("최대 100,000행, 200열까지 처리할 수 있습니다. 원본의 불필요한 빈 영역을 제거해 주세요.");
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true, range: { s: { r: 0, c: 0 }, e: range.e } });
    matrix.rawRows = matrix.map(row => row.slice());
    for (const name of ["订单创建时间", "订单付款时间"]) {
      const c = (matrix[0] || []).findIndex(value => String(value).trim() === name);
      if (c < 0) continue;
      for (let r = 1; r < matrix.length; r++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === "n") matrix[r][c] = XLSX.utils.format_cell(cell);
      }
    }
    return matrix;
  }
  function createWorkbook(result, XLSX) {
    const rows = result.included.map((row, index) => {
      const values = row.values.slice();
      values[9] = row.ratio;
      values[12] = row.chatUrl;
      values[13] = ""; values[14] = row.message; values[15] = index + 1;
      values[16] = ""; values[17] = "";
      return values;
    });
    const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
    result.included.forEach((row, index) => {
      const n = index + 2;
      sheet[`J${n}`] = { t: "n", v: row.ratio, f: `G${n}/I${n}`, z: "0.0%" };
      sheet[`M${n}`] = { t: "s", v: row.chatUrl, ...(row.chatUrl ? { l: { Target: row.chatUrl } } : {}) };
      sheet[`O${n}`] = { t: "s", v: row.message, f: `A${n}&"${MESSAGE}"` };
      sheet[`P${n}`] = { t: "n", v: index + 1, ...(index ? { f: `P${n - 1}+1` } : {}) };
    });
    sheet["!autofilter"] = { ref: `A1:AB${rows.length + 1}` };
    sheet["!cols"] = HEADERS.map((_, i) => ({ wch: [0, 24, 25].includes(i) ? 23 : [3, 4, 10, 11, 12, 14, 18, 26].includes(i) ? 32 : 16 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet2");
    const secondHeaders = [...HEADERS.slice(0, 26), HEADERS[27]];
    const secondSheet = XLSX.utils.aoa_to_sheet([secondHeaders, ...result.downstream]);
    secondSheet["!autofilter"] = { ref: `A1:AA${result.downstream.length + 1}` };
    secondSheet["!cols"] = secondHeaders.map((_, i) => ({ wch: [0, 24, 25].includes(i) ? 23 : [3, 4, 10, 11, 14, 18].includes(i) ? 32 : 16 }));
    XLSX.utils.book_append_sheet(workbook, secondSheet, "Sheet3");
    return workbook;
  }
  return { HEADERS, MESSAGE, CHAT_BASE, blank, readSheet, processRows, createWorkbook };
});
