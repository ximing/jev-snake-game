import {
  DIR_EN,
  DIR_LABEL,
  type Candidate,
  type DecisionSource,
  type DecisionTrace,
  type Direction,
  type TraceAnswer,
} from "@jev-snake/game";

const SOURCE_LABEL: Record<DecisionSource, string> = {
  jev: "Jev 采纳",
  survival: "保命",
  fallback: "回退",
  deterministic: "代码捷径",
  override: "方向键",
};

function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmtMs(n: number): string {
  return `${n} ms`;
}

function dirName(dir: string): string {
  if (dir in DIR_LABEL) {
    return `${DIR_LABEL[dir as Direction]} ${DIR_EN[dir as Direction]}`;
  }
  return dir;
}

export type InspectorModel = {
  traces: DecisionTrace[];
  selected: number;
  judging: boolean;
  error: string | null;
};

export function renderInspector(root: HTMLElement, model: InspectorModel) {
  const { traces, selected, judging, error } = model;
  const current = traces[selected] ?? null;

  root.innerHTML = `
    ${error ? `<div class="callout callout-bad">${esc(error)}</div>` : ""}
    ${current ? renderHero(current, judging) : renderEmpty(judging)}
    ${current ? renderPath(current) : ""}
    ${current ? renderFacts(current) : ""}
    ${current ? renderJev(current) : ""}
    ${current ? renderCompose(current) : ""}
    ${current ? renderRaw(current) : ""}
    ${renderLog(traces, selected)}
  `;
}

function renderEmpty(judging: boolean): string {
  return `
    <div class="hero">
      <p class="kicker">决策路径</p>
      <h2>${judging ? "正在问 Jev" : "等待第一拍"}</h2>
      <p class="lede">每拍先由代码算出候选事实，再一次性问 Jev 一组原子问题，最后用阈值组合成方向。</p>
    </div>
  `;
}

function renderHero(trace: DecisionTrace, judging: boolean): string {
  const usage = trace.usage
    ? `${trace.usage.input_tokens} in / ${trace.usage.output_tokens} out`
    : "未计 token";
  return `
    <div class="hero">
      <p class="kicker">第 ${trace.tick} 拍${judging ? " · 下一拍判断中" : ""}</p>
      <h2><span class="action">${esc(DIR_EN[trace.action])}</span></h2>
      <p class="lede">
        <span class="pill source-${esc(trace.source)}">${esc(SOURCE_LABEL[trace.source])}</span>
        ${trace.skippedJev ? "<span class='pill'>跳过 Jev</span>" : ""}
        <span class="meta">${fmtMs(trace.latencyMs)} · ${esc(trace.model ?? "—")} · ${esc(usage)}</span>
      </p>
    </div>
  `;
}

function renderPath(trace: DecisionTrace): string {
  const skip = trace.skippedJev;
  return `
    <ol class="flow">
      <li class="on">事实</li>
      <li class="${skip ? "off" : "on"}">${skip ? "跳过 Jev" : "Jev 并行"}</li>
      <li class="on">组合</li>
      <li class="end">${esc(DIR_EN[trace.action])}</li>
    </ol>
  `;
}

