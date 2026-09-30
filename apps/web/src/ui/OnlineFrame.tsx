// Encabezado de las pantallas online: las MISMAS clases que `AppFrame` (`.app-frame`, `.topbar`,
// `.topbar-brand`…) para que se vea igual, pero sin destinos de navegación (dependen del Router, que
// esta ruta no monta) y con `tengen` como `<a href="/">` de verdad: navegación completa del documento.
import type { ComponentChildren } from "preact";

export function OnlineFrame({ children }: { children: ComponentChildren }) {
  return (
    <div class="app-frame">
      <header class="topbar">
        <div class="topbar-brand">
          <a class="topbar-home" href="/" title="Volver al menú">
            tengen
          </a>
          <span class="topbar-sep" aria-hidden="true">
            ·
          </span>
          <span class="topbar-location">Partida online</span>
        </div>
      </header>
      <div class="app-frame-main app-frame-main--bare">{children}</div>
    </div>
  );
}
