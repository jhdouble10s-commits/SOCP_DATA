-- orderAnalysis를 원본 발주 이력에 자동 반영되는 뷰로 전환합니다.
-- 현재 orderAnalysis가 실제 테이블인 상태에서 Supabase SQL Editor로 실행하는 스크립트입니다.
begin;

drop view public.sku_barcode_product_view;
drop table public."orderAnalysis";

create view public."orderAnalysis" as
select
  h."SKU ID",
  s."바코드",
  s."상품명",
  sum(h."발주수량") filter (where h."발주일" >= date '2023-05-01' and h."발주일" < date '2023-07-01') as "2023_Q2",
  sum(h."발주수량") filter (where h."발주일" >= date '2023-07-01' and h."발주일" < date '2023-10-01') as "2023_Q3",
  sum(h."발주수량") filter (where h."발주일" >= date '2023-10-01' and h."발주일" < date '2024-01-01') as "2023_Q4",
  sum(h."발주수량") filter (where h."발주일" >= date '2024-01-01' and h."발주일" < date '2024-04-01') as "2024_Q1",
  sum(h."발주수량") filter (where h."발주일" >= date '2024-04-01' and h."발주일" < date '2024-07-01') as "2024_Q2",
  sum(h."발주수량") filter (where h."발주일" >= date '2024-07-01' and h."발주일" < date '2024-10-01') as "2024_Q3",
  sum(h."발주수량") filter (where h."발주일" >= date '2024-10-01' and h."발주일" < date '2025-01-01') as "2024_Q4",
  sum(h."발주수량") filter (where h."발주일" >= date '2025-01-01' and h."발주일" < date '2025-04-01') as "2025_Q1",
  sum(h."발주수량") filter (where h."발주일" >= date '2025-04-01' and h."발주일" < date '2025-07-01') as "2025_Q2",
  sum(h."발주수량") filter (where h."발주일" >= date '2025-07-01' and h."발주일" < date '2025-10-01') as "2025_Q3",
  sum(h."발주수량") filter (where h."발주일" >= date '2025-10-01' and h."발주일" < date '2026-01-01') as "2025_Q4",
  sum(h."발주수량") filter (where h."발주일" >= date '2026-01-01' and h."발주일" < date '2026-04-01') as "2026_Q1",
  sum(h."발주수량") filter (where h."발주일" >= date '2026-04-01' and h."발주일" < date '2026-07-01') as "2026_Q2",
  sum(h."발주수량") filter (where h."발주일" >= date '2026-07-01' and h."발주일" < date '2026-09-01') as "2026_Q3",
  sum(h."발주수량") filter (where h."발주일" >= date '2023-01-01' and h."발주일" < date '2024-01-01') as "2023_Anual",
  sum(h."발주수량") filter (where h."발주일" >= date '2024-01-01' and h."발주일" < date '2025-01-01') as "2024_Anual",
  sum(h."발주수량") filter (where h."발주일" >= date '2025-01-01' and h."발주일" < date '2026-01-01') as "2025_Anual",
  sum(h."발주수량") filter (where h."발주일" >= date '2026-01-01' and h."발주일" < date '2026-09-01') as "2026_Anual"
from public."@DN_SOCP_orderHistory" h
left join public."@DN_상품 공급상태 관리" s
  on s."SKU ID" = h."SKU ID"
where h."발주일" >= date '2023-05-01'
  and h."발주일" < date '2026-09-30'
group by h."SKU ID", s."바코드", s."상품명";

-- sku_barcode_product_view는 orderAnalysis의 바코드·상품명을 그대로 사용합니다.
create view public.sku_barcode_product_view as
select *
from public."orderAnalysis";

grant select on public."orderAnalysis", public.sku_barcode_product_view to anon, authenticated;

commit;
