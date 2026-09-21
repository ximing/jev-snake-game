import { DIR_EN, type Direction } from "./types.ts";
import type {
  ComposeStep,
  ComposeTrace,
  DecideFacts,
  DecisionSource,
  TraceAnswer,
} from "./types.ts";

export const THRESHOLDS = {
  dangerScore: 1.5,
  survivalNoul: 0.7,
  moveConfidence: 0.55,
} as const;

function noulOf(
  answers: Record<string, TraceAnswer> | null,
  id: string,
): number {
  const answer = answers?.[id];
  return answer?.type === "noul" ? answer.noul : 0;
}

function unusedIds(
  answers: Record<string, TraceAnswer> | null,
  used: string[],
): string[] {
  if (!answers) return [];
  const usedSet = new Set(used);
  return Object.keys(answers).filter((id) => !usedSet.has(id));
}

function pickSurvival(
  facts: DecideFacts,
  answers: Record<string, TraceAnswer> | null,
  safe: Direction[],
): Direction {
  return [...safe].sort((a, b) => {
    const ca = facts.candidates[a]!;
    const cb = facts.candidates[b]!;
    if (cb.reachableCells !== ca.reachableCells) {
      return cb.reachableCells - ca.reachableCells;
    }
    const sa = noulOf(answers, `${a}_safe`);
    const sb = noulOf(answers, `${b}_safe`);
    if (sb !== sa) return sb - sa;
    return ca.manhattanToFood - cb.manhattanToFood;
  })[0];
}

function pickFallback(
  facts: DecideFacts,
  answers: Record<string, TraceAnswer> | null,
  safe: Direction[],
): Direction {
  return [...safe].sort((a, b) => {
    const pa = noulOf(answers, `${a}_progress`);
    const pb = noulOf(answers, `${b}_progress`);
    if (pb !== pa) return pb - pa;
    const ca = facts.candidates[a]!;
    const cb = facts.candidates[b]!;
    if (ca.manhattanToFood !== cb.manhattanToFood) {
      return ca.manhattanToFood - cb.manhattanToFood;
    }
    return cb.reachableCells - ca.reachableCells;
  })[0];
}

function result(
  action: Direction,
  source: DecisionSource,
  survivalMode: boolean,
  steps: ComposeStep[],
  used: string[],
  ignored: string[],
): { action: Direction; source: DecisionSource; compose: ComposeTrace } {
  return {
    action,
    source,
    compose: {
      survivalMode,
      thresholds: { ...THRESHOLDS },
      steps,
      used,
      ignored,
    },
  };
}

export function compose(
  facts: DecideFacts,
  answers: Record<string, TraceAnswer> | null,
  options?: { override?: Direction },
): { action: Direction; source: DecisionSource; compose: ComposeTrace } {
  const safe = facts.legalMoves;
  const steps: ComposeStep[] = [];
  const used: string[] = [];

  if (options?.override) {
    const action = options.override;
    steps.push({
      id: "override",
      label: `方向键覆盖为 ${DIR_EN[action]}`,
      detail: "这一拍不询问 Jev",
      passed: true,
    });
    return result(action, "override", false, steps, used, unusedIds(answers, used));
  }

  if (safe.length === 0) {
    const fallback = (Object.keys(facts.candidates) as Direction[])[0] ?? "right";
    steps.push({
      id: "no-safe",
      label: "没有安全方向",
      detail: `将走入 ${DIR_EN[fallback]}`,
      passed: true,
    });
    return result(fallback, "fallback", true, steps, used, unusedIds(answers, used));
  }

  if (!answers || safe.length === 1) {
    const action = safe[0];
    steps.push({
      id: "deterministic",
      label: safe.length === 1 ? "只有一个安全方向" : "未调用 Jev",
      detail: `代码直接走 ${DIR_EN[action]}`,
      passed: true,
    });
    return result(
      action,
      "deterministic",
      false,
      steps,
      used,
      unusedIds(answers, used),
    );
  }

  const danger = answers.danger?.type === "score" ? answers.danger.score : 0;
  const survivalNoul =
    answers.prioritize_survival?.type === "noul"
      ? answers.prioritize_survival.noul
      : 0;
  const dangerHigh = danger >= THRESHOLDS.dangerScore;
  const survivalHigh = survivalNoul >= THRESHOLDS.survivalNoul;
  const survivalMode = dangerHigh || survivalHigh;

  used.push("danger", "prioritize_survival");
  steps.push({
    id: "danger",
    label: `危险度 ${danger.toFixed(2)} ${dangerHigh ? "≥" : "<"} ${THRESHOLDS.dangerScore}`,
    detail: dangerHigh ? "局面受压，进入保命分支" : "局面尚可",
    passed: dangerHigh,
  });
  steps.push({
    id: "survival-noul",
    label: `保命倾向 ${survivalNoul.toFixed(2)} ${survivalHigh ? "≥" : "<"} ${THRESHOLDS.survivalNoul}`,
    detail: survivalHigh ? "这一拍先保命、暂缓追食物" : "可以继续追食物",
    passed: survivalHigh,
  });

  if (survivalMode) {
    for (const dir of safe) used.push(`${dir}_safe`);
    const action = pickSurvival(facts, answers, safe);
    const candidate = facts.candidates[action]!;
    steps.push({
      id: "survival-pick",
      label: `保命：选空间最大的 ${DIR_EN[action]}`,
      detail: `可达 ${candidate.reachableCells} 格，曼哈顿 ${candidate.manhattanToFood}`,
      passed: true,
    });
    return result(
      action,
      "survival",
      survivalMode,
      steps,
      used,
      unusedIds(answers, used),
    );
  }

  const move = answers.move;
  if (move?.type === "choice") {
    used.push("move");
    const pick = move.choice as Direction;
    const confOk = move.confidence >= THRESHOLDS.moveConfidence;
    const isSafe = safe.includes(pick);
    steps.push({
      id: "confidence",
      label: `Choice 置信度 ${move.confidence.toFixed(2)} ${confOk ? "≥" : "<"} ${THRESHOLDS.moveConfidence}`,
      detail: `Jev 建议 ${DIR_EN[pick] ?? pick}`,
      passed: confOk,
    });
    steps.push({
      id: "choice-safe",
      label: isSafe
        ? `${DIR_EN[pick] ?? pick} 在安全集中`
        : `${DIR_EN[pick] ?? pick} 不在安全集，忽略`,
      detail: `安全方向：${safe.map((d) => DIR_EN[d]).join("、")}`,
      passed: isSafe,
    });
    if (confOk && isSafe) {
      steps.push({
        id: "take-jev",
        label: `采用 Jev Choice：${DIR_EN[pick]}`,
        detail: `P(${pick})=${(move.probabilities[pick] ?? 0).toFixed(2)}`,
        passed: true,
      });
      return result(pick, "jev", survivalMode, steps, used, unusedIds(answers, used));
    }
  }

  for (const dir of safe) used.push(`${dir}_progress`);
  const action = pickFallback(facts, answers, safe);
  steps.push({
    id: "fallback",
    label: `回退：按进度选 ${DIR_EN[action]}`,
    detail: "置信不足，或 Choice 不可用",
    passed: true,
  });
  return result(
    action,
    "fallback",
    survivalMode,
    steps,
    used,
    unusedIds(answers, used),
  );
}
