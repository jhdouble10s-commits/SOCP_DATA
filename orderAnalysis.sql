-- Supabase SQL Editor에서 한 번 실행합니다.
-- 이 스크립트는 기존 orderAnalysis 테이블과 skuList, orderStatus View를 삭제하지 않습니다.
-- 원본 @DN_SOCP_orderHistory는 변경하지 않습니다.

begin;
set local statement_timeout = '5min';

-- 미래 분기를 미리 준비합니다. 이미 열이 있으면 아무 작업도 하지 않습니다.
alter table public."orderAnalysis"
  add column if not exists "2026_Q4" numeric,
  add column if not exists "2027_Q1" numeric,
  add column if not exists "2027_Anual" numeric;

-- 발주 원본을 한 번만 집계해 orderAnalysis를 최신 상태로 만듭니다.
-- 이후 발주 이력 배치가 끝날 때 아래 함수만 호출하면 됩니다.
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
    "2026_Q1", "2026_Q2", "2026_Q3", "2026_Q4", "2027_Q1",
    "2023_Anual", "2024_Anual", "2025_Anual", "2026_Anual", "2027_Anual"
  )
  with supply as (
    -- 공급상태 테이블에 동일 SKU가 여러 번 있어도 발주수량이 중복 합산되지 않게 SKU별로 정리합니다.
    select
      "SKU ID",
      max("바코드") as "바코드",
      max("상품명") as "상품명"
    from public."@DN_상품 공급상태 관리"
    group by "SKU ID"
  ),
  history_agg as (
    select
      h."SKU ID",
      coalesce(sum(h."발주수량") filter (
        where h."발주일" >= date '2023-05-01'
          and h."발주일" < current_date + 1
      ), 0) as total_order_qty,
      max(h."발주일") as last_order_date,
      (array_agg(h."매입가" order by h."발주일" desc))[1] as last_purchase_price,
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2023-05-01' and h."발주일" < date '2023-07-01'), 0) as "2023_Q2",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2023-07-01' and h."발주일" < date '2023-10-01'), 0) as "2023_Q3",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2023-10-01' and h."발주일" < date '2024-01-01'), 0) as "2023_Q4",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2024-01-01' and h."발주일" < date '2024-04-01'), 0) as "2024_Q1",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2024-04-01' and h."발주일" < date '2024-07-01'), 0) as "2024_Q2",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2024-07-01' and h."발주일" < date '2024-10-01'), 0) as "2024_Q3",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2024-10-01' and h."발주일" < date '2025-01-01'), 0) as "2024_Q4",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2025-01-01' and h."발주일" < date '2025-04-01'), 0) as "2025_Q1",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2025-04-01' and h."발주일" < date '2025-07-01'), 0) as "2025_Q2",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2025-07-01' and h."발주일" < date '2025-10-01'), 0) as "2025_Q3",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2025-10-01' and h."발주일" < date '2026-01-01'), 0) as "2025_Q4",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2026-01-01' and h."발주일" < date '2026-04-01'), 0) as "2026_Q1",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2026-04-01' and h."발주일" < date '2026-07-01'), 0) as "2026_Q2",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2026-07-01' and h."발주일" < date '2026-10-01'), 0) as "2026_Q3",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2026-10-01' and h."발주일" < date '2027-01-01'), 0) as "2026_Q4",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2027-01-01' and h."발주일" < date '2027-04-01'), 0) as "2027_Q1",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2023-01-01' and h."발주일" < date '2024-01-01'), 0) as "2023_Anual",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2024-01-01' and h."발주일" < date '2025-01-01'), 0) as "2024_Anual",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2025-01-01' and h."발주일" < date '2026-01-01'), 0) as "2025_Anual",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2026-01-01' and h."발주일" < current_date + 1), 0) as "2026_Anual",
      coalesce(sum(h."발주수량") filter (where h."발주일" >= date '2027-01-01' and h."발주일" < current_date + 1), 0) as "2027_Anual"
    from public."@DN_SOCP_orderHistory" h
    where h."SKU ID" is not null
      and h."발주일" >= date '2023-05-01'
    group by h."SKU ID"
  )
  select
    h."SKU ID", s."바코드", s."상품명",
    h.total_order_qty, h.last_order_date, h.last_purchase_price,
    h."2023_Q2", h."2023_Q3", h."2023_Q4",
    h."2024_Q1", h."2024_Q2", h."2024_Q3", h."2024_Q4",
    h."2025_Q1", h."2025_Q2", h."2025_Q3", h."2025_Q4",
    h."2026_Q1", h."2026_Q2", h."2026_Q3", h."2026_Q4", h."2027_Q1",
    h."2023_Anual", h."2024_Anual", h."2025_Anual", h."2026_Anual", h."2027_Anual"
  from history_agg h
  left join supply s on s."SKU ID" = h."SKU ID";

  get diagnostics refreshed_rows = row_count;
  return jsonb_build_object('rows', refreshed_rows, 'refreshed_at', now());
end;
$$;

-- 웹 브라우저에는 집계 테이블을 비우고 재생성하는 권한을 주지 않습니다.
revoke all on function public.refresh_order_analysis() from public, anon, authenticated;

-- 지금 즉시 한 번 집계합니다.
select public.refresh_order_analysis();

commit;

-- 이후 원본 발주이력이 갱신될 때마다 SQL Editor 또는 로컬 배치에서 이 한 줄만 실행합니다.
-- select public.refresh_order_analysis();
