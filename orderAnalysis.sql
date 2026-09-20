-- Supabase SQL Editor에서 한 번 실행합니다.
-- 기존 orderAnalysis 테이블과 skuList, orderStatus View를 삭제하거나 다시 만들지 않습니다.
-- 원본 @DN_SOCP_orderHistory도 변경하지 않습니다.

begin;
set local statement_timeout = '5min';

-- 기존 테이블에 집계 기본 열이 없을 때만 추가합니다.
alter table public."orderAnalysis"
  add column if not exists "바코드" text,
  add column if not exists "상품명" text,
  add column if not exists total_order_qty numeric,
  add column if not exists last_order_date timestamp without time zone,
  add column if not exists last_purchase_price bigint;

-- 모든 분기·연도 열을 자동으로 인식해 갱신합니다.
-- 새해 열을 추가해도 이 함수 본문을 수정할 필요가 없습니다.
create or replace function public.refresh_order_analysis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_rows integer;
  target_column text;
begin
  -- 원본은 한 번만 읽고, SKU별 기본 집계와 분기·연도 합계를 임시 결과에 만듭니다.
  create temporary table if not exists order_analysis_refresh_source (
    "SKU ID" bigint primary key,
    "바코드" text,
    "상품명" text,
    total_order_qty numeric,
    last_order_date timestamp without time zone,
    last_purchase_price bigint,
    period_totals jsonb not null
  ) on commit delete rows;
  truncate table order_analysis_refresh_source;

  insert into order_analysis_refresh_source (
    "SKU ID", "바코드", "상품명", total_order_qty,
    last_order_date, last_purchase_price, period_totals
  )
  with history as materialized (
    select h."SKU ID", h."발주수량", h."발주일", h."매입가"
    from public."@DN_SOCP_orderHistory" h
    where h."SKU ID" is not null
      and h."발주일" >= date '2023-05-01'
      and h."발주일" < current_date + 1
  ),
  supply as (
    -- 공급상태 테이블에 같은 SKU가 여러 번 있어도 발주수량이 중복되지 않게 SKU별로 정리합니다.
    select "SKU ID", max("바코드") as "바코드", max("상품명") as "상품명"
    from public."@DN_상품 공급상태 관리"
    group by "SKU ID"
  ),
  base as (
    select
      "SKU ID",
      coalesce(sum("발주수량") filter (where "발주일" < current_date + 1), 0) as total_order_qty,
      max("발주일") as last_order_date,
      (array_agg("매입가" order by "발주일" desc))[1] as last_purchase_price
    from history
    group by "SKU ID"
  ),
  period_rows as (
    select
      "SKU ID",
      extract(year from "발주일")::integer || '_Q' || extract(quarter from "발주일")::integer as period_name,
      sum("발주수량") as qty
    from history
    group by "SKU ID", extract(year from "발주일"), extract(quarter from "발주일")

    union all

    select
      "SKU ID",
      extract(year from "발주일")::integer || '_Anual' as period_name,
      sum("발주수량") as qty
    from history
    group by "SKU ID", extract(year from "발주일")
  ),
  period_totals as (
    select "SKU ID", jsonb_object_agg(period_name, qty) as period_totals
    from period_rows
    group by "SKU ID"
  )
  select
    b."SKU ID", s."바코드", s."상품명",
    b.total_order_qty, b.last_order_date, b.last_purchase_price,
    coalesce(p.period_totals, '{}'::jsonb)
  from base b
  left join supply s on s."SKU ID" = b."SKU ID"
  left join period_totals p on p."SKU ID" = b."SKU ID";

  truncate table public."orderAnalysis";
  insert into public."orderAnalysis" (
    "SKU ID", "바코드", "상품명",
    total_order_qty, last_order_date, last_purchase_price
  )
  select
    "SKU ID", "바코드", "상품명",
    total_order_qty, last_order_date, last_purchase_price
  from order_analysis_refresh_source;

  -- 이름이 YYYY_Q1~Q4 또는 YYYY_Anual인 모든 열을 임시 집계에서 채웁니다.
  -- 예: 2028년 열을 새로 추가해도 아래 반복문이 자동으로 값을 반영합니다.
  for target_column in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orderAnalysis'
      and column_name ~ '^[0-9]{4}_(Q[1-4]|Anual)$'
    order by ordinal_position
  loop
    execute format(
      'update public."orderAnalysis" target
       set %1$I = coalesce((source.period_totals ->> %2$L)::numeric, 0)
       from order_analysis_refresh_source source
       where source."SKU ID" = target."SKU ID"',
      target_column,
      target_column
    );
  end loop;

  get diagnostics refreshed_rows = row_count;
  return jsonb_build_object('rows', refreshed_rows, 'refreshed_at', now());
end;
$$;

-- 한 해의 Q1~Q4와 연간 열을 한 번에 준비합니다.
-- 기본값은 0이며, refresh_order_analysis()가 실행될 때 실제 발주수량으로 갱신됩니다.
create or replace function public.ensure_order_analysis_year(
  p_year integer,
  p_refresh boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quarter_no integer;
  added_column text;
  refresh_result jsonb;
begin
  if p_year < 2023 or p_year > 2100 then
    raise exception '지원하지 않는 연도입니다: %', p_year;
  end if;

  for quarter_no in 1..4 loop
    added_column := p_year || '_Q' || quarter_no;
    execute format(
      'alter table public."orderAnalysis" add column if not exists %I numeric not null default 0',
      added_column
    );
  end loop;

  added_column := p_year || '_Anual';
  execute format(
    'alter table public."orderAnalysis" add column if not exists %I numeric not null default 0',
    added_column
  );

  if p_refresh then
    select public.refresh_order_analysis() into refresh_result;
  else
    refresh_result := null;
  end if;

  return jsonb_build_object('year', p_year, 'refreshed', p_refresh, 'result', refresh_result);
end;
$$;

-- 웹 브라우저에는 집계 테이블을 비우고 다시 만드는 권한을 주지 않습니다.
revoke all on function public.refresh_order_analysis() from public, anon, authenticated;
revoke all on function public.ensure_order_analysis_year(integer, boolean) from public, anon, authenticated;

-- 모든 연도를 같은 방식으로 준비하고, 마지막에 한 번만 집계합니다.
-- 2023_Q1은 발주 원본 시작일(2023-05-01) 이전 기간이므로 값이 0입니다.
select public.ensure_order_analysis_year(2023, false);
select public.ensure_order_analysis_year(2024, false);
select public.ensure_order_analysis_year(2025, false);
select public.ensure_order_analysis_year(2026, false);
select public.ensure_order_analysis_year(2027, false);
select public.refresh_order_analysis();

commit;

-- 이후 새해 열을 추가할 때는 Supabase SQL Editor에서 이 한 줄만 실행합니다.
-- 예: select public.ensure_order_analysis_year(2028);
