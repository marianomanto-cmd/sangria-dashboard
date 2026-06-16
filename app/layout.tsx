import type { Metadata } from "next";
import { Archivo, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Display / titulares del rediseño (uppercase para labels de sección).
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Sangria · Project OS",
  description:
    "Herramienta interna de gestión de planes de medios, gastos reales y billing.",
};

// Script inline anti-FOUC: aplica la clase `dark` ANTES de que React
// hidrate, leyendo localStorage (preferencia explícita) o `prefers-color-
// scheme` del SO. No usamos libs externas (next-themes) para mantener el
// bundle chico y la lógica auditable. La var global `__setTheme` se
// reutiliza desde el ThemeToggle.
const themeInitScript = `(function(){try{var t=localStorage.getItem('sangria-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');}window.__setTheme=function(v){var root=document.documentElement;if(v==='dark'){root.classList.add('dark');}else{root.classList.remove('dark');}try{localStorage.setItem('sangria-theme',v);}catch(e){}};}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geist.variable} ${jetbrainsMono.variable} ${archivo.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
