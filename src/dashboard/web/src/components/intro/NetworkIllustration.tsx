const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 400;
const CENTER_Y = 200;
const CLIENT = { x: 170, label: 'ESP32 CLIENT' };
const GATEWAY = { x: 470, label: 'PYTHON GATEWAY' };
const UNBOUND = { x: 790, label: 'UNBOUND' };
const BIND9 = { x: 1100, label: 'BIND9' };
const CONTOUR_OFFSETS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];

function contourPath(offset: number): string {
  const points: string[] = [];
  for (let x = 0; x <= VIEW_WIDTH; x += 30) {
    const y = CENTER_Y + offset + Math.sin(x / 150 + offset / 40) * 36 + Math.cos(x / 310 - offset / 60) * 22;
    points.push(`${points.length === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

const CONTOUR_PATHS = CONTOUR_OFFSETS.map(contourPath);

export function NetworkIllustration() {
  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="One ESP32 client connects to the Python gateway, which forwards requests to Unbound and the local BIND9 authority"
    >
      <g className="contour-drift" fill="none" strokeWidth="1">
        {CONTOUR_PATHS.map((path, index) => <path key={index} d={path} className="stroke-forest-900/[0.12]" />)}
      </g>

      <g fill="none" strokeWidth="1.25" strokeLinecap="round">
        <path d={`M${CLIENT.x + 18} ${CENTER_Y} L${GATEWAY.x - 16} ${CENTER_Y}`} pathLength={1} className="draw-line stroke-forest-700" />
        <path d={`M${GATEWAY.x + 16} ${CENTER_Y} L${UNBOUND.x - 16} ${CENTER_Y}`} pathLength={1} className="draw-line stroke-gold-500" style={{ animationDelay: '350ms' }} />
        <path d={`M${UNBOUND.x + 16} ${CENTER_Y} L${BIND9.x - 16} ${CENTER_Y}`} pathLength={1} className="draw-line stroke-gold-500" style={{ animationDelay: '700ms' }} />
      </g>

      <g>
        <circle cx={CLIENT.x} cy={CENTER_Y} r={28} fill="none" className="stroke-forest-700/40" strokeDasharray="2 6" />
        <circle cx={CLIENT.x} cy={CENTER_Y} r={12} className="fill-forest-900 stroke-forest-700" strokeWidth="1.5" />
        <text x={CLIENT.x} y={CENTER_Y + 58} textAnchor="middle" className="fill-forest-800 font-mono text-[11px] tracking-[0.15em]">{CLIENT.label}</text>
        <text x={CLIENT.x} y={CENTER_Y - 42} textAnchor="middle" className="fill-forest-700 font-mono text-[10px] tracking-[0.12em]">DoT · mTLS</text>
      </g>

      <g>
        <circle cx={GATEWAY.x} cy={CENTER_Y} r={34} fill="none" className="orbit stroke-gold-500/60" strokeDasharray="3 6" />
        <circle cx={GATEWAY.x} cy={CENTER_Y} r={12} className="fill-forest-900 stroke-gold-500" strokeWidth="1.5" />
        <text x={GATEWAY.x} y={CENTER_Y + 58} textAnchor="middle" className="fill-forest-800 font-mono text-[11px] tracking-[0.13em]">{GATEWAY.label}</text>
      </g>

      <g>
        <circle cx={UNBOUND.x} cy={CENTER_Y} r={64} fill="none" className="orbit stroke-gold-500/50" strokeDasharray="1 7" strokeWidth="2" />
        <circle cx={UNBOUND.x} cy={CENTER_Y} r={18} className="fill-forest-900 stroke-gold-500" strokeWidth="1.5" />
        <text x={UNBOUND.x} y={CENTER_Y + 58} textAnchor="middle" className="fill-forest-800 font-mono text-[11px] tracking-[0.2em]">{UNBOUND.label}</text>
        <text x={(UNBOUND.x + BIND9.x) / 2} y={CENTER_Y - 18} textAnchor="middle" className="fill-forest-700 font-mono text-[10px] tracking-[0.18em]">DNSSEC VALIDATION</text>
      </g>

      <g>
        <circle cx={BIND9.x} cy={CENTER_Y} r={26} fill="none" className="stroke-forest-700/60" strokeWidth="1" />
        <circle cx={BIND9.x} cy={CENTER_Y} r={14} className="fill-forest-900" />
        <text x={BIND9.x} y={CENTER_Y + 58} textAnchor="middle" className="fill-forest-800 font-mono text-[11px] tracking-[0.2em]">{BIND9.label}</text>
        <text x={BIND9.x} y={CENTER_Y - 42} textAnchor="middle" className="fill-forest-700 font-mono text-[10px] tracking-[0.12em]">aegis.test</text>
      </g>
    </svg>
  );
}
