"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { scaleSqrt } from "d3-scale";
import { formatUsd } from "@/lib/format";
import { type Language } from "@/lib/i18n";

// ════════════════════════════════════════════════════════════════════════════
// Mapa de mercados con Leaflet (tiles reales de CARTO, zoom/pan nativos). Cada
// mercado es una burbuja (divIcon) con el # de activaciones; tamaño = inversión.
// Leaflet se importa dinámicamente dentro del effect para no tocar `window` en
// SSR. La API (AmericasMap / MapPoint) se mantiene para no cambiar el resto.
// ════════════════════════════════════════════════════════════════════════════

export type MapPoint = {
  id: string;
  name: string;
  value: number; // inversión planeada
  count: number; // # de activaciones
  lat: number;
  lng: number;
  featureName?: string;
  kind?: "country" | "region";
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function AmericasMap({
  points,
  selectedIds,
  onSelect,
  lang = "es",
}: {
  points: MapPoint[];
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  lang?: Language;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs sin tipos de Leaflet (se importa dinámico): usamos unknown/any acotado.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const lastFitKey = useRef<string>("");
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Init del mapa (una sola vez, client-only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const isDark = document.documentElement.classList.contains("dark");
      const map = L.map(containerRef.current, {
        scrollWheelZoom: true,
        attributionControl: true,
        worldCopyJump: false,
      }).setView([-12, -65], 3);
      L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/${isDark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`,
        {
          subdomains: "abcd",
          maxZoom: 18,
          attribution: "&copy; OpenStreetMap &copy; CARTO",
        },
      ).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
      // recalcular tamaño cuando el contenedor cambia (grid responsive)
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(containerRef.current);
      (map as unknown as { _ro?: ResizeObserver })._ro = ro;
    })();
    return () => {
      cancelled = true;
      const map = mapRef.current as unknown as { _ro?: ResizeObserver } | null;
      map?._ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // (Re)dibujar burbujas al cambiar puntos / selección. selKey hace la dep
  // estable (selectedIds es un array nuevo en cada render).
  const selKey = (selectedIds ?? []).join(",");
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (points.length === 0) return;

    const selected = new Set(selKey ? selKey.split(",") : []);
    const maxValue = Math.max(1, ...points.map((p) => p.value));
    const diam = scaleSqrt().domain([0, maxValue]).range([18, 54]);
    const latlngs: [number, number][] = [];

    for (const p of points) {
      const d = Math.round(diam(p.value));
      const sel = selected.has(p.id);
      const html =
        `<div class="mkt-bubble${sel ? " mkt-bubble--sel" : ""}" ` +
        `style="width:${d}px;height:${d}px;font-size:${Math.min(13, Math.round(d * 0.42))}px">` +
        `${d >= 22 ? p.count : ""}</div>`;
      const icon = L.divIcon({
        html,
        className: "mkt-icon",
        iconSize: [d, d],
        iconAnchor: [d / 2, d / 2],
      });
      const tip =
        `<b>${escapeHtml(p.name)}</b><br>${p.count} ` +
        (lang === "es"
          ? p.count === 1
            ? "activación"
            : "activaciones"
          : p.count === 1
            ? "activation"
            : "activations") +
        ` · ${formatUsd(p.value)}`;
      L.marker([p.lat, p.lng], { icon, riseOnHover: true })
        .addTo(layer)
        .bindTooltip(tip, { direction: "top", offset: [0, -d / 2 - 2], opacity: 1 })
        .on("click", () => onSelectRef.current?.(p.id));
      latlngs.push([p.lat, p.lng]);
    }

    // Encuadrar solo cuando cambia el set de puntos (no al seleccionar).
    const fitKey = points
      .map((p) => p.id)
      .sort()
      .join(",");
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      if (latlngs.length === 1) {
        map.setView(latlngs[0], 5, { animate: false });
      } else {
        map.fitBounds(latlngs, { padding: [36, 36], maxZoom: 7, animate: false });
      }
    }
    map.invalidateSize();
  }, [ready, points, selKey, lang]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="rounded-lg border border-line overflow-hidden z-0"
        style={{ height: 560, width: "100%" }}
        aria-label={lang === "es" ? "Mapa de mercados" : "Markets map"}
      />
      <div className="mt-2 text-[11px] text-muted">
        {lang === "es"
          ? "Tamaño = inversión · número = activaciones · rueda para zoom"
          : "Size = spend · number = activations · scroll to zoom"}
      </div>
    </div>
  );
}
