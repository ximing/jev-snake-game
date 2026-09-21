import {
  DIRECTIONS,
  type Candidate,
  type DecideFacts,
  type Direction,
  type GameState,
  type Point,
} from "./types.ts";

export const BOARD_SIZE = 16;
export const INITIAL_LENGTH = 3;
export const OBSTACLE_MIN = 12;
export const OBSTACLE_MAX = 20;

export const VEC: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function addPoint(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function inBounds(p: Point, width: number, height: number): boolean {
  return p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
}

export function nonReverseMoves(direction: Direction): Direction[] {
  const blocked = OPPOSITE[direction];
  return DIRECTIONS.filter((dir) => dir !== blocked);
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function reservedKeys(
  snake: Point[],
  direction: Direction,
  width: number,
  height: number,
): Set<string> {
  const keys = new Set<string>();
  for (const p of snake) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const q = { x: p.x + dx, y: p.y + dy };
        if (inBounds(q, width, height)) keys.add(pointKey(q));
      }
    }
  }
  let cursor = snake[0];
  for (let i = 0; i < 4; i += 1) {
    cursor = addPoint(cursor, VEC[direction]);
    if (!inBounds(cursor, width, height)) break;
    keys.add(pointKey(cursor));
  }
  return keys;
}

function blockedSet(state: GameState, grow: boolean): Set<string> {
  const keys = new Set(state.obstacles.map(pointKey));
  for (const p of state.snake) keys.add(pointKey(p));
  if (!grow && state.snake.length > 0) {
    keys.delete(pointKey(state.snake[state.snake.length - 1]));
  }
  return keys;
}

function walkableFrom(state: GameState, from: Point, grow: boolean): Set<string> {
  const blocked = blockedSet(state, grow);
  blocked.delete(pointKey(from));
  if (!inBounds(from, state.width, state.height)) return new Set();
  if (state.obstacles.some((o) => o.x === from.x && o.y === from.y)) {
    return new Set();
  }
  const seen = new Set<string>([pointKey(from)]);
  const queue: Point[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dir of DIRECTIONS) {
      const next = addPoint(current, VEC[dir]);
      if (!inBounds(next, state.width, state.height)) continue;
      const k = pointKey(next);
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}

export function generateObstacles(
  width: number,
  height: number,
  snake: Point[],
  direction: Direction,
): Point[] {
  const target = OBSTACLE_MIN + randInt(OBSTACLE_MAX - OBSTACLE_MIN + 1);
  const minReach = Math.floor(width * height * 0.42);

  for (let round = 0; round < 40; round += 1) {
    const reserved = reservedKeys(snake, direction, width, height);
    const used = new Set(reserved);
    const obstacles: Point[] = [];

    for (let attempt = 0; attempt < 120 && obstacles.length < target; attempt += 1) {
      const horizontal = Math.random() < 0.5;
      const length = 2 + randInt(4);
      const start = { x: randInt(width), y: randInt(height) };
      const cells: Point[] = [];
      let fits = true;
      for (let i = 0; i < length; i += 1) {
        const cell = horizontal
          ? { x: start.x + i, y: start.y }
          : { x: start.x, y: start.y + i };
        if (!inBounds(cell, width, height) || used.has(pointKey(cell))) {
          fits = false;
          break;
        }
        cells.push(cell);
      }
      if (!fits) continue;
      if (obstacles.length + cells.length > target) continue;
      for (const cell of cells) {
        obstacles.push(cell);
        used.add(pointKey(cell));
      }
    }

    if (obstacles.length < OBSTACLE_MIN) continue;

    const probe: GameState = {
      width,
      height,
      snake: snake.map((p) => ({ ...p })),
      direction,
      food: snake[0],
      obstacles,
      score: 0,
      tick: 0,
      status: "playing",
      deaths: 0,
    };
    const reach = walkableFrom(probe, snake[0], true).size;
    if (reach < minReach) continue;

    let safeMoves = 0;
    for (const dir of nonReverseMoves(direction)) {
      const next = addPoint(snake[0], VEC[dir]);
      if (!isImmediateDeath(next, probe, false)) safeMoves += 1;
    }
    if (safeMoves < 2) continue;

    return obstacles;
  }

  return [];
}

export function createGame(): GameState {
  const width = BOARD_SIZE;
  const height = BOARD_SIZE;
  const midY = Math.floor(height / 2);
  const midX = Math.floor(width / 2);
  const snake: Point[] = [];
  for (let i = 0; i < INITIAL_LENGTH; i += 1) {
    snake.push({ x: midX - i, y: midY });
  }
  const direction: Direction = "right";
  const state: GameState = {
    width,
    height,
    snake,
    direction,
    food: { x: 0, y: 0 },
    obstacles: generateObstacles(width, height, snake, direction),
    score: 0,
    tick: 0,
    status: "playing",
    deaths: 0,
  };
  state.food = spawnFood(state);
  return state;
}

export function resetGame(prev?: GameState): GameState {
  const next = createGame();
  if (prev) {
    next.deaths = prev.deaths + (prev.status === "dead" ? 1 : 0);
  }
  return next;
}

export function spawnFood(state: GameState): Point {
  const occupied = new Set([
    ...state.snake.map(pointKey),
    ...state.obstacles.map(pointKey),
  ]);
  const reachable = walkableFrom(state, state.snake[0], true);
  const preferred: Point[] = [];
  const fallback: Point[] = [];
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const k = `${x},${y}`;
      if (occupied.has(k)) continue;
      const cell = { x, y };
      fallback.push(cell);
      if (reachable.has(k)) preferred.push(cell);
    }
  }
  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) return { ...state.snake[0] };
  return pool[randInt(pool.length)];
}

