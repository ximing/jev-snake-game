import {
  BOARD_SIZE,
  VEC,
  type DecideFacts,
  type Direction,
  type GameState,
  type Point,
} from "@jev-snake/game";

export type BoardFrame = {
  state: GameState;
  judging: boolean;
  facts: DecideFacts | null;
};

const AMBER = "#F4C95D";
const AMBER_DIM = "#C4922A";
const ICE = "#7EC8E3";
const MAGENTA = "#E551BA";
const VOID = "#0B1220";
const STEEL = "#3A4A5C";
const STEEL_EDGE = "#8FA0B5";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function cellRect(origin: number, size: number, p: Point, pad: number) {
  const x = origin + p.x * size + pad;
  const y = origin + p.y * size + pad;
  return { x, y, w: size - pad * 2, h: size - pad * 2 };
}

export function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const side = Math.max(1, Math.floor(Math.min(rect.width, rect.height) * dpr));
  if (canvas.width !== side || canvas.height !== side) {
    canvas.width = side;
    canvas.height = side;
  }
}

export function drawBoard(
  canvas: HTMLCanvasElement,
  frame: BoardFrame,
  timeMs: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { state, judging, facts } = frame;
  const W = canvas.width;
  const inset = W * 0.06;
  const grid = W - inset * 2;
  const cell = grid / BOARD_SIZE;
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, W, W);

  ctx.strokeStyle = "rgba(244,201,93,0.14)";
  ctx.lineWidth = Math.max(1, W * 0.004);
  ctx.strokeRect(inset - cell * 0.08, inset - cell * 0.08, grid + cell * 0.16, grid + cell * 0.16);

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const px = inset + x * cell + cell / 2;
      const py = inset + y * cell + cell / 2;
      ctx.fillStyle = "rgba(232,228,217,0.08)";
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, cell * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const obstacle of state.obstacles) {
    const rect = cellRect(inset, cell, obstacle, cell * 0.1);
    ctx.fillStyle = STEEL;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, cell * 0.08);
    ctx.fill();
    ctx.strokeStyle = STEEL_EDGE;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.stroke();
    ctx.fillStyle = "rgba(143,160,181,0.22)";
    ctx.fillRect(rect.x + rect.w * 0.18, rect.y + rect.h * 0.16, rect.w * 0.28, rect.h * 0.18);
  }

  if (facts) {
    for (const candidate of Object.values(facts.candidates)) {
      if (!candidate || candidate.immediateDeath) continue;
      const rect = cellRect(inset, cell, candidate.next, cell * 0.28);
      ctx.globalAlpha = judging ? 0.28 : 0.16;
      ctx.fillStyle = judging ? MAGENTA : AMBER;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, cell * 0.12);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  const foodPulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(timeMs / 280);
  const food = cellRect(inset, cell, state.food, cell * 0.22);
  ctx.save();
  ctx.translate(food.x + food.w / 2, food.y + food.h / 2);
  ctx.rotate(Math.PI / 4);
  ctx.scale(foodPulse, foodPulse);
  ctx.fillStyle = ICE;
  ctx.shadowColor = ICE;
  ctx.shadowBlur = cell * 0.35;
  const s = food.w * 0.72;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.restore();

  const pad = cell * 0.12;
  state.snake.forEach((seg, i) => {
    const rect = cellRect(inset, cell, seg, pad);
    const t = i / Math.max(1, state.snake.length - 1);
    ctx.fillStyle = i === 0 ? AMBER : mixHex(AMBER, AMBER_DIM, t);
    ctx.shadowColor = i === 0 ? AMBER : "transparent";
    ctx.shadowBlur = i === 0 ? cell * 0.25 : 0;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, cell * 0.16);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  const head = state.snake[0];
  if (head) {
    drawEyes(ctx, inset, cell, head, state.direction);
  }

  if (judging) {
    const sweep = reduced ? 0.5 : (timeMs % 1600) / 1600;
    const y = inset + sweep * grid;
    const g = ctx.createLinearGradient(0, y - cell, 0, y + cell);
    g.addColorStop(0, "rgba(229,81,186,0)");
    g.addColorStop(0.5, "rgba(229,81,186,0.18)");
    g.addColorStop(1, "rgba(229,81,186,0)");
    ctx.fillStyle = g;
    ctx.fillRect(inset, inset, grid, grid);
  }

  if (state.status === "dead") {
    ctx.fillStyle = "rgba(11,18,32,0.45)";
    ctx.fillRect(inset, inset, grid, grid);
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  origin: number,
  size: number,
  head: Point,
  dir: Direction,
) {
  const rect = cellRect(origin, size, head, size * 0.12);
  const vx = VEC[dir];
  const cx = rect.x + rect.w / 2 + vx.x * rect.w * 0.16;
  const cy = rect.y + rect.h / 2 + vx.y * rect.h * 0.16;
  const px = -vx.y;
  const py = vx.x;
  const eye = size * 0.09;
  const spread = size * 0.14;
  ctx.fillStyle = "#0B1220";
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + px * spread * sign, cy + py * spread * sign, eye, 0, Math.PI * 2);
    ctx.fill();
  }
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}
