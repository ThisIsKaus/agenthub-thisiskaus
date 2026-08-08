import type { ReactNode } from "react";

export type Tone = "paper" | "muted" | "faint" | "ok" | "copper" | "risk" | "watch";

export const HEX: Record<Tone, string> = {
  paper: "var(--fg)",
  muted: "var(--dek)",
  faint: "var(--graphite)",
  ok: "var(--ok)",
  copper: "var(--accent)",
  risk: "var(--fail)",
  watch: "var(--warn)",
};

const TEXT: Record<Tone, string> = {
  paper: "text-paper",
  muted: "text-muted-foreground",
  faint: "text-faint",
  ok: "text-ok",
  copper: "text-copper",
  risk: "text-risk",
  watch: "text-watch",
};

export type ZoneLine = { text: string; tone?: Tone };
export type ZoneId =
  | "browser"
  | "api"
  | "router"
  | "serving"
  | "corpus"
  | "source"
  | "frontier"
  | "backup";

export type Zone = {
  id: ZoneId;
  title: string;
  accent?: Tone;
  lines: ZoneLine[];
};

const BOX: Record<ZoneId, { x: number; y: number; w: number; h: number }> = {
  browser: { x: 52, y: 86, w: 238, h: 200 },
  api: { x: 356, y: 86, w: 266, h: 200 },
  router: { x: 688, y: 86, w: 250, h: 200 },
  serving: { x: 688, y: 340, w: 250, h: 180 },
  corpus: { x: 356, y: 340, w: 266, h: 180 },
  source: { x: 52, y: 340, w: 238, h: 180 },
  frontier: { x: 962, y: 150, w: 132, h: 118 },
  backup: { x: 962, y: 340, w: 132, h: 118 },
};

function ZoneRect({ zone }: { zone: Zone }) {
  const box = BOX[zone.id];
  const outbound = zone.id === "frontier" || zone.id === "backup";
  const stroke = zone.accent ? HEX[zone.accent] : "var(--rule)";
  const small = outbound;

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={8}
        fill={outbound ? "var(--haze)" : "var(--haze)"}
        stroke={stroke}
        strokeDasharray={outbound ? "4 4" : undefined}
      />
      <text
        x={box.x + 20}
        y={box.y + 30}
        fill="var(--fg)"
        fontFamily="Geist,sans-serif"
        fontSize={small ? 13.5 : 15}
        fontWeight={500}
      >
        {zone.title}
      </text>
      {zone.lines.map((line, index) => (
        <text
          key={`${zone.id}-${index}`}
          x={box.x + 20}
          y={box.y + 53 + index * (small ? 19 : 21)}
          fill={HEX[line.tone ?? "muted"]}
          fontFamily="Geist Mono,ui-monospace,monospace"
          fontSize={small ? 10.5 : 11}
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}

function ZoneCard({ zone }: { zone: Zone }) {
  const border = zone.accent ? { borderColor: HEX[zone.accent] } : undefined;
  return (
    <div className="border border-rule bg-panel2 px-4 py-3" style={border}>
      <div className="text-[13px] font-medium text-paper">{zone.title}</div>
      <ul className="mt-2 space-y-1">
        {zone.lines.map((line, index) => (
          <li
            key={`${zone.id}-m-${index}`}
            className={`break-words font-mono text-[11px] leading-relaxed ${TEXT[line.tone ?? "muted"]}`}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow({
  d,
  colour,
  dashed,
  marker,
}: {
  d: string;
  colour: string;
  dashed?: boolean;
  marker: string;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={colour}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "4 3" : undefined}
      markerEnd={`url(#${marker})`}
    />
  );
}

/**
 * The whole board: four zones plus two outbound sinks. Every arrow crossing the
 * perimeter points outward — there is no inbound path.
 */
export function BoardDiagram({ zones, caption }: { zones: Zone[]; caption: ReactNode }) {
  const byId = Object.fromEntries(zones.map((zone) => [zone.id, zone])) as Record<ZoneId, Zone>;
  const order: ZoneId[] = [
    "browser",
    "api",
    "router",
    "serving",
    "corpus",
    "source",
    "frontier",
    "backup",
  ];

  return (
    <div>
      <div className="hidden border border-rule bg-panel p-2.5 md:block">
        <svg
          viewBox="0 0 1120 620"
          className="block h-auto w-full"
          role="img"
          aria-label="Four-zone architecture map: browser, local API, router and serving, corpus and source, with outbound-only frontier and backup."
        >
          <defs>
            <marker id="bd-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9" fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" />
            </marker>
            <marker id="bd-f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9" fill="none" stroke="var(--graphite)" strokeWidth="1.4" strokeLinecap="round" />
            </marker>
          </defs>

          <rect
            x={26}
            y={52}
            width={1068}
            height={500}
            rx={14}
            fill="none"
            stroke="var(--fail)"
            strokeWidth={1}
            strokeDasharray="6 5"
          />
          <text x={42} y={44} fill="var(--fail)" fontFamily="Geist Mono,monospace" fontSize={11.5}>
            SECURITY PERIMETER · zero inbound · nothing listens beyond loopback
          </text>

          {order.map((id) => (byId[id] ? <ZoneRect key={id} zone={byId[id]} /> : null))}

          <Arrow d="M292 186 L352 186" colour="var(--accent)" marker="bd-c" />
          <text x={300} y={176} fill="var(--accent)" fontFamily="Geist Mono,monospace" fontSize={10.5}>
            loopback
          </text>
          <Arrow d="M624 186 L684 186" colour="var(--graphite)" marker="bd-f" />
          <Arrow d="M813 288 L813 336" colour="var(--graphite)" marker="bd-f" />
          <Arrow d="M684 430 L626 430" colour="var(--graphite)" marker="bd-f" />
          <Arrow d="M352 430 L294 430" colour="var(--graphite)" marker="bd-f" />
          <Arrow d="M940 200 L958 200" colour="var(--accent)" marker="bd-c" dashed />
          <Arrow d="M940 398 L958 398" colour="var(--graphite)" marker="bd-f" dashed />

          <text x={42} y={580} fill="var(--graphite)" fontFamily="Geist Mono,monospace" fontSize={10.5}>
            Every arrow crossing the perimeter points outward. There is no inbound path, and no port to find.
          </text>
        </svg>
      </div>

      <div className="grid gap-px md:hidden">
        {order.map((id) => (byId[id] ? <ZoneCard key={id} zone={byId[id]} /> : null))}
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-faint">
          Every connection crossing the perimeter points outward. There is no inbound path.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10.5px] text-muted-foreground">
        <Key colour={HEX.copper}>loopback · never leaves the machine</Key>
        <Key colour={HEX.ok}>local compute · zero marginal cost</Key>
        <Key colour={HEX.risk}>a control that must hold</Key>
        <Key colour={HEX.faint}>outbound only</Key>
      </div>
      <p className="mt-2 font-mono text-[10px] text-faint">{caption}</p>
    </div>
  );
}

function Key({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <i aria-hidden className="inline-block h-[2px] w-5" style={{ background: colour }} />
      {children}
    </span>
  );
}
