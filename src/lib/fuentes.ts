import type { CSSProperties } from "react";

// Tipografías de los diseños de la tarjeta de sellos. Vienen de @fontsource (importadas en globals.css), así el build
// no depende de bajarlas de Google Fonts. El navegador descarga solo la del diseño que se ve.
const fuente = (familia: string, respaldo: string): { style: CSSProperties } => ({ style: { fontFamily: `'${familia}', ${respaldo}` } });

export const fuenteSerif = fuente("Playfair Display", "Georgia, serif");
export const fuenteMono = fuente("Space Mono", "ui-monospace, monospace");
export const fuenteTiza = fuente("Caveat", "cursive");
export const fuentePop = fuente("Anton", "Impact, sans-serif");
