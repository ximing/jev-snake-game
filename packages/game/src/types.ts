export const DIRECTIONS = ["up", "right", "down", "left"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type Point = { x: number; y: number };

export type GameStatus = "playing" | "dead";

export type GameState = {
  width: number;
  height: number;
  snake: Point[];
  direction: Direction;
  food: Point;
  obstacles: Point[];
  score: number;
  tick: number;
  status: GameStatus;
  deaths: number;
};

export type Candidate = {
  dir: Direction;
  next: Point;
  immediateDeath: boolean;
  manhattanToFood: number;
  closerToFood: boolean;
  freeNeighbors: number;
  reachableCells: number;
};

export type DecideFacts = {
  tick: number;
  board: { width: number; height: number };
  snake: {
    head: Point;
    direction: Direction;
    length: number;
    body: Point[];
  };
  food: Point;
  obstacles: Point[];
  score: number;
  legalMoves: Direction[];
  candidates: Partial<Record<Direction, Candidate>>;
  boardMap: string[];
};

export type DecisionSource =
  | "deterministic"
  | "jev"
  | "survival"
  | "fallback"
  | "override";

export type TraceAnswer =
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "noul";
      noul: number;
    };

export type TraceQuestion = {
  id: string;
  type: "choice" | "score" | "noul";
  title: string;
  instructions: unknown;
  criteria?: unknown;
};

export type ComposeStep = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type Thresholds = {
  dangerScore: number;
  survivalNoul: number;
  moveConfidence: number;
};

export type ComposeTrace = {
  survivalMode: boolean;
  thresholds: Thresholds;
  steps: ComposeStep[];
  used: string[];
  ignored: string[];
};

export type DecisionTrace = {
  tick: number;
  latencyMs: number;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  skippedJev: boolean;
  facts: DecideFacts;
  questions: TraceQuestion[];
  answers: Record<string, TraceAnswer>;
  compose: ComposeTrace;
  action: Direction;
  source: DecisionSource;
};

export type DecideRequest = {
  facts: DecideFacts;
  override?: Direction;
};

export type DecideResponse = {
  action: Direction;
  source: DecisionSource;
  trace: DecisionTrace;
};

export const DIR_LABEL: Record<Direction, string> = {
  up: "上",
  right: "右",
  down: "下",
  left: "左",
};

export const DIR_EN: Record<Direction, string> = {
  up: "UP",
  right: "RIGHT",
  down: "DOWN",
  left: "LEFT",
};
