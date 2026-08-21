/**
 * Las dos marcas del producto: quien lo hizo y para quien.
 *
 * `Unamargo` es el isotipo del cliente -un mate con bombilla que forma una
 * ligadura-, el mismo archivo que usa su web publica.
 *
 * `Surlabs` es una aguja de brujula que apunta al SUR, no al norte: dice de
 * donde somos sin escribirlo.
 *
 * El lockup va MONOCROMO. La mitad sur solia ir en `--color-primary`, que
 * cuando el acento era el ember de Surlabs era su propio color. Ahora el acento
 * es el verde del cliente, y pintar la brujula de Surlabs de verde seria darle
 * a Surlabs un color que no es suyo, ademas de poner el acento en un lugar
 * donde no hay ninguna accion. Monocromo tambien es lo que corresponde a un
 * credito de proveedor: el sur se sigue leyendo por el contraste de opacidad.
 *
 * Los dos heredan el color con `currentColor`, asi sirven sobre claro y sobre
 * oscuro sin tener dos versiones.
 */

export function Unamargo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8256 7030"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M231 568.104C722.281 434.795 779.775 708.583 1260.46 1308.71C1549.24 1416.81 1649.63 1531.52 1625.83 1913.55C1851.2 2129.57 1856.88 2247.24 1949.23 2543.08C2001.47 2690.95 2010 2793.07 2035.63 2924.46C2035.3 2938.06 2134.65 3773.31 2134.71 3773.88V4623.29C2134.71 4893.33 2191.14 5092.84 2303.99 5221.81C2420.87 5346.76 2584.11 5409.23 2793.69 5409.23C2938.79 5409.23 3067.76 5379 3180.61 5318.54C3293.47 5254.06 3382.14 5157.33 3446.62 5028.35C3511.11 4895.35 3543.35 4730.1 3543.35 4532.61C3543.35 3264.32 3987.14 3015.38 4881.9 3015.38C4232.85 3579.44 4118.53 5318.54 5087.97 6177.03H3591.72V5795.92C3502.75 5901.18 3395.95 5987.91 3271.3 6056.12C3061.72 6168.97 2831.98 6225.39 2582.09 6225.39C2312.05 6225.39 2070.23 6173 1856.61 6068.21C1647.03 5963.42 1483.8 5804.21 1366.92 5590.6C1250.03 5372.95 1191.59 5096.87 1191.59 4762.34L1314 3234.24C1333.59 2900.93 1176.55 2409.5 1041.08 2093.77C762.856 1968.86 714.738 1845.23 784.329 1545.71L231 568.104Z" />\n      <path d="M7742.17 3362.67C9380.18 7296.92 3294.86 7056.75 4987.41 3362.67C6033.4 3619.39 6644.56 3620.22 7742.17 3362.67ZM7397.48 2832C7385.45 2984.99 7407.52 3053.74 7532.24 3127.07C6621.47 3327.26 6110.83 3327.41 5200.06 3127.07C5347.36 3048.85 5384.17 2981.89 5389.65 2832C6139.29 3002.67 6587.05 3001.46 7397.48 2832Z" />
    </svg>
  );
}

export function Surlabs({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.25"
      />
      <path
        d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
      {/* Norte apagado, sur pleno: el punto se sostiene con la opacidad. */}
      <path d="M12 3.6 15.1 12H8.9L12 3.6Z" fill="currentColor" fillOpacity="0.25" />
      <path d="M12 20.4 8.9 12h6.2L12 20.4Z" fill="currentColor" />
    </svg>
  );
}
