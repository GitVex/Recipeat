// Crate Label's photo filters (#87), as the inside of an SVG <filter>: one
// source for HalftoneFilter.vue and the filter lab (/lab/filters).
//
// The single-ink halftone below was the first; the riso after it is what the
// theme prints photos with now, and the halftone stays as a lab preset.
// Each photo is screened into dots of its own colour, each dot as large as the
// photo is bright there, on the dark between them.

// One cell of the screen: black at the centre, white by the corners. A pixel
// is inked where the photo is brighter than the cell is there.
export const HALFTONE_CELL = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><radialGradient id='g' r='.71'><stop offset='0' stop-color='#000'/><stop offset='1' stop-color='#fff'/></radialGradient><rect width='8' height='8' fill='url(#g)'/></svg>",
)}`;

/** The filter's primitives for a screen of `cell` pixels. */
export const halftonePrimitives = (cell: number) => `
<feImage href="${HALFTONE_CELL}" x="0" y="0" width="${cell}" height="${cell}" result="cell" />
<feTile in="cell" result="screen" />
<!-- Brightness, lifted a little so the darkest parts keep a speck. -->
<feColorMatrix in="SourceGraphic" values=".17 .57 .06 0 .2  .17 .57 .06 0 .2  .17 .57 .06 0 .2  0 0 0 1 0" result="tone" />
<feComposite in="tone" in2="screen" operator="arithmetic" k2="1" k3="-1" k4=".5" result="difference" />
<feComponentTransfer in="difference" result="dots">
  <feFuncR type="linear" slope="12" intercept="-5.5" />
</feComponentTransfer>
<feColorMatrix in="dots" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="mask" />
<feComposite in="SourceGraphic" in2="mask" operator="in" />
`.trim();

// ── Riso (#87) ──────────────────────────────────────────────────────────────
// The photo separated into four inks, blue, red, yellow and black, each
// screened at its own angle so the screens do not beat against each other,
// then printed onto cream paper a fraction of a pixel out of register.

/**
 * One tile of a dot screen whose rows run along (a, b): white at each dot's
 * centre, falling to black where the next dot is as near. Rows along a whole
 * vector repeat on a square of a² + b² units, so the tile is seamless at
 * 0° (1, 0), 26.6° (2, 1), 45° (1, 1) and 63.4° (1, 2).
 *
 * One square and no more: feImage draws its image afresh on every photo each
 * time the filter runs, and a tile of many squares cost a list of thumbnails
 * seconds where laying a small one many times costs milliseconds.
 */
function screenTile(a: number, b: number): { href: string; size: number } {
  const period = a * a + b * b;
  const radius = 0.71 * Math.sqrt(period); // the corner of a dot's square, so full coverage is reachable
  const dots = new Set<string>();
  for (let i = 0; i < period; i++)
    for (let j = 0; j < period; j++)
      dots.add(`${(((i * a - j * b) % period) + period) % period},${(i * b + j * a) % period}`);
  const circles = [...dots].flatMap((dot) => {
    const [x, y] = dot.split(",").map(Number) as [number, number];
    return [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map(
        (dy) =>
          `<circle cx='${x + dx * period}' cy='${y + dy * period}' r='${radius}' fill='url(#g)' style='mix-blend-mode:lighten'/>`,
      ),
    );
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${period} ${period}' width='64' height='64'><radialGradient id='g'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='#000'/></radialGradient><rect width='${period}' height='${period}'/>${circles.join("")}</svg>`;
  // Its dots are √period units apart: this many cells to the tile's side.
  return { href: `data:image/svg+xml,${encodeURIComponent(svg)}`, size: Math.sqrt(period) };
}

const RISO_SCREENS = {
  SCREEN_0: screenTile(1, 0),
  SCREEN_27: screenTile(2, 1),
  SCREEN_45: screenTile(1, 1),
  SCREEN_63: screenTile(1, 2),
};

// The inks in the order they go through the press: what each covers, the
// screen it goes through, and which way it lands out of register.
const INKS = [
  { name: "yellow", coverage: "0 0 1 0 0", from: "cmy", screen: "SCREEN_0", shift: [0.3, 0.5] },
  { name: "red", coverage: "0 1 0 0 0", from: "cmy", screen: "SCREEN_63", shift: [-0.5, 0.3] },
  { name: "blue", coverage: "1 0 0 0 0", from: "cmy", screen: "SCREEN_27", shift: [0.4, -0.3] },
  { name: "black", coverage: "1 0 0 0 0", from: "black", screen: "SCREEN_45", shift: [0, 0] },
] as const;

