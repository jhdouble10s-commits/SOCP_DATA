-- Supabase SQL Editor에서 한 번 실행합니다.
-- 원본: @DN_SOCP_orderHistory (변경하지 않음)
-- 결과: orderAnalysis (실제 테이블), V_socpOrder / sku_barcode_product_view (조회용 뷰)
-- 이후 @DN_SOCP_orderHistory 배치가 끝날 때 SELECT public.refresh_order_analysis()를 실행하면
-- 이 테이블과 두 조회 뷰가 최신 데이터로 갱신됩니다.

begin;
set local statement_timeout = '5min';

-- orderAnalysis를 참조하는 조회 뷰만 잠시 제거합니다. 원본 테이블은 삭제하지 않습니다.
drop view if exists public.sku_barcode_product_view;
drop table if exists public."orderAnalysis";

create table public."orderAnalysis" (
  "SKU ID" bigint primary key,
  "바코드" text,
  "상품명" text,
  total_order_qty numeric,
  last_order_date timestamp without time zone,
  last_purchase_price bigint,
  "2023_Q2" numeric,
  "2023_Q3" numeric,
  "2023_Q4" numeric,
  "2024_Q1" numeric,
  "2024_Q2" numeric,
  "2024_Q3" numeric,
  "2024_Q4" numeric,
  "2025_Q1" numeric,
  "2025_Q2" numeric,
  "2025_Q3" numeric,
  "2025_Q4" numeric,
  "2026_Q1" numeric,
  "2026_Q2" numeric,
  "2026_Q3" numeric,
  "2023_Anual" numeric,
  "2024_Anual" numeric,
  "2025_Anual" numeric,
  "2026_Anual" numeric
);

-- 원본 발주 이력 전체를 한 번만 읽어 집계 테이블을 교체합니다.
-- 일반 웹 브라우저에는 실행 권한을 주지 않고, Supabase SQL Editor와 로컬 배치에서만 실행합니다.
create or replace function public.refresh_order_analysis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_rows integer;
begin
  truncate table public."orderAnalysis";

  insert into public."orderAnalysis" (
    "SKU ID", "바코드", "상품명",
    total_order_qty, last_order_date, last_purchase_price,
    "2023_Q2", "2023_Q3", "2023_Q4",
    "2024_Q1", "2024_Q2", "2024_Q3", "2024_Q4",
    "2025_Q1", "2025_Q2", "2025_Q3", "2025_Q4",
    "2026_Q1", "2026_Q2", "2026_Q3",
    "2023_Anual", "2024_Anual", "2025_Anual", "2026_Anual"
  )
  select
    h."SKU ID",
    max(s."바코드") as "바코드",
    max(s."상품명") as "상품명",
    sum(h."발주수량") filter (
      where h."발주일" >= date '2023-05-01'
        and h."발주일" < current_date + 1
    ) as total_order_qty,
    max(h."발주일") as last_order_date,
    (array_agg(h."매입가" order by h."발주일" desc))[1] as last_purchase_price,
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
    sum(h."발주수량") filter (where h."발주일" >= date '2026-07-01' and h."발주일" < date '2026-10-01') as "2026_Q3",
    sum(h."발주수량") filter (where h."발주일" >= date '2023-01-01' and h."발주일" < date '2024-01-01') as "2023_Anual",
    sum(h."발주수량") filter (where h."발주일" >= date '2024-01-01' and h."발주일" < date '2025-01-01') as "2024_Anual",
    sum(h."발주수량") filter (where h."발주일" >= date '2025-01-01' and h."발주일" < date '2026-01-01') as "2025_Anual",
    sum(h."발주수량") filter (where h."발주일" >= date '2026-01-01' and h."발주일" < current_date + 1) as "2026_Anual"
  from public."@DN_SOCP_orderHistory" h
  left join public."@DN_상품 공급상태 관리" s
    on s."SKU ID" = h."SKU ID"
  where h."SKU ID" is not null
    and h."발주일" >= date '2023-05-01'
  group by h."SKU ID";

  get diagnostics refreshed_rows = row_count;
  return jsonb_build_object('rows', refreshed_rows, 'refreshed_at', now());
end;
$$;

revoke all on function public.refresh_order_analysis() from public, anon, authenticated;
select public.refresh_order_analysis();

-- skuList가 사용하는 열만 제공하는 가벼운 조회 뷰입니다.
create or replace view public."V_socpOrder" as
select
  "SKU ID",
  total_order_qty,
  last_order_date,
  last_purchase_price
from public."orderAnalysis";

alter view public."V_socpOrder" set (security_invoker = true);

-- 상품 공급상태 관리에 있는 SKU를 기준으로, 바코드·상품명과 집계 데이터를 함께 보여 줍니다.
create view public.sku_barcode_product_view as
select
  s."SKU ID",
  s."바코드",
  s."상품명",
  a."2023_Q2", a."2023_Q3", a."2023_Q4",
  a."2024_Q1", a."2024_Q2", a."2024_Q3", a."2024_Q4",
  a."2025_Q1", a."2025_Q2", a."2025_Q3", a."2025_Q4",
  a."2026_Q1", a."2026_Q2", a."2026_Q3",
  a."2023_Anual", a."2024_Anual", a."2025_Anual", a."2026_Anual"
from public."@DN_상품 공급상태 관리" s
left join public."orderAnalysis" a
  on a."SKU ID" = s."SKU ID";

grant select on public."orderAnalysis", public."V_socpOrder", public.sku_barcode_product_view
  to anon, authenticated;

commit;
