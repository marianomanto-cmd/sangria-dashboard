"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  geoBounds,
  geoCentroid,
  geoMercator,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { feature } from "topojson-client";
import type { Feature, Geometry } from "geojson";
import topology from "world-atlas/countries-110m.json";
import { RotateCcw } from "lucide-react";
import { useChartColors } from "@/components/chart-kit";
import { formatUsd } from "@/lib/format";
import { type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Mapa de América (SVG, d3-geo). On-brand, animado e interactivo:
//   • El recuadro se dimensiona al ASPECT del contenido (no queda un mapa chico
//     flotando en una caja ancha).
//   • Zoom a lo filtrado (auto-fit al bounding box de los mercados visibles).
//   • Zoom con la ruedita del mouse + pan arrastrando (transform sobre un <g>).
// Reemplaza a react-simple-maps (que no soporta React 19).
// ════════════════════════════════════════════════════════════════════════════

const PAD = 16;
const MAX_H = 600;
const MIN_H = 240;
const MIN_K = 1;
const MAX_K = 8;

type CountryFeature = Feature<Geometry, { name: string }>;

const AMERICAS_FEATURES: CountryFeature[] = (() => {
  const topo = topology as unknown as Parameters<typeof feature>[0];
  const obj = (
    topo as unknown as { objects: { countries: Parameters<typeof feature>[1] } }
  ).objects.countries;
  const fc = feature(topo, obj) as unknown as { features: CountryFeature[] };
  // Hemisferio occidental, hasta Canadá. Excluimos Groenlandia.
  const EXCLUDE = new Set(["Greenland"]);
  return fc.features.filter((f) => {
    if (EXCLUDE.has(f.properties.name)) return false;
    const c = geoCentroid(f);
    return c[0] > -170 && c[0] < -30 && c[1] > -58 && c[1] < 75;
  });
})();

const FEATURES_BY_NAME = new Map(
  AMERICAS_FEATURES.map((f) => [f.properties.name, f]),
);

const AMERICAS_FC = {
  type: "FeatureCollection" as const,
  features: AMERICAS_FEATURES,
};

export type MapPoint = {
  id: string;
  name: string;
  value: number; // inversión planeada
  count: number; // # de activaciones
  lat: number;
  lng: number;
  featureName?: string; // nombre del país en world-atlas (para fitear el zoom)
  kind?: "country" | "region";
};

type BBox = [number, number, number, number]; // [w, s, e, n]

// Bounding box geográfico a encuadrar según los mercados visibles.
function computeBBox(points: MapPoint[]): BBox {
  if (points.length === 0) {
    const b = geoBounds(AMERICAS_FC as GeoPermissibleObjects);
    return [b[0][0], b[0][1], b[1][0], b[1][1]];
  }
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    let pw: number;
    let ps: number;
    let pe: number;
    let pn: number;
    const f = p.featureName ? FEATURES_BY_NAME.get(p.featureName) : undefined;
    if (f) {
      const b = geoBounds(f);
      const sx = b[1][0] - b[0][0];
      const sy = b[1][1] - b[0][1];
      if (b[0][0] <= b[1][0] && sx <= 50 && sy <= 50) {
        [pw, ps] = b[0];
        [pe, pn] = b[1];
      } else {
        const span = 42; // país enorme (US/Canadá con Alaska) → centroide + span
        pw = p.lng - span / 2;
        pe = p.lng + span / 2;
        ps = p.lat - span / 2;
        pn = p.lat + span / 2;
      }
    } else {
      const span = p.kind === "region" ? 55 : 22;
      pw = p.lng - span / 2;
      pe = p.lng + span / 2;
      ps = p.lat - span / 2;
      pn = p.lat + span / 2;
    }
    w = Math.min(w, pw);
    s = Math.min(s, ps);
    e = Math.max(e, pe);
    n = Math.max(n, pn);
  }
  const mx = (e - w) * 0.08 || 3;
  const my = (n - s) * 0.08 || 3;
  return [w - mx, Math.max(-82, s - my), e + mx, Math.min(82, n + my)];
}

// Aspect (ancho/alto) del bbox ya proyectado (Mercator default; el ratio es
// invariante a escala/traslación, así que sirve para dimensionar el recuadro).
function bboxAspect([w, s, e, n]: BBox): number {
  const p = geoMercator();
  const a = p([w, n]);
  const b = p([e, s]);
  if (!a || !b) return 0.85;
  const r = Math.abs(b[0] - a[0]) / Math.abs(b[1] - a[1]);
  return Number.isFinite(r) && r > 0 ? r : 0.85;
}