export type RisoOptions = {
  /** Pixels between dots. */
  cell: number;
  /** Each ink's colour, as #rrggbb; riso's own by default. */
  inks: Record<(typeof INKS)[number]["name"], string>;
  paper: string;
  /** How far out of register, 1 being a fraction of a pixel. */
  shift: number;
  /** How much colour black takes away under it, 0 to 1. */
  undercolour: number;
  /** Each ink's opacity, 0 to 1. */
  opacity: number;
};

export const RISO_DEFAULTS: RisoOptions = {
  cell: 4,
  inks: { yellow: "#ffe800", red: "#ff665e", blue: "#0078bf", black: "#1a1a1f" },
  paper: "#f4ecd6",
  shift: 1,
  undercolour: 0.6,
  opacity: 0.9,
};

const channels = (hex: string) =>
  [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");

/** The filter's primitives for a riso print; anything not given is RISO_DEFAULTS'. */
export function risoPrimitives(given: Partial<RisoOptions> = {}): string {
  const { cell, inks, paper, shift, undercolour, opacity } = { ...RISO_DEFAULTS, ...given };
  const printed = INKS.map((ink, index) => {
    const tile = RISO_SCREENS[ink.screen];
    const side = +(tile.size * cell).toFixed(3);
    const [red, green, blue] = channels(inks[ink.name]).split(" ");
    const [dx, dy] = ink.shift.map((by) => +(by * shift).toFixed(2));
    const before = index ? `print${index - 1}` : "paper";
    return `
<!-- ${ink.name}: how much of it, against its screen; ink where it outweighs the screen. -->
<feColorMatrix in="${ink.from}" values="${ink.coverage}  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="${ink.name}-amount" />
<feImage href="${tile.href}" x="0" y="0" width="${side}" height="${side}" preserveAspectRatio="none" result="${ink.name}-tile" />
<feTile in="${ink.name}-tile" result="${ink.name}-screen" />
<feComposite in="${ink.name}-amount" in2="${ink.name}-screen" operator="arithmetic" k2=".5" k3=".5" result="${ink.name}-sum" />
<feComponentTransfer in="${ink.name}-sum" result="${ink.name}-dots"><feFuncR type="linear" slope="24" intercept="-11.5" /></feComponentTransfer>
<feColorMatrix in="${ink.name}-dots" values="0 0 0 0 ${red}  0 0 0 0 ${green}  0 0 0 0 ${blue}  ${opacity} 0 0 0 0" result="${ink.name}-ink" />
<feOffset in="${ink.name}-ink" dx="${dx}" dy="${dy}" result="${ink.name}-placed" />
<feBlend in="${ink.name}-placed" in2="${before}" mode="multiply" result="print${index}" />`;
  });
  return `
<feFlood flood-color="${paper}" result="paper" />
<!-- Each colour ink is what its channel lacks: blue for red, red for green, yellow for blue. -->
<feColorMatrix in="SourceGraphic" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 0 1" result="raw" />
<!-- Black where the photo is darker than middle grey, and less colour under it. -->
<feColorMatrix in="SourceGraphic" values="-.21 -.72 -.07 0 1  -.21 -.72 -.07 0 1  -.21 -.72 -.07 0 1  0 0 0 0 1" result="shade" />
<feComponentTransfer in="shade" result="black">
  <feFuncR type="linear" slope="2" intercept="-1" /><feFuncG type="linear" slope="2" intercept="-1" /><feFuncB type="linear" slope="2" intercept="-1" />
</feComponentTransfer>
<feComponentTransfer in="black" result="undercolour">
  <feFuncR type="linear" slope="${-undercolour}" intercept="1" /><feFuncG type="linear" slope="${-undercolour}" intercept="1" /><feFuncB type="linear" slope="${-undercolour}" intercept="1" />
</feComponentTransfer>
<feBlend in="raw" in2="undercolour" mode="multiply" result="cmy" />
${printed.join("\n")}
<feComposite in="print${INKS.length - 1}" in2="SourceGraphic" operator="in" />`.trim();
}

/** What Crate Label prints its photos with, as tuned in the lab; sepia(0.2) follows it in CSS. */
export const CRATE_RISO: Partial<RisoOptions> = {
  cell: 1.5,
  inks: { yellow: "#ffff51", red: "#f900f9", blue: "#0096f0", black: "#1a1a1f" },
  paper: "#f4ecd6",
  shift: 1.5,
  undercolour: 0.5,
  opacity: 1,
};

/** The long data URIs in these filters, by the short names the lab shows them under. */
export const HALFTONE_TOKENS: Record<string, string> = {
  CELL: HALFTONE_CELL,
  ...Object.fromEntries(Object.entries(RISO_SCREENS).map(([name, tile]) => [name, tile.href])),
};
