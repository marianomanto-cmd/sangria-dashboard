"use client";

// ════════════════════════════════════════════════════════════════════════════
// Selector de mercado — cargar un mercado dejó de ser un input de texto.
//
// El catálogo se había llenado de variantes del mismo lugar ("Panama",
// "Panamá", "Panama City", "Ciudad de Panamá" eran cuatro mercados distintos)
// porque el nombre se tipeaba libre. Acá se ELIGE: nivel + país + plaza, y el
// nombre lo arma `buildMarketName` (lib/market-nomenclature.ts). Dos personas
// que quieran cargar el mismo lugar terminan en el mismo nombre y el mismo
// slug — y el slug es único por cliente, así que el duplicado ya no entra.
//
// Lo único que se escribe a mano es la plaza cuando no está en la lista
// ("Otra…") y la etiqueta de un grupo. Ni siquiera ahí se puede romper la
// forma: el país sale del select y el nombre se arma igual.
// ════════════════════════════════════════════════════════════════════════════

import {
  COUNTRY_NAMES,
  NOMENCLATURE_HINT,
  REGION_NAMES,
  buildMarketName,
  parseMarketName,
  placesForCountry,
  type MarketFormValue,
} from "@/lib/market-nomenclature";

export type MarketPickerState = {
  level: "country" | "city" | "multi" | "region";
  country: string;
  /** Plaza elegida del select. `OTHER_PLACE` = "Otra…" (se escribe abajo). */
  place: string;
  customPlace: string;
  /** Etiqueta opcional del grupo, para distinguir dos "Varios" del mismo país. */
  label: string;
  region: string;
};

export const OTHER_PLACE = "__otra__";

export function emptyPickerState(): MarketPickerState {
  return { level: "country", country: "", place: "", customPlace: "", label: "", region: "" };
}

/** Precarga el selector desde un nombre ya guardado (editar). */
export function pickerStateFromName(name: string): MarketPickerState {
  const v = parseMarketName(name);
  const s = emptyPickerState();
  if (!v) return s;
  switch (v.level) {
    case "country":
      return { ...s, level: "country", country: v.country };
    case "multi":
      return { ...s, level: "multi", country: v.country, label: v.label ?? "" };
    case "city": {
      const known = placesForCountry(v.country).some((p) => p.name === v.place);
      return {
        ...s,
        level: "city",
        country: v.country,
        place: known ? v.place : OTHER_PLACE,
        customPlace: known ? "" : v.place,
      };
    }
    case "region":
      return { ...s, level: "region", region: v.region };
  }
}

/** Lo que eligió el usuario, o null si todavía falta algo. */
export function pickerToFormValue(s: MarketPickerState): MarketFormValue | null {
  if (s.level === "region") return s.region ? { level: "region", region: s.region } : null;
  if (!s.country) return null;
  if (s.level === "country") return { level: "country", country: s.country };
  if (s.level === "multi") return { level: "multi", country: s.country, label: s.label.trim() };
  const place = s.place === OTHER_PLACE ? s.customPlace.trim() : s.place;
  return place ? { level: "city", country: s.country, place } : null;
}

/** Nombre que va a quedar guardado — se muestra en vivo debajo del form. */
export function pickerPreviewName(s: MarketPickerState): string | null {
  const v = pickerToFormValue(s);
  return v ? buildMarketName(v) : null;
}

const SELECT_CLASS =
  "w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-xs disabled:opacity-50";
const LABEL_CLASS = "block text-[11px] uppercase tracking-[0.06em] text-muted mb-1";

const LEVELS: { value: MarketPickerState["level"]; label: string; help: string }[] = [
  { value: "country", label: "País entero", help: "Argentina (País)" },
  { value: "city", label: "Una ciudad o plaza", help: "México - Ciudad de México" },
  { value: "multi", label: "Varias plazas del país", help: "Argentina - Varios" },
  { value: "region", label: "Región (varios países)", help: "Centroamérica · LATAM" },
];

export function MarketPicker({
  value,
  onChange,
  disabled,
  idPrefix = "mkt",
}: {
  value: MarketPickerState;
  onChange: (v: MarketPickerState) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const places = value.country ? placesForCountry(value.country) : [];
  const cities = places.filter((p) => p.kind !== "state");
  const states = places.filter((p) => p.kind === "state");
  const preview = pickerPreviewName(value);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{NOMENCLATURE_HINT}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${idPrefix}-level`}>
            Nivel
          </label>
          <select
            id={`${idPrefix}-level`}
            value={value.level}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                level: e.target.value as MarketPickerState["level"],
                // Cambiar de nivel limpia lo que ya no aplica.
                place: "",
                customPlace: "",
              })
            }
            className={SELECT_CLASS}
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label} — {l.help}
              </option>
            ))}
          </select>
        </div>

        {value.level === "region" ? (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${idPrefix}-region`}>
              Región
            </label>
            <select
              id={`${idPrefix}-region`}
              value={value.region}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, region: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">Elegí una región…</option>
              {REGION_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={LABEL_CLASS} htmlFor={`${idPrefix}-country`}>
              País
            </label>
            <select
              id={`${idPrefix}-country`}
              value={value.country}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, country: e.target.value, place: "", customPlace: "" })
              }
              className={SELECT_CLASS}
            >
              <option value="">Elegí un país…</option>
              {COUNTRY_NAMES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {value.level === "city" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} htmlFor={`${idPrefix}-place`}>
              Ciudad o plaza
            </label>
            <select
              id={`${idPrefix}-place`}
              value={value.place}
              disabled={disabled || !value.country}
              onChange={(e) => onChange({ ...value, place: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">
                {value.country ? "Elegí una plaza…" : "Elegí primero el país"}
              </option>
              {cities.length > 0 && (
                <optgroup label="Ciudades">
                  {cities.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {states.length > 0 && (
                <optgroup label="Estados">
                  {states.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={OTHER_PLACE}>Otra…</option>
            </select>
          </div>
          {value.place === OTHER_PLACE && (
            <div>
              <label className={LABEL_CLASS} htmlFor={`${idPrefix}-custom`}>
                Nombre de la plaza
              </label>
              <input
                id={`${idPrefix}-custom`}
                type="text"
                value={value.customPlace}
                disabled={disabled}
                placeholder="ej. Punta del Este"
                onChange={(e) => onChange({ ...value, customPlace: e.target.value })}
                className={SELECT_CLASS}
              />
            </div>
          )}
        </div>
      )}

      {value.level === "multi" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS} htmlFor={`${idPrefix}-label`}>
              Etiqueta del grupo (opcional)
            </label>
            <input
              id={`${idPrefix}-label`}
              type="text"
              value={value.label}
              disabled={disabled}
              placeholder="ej. T1 — sólo si hay más de un grupo"
              onChange={(e) => onChange({ ...value, label: e.target.value })}
              className={SELECT_CLASS}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Va a quedar como{" "}
        {preview ? (
          <strong className="text-ink font-medium">{preview}</strong>
        ) : (
          <span className="italic">— completá los campos</span>
        )}
      </p>
    </div>
  );
}