export function isImmediateDeath(
  next: Point,
  state: GameState,
  grow: boolean,
): boolean {
  if (!inBounds(next, state.width, state.height)) return true;
  return blockedSet(state, grow).has(pointKey(next));
}

export function reachableCells(
  from: Point,
  state: GameState,
  grow: boolean,
): number {
  return walkableFrom(state, from, grow).size;
}

export function freeNeighbors(
  from: Point,
  state: GameState,
  grow: boolean,
): number {
  const blocked = blockedSet(state, grow);
  let count = 0;
  for (const dir of DIRECTIONS) {
    const next = addPoint(from, VEC[dir]);
    if (!inBounds(next, state.width, state.height)) continue;
    if (blocked.has(pointKey(next))) continue;
    count += 1;
  }
  return count;
}

export function renderBoardMap(state: GameState): string[] {
  const rows: string[][] = [];
  for (let y = 0; y < state.height; y += 1) {
    rows.push(Array.from({ length: state.width }, () => "."));
  }
  for (const o of state.obstacles) {
    rows[o.y][o.x] = "X";
  }
  rows[state.food.y][state.food.x] = "F";
  for (let i = state.snake.length - 1; i >= 0; i -= 1) {
    const p = state.snake[i];
    if (i === 0) rows[p.y][p.x] = "H";
    else if (i === state.snake.length - 1) rows[p.y][p.x] = "T";
    else rows[p.y][p.x] = "#";
  }
  return rows.map((row) => row.join(""));
}

export function analyze(state: GameState): DecideFacts {
  const head = state.snake[0];
  const currentManhattan = manhattan(head, state.food);
  const dirs = nonReverseMoves(state.direction);
  const candidates: Partial<Record<Direction, Candidate>> = {};
  const legalMoves: Direction[] = [];

  for (const dir of dirs) {
    const next = addPoint(head, VEC[dir]);
    const grow = samePoint(next, state.food);
    const death = isImmediateDeath(next, state, grow);
    const man = manhattan(next, state.food);
    const candidate: Candidate = {
      dir,
      next,
      immediateDeath: death,
      manhattanToFood: man,
      closerToFood: man < currentManhattan,
      freeNeighbors: death ? 0 : freeNeighbors(next, state, grow),
      reachableCells: death ? 0 : reachableCells(next, state, grow),
    };
    candidates[dir] = candidate;
    if (!death) legalMoves.push(dir);
  }

  return {
    tick: state.tick,
    board: { width: state.width, height: state.height },
    snake: {
      head,
      direction: state.direction,
      length: state.snake.length,
      body: state.snake.map((p) => ({ ...p })),
    },
    food: { ...state.food },
    obstacles: state.obstacles.map((p) => ({ ...p })),
    score: state.score,
    legalMoves,
    candidates,
    boardMap: renderBoardMap(state),
  };
}

export function step(state: GameState, dir: Direction): GameState {
  if (state.status === "dead") return state;
  let nextDir = dir;
  if (nextDir === OPPOSITE[state.direction]) nextDir = state.direction;
  const head = addPoint(state.snake[0], VEC[nextDir]);
  const grow = samePoint(head, state.food);
  if (isImmediateDeath(head, state, grow)) {
    return {
      ...state,
      direction: nextDir,
      status: "dead",
      tick: state.tick + 1,
    };
  }
  const snake = [{ ...head }, ...state.snake.map((p) => ({ ...p }))];
  if (!grow) snake.pop();
  const next: GameState = {
    ...state,
    snake,
    direction: nextDir,
    tick: state.tick + 1,
    score: grow ? state.score + 1 : state.score,
    status: "playing",
  };
  if (grow) next.food = spawnFood(next);
  return next;
}
