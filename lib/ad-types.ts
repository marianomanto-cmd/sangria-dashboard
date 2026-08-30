// Semilla del catálogo de TIPOS DE AD de un cliente.
//
// No es un catálogo global: cada cliente tiene su lista en `ad_types` y la
// edita a gusto (ver /configuracion/clientes/[slug]). Esto es sólo lo que
// carga el botón "Cargar los estándar", para no tipear siete filas a mano en
// cada cliente nuevo.
//
// Vive en lib/ y no en la server action porque un archivo "use server" sólo
// puede exportar funciones async.
//
// `requiresDetail` marca las entradas tipo "Otro": el ad además exige escribir
// a mano de qué se trata (ver lib/plan-traffic.ts).
export const DEFAULT_AD_TYPES: {
  slug: string;
  name: string;
  requiresDetail?: boolean;
}[] = [
  { slug: "carousel", name: "Carrusel" },
  { slug: "single_image", name: "Single image" },
  { slug: "video", name: "Video" },
  { slug: "dgen_set", name: "DGEN set" },
  { slug: "pmax_set", name: "PMAX set" },
  { slug: "yt_video", name: "YT Video" },
  { slug: "other", name: "Otro", requiresDetail: true },
];
