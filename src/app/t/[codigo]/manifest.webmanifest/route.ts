import { leerTarjeta } from "@/lib/servidor";
import { limpiarCodigo } from "@/lib/tipos";

// Manifiesto de la tarjeta de un cliente: la deja instalar como app en la pantalla de inicio, con el nombre, el
// logo y el color del negocio, y abre directo en su tarjeta.
export async function GET(_: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const codigo = limpiarCodigo((await params).codigo);
  const t = codigo ? await leerTarjeta(codigo) : null;
  if (!t) return new Response("No encontrada", { status: 404 });
  const color = t.programa?.color || t.negocio.color || "#141414";
  const icono = (tam: number) => `/api/icono/${t.codigo}/${tam}`;
  const manifiesto = {
    id: `/t/${t.codigo}`,
    name: t.negocio.nombre,
    short_name: t.negocio.nombre.slice(0, 24),
    description: `Tu tarjeta de ${t.negocio.nombre}: ${t.programa?.tipo === "puntos" ? t.programa.nombre_puntos : "sellos"}, premios y avisos.`,
    lang: "es",
    start_url: `/t/${t.codigo}`,
    scope: `/t/${t.codigo}`,
    display: "standalone",
    orientation: "portrait",
    background_color: color,
    theme_color: color,
    icons: [
      { src: icono(192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icono(512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icono(512), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifiesto), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
