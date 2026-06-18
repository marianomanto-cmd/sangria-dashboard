"use client";

// Navegación principal en el HEADER (solo desktop, ≥ lg). Reemplaza al sidebar
// vertical para liberar todo el ancho de la ventana al contenido. En mobile no
// se renderiza: ahí manda el drawer (Sidebar) + hamburguesa.
//
// Tira horizontal ícono+label que NUNCA scrollea: mide el ancho disponible y
// los anchos de cada item, muestra los que entran y mete el resto en un menú
// "Más ▾" al final. Recalcula con un ResizeObserver (y al cargar las fuentes).

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { buildHrefWithClient } from "@/lib/client-filter";
import { FOOTER_NAV, isNavActive, type NavEntry, PRIMARY_NAV } from "@/lib/nav";

const ITEMS: NavEntry[] = [...PRIMARY_NAV, ...FOOTER_NAV];

// useLayoutEffect tira warning en SSR; en server caemos a useEffect.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const clientSlug = searchParams?.get("client") ?? null;

  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const widthsRef = useRef<number[]>([]);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(ITEMS.length);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Cuántos items entran en el ancho disponible (reservando el botón "Más" si
  // hace falta). Los anchos de los items no cambian (labels fijos): se cachean.
  const recompute = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    itemRefs.current.forEach((el, i) => {
      if (el) widthsRef.current[i] = el.getBoundingClientRect().width;
    });
    const widths = widthsRef.current;
    for (let i = 0; i < ITEMS.length; i++) if (widths[i] == null) return; // aún sin medir
    const GAP = 2; // gap-0.5
    const avail = nav.clientWidth;
    const howMany = (reserve: number) => {
      let used = 0;
      let n = 0;
      for (let i = 0; i < ITEMS.length; i++) {
        used += widths[i] + GAP;
        if (used <= avail - reserve) n++;
        else break;
      }
      return n;
    };
    let n = howMany(0);
    if (n < ITEMS.length) {
      const moreW = moreBtnRef.current?.getBoundingClientRect().width ?? 84;
      n = howMany(moreW + GAP);
    }
    setVisible(n);
  }, []);

  useIsoLayoutEffect(() => {
    recompute();
    const nav = navRef.current;
    if (!nav) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(nav);
    // Re-medir cuando terminan de cargar las fuentes (evita medir con métricas
    // viejas) y deja medido el botón "Más" real.
    document.fonts?.ready.then(recompute).catch(() => {});
    return () => ro.disconnect();
  }, [recompute]);

  // Cerrar el dropdown al clickear afuera / scrollear / resize.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const overflow = ITEMS.slice(visible);
  const overflowActive = overflow.some((e) =>
    isNavActive(pathname, e.href, e.exact),
  );

  const itemClass = (active: boolean) =>
    `group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap shrink-0 transition-colors ${
      active
        ? "bg-accent-soft text-accent font-medium"
        : "text-ink-2 hover:bg-paper-2 hover:text-ink"
    }`;

  return (
    <nav
      ref={navRef}
      aria-label="Navegación principal"
      className="hidden lg:flex flex-1 min-w-0 items-center gap-0.5 overflow-hidden"
    >
      {ITEMS.slice(0, visible).map((entry, i) => {
        const Icon = entry.icon;
        const active = isNavActive(pathname, entry.href, entry.exact);
        return (
          <Link
            key={entry.href}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            href={buildHrefWithClient(entry.href, clientSlug)}
            data-active={active}
            title={entry.label}
            className={itemClass(active)}
          >
            <Icon size={15} strokeWidth={1.9} className="shrink-0" />
            <span>{entry.label}</span>
          </Link>
        );
      })}

      {overflow.length > 0 && (
        <button
          ref={moreBtnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            const r = moreBtnRef.current?.getBoundingClientRect();
            if (r) {
              setPos({
                top: r.bottom + 4,
                right: Math.max(8, window.innerWidth - r.right),
              });
            }
            setOpen((o) => !o);
          }}
          className={`${itemClass(overflowActive)} cursor-pointer`}
        >
          <span>Más</span>
          <ChevronDown size={14} className="shrink-0" />
        </button>
      )}

      {open && pos && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-[12rem] rounded-md border border-line bg-surface dark:bg-paper-2 py-1 shadow-lg"
        >
          {overflow.map((entry) => {
            const Icon = entry.icon;
            const active = isNavActive(pathname, entry.href, entry.exact);
            return (
              <Link
                key={entry.href}
                role="menuitem"
                href={buildHrefWithClient(entry.href, clientSlug)}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-3 py-1.5 text-[13px] whitespace-nowrap ${
                  active
                    ? "text-accent font-medium"
                    : "text-ink-2 hover:bg-paper-2 hover:text-ink"
                }`}
              >
                <Icon size={15} strokeWidth={1.9} className="shrink-0" />
                <span>{entry.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
