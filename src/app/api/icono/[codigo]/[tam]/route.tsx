import { ImageResponse } from "next/og";
import { leerTarjeta } from "@/lib/servidor";
import { limpiarCodigo } from "@/lib/tipos";

// Ícono de la app de la tarjeta: el logo del negocio sobre su color (o su inicial si no tiene logo).
const TAMANOS = [180, 192, 512];

export async function GET(_: Request, { params }: { params: Promise<{ codigo: string; tam: string }> }) {
  const { codigo, tam } = await params;
  const lado = TAMANOS.includes(Number(tam)) ? Number(tam) : 192;
  const t = await leerTarjeta(limpiarCodigo(codigo));
  const color = t?.programa?.color || t?.negocio.color || "#141414";
  const logo = t?.negocio.logo_url && /^https:\/\//.test(t.negocio.logo_url) ? t.negocio.logo_url : null;
  const inicial = (t?.negocio.nombre.trim().charAt(0) || "★").toUpperCase();
  // Zona segura para íconos "maskable": el contenido va dentro del 60 % central.
  const caja = Math.round(lado * 0.6);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: color }}>
        {logo ? (
          <div
            style={{
              width: caja,
              height: caja,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
              borderRadius: Math.round(caja * 0.22),
              padding: Math.round(caja * 0.08),
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={logo} width={Math.round(caja * 0.84)} height={Math.round(caja * 0.84)} style={{ objectFit: "contain" }} />
          </div>
        ) : (
          <div style={{ color: "#ffffff", fontSize: Math.round(lado * 0.5), fontWeight: 700 }}>{inicial}</div>
        )}
      </div>
    ),
    { width: lado, height: lado, headers: { "cache-control": "public, max-age=86400" } },
  );
}