function bboxPolygon([w, s, e, n]: BBox) {
  return {
    type: "Polygon" as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

// Evita que el recuadro quede una tira finita (footprint LATAM = muy alto) o
// demasiado panorámico: si el aspect cae fuera de [minA, maxA] ensanchamos el
// bbox geográfico (más océano/contexto a los lados) para acercarlo al rango.
function clampBBoxAspect(bbox: BBox, minA: number, maxA: number): BBox {
  let [w, s, e, n] = bbox;
  const a = bboxAspect([w, s, e, n]);
  if (a > 0 && a < minA) {
    const cx = (w + e) / 2;
    const half = ((e - w) / 2) * (minA / a);
    w = cx - half;
    e = cx + half;
  } else if (a > maxA) {
    const cy = (s + n) / 2;
    const half = ((n - s) / 2) * (a / maxA);
    s = Math.max(-82, cy - half);
    n = Math.min(82, cy + half);
  }
  return [w, s, e, n];
}

function clampPan(x: number, y: number, k: number, W: number, H: number) {
  const minX = W * (1 - k);
  const minY = H * (1 - k);
  return {
    x: Math.min(0, Math.max(minX, x)),
    y: Math.min(0, Math.max(minY, y)),
  };
}

export function AmericasMap({
  points,
  selectedId,
  onSelect,
  lang = "es",
}: {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  lang?: Language;
}) {
  const c = useChartColors();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [availW, setAvailW] = useState(720);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  // Medimos el ancho disponible (la celda) para dimensionar el recuadro.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvailW(el.clientWidth || 720));
    ro.observe(el);
    setAvailW(el.clientWidth || 720);
    return () => ro.disconnect();
  }, []);

  const maxValue = Math.max(1, ...points.map((p) => p.value));
  const r = useMemo(
    () => scaleSqrt().domain([0, maxValue]).range([6, 30]),
    [maxValue],
  );

  // Layout + proyección: el recuadro toma el aspect del contenido y la
  // proyección se fitea a esos píxeles → el mapa llena la caja.
  const { svgW, svgH, projection, paths } = useMemo(() => {
    // Aspect acotado a [0.9, 1.5] para que el recuadro no quede una tira.
    const bbox = clampBBoxAspect(computeBBox(points), 0.9, 1.5);
    const aspect = bboxAspect(bbox);
    let h = Math.min(MAX_H, availW / aspect);
    h = Math.max(MIN_H, h);
    let w = h * aspect;
    if (w > availW) {
      w = availW;
      h = w / aspect;
    }
    const projection = geoMercator().fitExtent(
      [[PAD, PAD], [w - PAD, h - PAD]],
      bboxPolygon(bbox) as GeoPermissibleObjects,
    );
    const path = geoPath(projection);
    const paths = AMERICAS_FEATURES.map((f) => ({
      name: f.properties.name,
      d: path(f) ?? "",
    }));
    return { svgW: w, svgH: h, projection, paths };
  }, [points, availW]);

  // Reset del zoom cuando cambia el set filtrado (para que el auto-fit mande).
  // Patrón render-phase setState (ajustar estado cuando cambia un input).
  const pointsKey = useMemo(
    () => points.map((p) => p.id).sort().join(","),
    [points],
  );
  const [lastKey, setLastKey] = useState(pointsKey);
  if (pointsKey !== lastKey) {
    setLastKey(pointsKey);
    setZoom({ k: 1, x: 0, y: 0 });
  }

  // Puntos proyectados (coords base, sin el transform de zoom).
  const projected = useMemo(
    () =>
      points
        .map((p) => {
          const xy = projection([p.lng, p.lat]);
          return xy ? { ...p, bx: xy[0], by: xy[1], radius: r(p.value) } : null;
        })
        .filter(
          (p): p is MapPoint & { bx: number; by: number; radius: number } =>
            p !== null,
        )
        .sort((a, b) => b.radius - a.radius),
    [points, projection, r],
  );

  // Zoom con la ruedita (listener nativo non-passive para poder preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      const rect = svg!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (ev.clientX - rect.left) * (svgW / rect.width);
      const py = (ev.clientY - rect.top) * (svgH / rect.height);
      setZoom((z) => {
        const factor = ev.deltaY < 0 ? 1.2 : 1 / 1.2;
        const k = Math.min(MAX_K, Math.max(MIN_K, z.k * factor));
        if (k === z.k) return z;
        // mantener fijo el punto bajo el cursor
        const nx = px - ((px - z.x) / z.k) * k;
        const ny = py - ((py - z.y) / z.k) * k;
        return { k, ...clampPan(nx, ny, k, svgW, svgH) };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgW, svgH]);

  // Pan arrastrando (solo cuando hay zoom).
  const onPointerDown = (ev: React.PointerEvent) => {
    if (zoom.k <= 1) return;
    dragRef.current = { px: ev.clientX, py: ev.clientY, moved: false };
    svgRef.current?.setPointerCapture(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (ev.clientX - d.px) * (svgW / rect.width);
    const dy = (ev.clientY - d.py) * (svgH / rect.height);
    if (Math.abs(ev.clientX - d.px) + Math.abs(ev.clientY - d.py) > 3) d.moved = true;
    d.px = ev.clientX;
    d.py = ev.clientY;
    setZoom((z) => ({ ...z, ...clampPan(z.x + dx, z.y + dy, z.k, svgW, svgH) }));
  };
  const endDrag = (ev: React.PointerEvent) => {
    if (dragRef.current) svgRef.current?.releasePointerCapture?.(ev.pointerId);
    // pequeño delay para que el onClick del bubble pueda leer `moved`
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const active = hover ?? selectedId ?? null;
  const hovered = projected.find((p) => p.id === active) ?? null;
  const hoveredX = hovered ? zoom.x + hovered.bx * zoom.k : 0;
  const hoveredY = hovered ? zoom.y + hovered.by * zoom.k : 0;
  const zoomed = zoom.k > 1.001;

  return (
    <div ref={wrapRef} className="w-full flex justify-center">
      <div
        className="relative rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden"
        style={{ width: svgW, height: svgH }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          width={svgW}
          height={svgH}
          className={zoomed ? "cursor-grab active:cursor-grabbing touch-none" : "touch-none"}
          role="img"
          aria-label={lang === "es" ? "Mapa de América" : "Map of the Americas"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <defs>
            <radialGradient id="am-bubble" cx="50%" cy="40%" r="65%">
              <stop offset="0%" stopColor={c.accent2} stopOpacity={0.95} />
              <stop offset="100%" stopColor={c.accent} stopOpacity={0.85} />
            </radialGradient>
            <filter id="am-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Países (escalan con el zoom; stroke no-escalable para que quede fino) */}
          <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`}>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={c.grid}
                stroke={c.line}
                strokeWidth={0.5}
                opacity={0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Burbujas: posición sigue el zoom, tamaño constante (separan los
              solapados al hacer zoom). */}
          <g>
            {projected.map((p) => {
              const X = zoom.x + p.bx * zoom.k;
              const Y = zoom.y + p.by * zoom.k;
              const isActive = p.id === active;
              return (
                <g
                  key={p.id}
                  transform={`translate(${X},${Y})`}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(p.id)}
                  onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
                  onClick={() => {
                    if (dragRef.current?.moved) return;
                    onSelect?.(selectedId === p.id ? null : p.id);
                  }}
                >
                  <circle r={p.radius} fill="none" stroke={c.accent} strokeWidth={1} opacity={0.5}>
                    <animate
                      attributeName="r"
                      values={`${p.radius};${p.radius + 12}`}
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.5;0"
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle
                    r={p.radius}
                    fill="url(#am-bubble)"
                    stroke={isActive ? c.ink : c.accent2}
                    strokeWidth={isActive ? 2 : 0.8}
                    filter={isActive ? "url(#am-glow)" : undefined}
                    opacity={active && !isActive ? 0.55 : 1}
                  />
                  {p.radius >= 13 && (
                    <text
                      textAnchor="middle"
                      dy="0.32em"
                      fontSize={Math.min(13, p.radius * 0.7)}
                      fontWeight={700}
                      fill="#fff"
                      style={{ pointerEvents: "none", fontFamily: "var(--font-mono)" }}
                    >
                      {p.count}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip flotante */}
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-line bg-paper-2 px-3 py-2 shadow-lg"
            style={{
              left: `${(hoveredX / svgW) * 100}%`,
              top: `${(hoveredY / svgH) * 100}%`,
              transform: "translate(-50%, calc(-100% - 12px))",
            }}
          >
            <p className="text-xs font-semibold text-ink whitespace-nowrap">
              {hovered.name}
            </p>
            <p className="text-[11px] text-muted whitespace-nowrap">
              {hovered.count}{" "}
              {lang === "es"
                ? hovered.count === 1
                  ? "activación"
                  : "activaciones"
                : hovered.count === 1
                  ? "activation"
                  : "activations"}{" "}
              · {formatUsd(hovered.value)}
            </p>
          </div>
        )}

        {/* Reset zoom */}
        {zoomed && (
          <button
            type="button"
            onClick={() => setZoom({ k: 1, x: 0, y: 0 })}
            title={lang === "es" ? "Reset zoom" : "Reset zoom"}
            className="absolute top-3 right-3 inline-flex items-center justify-center w-8 h-8 rounded-md border border-line bg-paper-2/80 backdrop-blur text-muted hover:text-ink"
          >
            <RotateCcw size={14} />
          </button>
        )}

        {/* Leyenda */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-paper-2/80 backdrop-blur px-2.5 py-1.5 border border-line">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.accent }} />
          <span className="text-[10px] text-muted">
            {lang === "es"
              ? "Tamaño = inversión · número = activaciones · rueda para zoom"
              : "Size = spend · number = activations · scroll to zoom"}
          </span>
        </div>
      </div>
    </div>
  );
}
