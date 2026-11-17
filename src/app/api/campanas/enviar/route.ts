import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { avisarCampana } from "@/lib/campanas";
import { sitioDe } from "@/lib/servidor";
import { limpiarCodigo } from "@/lib/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

// Envía una campaña recién creada (crear_campana) como aviso al celular y mensaje en Google Wallet.
// Solo el dueño o un encargado, una sola vez por campaña y dentro de los 10 minutos siguientes a crearla.
export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => ({}))) as { campana?: string; codigos?: string[] };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("campanas")
    .select("id, negocio_id, titulo, mensaje, canal, avisos, wallet, created_at")
    .eq("id", String(cuerpo.campana ?? ""))
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
  if (c.canal !== "avisos" || c.avisos > 0 || c.wallet > 0 || Date.now() - Date.parse(c.created_at) > 10 * 60000)
    return NextResponse.json({ enviados: 0, wallet: 0 });

  const pedidos = [...new Set((cuerpo.codigos ?? []).map((x) => limpiarCodigo(String(x))).filter(Boolean))].slice(0, 5000);
  // Solo tarjetas de ese negocio que aceptaron avisos (lo valida la base con los permisos de quien envía).
  const codigos: string[] = [];
  for (let i = 0; i < pedidos.length; i += 500) {
    const { data } = await supabase
      .from("tarjetas")
      .select("codigo")
      .eq("negocio_id", c.negocio_id)
      .eq("acepta_avisos", true)
      .in("codigo", pedidos.slice(i, i + 500));
    codigos.push(...(data ?? []).map((t) => t.codigo as string));
  }

  const admin = createAdminClient();
  const { enviados, wallet } = await avisarCampana(admin, codigos, { titulo: c.titulo, cuerpo: c.mensaje }, sitioDe(request), Date.now() + 50000);
  if (admin) await admin.from("campanas").update({ avisos: enviados, wallet }).eq("id", c.id);
  return NextResponse.json({ enviados, wallet, destinatarios: codigos.length });
}
