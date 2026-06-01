// Primitivo de botón: fuente de verdad única del look de los botones de la app
// (antes el botón primario `bg-ink` vivía inline, repetido en ~13 archivos, y
// driftaba en padding/tamaño/estados).
//
// - `Button`: para elementos <button>.
// - `buttonVariants()`: devuelve el className para reusar el mismo look en
//   <Link>/<a> (que no son <button>). Mismo patrón que shadcn/ui.
//
// El focus ring lo pone el `*:focus-visible` global de globals.css (accent), por
// eso NO seteamos outline acá.
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "xs" | "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  secondary: "border border-line bg-white dark:bg-paper-2 text-ink hover:bg-paper-2",
  ghost: "text-muted hover:text-ink hover:bg-paper-2",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-4 py-2 text-sm",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className: className ?? "" })}
      {...props}
    />
  );
}
