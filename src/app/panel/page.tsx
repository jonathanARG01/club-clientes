import { cargarPanel } from "@/lib/panel";
import { COLUMNAS_TARJETA, type Cupon, type EstadoCliente, type FilaTarjeta, type Premio } from "@/lib/tipos";
import { Tarjetas } from "@/components/panel/Tarjetas";

export const metadata = { title: "Clientes" };

export default async function PaginaClientes() {
  const { supabase, negocio, programa, dueno, gestor, sucursal, incluye } = await cargarPanel();
  const [{ data }, { data: pide }, { data: catalogo }, { data: cupones }, { data: estados }, { count: sinLeer }] = await Promise.all([
    supabase
      .from("tarjetas")
      .select(COLUMNAS_TARJETA)
      .eq("negocio_id", negocio.id)
      .order("ultima_at", { ascending: false, nullsFirst: false })
      .limit(5000),
    supabase.rpc("pide_pin", { p_negocio: negocio.id }),
    (programa.tipo === "puntos" && incluye("puntos")) || (programa.mostrar_catalogo !== false && incluye("premios"))
      ? supabase.from("premios").select("*").eq("negocio_id", negocio.id).eq("activo", true).order("puntos")
      : Promise.resolve({ data: [] }),
    gestor && incluye("cupones") ? supabase.from("cupones").select("*").eq("negocio_id", negocio.id).eq("activo", true) : Promise.resolve({ data: [] }),
    supabase.rpc("segmentos_clientes", { p_negocio: negocio.id }),
    gestor
      ? supabase.from("encuestas").select("id", { count: "exact", head: true }).eq("negocio_id", negocio.id).eq("leida", false)
      : Promise.resolve({ count: 0 }),
  ]);
  return (
    <Tarjetas
      negocio={negocio}
      programa={programa}
      dueno={dueno}
      pidePin={pide === true}
      iniciales={(data ?? []) as FilaTarjeta[]}
      estados={Object.fromEntries(((estados ?? []) as { tarjeta_id: string; estado: EstadoCliente }[]).map((x) => [x.tarjeta_id, x.estado]))}
      opinionesSinLeer={sinLeer ?? 0}
      extras={{ sucursal: sucursal?.id ?? null, gestor, catalogo: (catalogo ?? []) as Premio[], cupones: (cupones ?? []) as Cupon[] }}
    />
  );
}
