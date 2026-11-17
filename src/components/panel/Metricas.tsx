"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import {
  CAMPANA_DE_ESTADO,
  COLUMNAS_TARJETA,
  ESTADOS_CLIENTE,
  ORDEN_ESTADOS,
  type EstadoCliente,
  type FilaTarjeta,
  type Negocio,
  type ProgramaSellos,
} from "@/lib/tipos";
import { formatoFecha, formatoPrecio, mensajeError } from "@/lib/utils";

export type DatosMetricas = {
  dias: number;
  clientes: number;
  nuevos: number;
  nuevos_previo: number;
  visitas: number;
  visitas_previo: number;
  activos: number;
  volvieron: number;
  canjes: number;
  cupones: number;
  avisos: number;
  costo_premios: number;
  semanas?: { semana: string; visitas: number; nuevos: number }[];
  dias_semana?: number[];
  locales?: { nombre: string; visitas: number }[];
  top?: { nombre: string; codigo: string; visitas: number }[];
};

type Conteos = Record<EstadoCliente, number>;
export type ResumenSegmentos = { ahora: Conteos; hace_7: Conteos | null; hace_30: Conteos | null; desde: string | null };
export type Opinion = { id: string; nota: number; comentario: string | null; leida: boolean; created_at: string; nombre: string; codigo: string };
export type DatosOpiniones = { total: number; promedio: number | null; notas: number[]; sin_leer: number; ultimas: Opinion[] };

const CARAS = ["😞", "🙁", "😐", "🙂", "😍"];

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function variacion(ahora: number, antes: number) {
  if (!antes) return ahora ? "nuevo" : null;
  const v = Math.round(((ahora - antes) / antes) * 100);
  return `${v > 0 ? "+" : ""}${v} %`;
}

