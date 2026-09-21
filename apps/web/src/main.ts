import {
  OPPOSITE,
  analyze,
  createGame,
  resetGame,
  step,
  type DecisionTrace,
  type Direction,
  type GameState,
} from "@jev-snake/game";
import { decide, fetchHealth } from "./api.ts";
import { drawBoard, resizeCanvas } from "./board.ts";
import { renderInspector } from "./inspector.ts";

const MIN_TICK_MS = 280;
const RESTART_MS = 1500;

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const inspectorEl = document.querySelector<HTMLElement>("#inspector")!;
const statusEl = document.querySelector<HTMLElement>("#stage-status")!;
const bannerEl = document.querySelector<HTMLElement>("#banner")!;
const btnAuto = document.querySelector<HTMLButtonElement>("#btn-auto")!;
const btnStep = document.querySelector<HTMLButtonElement>("#btn-step")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;

const hud = {
  score: document.querySelector("#hud-score")!,
  length: document.querySelector("#hud-length")!,
  obstacles: document.querySelector("#hud-obstacles")!,
  tick: document.querySelector("#hud-tick")!,
  latency: document.querySelector("#hud-latency")!,
  tokens: document.querySelector("#hud-tokens")!,
};

const KEY_DIR: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  ArrowLeft: "left",
  w: "up",
  d: "right",
  s: "down",
  a: "left",
  W: "up",
  D: "right",
  S: "down",
  A: "left",
};

type App = {
  state: GameState;
  traces: DecisionTrace[];
  selected: number;
  auto: boolean;
  judging: boolean;
  inFlight: boolean;
  pendingDir: Direction | null;
  error: string | null;
  tokensIn: number;
};

const app: App = {
  state: createGame(),
  traces: [],
  selected: -1,
  auto: true,
  judging: false,
  inFlight: false,
  pendingDir: null,
  error: null,
  tokensIn: 0,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paint() {
  hud.score.textContent = String(app.state.score);
  hud.length.textContent = String(app.state.snake.length);
  hud.obstacles.textContent = String(app.state.obstacles.length);
  hud.tick.textContent = String(app.state.tick);
  const last = app.traces[app.traces.length - 1];
  hud.latency.textContent = last ? `${last.latencyMs}ms` : "—";
  hud.tokens.textContent = String(app.tokensIn);
  btnAuto.textContent = app.auto ? "暂停" : "自动";
  if (app.error) statusEl.textContent = "出错";
  else if (app.state.status === "dead") statusEl.textContent = "结束";
  else if (app.judging) statusEl.textContent = "判断中";
  else if (!app.auto) statusEl.textContent = "已暂停";
  else statusEl.textContent = "自动运行";
  renderInspector(inspectorEl, {
    traces: app.traces,
    selected: app.selected < 0 ? app.traces.length - 1 : app.selected,
    judging: app.judging,
    error: app.error,
  });
}

function loop(time: number) {
  resizeCanvas(canvas);
  drawBoard(
    canvas,
    {
      state: app.state,
      judging: app.judging,
      facts: app.state.status === "playing" ? analyze(app.state) : null,
    },
    time,
  );
  requestAnimationFrame(loop);
}

async function playOnce(): Promise<void> {
  if (app.inFlight) return;
  if (app.state.status === "dead") return;
  app.inFlight = true;
  app.error = null;
  const facts = analyze(app.state);
  const override = app.pendingDir;
  app.pendingDir = null;
  const useOverride =
    override && override !== OPPOSITE[app.state.direction] ? override : undefined;

  app.judging = !useOverride && facts.legalMoves.length > 1;
  paint();
  const started = Date.now();
  try {
    const result = await decide(facts, useOverride);
    app.traces.push(result.trace);
    app.selected = app.traces.length - 1;
    if (result.trace.usage) {
      app.tokensIn += result.trace.usage.input_tokens;
    }
    app.state = step(app.state, result.action);
    app.judging = false;
    paint();
    const elapsed = Date.now() - started;
    if (elapsed < MIN_TICK_MS) await sleep(MIN_TICK_MS - elapsed);
  } catch (err) {
    app.judging = false;
    app.auto = false;
    app.error = err instanceof Error ? err.message : String(err);
    paint();
  } finally {
    app.inFlight = false;
  }
}

async function autoLoop() {
  while (true) {
    if (!app.auto) {
      await sleep(40);
      continue;
    }
    if (app.inFlight) {
      await sleep(40);
      continue;
    }
    if (app.state.status === "dead") {
      statusEl.textContent = "结束，即将重开";
      await sleep(RESTART_MS);
      if (app.auto) {
        app.state = resetGame(app.state);
        paint();
      }
      continue;
    }
    await playOnce();
  }
}

function setAuto(next: boolean) {
  app.auto = next;
  paint();
}

btnAuto.addEventListener("click", () => setAuto(!app.auto));
btnStep.addEventListener("click", () => {
  setAuto(false);
  void playOnce();
});
btnReset.addEventListener("click", () => {
  app.state = resetGame(app.state);
  app.traces = [];
  app.selected = -1;
  app.error = null;
  paint();
});

inspectorEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLElement>("[data-trace]");
  if (!button) return;
  const index = Number(button.dataset.trace);
  if (Number.isInteger(index)) {
    app.selected = index;
    paint();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    setAuto(!app.auto);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    setAuto(false);
    void playOnce();
    return;
  }
  const dir = KEY_DIR[event.key];
  if (!dir) return;
  event.preventDefault();
  if (dir === OPPOSITE[app.state.direction]) return;
  app.pendingDir = dir;
  statusEl.textContent = `下一拍覆盖 ${dir}`;
});

window.addEventListener("resize", () => resizeCanvas(canvas));

async function boot() {
  paint();
  requestAnimationFrame(loop);
  try {
    const health = await fetchHealth();
    if (!health.hasKey) {
      bannerEl.hidden = false;
      bannerEl.textContent =
        "服务端还没有 TYPESAFE_API_KEY。把它写进仓库根目录的 .env 后重启 pnpm dev。";
      app.auto = false;
      paint();
    }
  } catch {
    bannerEl.hidden = false;
    bannerEl.textContent = "判断服务还没起来。确认 pnpm dev 里 @jev-snake/server 已启动。";
    app.auto = false;
    paint();
  }
  void autoLoop();
}

void boot();
