import type { SupabaseClient } from "@supabase/supabase-js";
import { avisarCliente } from "./avisos";
import { leerTarjeta } from "./servidor";

// Envía el aviso de una campaña a cada tarjeta (al celular y a Google Wallet), de a 10, hasta agotar el tiempo.
export async function avisarCampana(
  admin: SupabaseClient | null,
  codigos: string[],
  mensaje: { titulo: string; cuerpo: string },
  sitio: string,
  hasta: number,
) {
  let enviados = 0;
  let wallet = 0;
  for (let i = 0; i < codigos.length && Date.now() < hasta; i += 10) {
    const r = await Promise.all(
      codigos.slice(i, i + 10).map(async (codigo) => {
        const t = await leerTarjeta(codigo);
        return t ? avisarCliente(admin, t, mensaje, sitio) : { enviados: 0, wallet: false };
      }),
    );
    for (const x of r) {
      enviados += x.enviados;
      if (x.wallet) wallet++;
    }
  }
  return { enviados, wallet };
}
