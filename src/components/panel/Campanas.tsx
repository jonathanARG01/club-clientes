"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { SEGMENTOS, type Cupon, type Negocio, type Nivel, type Segmento, type Sucursal } from "@/lib/tipos";
import { formatoFecha, mensajeError, numeroWhatsapp, urlSitio } from "@/lib/utils";

export type FilaCampana = {
  id: string;
  titulo: string;
  mensaje: string;
  segmento: string;
  canal: "avisos" | "whatsapp";
  destinatarios: number;
  avisos: number;
  wallet: number;
  created_at: string;
  estado?: "programada" | "enviada" | "cancelada";
  programada_para?: string | null;
  enviada_at?: string | null;
  cupon_id?: string | null;
};
export type ResultadoCampana = { volvieron: number; cupones_usados: number };

// Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio, más n días.
function diaDe(zona: string, mas = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona || "America/Santiago" }).format(new Date(Date.now() + mas * 86400000));
}

const IDEAS: { titulo: string; mensaje: string; segmento: Segmento }[] = [
  { titulo: "Te extrañamos", mensaje: "Hace tiempo que no vienes. Esta semana tu visita suma el doble. ¡Te esperamos!", segmento: "dormidos" },
  { titulo: "¡Estás muy cerca!", mensaje: "Te falta poquito para tu premio. Pasa esta semana y llévatelo.", segmento: "cerca" },
  { titulo: "Tu premio te espera", mensaje: "Ya ganaste tu premio y todavía no lo vienes a buscar. ¡Es tuyo!", segmento: "premio" },
  { titulo: "Gracias por ser VIP", mensaje: "Eres de nuestros mejores clientes. Tenemos un regalo para ti en tu próxima visita.", segmento: "vip" },
];

