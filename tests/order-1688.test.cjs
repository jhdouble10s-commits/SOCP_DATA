const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const XLSX = require("../vendor/xlsx-0.20.3.min.js");
const core = require("../order-1688-core.js");
function row(id, overrides = {}) {
  const values = { "订单编号": id, "卖家会员名": "seller", "下游订单号": "5W0001", "运费(元)": 25, "实付款(元)": 250, ...overrides };
  return core.HEADERS.map(name => values[name] ?? "");
}
test("sequential filters keep exact 10%, exempt memos, and do not round ratios", () => {
  const result = core.processRows([core.HEADERS,
    row("no-id", { "下游订单号": " " }),
    row("15", { "运费(元)": 15, "实付款(元)": 100 }),
    row("under", { "运费(元)": 25, "实付款(元)": 250.01 }),
    row("equal"),
    row("over", { "实付款(元)": 249.99 }),
    row("memo", { "买家留言": "포장 요청", "运费(元)": 0, "实付款(元)": 100 }),
    row("whitespace", { "买家留言": " \t", "运费(元)": 15 }),
    row("comma", { "运费(元)": "200", "实付款(元)": "2,000" }),
  ]);
  assert.deepEqual(result.included.map(r => r.order), ["equal", "over", "memo", "comma"]);
  assert.equal(result.stats.step1, 7); assert.equal(result.stats.step2, 5);
  assert.equal(result.stats.ratio, 1); assert.equal(result.stats.final, 4);
  assert.equal(result.excluded.length + result.included.length, result.stats.input);
});
test("maps by headers, retains identifiers as text, groups duplicate sellers", () => {
  const rows = [row("5127266559180009348", { "卖家会员名": "b", "SKU ID": "0000123" }), row("two", { "卖家会员名": "a" }), row("three", { "卖家会员名": "b" })];
  const result = core.processRows([[...core.HEADERS].reverse(), ...rows.map(r => [...r].reverse())]);
  assert.deepEqual(result.included.map(r => r.order), ["5127266559180009348", "three", "two"]);
  assert.equal(result.included[0].values[25], "0000123");
  assert.equal(result.stats.duplicateSellers, 1);
});
test("validates missing/duplicate columns and unsafe amounts/identifiers", () => {
  assert.throws(() => core.processRows([["订单编号"]]), /필수 컬럼/);
  assert.throws(() => core.processRows([[...core.HEADERS, "订单编号"]]), /중복/);
  for (const paid of [0, "", "NaN", -1]) assert.throws(() => core.processRows([core.HEADERS, row("bad", { "实付款(元)": paid })]), /실결제액/);
  assert.throws(() => core.processRows([core.HEADERS, row(5127266559180009348)]), /텍스트/);
  assert.throws(() => core.processRows([core.HEADERS, row("bad", { "运费(元)": "1,2" })]), /배송비/);
  assert.equal(core.processRows([core.HEADERS]).stats.final, 0);
});
test("merged continuation rows are excluded, not filled with the order above", () => {
  const sheet = XLSX.utils.aoa_to_sheet([core.HEADERS, row("parent"), row("", { "下游订单号": "" })]);
  sheet["!merges"] = [{ s: { r: 1, c: 27 }, e: { r: 2, c: 27 } }];
  const result = core.processRows(core.readSheet(sheet, XLSX));
  assert.equal(result.stats.final, 1); assert.equal(result.stats.noDownstream, 1);
});
test("export round trip preserves sample layout, cached formulas and safe text", () => {
  const result = core.processRows([core.HEADERS, row("5127266559180009348", { "买家留言": "=1+1", "卖家会员名": "中文&seller", "SKU ID": "0001" }), row("second")]);
  const bytes = XLSX.write(core.createWorkbook(result, XLSX), { type: "buffer", bookType: "xlsx" });
  const wb = XLSX.read(bytes); const sheet = wb.Sheets.Sheet2;
  assert.deepEqual(wb.SheetNames, ["Sheet2", "Sheet3"]);
  assert.equal(sheet.J2.f, "G2/I2"); assert.equal(sheet.J2.v, .1);
  const n = result.included.findIndex(r => r.order === "5127266559180009348") + 2;
  assert.equal(sheet[`A${n}`].t, "s"); assert.equal(sheet[`A${n}`].v, "5127266559180009348");
  assert.equal(sheet[`Z${n}`].v, "0001"); assert.equal(sheet[`AA${n}`].t, "s"); assert.equal(sheet[`AA${n}`].f, undefined);
  assert.equal(sheet[`M${n}`].l.Target, core.CHAT_BASE + encodeURIComponent("中文&seller"));
  assert.equal(sheet[`O${n}`].v, "5127266559180009348" + core.MESSAGE);
  assert.equal(sheet["!autofilter"].ref, "A1:AB3");
});
test("provided sample: exact 102-order set and all preserved output columns", { skip: !process.env.ORDER_1688_SOURCE || !process.env.ORDER_1688_EXPECTED }, () => {
  const source = XLSX.read(fs.readFileSync(process.env.ORDER_1688_SOURCE));
  const reference = XLSX.read(fs.readFileSync(process.env.ORDER_1688_EXPECTED));
  const result = core.processRows(core.readSheet(source.Sheets[source.SheetNames[0]], XLSX));
  const expected = core.readSheet(reference.Sheets[reference.SheetNames[0]], XLSX).slice(1);
  assert.deepEqual([result.stats.step1, result.stats.step2, result.stats.final], [204, 127, 102]);
  assert.deepEqual(new Set(result.included.map(r => r.order)), new Set(expected.map(r => r[0])));
  const output = core.createWorkbook(result, XLSX);
  const actual = XLSX.utils.sheet_to_json(output.Sheets.Sheet2, { header: 1, defval: "", raw: true }).slice(1);
  for (const referenceRow of expected) {
    const found = actual.find(r => r[0] === referenceRow[0]);
    for (let c = 0; c < 28; c++) {
      if ([12, 15].includes(c)) continue; // URL encoding and stable source-order numbering are intentional.
      if (c === 9) assert.ok(Math.abs(found[c] - referenceRow[c]) < 1e-12);
      else assert.equal(found[c], referenceRow[c], `${referenceRow[0]} / ${core.HEADERS[c]}`);
    }
  }
  if (process.env.ORDER_1688_OUTPUT) fs.writeFileSync(process.env.ORDER_1688_OUTPUT, XLSX.write(output, { type: "buffer", bookType: "xlsx" }));
});

