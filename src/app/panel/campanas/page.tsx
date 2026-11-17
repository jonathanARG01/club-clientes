import { cargarPanelGestor } from "@/lib/panel";
import { Campanas, type FilaCampana, type ResultadoCampana } from "@/components/panel/Campanas";
import { SEGMENTOS } from "@/lib/tipos";

export const metadata = { title: "Campañas" };

export default async function PaginaCampanas({ searchParams }: { searchParams: Promise<{ segmento?: string }> }) {
  const { supabase, negocio, programa, sucursales, incluye } = await cargarPanelGestor();
  const pedido = (await searchParams).segmento ?? "";
  const [{ data: cupones }, { data: historial }, { data: resultados }] = await Promise.all([
    supabase.from("cupones").select("id, titulo").eq("negocio_id", negocio.id).eq("activo", true),
    supabase.from("campanas").select("*").eq("negocio_id", negocio.id).order("created_at", { ascending: false }).limit(30),
    incluye("campanas") ? supabase.rpc("resultados_campanas", { p_negocio: negocio.id }) : Promise.resolve({ data: [] }),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Campañas</h1>
        <p className="text-sm text-suave">Un mensaje al grupo justo de clientes para que vuelvan.</p>
      </div>
      <Campanas
        negocio={negocio}
        puede={{ campanas: incluye("campanas"), cupones: incluye("cupones") }}
        cupones={cupones ?? []}
        niveles={incluye("niveles") ? programa.niveles : []}
        sucursales={sucursales}
        historial={(historial ?? []) as FilaCampana[]}
        resultados={Object.fromEntries(
          ((resultados ?? []) as ({ id: string } & ResultadoCampana)[]).map((r) => [r.id, { volvieron: r.volvieron, cupones_usados: r.cupones_usados }]),
        )}
        segmentoInicial={pedido in SEGMENTOS ? pedido : undefined}
      />
    </div>
  );
}
