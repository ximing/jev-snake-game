import {
  DIR_EN,
  DIR_LABEL,
  THRESHOLDS,
  compose,
  type DecideFacts,
  type DecisionTrace,
  type Direction,
  type TraceAnswer,
  type TraceQuestion,
} from "@jev-snake/game";
import {
  TypeSafeClient,
  choice,
  noul,
  score,
  type Question,
} from "@typesafe-ai/sdk";

const DIR_TITLE: Record<Direction, string> = DIR_LABEL;

function hasApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

let client: TypeSafeClient | null = null;

function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      apiKey: process.env.TYPESAFE_API_KEY,
      defaultModel: "jev-latest",
    });
  }
  return client;
}

export function keyStatus(): { hasKey: boolean } {
  return { hasKey: hasApiKey() };
}

export function buildJevState(facts: DecideFacts) {
  const candidates: Record<
    string,
    {
      next: { x: number; y: number };
      immediate_death: boolean;
      manhattan_to_food: number;
      closer_to_food: boolean;
      free_neighbors: number;
      reachable_cells: number;
    }
  > = {};
  for (const [dir, candidate] of Object.entries(facts.candidates)) {
    if (!candidate) continue;
    candidates[dir] = {
      next: candidate.next,
      immediate_death: candidate.immediateDeath,
      manhattan_to_food: candidate.manhattanToFood,
      closer_to_food: candidate.closerToFood,
      free_neighbors: candidate.freeNeighbors,
      reachable_cells: candidate.reachableCells,
    };
  }
  return {
    game: "Snake on a 16x16 grid. Origin is the top-left cell (0,0). x increases to the right, y increases downward. Moving into a wall, an obstacle, or the snake body is death. Obstacles are static blocks placed at the start of the round. Eating food grows the snake by one. The snake cannot reverse into itself. On the board map, H is the head, # is the body, T is the tail, F is food, X is an obstacle, and . is empty.",
    tick: facts.tick,
    score: facts.score,
    board: facts.board,
    snake: {
      head: facts.snake.head,
      direction: facts.snake.direction,
      length: facts.snake.length,
    },
    food: facts.food,
    obstacles: facts.obstacles,
    legal_moves: facts.legalMoves,
    candidates,
    board_map: facts.boardMap,
  };
}

function describeCandidate(facts: DecideFacts, dir: Direction) {
  const candidate = facts.candidates[dir]!;
  return {
    what: `Move ${dir} to (${candidate.next.x}, ${candidate.next.y})`,
    immediate_death: candidate.immediateDeath,
    manhattan_to_food: candidate.manhattanToFood,
    closer_to_food: candidate.closerToFood,
    free_neighbors: candidate.freeNeighbors,
    reachable_cells: candidate.reachableCells,
    not_for: candidate.immediateDeath
      ? "This move dies immediately and must not be chosen."
      : "Use a different direction if that one keeps more space or is closer to food without trapping the snake.",
  };
}

type BuiltQuestions = Record<string, Question>;

