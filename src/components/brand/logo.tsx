/**
 * Marca SurLabs: una aguja de brujula apuntando al SUR, no al norte.
 * Dice de donde somos sin escribirlo.
 *
 * Portado de `formularios/src/components/Logo.tsx`, que a su vez viene de la
 * landing (`surlabs/src/components/brand/Logo.tsx`). Son TRES repos y nada los
 * sincroniza: si el trazado cambia en la landing, hay que traerlo a mano aca.
 *
 * Dos diferencias deliberadas con el original:
 *  - Va monocromo. En la landing la mitad sur lleva el ember de Surlabs; aca el
 *    acento del producto es el verde del cliente, y pintar de verde la brujula
 *    de Surlabs le daria un color que no es suyo. Ver `marca.tsx`.
 *  - Sin la clase `.needle` ni su animacion: design.md §8 pide movimiento casi
 *    nulo, y una aguja que gira en la pantalla de login envejece rapido.
 */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Rosa de los vientos */}
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.25"
      />
      {/* Ejes cardinales, apenas insinuados */}
      <path
        d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
      {/* Mitad norte: apagada */}
      <path
        d="M12 3.6 15.1 12H8.9L12 3.6Z"
        fill="currentColor"
        fillOpacity="0.25"
      />
      {/* Mitad sur: plena contra el norte al 25%. Ese contraste es el punto. */}
      <path d="M12 20.4 8.9 12h6.2L12 20.4Z" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="size-7 shrink-0" />
      {/* La landing y el formulario sientan esta palabra en Bricolage con el eje
          wdth en 82. Aca la interfaz es Geist y design.md §5 pide dos familias,
          no tres, asi que se aproxima con peso y tracking negativo. */}
      <span className="text-[1.35rem] leading-none font-extrabold tracking-[-0.045em]">
        surlabs
      </span>
    </span>
  );
}
