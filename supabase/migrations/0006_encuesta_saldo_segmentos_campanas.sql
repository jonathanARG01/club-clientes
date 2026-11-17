-- ═════════════════════════════════════════════
-- 0006: Cinco mejoras para competir mejor
--   1. Encuesta de un toque después de cada visita (😞 … 😍) y aviso privado al dueño cuando la nota es baja.
--   2. Cashback: descontar un monto libre del saldo al pagar ("usa $3.200 de tu saldo").
--   3. Segmentos a la vista: cada cliente con su estado (VIP, frecuente, nuevo, ocasional, en riesgo, dormido),
--      cuántos hay en cada grupo y cómo cambian día a día. Nuevo grupo de campaña: "En riesgo".
--   4. Campañas programadas para otro día y con resultados (cuántos volvieron después de recibirla).
--   (5. La tarjeta del cliente instalable con la marca del negocio no necesita cambios en la base.)
-- Ejecutar DESPUÉS de 0005_soporte.sql. Se puede volver a ejecutar sin romper nada.
-- ═════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Encuesta de satisfacción
-- ─────────────────────────────────────────────

alter table public.programas add column if not exists pedir_encuesta boolean not null default true;

create table if not exists public.encuestas (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios (id) on delete cascade,
  tarjeta_id    uuid not null references public.tarjetas (id) on delete cascade,
  -- La visita que se evalúa: una sola respuesta por visita.
  movimiento_id uuid unique references public.movimientos (id) on delete set null,
  sucursal_id   uuid references public.sucursales (id) on delete set null,
  nota          smallint not null check (nota between 1 and 5),
  comentario    text check (char_length(comentario) <= 300),
  leida         boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists encuestas_negocio_idx on public.encuestas (negocio_id, created_at desc);
create index if not exists encuestas_tarjeta_idx on public.encuestas (tarjeta_id, created_at desc);
alter table public.encuestas enable row level security;
revoke all on public.encuestas from anon, authenticated;
grant select on public.encuestas to authenticated;
grant update (leida) on public.encuestas to authenticated;
drop policy if exists "gestor: ver encuestas" on public.encuestas;
create policy "gestor: ver encuestas" on public.encuestas for select to authenticated using (public.es_gestor(negocio_id));
drop policy if exists "gestor: marcar encuestas" on public.encuestas;
create policy "gestor: marcar encuestas" on public.encuestas for update to authenticated
  using (public.es_gestor(negocio_id)) with check (public.es_gestor(negocio_id));

-- La visita de las últimas 24 horas que este cliente todavía no evalúa (si el negocio tiene la encuesta encendida).
create or replace function public.visita_sin_encuesta(p_tarjeta uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.movimientos m
  join public.programas p on p.negocio_id = m.negocio_id and p.pedir_encuesta
  where m.tarjeta_id = p_tarjeta and m.tipo = 'sello' and m.origen in ('qr', 'equipo', 'api')
    and m.created_at > now() - interval '24 hours'
    and not exists (select 1 from public.encuestas e where e.movimiento_id = m.id)
    -- Como mucho una encuesta cada 20 horas, aunque venga dos veces el mismo día.
    and not exists (select 1 from public.encuestas e where e.tarjeta_id = p_tarjeta and e.created_at > now() - interval '20 hours')
  order by m.created_at desc
  limit 1;
$$;
revoke all on function public.visita_sin_encuesta(uuid) from public, anon, authenticated;

-- ¿Le preguntamos cómo le fue? (la tarjeta lo consulta al abrirse o después de sumar).
create or replace function public.encuesta_pendiente(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tarjetas t
    where t.codigo = upper(trim(p_codigo)) and public.visita_sin_encuesta(t.id) is not null
  );
$$;
grant execute on function public.encuesta_pendiente(text) to anon, authenticated;

-- El cliente responde desde su tarjeta (con el código de su tarjeta, como todo lo demás que hace ahí).
create or replace function public.responder_encuesta(p_codigo text, p_nota integer, p_comentario text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tarjetas;
  v_mov uuid;
  v_local uuid;
begin
  if p_nota is null or p_nota not between 1 and 5 then
    raise exception 'Elige una nota del 1 al 5';
  end if;
  select * into t from public.tarjetas where codigo = upper(trim(p_codigo));
  if t.id is null then
    raise exception 'No encontramos esa tarjeta';
  end if;
  v_mov := public.visita_sin_encuesta(t.id);
  if v_mov is null then
    return false;
  end if;
  select sucursal_id into v_local from public.movimientos where id = v_mov;
  insert into public.encuestas (negocio_id, tarjeta_id, movimiento_id, sucursal_id, nota, comentario, leida)
  values (t.negocio_id, t.id, v_mov, v_local, p_nota, nullif(left(trim(coalesce(p_comentario, '')), 300), ''), p_nota >= 4)
  on conflict (movimiento_id) do nothing;
  return true;
end;
$$;
grant execute on function public.responder_encuesta(text, integer, text) to anon, authenticated;

-- Si después de responder deja un comentario (solo dentro de los 30 minutos siguientes).
create or replace function public.comentar_encuesta(p_codigo text, p_comentario text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select e.id into v_id from public.encuestas e join public.tarjetas t on t.id = e.tarjeta_id
  where t.codigo = upper(trim(p_codigo)) and e.created_at > now() - interval '30 minutes'
  order by e.created_at desc limit 1;
  if v_id is null then
    return false;
  end if;
  update public.encuestas set comentario = nullif(left(trim(coalesce(p_comentario, '')), 300), '') where id = v_id;
  return true;
end;
$$;
grant execute on function public.comentar_encuesta(text, text) to anon, authenticated;

-- Resumen para Métricas: promedio, reparto de notas y las últimas opiniones.
create or replace function public.opiniones(p_negocio uuid, p_dias integer default 30, p_sucursal uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  desde timestamptz := now() - make_interval(days => least(730, greatest(1, p_dias)));
begin
  if not public.es_gestor(p_negocio) then
    raise exception 'Solo el dueño o un encargado ve las opiniones';
  end if;
  return (
    with e as (
      select * from public.encuestas
      where negocio_id = p_negocio and created_at >= desde and (p_sucursal is null or sucursal_id = p_sucursal)
    )
    select jsonb_build_object(
      'total', (select count(*) from e),
      'promedio', (select round(avg(nota)::numeric, 1) from e),
      'notas', (select jsonb_agg(coalesce((select count(*) from e where e.nota = g.n), 0) order by g.n) from generate_series(1, 5) g(n)),
      'sin_leer', (select count(*) from public.encuestas x where x.negocio_id = p_negocio and not x.leida),
      'ultimas', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'nota', x.nota, 'comentario', x.comentario, 'leida', x.leida,
                                            'created_at', x.created_at, 'nombre', t.nombre, 'codigo', t.codigo)
                         order by x.leida, x.created_at desc)
        from (
          select * from public.encuestas y
          where y.negocio_id = p_negocio and (p_sucursal is null or y.sucursal_id = p_sucursal)
            and (y.created_at >= desde or not y.leida) and (y.nota <= 3 or y.comentario is not null)
          order by y.leida, y.created_at desc limit 30
        ) x join public.tarjetas t on t.id = x.tarjeta_id
      ), '[]'::jsonb)
    )
  );
end;
$$;
grant execute on function public.opiniones(uuid, integer, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 2. Cashback: descontar un monto libre del saldo
-- ─────────────────────────────────────────────

alter table public.movimientos drop constraint if exists movimientos_origen_check;
alter table public.movimientos add constraint movimientos_origen_check check (origen in (
  'qr', 'equipo', 'manual', 'bienvenida', 'cumpleanos', 'regreso', 'migracion', 'referido', 'api', 'premio', 'cupon', 'reto', 'saldo'
));

create or replace function public.canjear_saldo(p_tarjeta text, p_monto integer, p_pin text default null, p_sucursal uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tarjetas;
  quien uuid;
  v_nombre text;
begin
  select * into t from public.tarjetas where codigo = upper(trim(p_tarjeta)) for update;
  if t.id is null then
    raise exception 'No encontramos esa tarjeta';
  end if;
  quien := public.exigir_pin(t.negocio_id, p_pin);
  if public.unidad_de(t.negocio_id) <> 'puntos' then
    raise exception 'Esta tarjeta no tiene saldo para descontar';
  end if;
  if p_monto is null or p_monto < 1 then
    raise exception 'Anota cuánto quieres descontar';
  end if;
  if p_monto > t.puntos then
    raise exception 'El saldo no alcanza: tiene %', t.puntos;
  end if;
  select nombre_puntos into v_nombre from public.programas where negocio_id = t.negocio_id;
  update public.tarjetas set puntos = puntos - p_monto, canjes = canjes + 1, ultima_at = now() where id = t.id returning * into t;
  insert into public.movimientos (negocio_id, tarjeta_id, tipo, cantidad, origen, autorizado_por, nota, sucursal_id, unidad, costo)
  values (t.negocio_id, t.id, 'canje', -p_monto, 'saldo', quien,
          case when v_nombre = 'pesos' then 'un descuento de $' || replace(to_char(p_monto, 'FM999,999,999'), ',', '.')
               else p_monto || ' ' || coalesce(v_nombre, 'puntos') || ' de descuento' end,
          public.sucursal_de(t.negocio_id, p_sucursal), 'puntos',
          case when v_nombre = 'pesos' then p_monto end);
  return public.estado_tarjeta(t) || jsonb_build_object('descontado', p_monto);
end;
$$;
revoke all on function public.canjear_saldo(text, integer, text, uuid) from public, anon;
grant execute on function public.canjear_saldo(text, integer, text, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 3. Segmentos a la vista
-- ─────────────────────────────────────────────
-- Cada cliente queda en un solo estado (en este orden):
--   dormido   · no viene hace 45 días o más
--   en_riesgo · venía seguido (4 visitas o más) y lleva 21 días sin venir
--   vip       · el 10 % que más viene, con 10 visitas o más
--   frecuente · 4 visitas o más en los últimos 60 días
--   nuevo     · se unió en los últimos 30 días
--   ocasional · el resto

create or replace function public.estados_de(p_negocio uuid)
returns table (tarjeta_id uuid, estado text)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select m.tarjeta_id, count(*) n from public.movimientos m
    where m.negocio_id = p_negocio and m.tipo = 'sello' and m.origen in ('qr', 'equipo', 'api') and m.created_at > now() - interval '60 days'
    group by 1
  ),
  corte as (
    select coalesce(percentile_disc(0.9) within group (order by x.visitas), 0) as p90 from public.tarjetas x where x.negocio_id = p_negocio
  )
  select t.id,
    case
      when coalesce(t.ultima_at, t.created_at) < now() - interval '45 days' then 'dormido'
      when t.visitas >= 4 and coalesce(t.ultima_at, t.created_at) < now() - interval '21 days' then 'en_riesgo'
      when t.visitas >= 10 and t.visitas >= c.p90 then 'vip'
      when coalesce(f.n, 0) >= 4 then 'frecuente'
      when t.created_at > now() - interval '30 days' then 'nuevo'
      else 'ocasional'
    end
  from public.tarjetas t
  cross join corte c
  left join f on f.tarjeta_id = t.id
  where t.negocio_id = p_negocio;
$$;
revoke all on function public.estados_de(uuid) from public, anon, authenticated;

-- El estado de cada cliente, para la lista del panel.
create or replace function public.segmentos_clientes(p_negocio uuid)
returns table (tarjeta_id uuid, estado text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_miembro(p_negocio) then
    raise exception 'No tienes acceso a este negocio';
  end if;
  return query select * from public.estados_de(p_negocio);
end;
$$;
grant execute on function public.segmentos_clientes(uuid) to authenticated;

-- Foto diaria de cuántos hay en cada estado (para ver cómo cambian).
create table if not exists public.segmentos_dia (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  dia        date not null,
  conteos    jsonb not null,
  primary key (negocio_id, dia)
);
alter table public.segmentos_dia enable row level security;
revoke all on public.segmentos_dia from anon, authenticated;

create or replace function public.contar_estados(p_negocio uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'vip', count(*) filter (where estado = 'vip'),
    'frecuente', count(*) filter (where estado = 'frecuente'),
    'nuevo', count(*) filter (where estado = 'nuevo'),
    'ocasional', count(*) filter (where estado = 'ocasional'),
    'en_riesgo', count(*) filter (where estado = 'en_riesgo'),
    'dormido', count(*) filter (where estado = 'dormido')
  )
  from public.estados_de(p_negocio);
$$;
revoke all on function public.contar_estados(uuid) from public, anon, authenticated;

-- Guarda la foto de hoy de todos los negocios vigentes (lo llama el cron diario).
create or replace function public.guardar_segmentos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  f record;
begin
  for f in select id, zona_horaria from public.negocios where public.vigente(id) loop
    insert into public.segmentos_dia (negocio_id, dia, conteos)
    values (f.id, (now() at time zone f.zona_horaria)::date, public.contar_estados(f.id))
    on conflict (negocio_id, dia) do update set conteos = excluded.conteos;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.guardar_segmentos() from public, anon, authenticated;
grant execute on function public.guardar_segmentos() to service_role;

-- Para Métricas: cuántos hay hoy en cada estado y cuántos había hace 7 y 30 días.
create or replace function public.resumen_segmentos(p_negocio uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoy date;
  ahora jsonb;
begin
  if not public.es_gestor(p_negocio) then
    raise exception 'Solo el dueño o un encargado ve las métricas';
  end if;
  select (now() at time zone zona_horaria)::date into hoy from public.negocios where id = p_negocio;
  ahora := public.contar_estados(p_negocio);
  -- Si el cron todavía no pasó hoy, la foto de hoy queda guardada al mirar.
  insert into public.segmentos_dia (negocio_id, dia, conteos) values (p_negocio, hoy, ahora)
  on conflict (negocio_id, dia) do update set conteos = excluded.conteos;
  return jsonb_build_object(
    'ahora', ahora,
    'hace_7', (select s.conteos from public.segmentos_dia s where s.negocio_id = p_negocio and s.dia <= hoy - 7 order by s.dia desc limit 1),
    'hace_30', (select s.conteos from public.segmentos_dia s where s.negocio_id = p_negocio and s.dia <= hoy - 30 order by s.dia desc limit 1),
    'desde', (select min(s.dia) from public.segmentos_dia s where s.negocio_id = p_negocio)
  );
end;
$$;
grant execute on function public.resumen_segmentos(uuid) to authenticated;

-- Grupos de campaña: igual que antes + "en_riesgo" (venían seguido y llevan 21 días sin venir).
create or replace function public.segmento(p_negocio uuid, p_segmento text, p_dias integer default 30, p_sucursal uuid default null)
returns setof public.tarjetas
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.tarjetas t
  join public.programas p on p.negocio_id = t.negocio_id
  join public.negocios n on n.id = t.negocio_id
  where t.negocio_id = p_negocio
    and t.acepta_avisos
    and (p_sucursal is null or t.sucursal_id = p_sucursal)
    and case
      when p_segmento = 'todos' then true
      when p_segmento = 'cerca' then
        case when public.unidad_de(p_negocio) = 'puntos'
          then exists (select 1 from public.premios r
                       where r.negocio_id = p_negocio and public.premio_disponible(r, n.zona_horaria)
                         and t.puntos < r.puntos and t.puntos >= r.puntos * 0.75)
          else t.sellos > 0 and p.meta - t.sellos <= 2 end
      when p_segmento = 'premio' then
        case when public.unidad_de(p_negocio) = 'puntos'
          then exists (select 1 from public.premios r
                       where r.negocio_id = p_negocio and public.premio_disponible(r, n.zona_horaria) and t.puntos >= r.puntos)
          else t.premios > 0 end
      when p_segmento = 'frecuentes' then (
        select count(*) from public.movimientos m
        where m.tarjeta_id = t.id and m.tipo = 'sello' and m.origen in ('qr', 'equipo', 'api') and m.created_at > now() - interval '60 days'
      ) >= 4
      when p_segmento = 'vip' then t.visitas >= 10 and t.visitas >= (
        select coalesce(percentile_disc(0.9) within group (order by x.visitas), 0) from public.tarjetas x where x.negocio_id = p_negocio
      )
      when p_segmento = 'en_riesgo' then t.visitas >= 4
        and coalesce(t.ultima_at, t.created_at) < now() - interval '21 days'
        and coalesce(t.ultima_at, t.created_at) >= now() - interval '45 days'
      when p_segmento = 'dormidos' then coalesce(t.ultima_at, t.created_at) < now() - make_interval(days => greatest(1, p_dias))
      when p_segmento = 'nuevos' then t.created_at > now() - interval '30 days'
      when p_segmento = 'cumple' then extract(month from t.cumpleanos) = extract(month from now() at time zone n.zona_horaria)
      when p_segmento like 'nivel:%' then public.nivel_de(t) ->> 'nombre' = substr(p_segmento, 7)
      else false
    end
  order by t.ultima_at desc nulls last
  limit 5000;
$$;
revoke all on function public.segmento(uuid, text, integer, uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. Campañas programadas y con resultados
-- ─────────────────────────────────────────────

alter table public.campanas add column if not exists dias integer not null default 30;
alter table public.campanas add column if not exists programada_para date;
alter table public.campanas add column if not exists enviada_at timestamptz;
alter table public.campanas add column if not exists estado text not null default 'enviada';
alter table public.campanas drop constraint if exists campanas_estado_check;
alter table public.campanas add constraint campanas_estado_check check (estado in ('programada', 'enviada', 'cancelada'));
update public.campanas set enviada_at = created_at where enviada_at is null and estado = 'enviada';

-- A quiénes les llegó cada campaña (para medir cuántos volvieron).
create table if not exists public.campana_destinatarios (
  campana_id uuid not null references public.campanas (id) on delete cascade,
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  primary key (campana_id, tarjeta_id)
);
create index if not exists campana_destinatarios_tarjeta_idx on public.campana_destinatarios (tarjeta_id);
alter table public.campana_destinatarios enable row level security;
revoke all on public.campana_destinatarios from anon, authenticated;

-- Entrega una campaña: arma el grupo en ese momento, anota a quiénes, regala el cupón y devuelve sus códigos.
create or replace function public.entregar_campana(p_campana uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.campanas;
  c public.cupones;
  codigos jsonb;
  total integer;
begin
  select * into k from public.campanas where id = p_campana for update;
  if k.id is null or k.enviada_at is not null or k.estado = 'cancelada' then
    return '[]'::jsonb;
  end if;
  insert into public.campana_destinatarios (campana_id, tarjeta_id)
  select k.id, s.id from public.segmento(k.negocio_id, k.segmento, k.dias, k.sucursal_id) s
  on conflict do nothing;
  select coalesce(jsonb_agg(t.codigo), '[]'::jsonb), count(*) into codigos, total
  from public.campana_destinatarios d join public.tarjetas t on t.id = d.tarjeta_id where d.campana_id = k.id;
  if k.cupon_id is not null and public.plan_incluye(k.negocio_id, 'cupones') then
    select * into c from public.cupones where id = k.cupon_id and activo;
    if c.id is not null then
      insert into public.tarjeta_cupones (negocio_id, tarjeta_id, cupon_id, titulo, detalle, vence_at)
      select k.negocio_id, d.tarjeta_id, c.id, c.titulo, c.detalle, case when c.dias is not null then now() + make_interval(days => c.dias) end
      from public.campana_destinatarios d where d.campana_id = k.id;
    end if;
  end if;
  update public.campanas set estado = 'enviada', enviada_at = now(), destinatarios = total where id = k.id;
  return codigos;
end;
$$;
revoke all on function public.entregar_campana(uuid) from public, anon, authenticated;

-- Crear campaña: igual que antes, pero con p_programada (un día futuro) queda guardada y sale ese día.
drop function if exists public.crear_campana(uuid, text, text, text, text, integer, uuid, uuid);
create or replace function public.crear_campana(
  p_negocio uuid, p_titulo text, p_mensaje text, p_segmento text, p_canal text default 'avisos',
  p_dias integer default 30, p_cupon uuid default null, p_sucursal uuid default null, p_programada date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cupones;
  v_id uuid;
  v_dia date;
  hoy date;
  total integer;
  v_canal text := case when p_canal = 'whatsapp' then 'whatsapp' else 'avisos' end;
begin
  if not public.es_gestor(p_negocio) then
    raise exception 'Solo el dueño o un encargado envía campañas';
  end if;
  if not public.plan_incluye(p_negocio, 'campanas') then
    raise exception 'Las campañas son del plan Pro';
  end if;
  if not public.vigente(p_negocio) then
    raise exception 'Tu prueba gratis terminó. Escríbenos para activar tu cuenta.';
  end if;
  select (now() at time zone zona_horaria)::date into hoy from public.negocios where id = p_negocio;
  v_dia := case when p_programada is not null and p_programada > hoy then p_programada end;
  if v_dia is not null and v_canal = 'whatsapp' then
    raise exception 'Las campañas por WhatsApp se envían al momento, desde tu teléfono';
  end if;
  if v_dia > hoy + 90 then
    raise exception 'Puedes programar hasta 90 días hacia adelante';
  end if;
  if (select count(*) from public.campanas k join public.negocios n on n.id = k.negocio_id
      where k.negocio_id = p_negocio and k.estado <> 'cancelada'
        and coalesce(k.programada_para, (k.created_at at time zone n.zona_horaria)::date) = coalesce(v_dia, hoy)) >= 3 then
    raise exception 'Puedes enviar hasta 3 campañas al día. Así tus clientes no se cansan.';
  end if;
  if p_cupon is not null then
    select * into c from public.cupones where id = p_cupon and negocio_id = p_negocio and activo;
    if c.id is null then
      raise exception 'Ese cupón no está disponible';
    end if;
    if not public.plan_incluye(p_negocio, 'cupones') then
      raise exception 'Los cupones son del plan Pro';
    end if;
  end if;
  if p_sucursal is not null and not exists (select 1 from public.sucursales where id = p_sucursal and negocio_id = p_negocio) then
    raise exception 'Ese local no es de este negocio';
  end if;

  select count(*) into total from public.segmento(p_negocio, p_segmento, p_dias, p_sucursal);
  if total = 0 and v_dia is null then
    raise exception 'Nadie de ese grupo aceptó recibir avisos todavía';
  end if;

  insert into public.campanas (negocio_id, titulo, mensaje, segmento, canal, cupon_id, sucursal_id, destinatarios, dias, programada_para, estado)
  values (p_negocio, left(trim(p_titulo), 60), left(trim(p_mensaje), 300), p_segmento, v_canal, p_cupon, p_sucursal, total,
          greatest(1, coalesce(p_dias, 30)), v_dia, case when v_dia is null then 'enviada' else 'programada' end)
  returning id into v_id;

  if v_dia is not null then
    return jsonb_build_object('id', v_id, 'programada', v_dia, 'codigos', '[]'::jsonb);
  end if;
  return jsonb_build_object('id', v_id, 'codigos', public.entregar_campana(v_id));
end;
$$;
grant execute on function public.crear_campana(uuid, text, text, text, text, integer, uuid, uuid, date) to authenticated;

create or replace function public.cancelar_campana(p_campana uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.campanas;
begin
  select * into k from public.campanas where id = p_campana for update;
  if k.id is null or not public.es_gestor(k.negocio_id) then
    raise exception 'Campaña no encontrada';
  end if;
  if k.estado <> 'programada' then
    raise exception 'Esa campaña ya salió';
  end if;
  update public.campanas set estado = 'cancelada' where id = k.id;
  return true;
end;
$$;
grant execute on function public.cancelar_campana(uuid) to authenticated;

-- Las programadas que tocan hoy (lo llama el cron diario): las entrega y devuelve qué avisar.
create or replace function public.campanas_programadas()
returns table (id uuid, titulo text, mensaje text, codigos jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  k record;
begin
  for k in
    select c.id, c.titulo, c.mensaje from public.campanas c join public.negocios n on n.id = c.negocio_id
    where c.estado = 'programada' and c.programada_para <= (now() at time zone n.zona_horaria)::date
      and public.vigente(c.negocio_id) and public.plan_incluye(c.negocio_id, 'campanas')
    order by c.programada_para, c.created_at
    limit 200
  loop
    id := k.id; titulo := k.titulo; mensaje := k.mensaje;
    codigos := public.entregar_campana(k.id);
    return next;
  end loop;
end;
$$;
revoke all on function public.campanas_programadas() from public, anon, authenticated;
grant execute on function public.campanas_programadas() to service_role;

-- Resultados: de los que la recibieron, cuántos vinieron en los 14 días siguientes y cuántos usaron el cupón.
create or replace function public.resultados_campanas(p_negocio uuid)
returns table (id uuid, volvieron integer, cupones_usados integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_gestor(p_negocio) then
    raise exception 'Solo el dueño o un encargado ve las campañas';
  end if;
  return query
  select k.id,
    (select count(distinct d.tarjeta_id)::integer from public.campana_destinatarios d
     where d.campana_id = k.id and exists (
       select 1 from public.movimientos m
       where m.tarjeta_id = d.tarjeta_id and m.tipo = 'sello' and m.origen in ('qr', 'equipo', 'api')
         and m.created_at > k.enviada_at and m.created_at <= k.enviada_at + interval '14 days')),
    (select count(*)::integer from public.tarjeta_cupones tc
     join public.campana_destinatarios d on d.campana_id = k.id and d.tarjeta_id = tc.tarjeta_id
     where k.cupon_id is not null and tc.cupon_id = k.cupon_id and tc.usado_at >= k.enviada_at
       and tc.created_at >= k.enviada_at - interval '1 minute')
  from public.campanas k
  where k.negocio_id = p_negocio and k.enviada_at is not null
  order by k.enviada_at desc
  limit 30;
end;
$$;
grant execute on function public.resultados_campanas(uuid) to authenticated;