function buildQuestions(facts: DecideFacts): {
  questions: BuiltQuestions;
  meta: TraceQuestion[];
} {
  const safe = facts.legalMoves;
  const criteria: Record<string, ReturnType<typeof describeCandidate>> = {};
  for (const dir of safe) {
    criteria[dir] = describeCandidate(facts, dir);
  }

  const questions: BuiltQuestions = {
    danger: score(
      {
        question: "How threatened is the snake right now?",
        inspect: ["`board_map`", "`candidates`", "`obstacles`", "`legal_moves`"],
        focus: "Judge remaining space, obstacles, and how many safe moves remain, not how close the food is.",
      },
      [
        "Open: ample reachable space and at least two safe moves with room to turn.",
        "Pressured: limited space, close to walls or body, or food may be a trap.",
        "Nearly trapped: most moves die immediately or reachable space is very small.",
      ],
    ),
    prioritize_survival: noul(
      {
        question:
          "Should the snake ignore food this step and move primarily to stay alive?",
        inspect: ["`candidates`", "`legal_moves`", "`board_map`", "`obstacles`"],
        focus:
          "Yes if a food-seeking move would shrink reachable space badly, run the snake into obstacles, or leave almost no room.",
      },
      {
        true: "Survival should outrank food this step.",
        false: "A safe move can also make progress toward food.",
      },
    ),
    move: choice(
      {
        question: "Which legal direction should the snake take this step?",
        focus:
          "Never pick a move with immediate_death. Obstacles (X on the board map) are walls. Prefer keeping reachable_cells high. Take food when closer_to_food is true and reachable space stays healthy.",
        legal_moves: safe,
      },
      criteria,
    ),
  };

  const meta: TraceQuestion[] = [
    {
      id: "danger",
      type: "score",
      title: "危险度",
      instructions: questions.danger.instructions,
      criteria: questions.danger.criteria,
    },
    {
      id: "prioritize_survival",
      type: "noul",
      title: "是否先保命",
      instructions: questions.prioritize_survival.instructions,
      criteria: questions.prioritize_survival.criteria,
    },
    {
      id: "move",
      type: "choice",
      title: "建议方向",
      instructions: questions.move.instructions,
      criteria: questions.move.criteria,
    },
  ];

  for (const dir of safe) {
    const safeId = `${dir}_safe`;
    const progressId = `${dir}_progress`;
    questions[safeId] = noul(
      {
        question:
          "Would taking this candidate keep the snake alive this step and leave room to maneuver?",
        inspect: `\`candidates.${dir}\``,
        candidate: `candidates.${dir}`,
      },
      {
        true: "The move is survivable and keeps a healthy amount of reachable space.",
        false: "The move dies, hugs a wall too tightly, or traps the snake.",
      },
    );
    questions[progressId] = noul(
      {
        question:
          "Does this candidate make progress toward food without trapping the snake?",
        inspect: [`\`candidates.${dir}\``, "`food`"],
        candidate: `candidates.${dir}`,
      },
      {
        true: "The move is closer to food, or clearly advances toward it, and still leaves an escape.",
        false: "The move is a detour, or it chases food into a dead end.",
      },
    );
    meta.push(
      {
        id: safeId,
        type: "noul",
        title: `${DIR_TITLE[dir]} · 安全`,
        instructions: questions[safeId].instructions,
        criteria: questions[safeId].criteria,
      },
      {
        id: progressId,
        type: "noul",
        title: `${DIR_TITLE[dir]} · 进度`,
        instructions: questions[progressId].instructions,
        criteria: questions[progressId].criteria,
      },
    );
  }

  return { questions, meta };
}

function plainAnswers(
  raw: Record<string, unknown>,
): Record<string, TraceAnswer> {
  const out: Record<string, TraceAnswer> = {};
  for (const [id, value] of Object.entries(raw)) {
    const item = value as Record<string, unknown>;
    if (item.type === "choice" || "choice" in item) {
      out[id] = {
        type: "choice",
        choice: String(item.choice),
        probabilities: (item.probabilities ?? {}) as Record<string, number>,
        confidence: Number(item.confidence ?? 0),
      };
    } else if (item.type === "score" || "score" in item) {
      out[id] = {
        type: "score",
        score: Number(item.score ?? 0),
        legend: (item.legend ?? {}) as Record<string, string>,
        probabilities: (item.probabilities ?? {}) as Record<string, number>,
        confidence: Number(item.confidence ?? 0),
      };
    } else {
      out[id] = { type: "noul", noul: Number(item.noul ?? 0) };
    }
  }
  return out;
}

function emptyTrace(
  facts: DecideFacts,
  extra: Partial<DecisionTrace> & Pick<DecisionTrace, "action" | "source" | "compose">,
): DecisionTrace {
  return {
    tick: facts.tick,
    latencyMs: extra.latencyMs ?? 0,
    model: extra.model ?? null,
    usage: extra.usage ?? null,
    skippedJev: extra.skippedJev ?? false,
    facts,
    questions: extra.questions ?? [],
    answers: extra.answers ?? {},
    compose: extra.compose,
    action: extra.action,
    source: extra.source,
  };
}

export async function decideMove(
  facts: DecideFacts,
  override?: Direction,
): Promise<DecisionTrace> {
  if (override) {
    const { action, source, compose: composeTrace } = compose(facts, null, {
      override,
    });
    return emptyTrace(facts, {
      skippedJev: true,
      action,
      source,
      compose: composeTrace,
    });
  }

  if (facts.legalMoves.length <= 1) {
    const { action, source, compose: composeTrace } = compose(facts, null);
    return emptyTrace(facts, {
      skippedJev: true,
      action,
      source,
      compose: composeTrace,
    });
  }

  if (!hasApiKey()) {
    throw new Error("MISSING_API_KEY");
  }

  const state = buildJevState(facts);
  const { questions, meta } = buildQuestions(facts);
  const started = Date.now();
  const response = await getClient().systemOne({
    model: "jev-latest",
    state,
    questions,
  });
  const latencyMs = Date.now() - started;
  const answers = plainAnswers(
    response.answers as unknown as Record<string, unknown>,
  );
  const { action, source, compose: composeTrace } = compose(facts, answers);

  return {
    tick: facts.tick,
    latencyMs,
    model: response.model ?? "jev-latest",
    usage: response.usage
      ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        }
      : null,
    skippedJev: false,
    facts,
    questions: meta,
    answers,
    compose: composeTrace,
    action,
    source,
  };
}

export { THRESHOLDS, DIR_EN };