test("second sheet retains source order and original fields, even if first sheet is empty", () => {
  const input = [core.HEADERS, row("b", { "运费(元)": 5, "订单状态": "交易关闭", "收货人姓名": "원본 이름" }), row("a", { "运费(元)": 15 })];
  const result = core.processRows(input);
  assert.equal(result.included.length, 0);
  const output = core.createWorkbook(result, XLSX);
  const rows = XLSX.utils.sheet_to_json(output.Sheets.Sheet3, { header: 1, defval: "" });
  assert.equal(rows.length, 3); assert.equal(rows[0].length, 27);
  assert.equal(rows[0].includes("买家留言"), false);
  assert.deepEqual(rows.slice(1).map(r => r[0]), ["b", "a"]);
  assert.equal(rows[1][9], "交易关闭"); assert.equal(rows[1][13], "원본 이름");
  assert.throws(() => core.processRows([core.HEADERS, row(5127266559180009348, { "运费(元)": 5 })]), /텍스트/);
});
test("second sample: all 204 rows and 27 columns match in original order", { skip: !process.env.ORDER_1688_SOURCE || !process.env.ORDER_1688_SECOND }, () => {
  const source = XLSX.read(fs.readFileSync(process.env.ORDER_1688_SOURCE));
  const reference = XLSX.read(fs.readFileSync(process.env.ORDER_1688_SECOND));
  const result = core.processRows(core.readSheet(source.Sheets[source.SheetNames[0]], XLSX));
  const output = core.createWorkbook(result, XLSX);
  const bytes = XLSX.write(output, { type: "buffer", bookType: "xlsx" });
  const reread = XLSX.read(bytes);
  const actual = XLSX.utils.sheet_to_json(reread.Sheets.Sheet3, { header: 1, defval: "", raw: true });
  const expected = XLSX.utils.sheet_to_json(reference.Sheets[reference.SheetNames[0]], { header: 1, defval: "", raw: true });
  assert.equal(actual.length, 205);
  assert.deepEqual(actual, expected);
  assert.equal(reread.Sheets.Sheet3["!autofilter"].ref, "A1:AA205");
});