export function Metricas({
  negocio,
  programa,
  dias,
  periodos,
  local,
  completo,
  datos,
  error,
  segmentos,
  opiniones,
  campanas,
}: {
  negocio: Negocio;
  programa: ProgramaSellos;
  dias: number;
  periodos: number[];
  local: string | null;
  completo: boolean;
  datos: DatosMetricas | null;
  error: string | null;
  segmentos: ResumenSegmentos | null;
  opiniones: DatosOpiniones | null;
  // ¿El plan incluye campañas? (para el botón "Enviarles una campaña").
  campanas: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const avisar = useToast();
  const [exportando, setExportando] = useState(false);
  const [leidas, setLeidas] = useState<string[]>([]);

  async function marcarLeida(ids: string[]) {
    const { error } = await supabase.from("encuestas").update({ leida: true }).in("id", ids);
    if (error) return avisar(mensajeError(error), "error");
    setLeidas((l) => [...l, ...ids]);
  }

  async function exportar() {
    setExportando(true);
    try {
      const { data, error } = await supabase.from("tarjetas").select(COLUMNAS_TARJETA).eq("negocio_id", negocio.id).limit(20000);
      if (error) throw error;
      const filas = (data ?? []) as FilaTarjeta[];
      const puntos = programa.tipo === "puntos";
      const cab = ["Nombre", "Teléfono", "Correo", "Cumpleaños", "Acepta avisos", puntos ? programa.nombre_puntos : "Sellos", "Premios por canjear", "Visitas", "Canjes", "Se unió", "Última visita", "Tarjeta"];
      const celda = (v: unknown) => {
        const t = v === null || v === undefined ? "" : String(v);
        return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const lineas = filas.map((t) =>
        [
          t.nombre,
          t.telefono,
          t.email,
          t.cumpleanos,
          t.acepta_avisos ? "Sí" : "No",
          puntos ? t.puntos : t.sellos,
          t.premios,
          t.visitas,
          t.canjes,
          t.created_at.slice(0, 10),
          t.ultima_at?.slice(0, 10) ?? "",
          t.codigo,
        ]
          .map(celda)
          .join(";"),
      );
      // BOM + punto y coma: Excel en español lo abre directo con tildes y columnas.
      const blob = new Blob(["﻿" + [cab.join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `clientes-${negocio.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      avisar(mensajeError(e), "error");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Métricas</h1>
          <p className="text-sm text-suave">{local ? `Local ${local}` : "Todos los locales"} · últimos {dias} días</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-borde bg-superficie p-0.5">
            {periodos.map((p) => (
              <Link
                key={p}
                href={`/panel/metricas?d=${p}`}
                className={`rounded-md px-3 py-1.5 text-sm ${p === dias ? "bg-marca text-white shadow-sm" : "text-suave"}`}
              >
                {p === 365 ? "1 año" : `${p} días`}
              </Link>
            ))}
          </div>
          <button className="boton-secundario py-1.5" onClick={exportar} disabled={exportando || !completo} title={completo ? "" : "Del plan Pro"}>
            {exportando ? "Exportando…" : "⬇ Exportar a Excel"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {datos && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Dato titulo="Visitas" valor={datos.visitas} cambio={variacion(datos.visitas, datos.visitas_previo)} />
            <Dato titulo="Clientes nuevos" valor={datos.nuevos} cambio={variacion(datos.nuevos, datos.nuevos_previo)} />
            <Dato
              titulo="Volvieron"
              valor={datos.volvieron}
              nota={datos.activos ? `${Math.round((datos.volvieron / datos.activos) * 100)} % de los que vinieron` : undefined}
            />
            <Dato titulo="Premios entregados" valor={datos.canjes} nota={datos.cupones ? `y ${datos.cupones} cupones usados` : undefined} />
            <Dato titulo="Clientes con tarjeta" valor={datos.clientes} />
            <Dato titulo="Reciben avisos" valor={datos.avisos} nota={datos.clientes ? `${Math.round((datos.avisos / datos.clientes) * 100)} %` : undefined} />
            <Dato titulo="Vinieron en el período" valor={datos.activos} />
            <Dato titulo="Inversión en premios" texto={formatoPrecio(Number(datos.costo_premios), negocio.moneda)} nota="Según el costo que anotaste" />
          </div>

          {segmentos && (
            <div className="tarjeta p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Tus clientes por estado</h2>
                  <p className="text-sm text-suave">Se actualiza solo cada día. Cada cliente está en un solo grupo.</p>
                </div>
                {!segmentos.hace_7 && (
                  <p className="text-xs text-suave">Los cambios aparecen después de una semana de datos guardados.</p>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {ORDEN_ESTADOS.map((e) => {
                  const n = segmentos.ahora[e] ?? 0;
                  const d7 = segmentos.hace_7 ? n - (segmentos.hace_7[e] ?? 0) : null;
                  const d30 = segmentos.hace_30 ? n - (segmentos.hace_30[e] ?? 0) : null;
                  const malo = e === "en_riesgo" || e === "dormido";
                  const color = (d: number) => (d === 0 ? "text-suave" : d > 0 !== malo ? "text-emerald-700" : "text-red-700");
                  const campana = CAMPANA_DE_ESTADO[e];
                  return (
                    <div key={e} className="rounded-xl border border-borde p-3">
                      <span className={`inline-block rounded-full px-2 text-[11px] font-semibold ${ESTADOS_CLIENTE[e].clase}`}>
                        {ESTADOS_CLIENTE[e].nombre}
                      </span>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{n.toLocaleString("es-CL")}</p>
                      <p className="text-[11px] leading-tight text-suave">{ESTADOS_CLIENTE[e].texto}</p>
                      {d7 !== null && (
                        <p className={`mt-1 text-xs font-medium ${color(d7)}`}>
                          {d7 > 0 ? "+" : ""}
                          {d7} en 7 días
                        </p>
                      )}
                      {d30 !== null && (
                        <p className={`text-xs ${color(d30)}`}>
                          {d30 > 0 ? "+" : ""}
                          {d30} en 30 días
                        </p>
                      )}
                      {campana && campanas && n > 0 && (
                        <Link href={`/panel/campanas?segmento=${campana}`} className="mt-1 block text-xs font-medium text-marca hover:underline">
                          Enviarles una campaña →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {opiniones && (
            <div id="opiniones" className="tarjeta scroll-mt-24 p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Cómo les fue a tus clientes</h2>
                  <p className="text-sm text-suave">La encuesta de un toque después de cada visita. Solo la ves tú y tu equipo.</p>
                </div>
                {opiniones.total > 0 && (
                  <p className="text-right">
                    <span className="text-3xl font-semibold tabular-nums">{String(opiniones.promedio ?? "–").replace(".", ",")}</span>
                    <span className="text-sm text-suave"> / 5 · {opiniones.total} respuestas</span>
                  </p>
                )}
              </div>
              {opiniones.total === 0 ? (
                <p className="mt-3 text-sm text-suave">
                  Todavía no hay respuestas en este período. Se pregunta después de cada visita (puedes apagarlo en Tarjeta).
                </p>
              ) : (
                <ul className="mt-4 space-y-1.5 text-sm">
                  {[...opiniones.notas].reverse().map((v, i) => {
                    const nota = 5 - i;
                    return (
                      <li key={nota} className="grid grid-cols-[2rem_1fr_4rem] items-center gap-2">
                        <span className="text-lg" aria-label={`Nota ${nota}`}>
                          {CARAS[nota - 1]}
                        </span>
                        <span className="h-3 rounded-full bg-stone-100">
                          <span
                            className={`block h-full rounded-full ${nota >= 4 ? "bg-emerald-500" : nota === 3 ? "bg-amber-400" : "bg-red-500"}`}
                            style={{ width: `${(v / Math.max(1, opiniones.total)) * 100}%` }}
                          />
                        </span>
                        <span className="text-right tabular-nums text-suave">
                          {v} · {Math.round((v / Math.max(1, opiniones.total)) * 100)} %
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {opiniones.ultimas.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Para revisar</h3>
                    {opiniones.ultimas.some((o) => !o.leida && !leidas.includes(o.id)) && (
                      <button
                        type="button"
                        className="text-xs text-suave hover:text-tinta"
                        onClick={() => marcarLeida(opiniones.ultimas.filter((o) => !o.leida && !leidas.includes(o.id)).map((o) => o.id))}
                      >
                        Marcar todas como revisadas
                      </button>
                    )}
                  </div>
                  <ul className="mt-2 divide-y divide-borde rounded-xl border border-borde text-sm">
                    {opiniones.ultimas.map((o) => {
                      const nueva = !o.leida && !leidas.includes(o.id);
                      return (
                        <li key={o.id} className={`flex items-start gap-3 px-3 py-2.5 ${nueva ? "bg-orange-50/60" : ""}`}>
                          <span className="text-xl" aria-label={`Nota ${o.nota}`}>
                            {CARAS[o.nota - 1]}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{o.nombre}</span>
                            <span className="text-xs text-suave">
                              {" "}
                              · {formatoFecha(o.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, negocio.zona_horaria)} ·{" "}
                              {o.codigo}
                            </span>
                            {o.comentario ? <span className="block text-suave">“{o.comentario}”</span> : <span className="block text-xs text-suave">Sin comentario</span>}
                          </span>
                          {nueva && (
                            <button type="button" className="shrink-0 text-xs font-medium text-marca hover:underline" onClick={() => marcarLeida([o.id])}>
                              Revisada
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-suave">
                    Un consejo: escríbele a quien quedó descontento y regálale algo en su próxima visita. Busca su nombre en Clientes.
                  </p>
                </div>
              )}
            </div>
          )}

          {!completo ? (
            <div className="tarjeta border-dashed p-5 text-sm">
              <p className="font-semibold">Gráficos, mejores clientes y exportar a Excel son del plan Pro</p>
              <a href="/panel/plan" className="boton mt-3">
                Ver planes
              </a>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="tarjeta p-5 lg:col-span-2">
                <h2 className="font-semibold">Visitas y clientes nuevos por semana</h2>
                <GraficoSemanas semanas={datos.semanas ?? []} zona={negocio.zona_horaria} />
              </div>
              <div className="tarjeta p-5">
                <h2 className="font-semibold">Qué días vienen más</h2>
                <Barras valores={(datos.dias_semana ?? []).map((v, i) => ({ etiqueta: DIAS[i], valor: v }))} />
              </div>
              <div className="tarjeta p-5">
                <h2 className="font-semibold">Mejores clientes</h2>
                <ol className="mt-3 space-y-1.5 text-sm">
                  {(datos.top ?? []).map((t, i) => (
                    <li key={t.codigo} className="flex items-center gap-2">
                      <span className="w-5 text-right text-suave">{i + 1}.</span>
                      <span className="flex-1 truncate">{t.nombre}</span>
                      <span className="font-semibold tabular-nums">{t.visitas}</span>
                    </li>
                  ))}
                  {!datos.top?.length && <li className="text-suave">Todavía no hay visitas en este período.</li>}
                </ol>
              </div>
              {(datos.locales?.length ?? 0) > 0 && (
                <div className="tarjeta p-5 lg:col-span-2">
                  <h2 className="font-semibold">Visitas por local</h2>
                  <Barras valores={(datos.locales ?? []).map((l) => ({ etiqueta: l.nombre, valor: l.visitas }))} horizontal />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Dato({ titulo, valor, texto, cambio, nota }: { titulo: string; valor?: number; texto?: string; cambio?: string | null; nota?: string }) {
  const sube = cambio?.startsWith("+") || cambio === "nuevo";
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-suave">{titulo}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{texto ?? (valor ?? 0).toLocaleString("es-CL")}</p>
      {cambio && (
        <p className={`text-xs font-medium ${sube ? "text-emerald-700" : cambio.startsWith("-") ? "text-red-700" : "text-suave"}`}>
          {cambio} vs. período anterior
        </p>
      )}
      {nota && <p className="text-xs text-suave">{nota}</p>}
    </div>
  );
}

function GraficoSemanas({ semanas, zona }: { semanas: { semana: string; visitas: number; nuevos: number }[]; zona: string }) {
  if (!semanas.length) return <p className="mt-3 text-sm text-suave">Sin datos todavía.</p>;
  const W = 640;
  const H = 200;
  const max = Math.max(1, ...semanas.map((s) => Math.max(s.visitas, s.nuevos)));
  const paso = semanas.length > 1 ? W / (semanas.length - 1) : W;
  const punto = (v: number, i: number) => `${(semanas.length > 1 ? i * paso : W / 2).toFixed(1)},${(H - (v / max) * (H - 16)).toFixed(1)}`;
  const linea = (k: "visitas" | "nuevos") => semanas.map((s, i) => punto(s[k], i)).join(" ");
  return (
    <div className="mt-3">
      <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="h-52 w-full" role="img" aria-label="Visitas y clientes nuevos por semana">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - f * (H - 16)} y2={H - f * (H - 16)} stroke="currentColor" className="text-borde" strokeWidth={1} />
        ))}
        <polygon points={`0,${H} ${linea("visitas")} ${W},${H}`} className="fill-marca/10" />
        <polyline points={linea("visitas")} fill="none" className="stroke-marca" strokeWidth={2.5} strokeLinejoin="round" />
        <polyline points={linea("nuevos")} fill="none" stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
        {semanas.map((s, i) => (
          <circle key={s.semana} cx={semanas.length > 1 ? i * paso : W / 2} cy={H - (s.visitas / max) * (H - 16)} r={3} className="fill-marca">
            <title>
              Semana del {formatoFecha(`${s.semana}T12:00:00`, { day: "numeric", month: "short" }, zona)}: {s.visitas} visitas, {s.nuevos} nuevos
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-suave">
        <span>{formatoFecha(`${semanas[0].semana}T12:00:00`, { day: "numeric", month: "short" }, zona)}</span>
        <span className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-marca" /> Visitas
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 border-t-2 border-dashed border-teal-700" /> Nuevos
          </span>
        </span>
        <span>{formatoFecha(`${semanas[semanas.length - 1].semana}T12:00:00`, { day: "numeric", month: "short" }, zona)}</span>
      </div>
    </div>
  );
}

function Barras({ valores, horizontal }: { valores: { etiqueta: string; valor: number }[]; horizontal?: boolean }) {
  const max = Math.max(1, ...valores.map((v) => v.valor));
  if (horizontal)
    return (
      <ul className="mt-3 space-y-2 text-sm">
        {valores.map((v) => (
          <li key={v.etiqueta} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
            <span className="truncate">{v.etiqueta}</span>
            <span className="h-3 rounded-full bg-stone-100">
              <span className="block h-full rounded-full bg-marca" style={{ width: `${(v.valor / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{v.valor}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mt-3 flex h-40 items-end gap-2">
      {valores.map((v) => (
        <div key={v.etiqueta} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs tabular-nums text-suave">{v.valor}</span>
          <span className="w-full rounded-t-md bg-marca/80" style={{ height: `${Math.max(2, (v.valor / max) * 110)}px` }} />
          <span className="text-xs text-suave">{v.etiqueta}</span>
        </div>
      ))}
    </div>
  );
}