export function Campanas({
  negocio,
  puede,
  cupones,
  niveles,
  sucursales,
  historial,
  resultados = {},
  segmentoInicial,
}: {
  negocio: Negocio;
  puede: { campanas: boolean; cupones: boolean };
  cupones: Pick<Cupon, "id" | "titulo">[];
  niveles: Nivel[];
  sucursales: Sucursal[];
  historial: FilaCampana[];
  resultados?: Record<string, ResultadoCampana>;
  segmentoInicial?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const avisar = useToast();
  const router = useRouter();
  const [f, setF] = useState({
    titulo: "",
    mensaje: "",
    segmento: segmentoInicial || "dormidos",
    dias: 30,
    canal: "avisos" as "avisos" | "whatsapp",
    cupon: "",
    sucursal: "",
    programar: false,
    dia: diaDe(negocio.zona_horaria, 1),
  });
  const programada = f.programar && f.canal === "avisos";
  const textoDia = (d: string) => formatoFecha(`${d}T12:00:00`, { weekday: "long", day: "numeric", month: "long" }, negocio.zona_horaria);
  const [cuantos, setCuantos] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [lista, setLista] = useState<{ nombre: string; telefono: string | null; codigo: string }[] | null>(null);
  const [abiertos, setAbiertos] = useState<string[]>([]);
  const [textoWa, setTextoWa] = useState("");

  useEffect(() => {
    let vivo = true;
    supabase
      .rpc("contar_segmento", { p_negocio: negocio.id, p_segmento: f.segmento, p_dias: f.dias, p_sucursal: f.sucursal || null })
      .then(({ data }) => vivo && setCuantos(typeof data === "number" ? data : null));
    return () => {
      vivo = false;
    };
  }, [supabase, negocio.id, f.segmento, f.dias, f.sucursal]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (
      !confirm(
        programada
          ? `¿Programar “${f.titulo}” para el ${textoDia(f.dia)}? Hoy serían ${cuantos ?? 0} clientes; el grupo se arma ese día.`
          : `¿Enviar “${f.titulo}” a ${cuantos ?? 0} clientes?`,
      )
    )
      return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc("crear_campana", {
        p_negocio: negocio.id,
        p_titulo: f.titulo,
        p_mensaje: f.mensaje,
        p_segmento: f.segmento,
        p_canal: f.canal,
        p_dias: f.dias,
        p_cupon: f.cupon || null,
        p_sucursal: f.sucursal || null,
        p_programada: programada ? f.dia : null,
      });
      if (error) throw error;
      const r = data as { id: string; codigos: string[]; programada?: string };
      if (r.programada) {
        avisar(`Campaña programada para el ${textoDia(r.programada)}`);
      } else if (f.canal === "avisos") {
        const res = await fetch("/api/campanas/enviar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campana: r.id, codigos: r.codigos }),
        }).then((x) => x.json());
        avisar(`Campaña enviada: ${res.enviados ?? 0} avisos al celular y ${res.wallet ?? 0} en Google Wallet`);
      } else {
        const { data: filas } = await supabase
          .from("tarjetas")
          .select("nombre, telefono, codigo")
          .eq("negocio_id", negocio.id)
          .in("codigo", r.codigos.slice(0, 1000));
        setLista(filas ?? []);
        setTextoWa(`*${f.titulo}*\n${f.mensaje}`);
        setAbiertos([]);
        avisar("Lista lista: envía el mensaje a cada uno por WhatsApp");
      }
      setF({ ...f, titulo: "", mensaje: "", programar: false });
      router.refresh();
    } catch (err) {
      avisar(mensajeError(err), "error");
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(id: string) {
    if (!confirm("¿Cancelar esta campaña programada?")) return;
    const { error } = await supabase.rpc("cancelar_campana", { p_campana: id });
    if (error) return avisar(mensajeError(error), "error");
    avisar("Campaña cancelada");
    router.refresh();
  }

  if (!puede.campanas)
    return (
      <div className="tarjeta border-dashed p-5 text-sm">
        <p className="font-semibold">Las campañas son del plan Pro</p>
        <p className="text-suave">Envía mensajes a grupos de clientes (VIP, dormidos, cerca del premio…) con un toque.</p>
        <a href="/panel/plan" className="boton mt-3">
          Ver planes
        </a>
      </div>
    );

  const segmentos: [string, string, string][] = [
    ...(Object.keys(SEGMENTOS) as Segmento[]).map((s): [string, string, string] => [s, SEGMENTOS[s].nombre, SEGMENTOS[s].texto]),
    ...niveles.map((n): [string, string, string] => [`nivel:${n.nombre}`, `Nivel ${n.nombre}`, `${n.visitas} visitas o más`]),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <form onSubmit={enviar} className="tarjeta space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Nueva campaña</h2>
            <p className="text-sm text-suave">Llega solo a quienes aceptaron avisos. Hasta 3 campañas al día.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {IDEAS.map((i) => (
              <button
                key={i.titulo}
                type="button"
                className="rounded-full bg-stone-100 px-3 py-1 text-xs hover:bg-stone-200"
                onClick={() => setF({ ...f, titulo: i.titulo, mensaje: i.mensaje, segmento: i.segmento })}
              >
                💡 {i.titulo}
              </button>
            ))}
          </div>
          <fieldset>
            <legend className="etiqueta-campo">¿A quién?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {segmentos.map(([id, nombre, texto]) => (
                <label
                  key={id}
                  className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${f.segmento === id ? "border-marca ring-2 ring-marca/20" : "border-borde"}`}
                >
                  <input type="radio" name="segmento" checked={f.segmento === id} onChange={() => setF({ ...f, segmento: id })} />
                  <span>
                    <span className="block font-medium">{nombre}</span>
                    <span className="block text-xs text-suave">{texto}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            {f.segmento === "dormidos" && (
              <label className="block text-sm">
                <span className="etiqueta-campo">Sin venir hace</span>
                <select value={f.dias} onChange={(e) => setF({ ...f, dias: Number(e.target.value) })} className="campo">
                  {[15, 30, 45, 60, 90, 180].map((d) => (
                    <option key={d} value={d}>
                      {d} días
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sucursales.length > 0 && (
              <label className="block text-sm">
                <span className="etiqueta-campo">Local</span>
                <select value={f.sucursal} onChange={(e) => setF({ ...f, sucursal: e.target.value })} className="campo">
                  <option value="">Todos los locales</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="block text-sm">
            <span className="etiqueta-campo">Título</span>
            <input required maxLength={60} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className="campo" />
          </label>
          <label className="block text-sm">
            <span className="etiqueta-campo">Mensaje</span>
            <textarea required maxLength={300} rows={3} value={f.mensaje} onChange={(e) => setF({ ...f, mensaje: e.target.value })} className="campo resize-none" />
            <span className="mt-1 block text-right text-xs text-suave">{f.mensaje.length}/300</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="etiqueta-campo">Regalar un cupón</span>
              <select
                value={f.cupon}
                disabled={!puede.cupones || !cupones.length}
                onChange={(e) => setF({ ...f, cupon: e.target.value })}
                className="campo"
              >
                <option value="">{cupones.length ? "Sin cupón" : "Crea cupones en Premios"}</option>
                {cupones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.titulo}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="text-sm">
              <legend className="etiqueta-campo">Por dónde</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={f.canal === "avisos"} onChange={() => setF({ ...f, canal: "avisos" })} />
                Aviso al celular y Google Wallet
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={f.canal === "whatsapp"} onChange={() => setF({ ...f, canal: "whatsapp" })} />
                WhatsApp (uno por uno, desde tu teléfono)
              </label>
            </fieldset>
          </div>
          {f.canal === "avisos" && (
            <fieldset className="text-sm">
              <legend className="etiqueta-campo">Cuándo</legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!f.programar} onChange={() => setF({ ...f, programar: false })} />
                  Ahora
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={f.programar} onChange={() => setF({ ...f, programar: true })} />
                  Otro día
                </label>
                {f.programar && (
                  <input
                    type="date"
                    required
                    value={f.dia}
                    min={diaDe(negocio.zona_horaria, 1)}
                    max={diaDe(negocio.zona_horaria, 90)}
                    onChange={(e) => setF({ ...f, dia: e.target.value })}
                    className="campo w-auto py-1.5"
                    aria-label="Día de envío"
                  />
                )}
              </div>
              {f.programar && (
                <p className="mt-1 text-xs text-suave">
                  Sale ese día en la mañana (cerca de las 11). El grupo se arma ese mismo día, así llega a quienes calcen en ese momento.
                </p>
              )}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="boton" disabled={enviando || (!cuantos && !programada)}>
              {enviando ? "Enviando…" : programada ? `Programar para el ${textoDia(f.dia)}` : `Enviar a ${cuantos ?? "…"} clientes`}
            </button>
            {cuantos === 0 && !programada && <p className="text-sm text-suave">Nadie de ese grupo aceptó avisos todavía.</p>}
          </div>
        </form>

        {lista && (
          <div className="tarjeta space-y-2 p-5">
            <h2 className="font-semibold">Enviar por WhatsApp ({abiertos.length}/{lista.length})</h2>
            <ul className="divide-y divide-borde">
              {lista.map((x) => (
                <li key={x.codigo} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">{x.nombre}</span>
                  {x.telefono ? (
                    <a
                      className={abiertos.includes(x.codigo) ? "text-suave" : "font-medium text-emerald-700"}
                      href={`https://wa.me/${numeroWhatsapp(x.telefono, negocio.pais)}?text=${encodeURIComponent(
                        `${textoWa}\n\nTu tarjeta: ${urlSitio()}/t/${x.codigo}`,
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setAbiertos((a) => [...a, x.codigo])}
                    >
                      {abiertos.includes(x.codigo) ? "✓ Abierto" : "Abrir WhatsApp"}
                    </a>
                  ) : (
                    <span className="text-suave">Sin teléfono</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">Tus campañas</h2>
        {!historial.length && <p className="text-sm text-suave">Todavía no envías campañas.</p>}
        {historial.map((c) => {
          const grupo = SEGMENTOS[c.segmento as Segmento]?.nombre ?? c.segmento.replace("nivel:", "Nivel ");
          const r = resultados[c.id];
          const salio = c.enviada_at ?? c.created_at;
          const midiendo = Date.now() - Date.parse(salio) < 14 * 86400000;
          return (
            <div key={c.id} className={`tarjeta p-4 text-sm ${c.estado === "cancelada" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{c.titulo}</p>
                {c.estado === "programada" && (
                  <span className="shrink-0 rounded-full bg-sky-100 px-2 text-[11px] font-semibold text-sky-900">Programada</span>
                )}
                {c.estado === "cancelada" && (
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 text-[11px] font-semibold text-stone-700">Cancelada</span>
                )}
              </div>
              <p className="line-clamp-2 text-suave">{c.mensaje}</p>
              {c.estado === "programada" || c.estado === "cancelada" ? (
                <p className="mt-1 text-xs text-suave">
                  {c.programada_para ? `Para el ${textoDia(c.programada_para)}` : ""} · {grupo}
                </p>
              ) : (
                <p className="mt-1 text-xs text-suave">
                  {formatoFecha(salio, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, negocio.zona_horaria)} · {grupo} ·{" "}
                  {c.destinatarios} clientes
                  {c.canal === "avisos" ? ` · ${c.avisos} avisos · ${c.wallet} Wallet` : " · WhatsApp"}
                </p>
              )}
              {r && c.destinatarios > 0 && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
                  <b>
                    Volvieron {r.volvieron} de {c.destinatarios} ({Math.round((r.volvieron / c.destinatarios) * 100)} %)
                  </b>{" "}
                  {midiendo ? "hasta ahora (se mide 14 días)" : "en los 14 días siguientes"}
                  {c.cupon_id ? ` · ${r.cupones_usados} usaron el cupón` : ""}
                </p>
              )}
              {c.estado === "programada" && (
                <button type="button" className="mt-2 text-xs text-suave hover:text-red-600" onClick={() => cancelar(c.id)}>
                  Cancelar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
