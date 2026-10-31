// Yakaru – Produkt-Illustrationen als Vektorgrafik (SVG). Einheitlicher Look:
// heller Hintergrund, Dunkelblau/Anthrazit, Cyan-Akzent, weicher Schatten.
// Alle Bilder sind ausdrücklich Symbolbilder (Illustration), keine Produktfotos.
//
// Wird von scripts/render-product-images.mjs gerendert.

export const SIZE = 1200;

const C = {
  navy: "#14233C",
  navy2: "#1E3A5F",
  slate: "#3A4A63",
  cyan: "#4FB3C8",
  cyanLight: "#BFE6EE",
  silver: "#C9D2DD",
  silverDark: "#9AA6B5",
  line: "#D3DCE7",
  white: "#FFFFFF",
  muted: "#7A869A",
};

const n = (v) => Math.round(v * 10) / 10;

function frame(content, { glow = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F6F9FC"/>
      <stop offset="1" stop-color="#E3EAF3"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.cyan}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E4E9F0"/>
      <stop offset="0.55" stop-color="${C.silver}"/>
      <stop offset="1" stop-color="${C.silverDark}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  ${glow ? `<circle cx="600" cy="560" r="430" fill="url(#glow)" opacity="0.5"/>` : ""}
  <ellipse cx="600" cy="985" rx="400" ry="38" fill="${C.navy}" opacity="0.07"/>
  ${content}
  <text x="1150" y="1160" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="${C.muted}">Illustration · Symbolbild</text>
</svg>
`;
}

/** Punkt und Steigungswinkel auf einer quadratischen Bézierkurve */
function quad(p0, p1, p2, t) {
  const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0];
  const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1];
  const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

function ledStrip() {
  const cx = 420;
  const cy = 520;
  const ringLeds = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const x = cx + Math.cos(a) * 200;
    const y = cy + Math.sin(a) * 200;
    return `<rect x="${n(x - 9)}" y="${n(y - 9)}" width="18" height="18" rx="4" fill="${C.cyan}" transform="rotate(${n((a * 180) / Math.PI)} ${n(x)} ${n(y)})"/>`;
  }).join("");

  const p0 = [560, 680];
  const p1 = [760, 930];
  const p2 = [1080, 760];
  const strip = `M${p0} Q${p1} ${p2}`;
  const leds = Array.from({ length: 11 }, (_, i) => {
    const { x, y, angle } = quad(p0, p1, p2, 0.08 + i * 0.087);
    return `<circle cx="${n(x)}" cy="${n(y)}" r="30" fill="${C.cyan}" opacity="0.22"/>
      <rect x="${n(x - 12)}" y="${n(y - 12)}" width="24" height="24" rx="5" fill="${C.cyan}" transform="rotate(${n(angle)} ${n(x)} ${n(y)})"/>`;
  }).join("");

  return frame(
    `
  <!-- Spule -->
  <circle cx="${cx}" cy="${cy}" r="255" fill="${C.white}" stroke="${C.line}" stroke-width="6"/>
  <circle cx="${cx}" cy="${cy}" r="200" fill="none" stroke="#EEF2F7" stroke-width="44"/>
  ${[175, 150, 125].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.line}" stroke-width="3"/>`).join("")}
  ${ringLeds}
  <circle cx="${cx}" cy="${cy}" r="72" fill="${C.navy}"/>
  <circle cx="${cx}" cy="${cy}" r="24" fill="${C.cyan}"/>
  <!-- abgerollter Streifen -->
  <path d="${strip}" fill="none" stroke="${C.line}" stroke-width="66" stroke-linecap="round"/>
  <path d="${strip}" fill="none" stroke="${C.white}" stroke-width="54" stroke-linecap="round"/>
  ${leds}
  <!-- App-Steuerung -->
  <path d="M700 380 Q790 300 880 330" fill="none" stroke="${C.cyan}" stroke-width="6" stroke-dasharray="4 16" stroke-linecap="round"/>
  <rect x="880" y="170" width="190" height="340" rx="34" fill="${C.navy}"/>
  <rect x="898" y="200" width="154" height="280" rx="20" fill="${C.navy2}"/>
  <circle cx="975" cy="320" r="52" fill="none" stroke="${C.cyan}" stroke-width="14"/>
  <circle cx="975" cy="320" r="20" fill="${C.cyanLight}"/>
  <rect x="925" y="410" width="100" height="14" rx="7" fill="${C.cyan}" opacity="0.7"/>
  <rect x="945" y="438" width="60" height="10" rx="5" fill="${C.silverDark}" opacity="0.7"/>`,
    { glow: true },
  );
}

function laptopStand() {
  return frame(`
  <!-- Fuß -->
  <rect x="250" y="880" width="680" height="34" rx="17" fill="url(#metal)"/>
  <!-- Stütze -->
  <path d="M720 896 L840 480" stroke="${C.silverDark}" stroke-width="42" stroke-linecap="round"/>
  <path d="M720 896 L840 480" stroke="url(#metal)" stroke-width="30" stroke-linecap="round"/>
  <circle cx="720" cy="896" r="26" fill="${C.silverDark}"/>
  <circle cx="720" cy="896" r="12" fill="${C.white}"/>
  <!-- Ablage -->
  <path d="M300 660 L880 470" stroke="${C.silverDark}" stroke-width="40" stroke-linecap="round"/>
  <path d="M300 660 L880 470" stroke="url(#metal)" stroke-width="28" stroke-linecap="round"/>
  <path d="M300 660 L286 612" stroke="${C.silverDark}" stroke-width="24" stroke-linecap="round"/>
  <circle cx="840" cy="483" r="24" fill="${C.silverDark}"/>
  <circle cx="840" cy="483" r="10" fill="${C.white}"/>
  <!-- Laptop -->
  <path d="M322 622 L868 443" stroke="#2B3442" stroke-width="24" stroke-linecap="round"/>
  <path d="M868 443 L930 120" stroke="${C.navy}" stroke-width="30" stroke-linecap="round"/>
  <path d="M858 430 L918 118" stroke="${C.cyan}" stroke-width="6" stroke-linecap="round" opacity="0.8"/>
  <!-- Belüftung angedeutet -->
  ${[0, 1, 2, 3].map((i) => `<circle cx="${430 + i * 90}" cy="${n(624 - i * 29.5)}" r="5" fill="${C.cyan}" opacity="0.5"/>`).join("")}`);
}

function cableOrganizer() {
  const colors = [C.navy, C.slate, C.cyan, C.silverDark, C.navy2];
  const xs = [280, 440, 600, 760, 920];
  const cables = xs
    .map((x, i) => {
      const c = colors[i];
      const up = `M${x} 600 C${x - 50} 470 ${x + 70} 330 ${x + 20} 190`;
      const down = `M${x} 600 C${x + 40} 760 ${x - 60} 880 ${x - 10} 1010`;
      return `<path d="${up}" fill="none" stroke="${c}" stroke-width="20" stroke-linecap="round"/>
        <path d="${down}" fill="none" stroke="${c}" stroke-width="20" stroke-linecap="round"/>
        <rect x="${x + 2}" y="150" width="36" height="58" rx="10" fill="${c}"/>
        <rect x="${x + 12}" y="128" width="16" height="28" rx="4" fill="${C.silver}"/>`;
    })
    .join("");
  const clips = xs
    .map(
      (x) => `<circle cx="${x}" cy="600" r="62" fill="${C.white}" stroke="${C.line}" stroke-width="6"/>
      <circle cx="${x}" cy="600" r="38" fill="none" stroke="${C.cyan}" stroke-width="8"/>
      <rect x="${x - 26}" y="588" width="52" height="24" rx="12" fill="${C.navy}"/>`,
    )
    .join("");
  return frame(`
  <rect x="200" y="660" width="800" height="26" rx="13" fill="${C.line}"/>
  ${cables}
  ${clips}`);
}

function bottle(cx, baseY, scale, body, stroke) {
  const s = (v) => n(v * scale);
  const w = s(190);
  const h = s(500);
  const top = baseY - h;
  return `<g>
    <rect x="${n(cx - w / 2)}" y="${n(top)}" width="${w}" height="${h}" rx="${s(72)}" fill="${body}" stroke="${stroke}" stroke-width="5"/>
    <rect x="${n(cx - w / 2 + s(26))}" y="${n(top + s(60))}" width="${s(22)}" height="${n(h - s(130))}" rx="${s(11)}" fill="#FFFFFF" opacity="0.28"/>
    <rect x="${n(cx - w / 2)}" y="${n(top + s(70))}" width="${w}" height="${s(10)}" fill="${C.navy}" opacity="0.08"/>
    <rect x="${n(cx - s(58))}" y="${n(top - s(48))}" width="${s(116)}" height="${s(60)}" rx="${s(14)}" fill="url(#metal)"/>
    <rect x="${n(cx - s(66))}" y="${n(top - s(128))}" width="${s(132)}" height="${s(88)}" rx="${s(26)}" fill="${C.navy}"/>
    <path d="M${n(cx - s(30))} ${n(top - s(126))} Q${n(cx)} ${n(top - s(200))} ${n(cx + s(30))} ${n(top - s(126))}" fill="none" stroke="${C.navy}" stroke-width="${s(16)}" stroke-linecap="round"/>
    <rect x="${n(cx - s(40))}" y="${n(top - s(100))}" width="${s(80)}" height="${s(10)}" rx="${s(5)}" fill="${C.cyan}"/>
  </g>`;
}

function bottles() {
  return frame(`
  ${bottle(390, 930, 0.86, "#F7F9FB", C.line)}
  ${bottle(810, 930, 0.86, "#9DB8A0", "#86A08A")}
  ${bottle(600, 960, 1, "#262B33", "#1B1F25")}`);
}

function strap(cx, cy, color, edge, withBuckle) {
  const len = 760;
  const w = 112;
  const holes = Array.from({ length: 7 }, (_, i) => `<circle cx="${n(cx - len / 2 + 120 + i * 52)}" cy="${cy}" r="9" fill="${edge}" opacity="0.55"/>`).join("");
  const buckle = withBuckle
    ? `<rect x="${cx + len / 2 - 120}" y="${cy - w / 2 - 14}" width="96" height="${w + 28}" rx="20" fill="none" stroke="url(#metal)" stroke-width="14"/>
       <path d="M${cx + len / 2 - 72} ${cy} H${cx + len / 2 - 150}" stroke="${C.silverDark}" stroke-width="10" stroke-linecap="round"/>`
    : `<rect x="${cx + len / 2 - 150}" y="${cy - w / 2 - 6}" width="34" height="${w + 12}" rx="10" fill="${edge}"/>`;
  return `<g transform="rotate(-20 ${cx} ${cy})">
    <rect x="${cx - len / 2}" y="${cy - w / 2}" width="${len}" height="${w}" rx="${w / 2}" fill="${color}" stroke="${edge}" stroke-width="5"/>
    <rect x="${cx - len / 2 + 40}" y="${cy - w / 2 + 16}" width="${len - 220}" height="10" rx="5" fill="#FFFFFF" opacity="0.25"/>
    ${holes}
    ${buckle}
  </g>`;
}

function watchBands() {
  return frame(`
  ${strap(600, 420, "#1E3A5F", "#14233C", true)}
  ${strap(600, 600, "#4FB3C8", "#3A98AC", true)}
  ${strap(600, 780, "#E9D9C0", "#D2BE9F", true)}`);
}

/** Bilddateien je Shop-Handle. Alt-Texte stehen zentral in src/lib/shopify/listings.ts. */
export const PRODUCT_ART = {
  "demo-led-lichtleiste": { svg: ledStrip },
  "demo-laptopstaender": { svg: laptopStand },
  "demo-kabel-organizer": { svg: cableOrganizer },
  "demo-trinkflasche": { svg: bottles },
  "demo-uhrenarmband": { svg: watchBands },
};

/** Ohne Kennzeichnung (für Zusammenstellungen, die selbst gekennzeichnet werden) */
const withoutLabel = (svg) => svg.replace(/<text[^>]*>Illustration · Symbolbild<\/text>/, "");

/**
 * Startseiten-Grafik: drei schwebende Produktkarten auf transparentem Grund.
 * Kennzeichnung als Illustration erfolgt im Theme (Bildunterschrift/Alt-Text).
 */
export function heroSvg() {
  const card = (art, x, y, size, rotate) => {
    const inner = withoutLabel(art())
      .replace(/^<svg[^>]*>/, `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 ${SIZE} ${SIZE}">`);
    return `<g transform="translate(${x} ${y}) rotate(${rotate} ${size / 2} ${size / 2})">
      <rect x="6" y="18" width="${size}" height="${size}" rx="36" fill="#000000" opacity="0.18"/>
      <clipPath id="c${x}${y}"><rect width="${size}" height="${size}" rx="36"/></clipPath>
      <g clip-path="url(#c${x}${y})">${inner}</g>
      <rect width="${size}" height="${size}" rx="36" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="3"/>
    </g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" width="1000" height="800">
  <circle cx="560" cy="400" r="330" fill="#4FB3C8" opacity="0.12"/>
  <circle cx="560" cy="400" r="220" fill="#4FB3C8" opacity="0.10"/>
  ${card(laptopStand, 50, 400, 360, -6)}
  ${card(bottles, 590, 400, 360, 5)}
  ${card(ledStrip, 300, 40, 400, -1)}
</svg>
`;
}