function renderFacts(trace: DecisionTrace): string {
  const dirs = Object.keys(trace.facts.candidates) as Direction[];
  const rows = dirs
    .map((dir) => {
      const c = trace.facts.candidates[dir];
      if (!c) return "";
      const chosen = dir === trace.action;
      return `
        <tr class="${chosen ? "is-chosen" : ""} ${c.immediateDeath ? "is-dead" : ""}">
          <th>${esc(dirName(dir))}</th>
          <td>${c.immediateDeath ? "死" : "活"}</td>
          <td>${c.manhattanToFood}</td>
          <td>${c.closerToFood ? "近" : "—"}</td>
          <td>${c.freeNeighbors}</td>
          <td>${c.reachableCells}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="block">
      <h3>事实 <span>代码算出，不经过模型</span></h3>
      <p class="note">合法方向 ${trace.facts.legalMoves.map((d) => DIR_EN[d]).join(" / ") || "无"} · 头 (${trace.facts.snake.head.x},${trace.facts.snake.head.y}) · 食物 (${trace.facts.food.x},${trace.facts.food.y}) · 路障 ${trace.facts.obstacles.length}</p>
      <table class="grid-table">
        <thead>
          <tr>
            <th>方向</th><th>这一步</th><th>曼哈顿</th><th>靠近</th><th>邻格</th><th>可达</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderJev(trace: DecisionTrace): string {
  if (trace.skippedJev) {
    return `
      <section class="block">
        <h3>Jev <span>这一拍没发请求</span></h3>
        <p class="note">${
          trace.source === "override"
            ? "方向键覆盖，代码自己走。"
            : "只有一个安全方向，按 TypeSafe 的原则直接用代码。"
        }</p>
      </section>
    `;
  }

  const used = new Set(trace.compose.used);
  const ignored = new Set(trace.compose.ignored);
  const cards = trace.questions
    .map((q) => {
      const answer = trace.answers[q.id];
      const flag = used.has(q.id)
        ? "已采用"
        : ignored.has(q.id)
          ? "未使用"
          : "";
      return `
        <article class="q ${used.has(q.id) ? "q-used" : ignored.has(q.id) ? "q-ignored" : ""}">
          <header>
            <span class="q-type">${esc(q.type)}</span>
            <h4>${esc(q.title)}</h4>
            ${flag ? `<span class="q-flag">${flag}</span>` : ""}
          </header>
          ${renderAnswer(answer, trace)}
        </article>
      `;
    })
    .join("");

  return `
    <section class="block">
      <h3>Jev <span>一次请求，${trace.questions.length} 个问题并行</span></h3>
      <div class="q-list">${cards}</div>
    </section>
  `;
}

function renderAnswer(
  answer: TraceAnswer | undefined,
  trace: DecisionTrace,
): string {
  if (!answer) return `<p class="note">没有答案</p>`;
  if (answer.type === "noul") {
    return barRow("yes", answer.noul, answer.noul >= 0.5);
  }
  if (answer.type === "choice") {
    const entries = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    const bars = entries
      .map(([key, value]) =>
        barRow(dirName(key), value, key === answer.choice || key === trace.action),
      )
      .join("");
    return `
      <p class="note">选 ${esc(dirName(answer.choice))} · 置信 ${answer.confidence.toFixed(2)}</p>
      ${bars}
    `;
  }
  const entries = Object.entries(answer.probabilities).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const bars = entries
    .map(([key, value]) => {
      const label = answer.legend[key] ?? key;
      return barRow(`${key} ${label}`, value, Number(key) === Math.round(answer.score));
    })
    .join("");
  return `
    <p class="note">分 ${answer.score.toFixed(2)} · 置信 ${answer.confidence.toFixed(2)}</p>
    ${bars}
  `;
}

function barRow(label: string, value: number, hot: boolean): string {
  const width = Math.max(0, Math.min(1, value));
  return `
    <div class="bar ${hot ? "hot" : ""}">
      <span class="bar-label">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${width * 100}%"></span></span>
      <span class="bar-val">${pct(value)}</span>
    </div>
  `;
}

function renderCompose(trace: DecisionTrace): string {
  const steps = trace.compose.steps
    .map(
      (step) => `
        <li class="${step.passed ? "pass" : "skip"}">
          <strong>${esc(step.label)}</strong>
          <span>${esc(step.detail)}</span>
        </li>
      `,
    )
    .join("");
  const t = trace.compose.thresholds;
  return `
    <section class="block">
      <h3>组合 <span>代码门控</span></h3>
      <p class="note">survival = 危险度 ≥ ${t.dangerScore} 或 保命 Noul ≥ ${t.survivalNoul} · Choice 置信 ≥ ${t.moveConfidence}</p>
      <ol class="steps">${steps}</ol>
    </section>
  `;
}

function renderRaw(trace: DecisionTrace): string {
  const payload = {
    action: trace.action,
    source: trace.source,
    model: trace.model,
    usage: trace.usage,
    answers: trace.answers,
    compose: trace.compose,
    facts: summarizeFacts(trace),
  };
  return `
    <details class="raw">
      <summary>原始记录</summary>
      <pre>${esc(JSON.stringify(payload, null, 2))}</pre>
    </details>
  `;
}

function summarizeFacts(trace: DecisionTrace) {
  const candidates: Record<string, Candidate> = {};
  for (const [dir, candidate] of Object.entries(trace.facts.candidates)) {
    if (candidate) candidates[dir] = candidate;
  }
  return {
    tick: trace.facts.tick,
    head: trace.facts.snake.head,
    food: trace.facts.food,
    obstacles: trace.facts.obstacles,
    legalMoves: trace.facts.legalMoves,
    candidates,
  };
}

function renderLog(traces: DecisionTrace[], selected: number): string {
  if (traces.length === 0) return "";
  const items = [...traces]
    .map((trace, index) => ({ trace, index }))
    .reverse()
    .map(({ trace, index }) => {
      return `
        <button type="button" class="log-item ${index === selected ? "is-on" : ""}" data-trace="${index}">
          <span class="log-tick">${trace.tick}</span>
          <span class="log-move">${esc(DIR_EN[trace.action])}</span>
          <span class="pill source-${esc(trace.source)}">${esc(SOURCE_LABEL[trace.source])}</span>
          <span class="log-ms">${trace.skippedJev ? "—" : fmtMs(trace.latencyMs)}</span>
        </button>
      `;
    })
    .join("");
  return `
    <section class="block log-block">
      <h3>时间轴</h3>
      <div class="log">${items}</div>
    </section>
  `;
}
