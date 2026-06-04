"use client";

import { useMemo, useState } from "react";
import { geoCentroid, geoMercator, geoPath } from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import topology from "world-atlas/countries-110m.json";
import { useChartColors } from "@/components/chart-kit";
import { formatUsd } from "@/lib/format";
import { type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Mapa de América (SVG, d3-geo) con burbujas por mercado. On-brand, animado.
// Reemplaza a react-simple-maps (que no soporta React 19): proyectamos y
// dibujamos nosotros. La topología se filtra a las features del hemisferio
// occidental y la proyección se "fitea" a un viewBox fijo (responsive vía
// preserveAspectRatio).
// ════════════════════════════════════════════════════════════════════════════

const VB_W = 720;
const VB_H = 940;

// FeatureCollection de América + paths proyectados — se computan una sola vez
// a nivel módulo (la topología y la proyección son fijas).
const AMERICAS = (() => {
  const topo = topology as unknown as Parameters<typeof feature>[0];
  const obj = (
    topo as unknown as { objects: { countries: Parameters<typeof feature>[1] } }
  ).objects.countries;
  const fc = feature(topo, obj) as unknown as FeatureCollection<
    Geometry,
    { name: string }
  >;
  const features = fc.features as Feature<Geometry, { name: string }>[];
  const americasFeatures = features.filter((f) => {
    const c = geoCentroid(f);
    return c[0] > -170 && c[0] < -30 && c[1] > -58 && c[1] < 75;
  });
  const americasFc = {
    type: "FeatureCollection" as const,
    features: americasFeatures,
  };
  const projection = geoMercator().fitSize([VB_W, VB_H], americasFc);
  const path = geoPath(projection);
  const paths = americasFeatures.map((f) => ({
    name: f.properties.name,
    d: path(f) ?? "",
  }));
  return { projection, paths };
})();

export type MapPoint = {
  id: string;
  name: string;
  value: number; // inversión planeada
  count: number; // # de activaciones
  lat: number;
  lng: number;
};

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
  const [hover, setHover] = useState<string | null>(null);

  const maxValue = Math.max(1, ...points.map((p) => p.value));
  const r = useMemo(
    () => scaleSqrt().domain([0, maxValue]).range([6, 34]),
    [maxValue],
  );

  // Proyectamos cada punto a coords del viewBox.
  const projected = points
    .map((p) => {
      const xy = AMERICAS.projection([p.lng, p.lat]);
      return xy ? { ...p, x: xy[0], y: xy[1], radius: r(p.value) } : null;
    })
    .filter((p): p is MapPoint & { x: number; y: number; radius: number } => p !== null)
    // dibujamos las más chicas arriba para que se puedan clickear
    .sort((a, b) => b.radius - a.radius);

  const active = hover ?? selectedId ?? null;
  const hovered = projected.find((p) => p.id === active) ?? null;

  return (
    <div className="relative rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto"
        style={{ maxHeight: 620 }}
        role="img"
        aria-label={lang === "es" ? "Mapa de América" : "Map of the Americas"}
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

        {/* Países */}
        <g>
          {AMERICAS.paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={c.grid}
              stroke={c.line}
              strokeWidth={0.4}
              opacity={0.55}
            />
          ))}
        </g>

        {/* Burbujas por mercado */}
        <g>
          {projected.map((p) => {
            const isActive = p.id === active;
            return (
              <g
                key={p.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
                onClick={() =>
                  onSelect?.(selectedId === p.id ? null : p.id)
                }
              >
                {/* anillo de pulso */}
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
                {p.radius >= 14 && (
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
            left: `${(hovered.x / VB_W) * 100}%`,
            top: `${(hovered.y / VB_H) * 100}%`,
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

      {/* Leyenda */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-paper-2/80 backdrop-blur px-2.5 py-1.5 border border-line">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.accent }} />
        <span className="text-[10px] text-muted">
          {lang === "es"
            ? "Tamaño = inversión · número = activaciones"
            : "Size = spend · number = activations"}
        </span>
      </div>
    </div>
  );
}
