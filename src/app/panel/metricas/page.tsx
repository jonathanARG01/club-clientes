import { cargarPanelGestor } from "@/lib/panel";
import { Metricas, type DatosMetricas, type DatosOpiniones, type ResumenSegmentos } from "@/components/panel/Metricas";

export const metadata = { title: "Métricas" };

const PERIODOS = [7, 30, 90, 365];

export default async function PaginaMetricas({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { supabase, negocio, programa, sucursal, incluye } = await cargarPanelGestor();
  const pedido = Number((await searchParams).d);
  const dias = PERIODOS.includes(pedido) ? pedido : 30;
  const [{ data, error }, { data: segmentos }, { data: opiniones }] = await Promise.all([
    supabase.rpc("metricas", { p_negocio: negocio.id, p_dias: dias, p_sucursal: sucursal?.id ?? null }),
    supabase.rpc("resumen_segmentos", { p_negocio: negocio.id }),
    supabase.rpc("opiniones", { p_negocio: negocio.id, p_dias: dias, p_sucursal: sucursal?.id ?? null }),
  ]);
  return (
    <Metricas
      negocio={negocio}
      programa={programa}
      dias={dias}
      periodos={PERIODOS}
      local={sucursal?.nombre ?? null}
      completo={incluye("metricas")}
      datos={(data ?? null) as DatosMetricas | null}
      error={error?.message ?? null}
      segmentos={(segmentos ?? null) as ResumenSegmentos | null}
      opiniones={(opiniones ?? null) as DatosOpiniones | null}
      campanas={incluye("campanas")}
    />
  );
}
