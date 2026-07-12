"use client";

import { useEffect, useState } from "react";

/**
 * Live BlockDAG visualizer in the style of kgi.kaspad.net.
 *
 * Blocks spawn at the right edge in small bursts, drift continuously
 * leftward, and each new block draws one or two edges back to the
 * youngest recently-spawned blocks — that's what makes the field read
 * as a Directed Acyclic Graph instead of a confetti spray. Y-position
 * for new blocks is jittered around the average Y of their parents so
 * the edges stay short and the graph looks structurally coherent.
 *
 * Implementation notes:
 *
 *   - All geometry lives in a fixed SVG viewBox (800×220). The browser
 *     handles the scaling to the visible container, so the same numbers
 *     work on mobile and desktop.
 *   - We don't animate each block with a CSS transition. Instead a 60ms
 *     React tick recomputes every block's x-position from
 *     `now - spawnedAt`, and the SVG re-renders. Cheap because there's
 *     no layout — pure paint — and stable because edges trivially
 *     follow their endpoints (no separate animation to keep in sync).
 *   - Spawn rate: 2 blocks every 200ms = ~10 blocks per second, the
 *     current Kaspa mainnet target.
 *   - Block lifetime: ~5.3s (FRAME_WIDTH / SPEED_PX_PER_S). After that
 *     they've drifted past the left edge and the React cleanup pass
 *     removes them from state so the array doesn't grow unbounded.
 */

const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 220;
const SPEED_PX_PER_S = 150;
const SPAWN_INTERVAL_MS = 200;
const BLOCKS_PER_SPAWN = 2;
const TICK_INTERVAL_MS = 60;
const BLOCK_VISIBLE_AFTER_SPAWN = -30;
// Real Kaspa blocks reference 8-10 parents from the recent anticone —
// that's what gives kgi.kaspad.net its dense spider-web look. A 600ms
// lookback was way too short: there's only ~6 blocks that fresh, so
// the visualizer never had enough candidates to draw a busy web.
// 1500ms holds ~15 candidates, and we now ask for 3-6 parents per
// block so the field reads as a genuine DAG instead of a sparse tree.
const PARENT_LOOKBACK_MS = 1500;
const PARENT_COUNT_MIN = 3;
const PARENT_COUNT_MAX = 6;
const Y_PADDING_RATIO = 0.06;
// Y-jitter widens too so the extra edges have room to spread across
// the field rather than overlapping a thin horizontal band.
const Y_JITTER = 0.55;

type DagBlock = {
  id: string;
  parentIds: string[];
  spawnedAt: number;
  yRatio: number;
};

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blockX(block: DagBlock, now: number): number {
  return FRAME_WIDTH - ((now - block.spawnedAt) / 1000) * SPEED_PX_PER_S;
}

function blockY(block: DagBlock): number {
  return Y_PADDING_RATIO * FRAME_HEIGHT + block.yRatio * (1 - 2 * Y_PADDING_RATIO) * FRAME_HEIGHT;
}

/**
 * Pick 3-6 parents from blocks spawned within the recent lookback
 * window. The dense parent-set is what makes the DAG look like
 * kgi.kaspad.net's spider web instead of a sparse tree — real Kaspa
 * blocks reference 8-10 parents from the recent anticone; we round
 * down a bit so the SVG doesn't get unreadable. Falls back gracefully
 * during the first second of life when there are fewer than 3
 * candidates total.
 */
function pickParents(existing: DagBlock[], now: number): DagBlock[] {
  const candidates = existing
    .filter((b) => now - b.spawnedAt < PARENT_LOOKBACK_MS)
    .sort((a, b) => b.spawnedAt - a.spawnedAt);
  if (candidates.length === 0) return [];
  const upper = Math.min(candidates.length, PARENT_COUNT_MAX);
  const lower = Math.min(candidates.length, PARENT_COUNT_MIN);
  const want = lower + Math.floor(Math.random() * (upper - lower + 1));
  // Bias toward the freshest candidates: pool size is roughly 2× the
  // target count, capped at the actual recent window so we never run
  // out of choices.
  const pool = candidates.slice(0, Math.min(candidates.length, Math.max(want * 2, 6)));
  const picked: DagBlock[] = [];
  while (picked.length < want && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

/**
 * New block's Y position drifts off the average Y of its parents.
 * A wider jitter (Y_JITTER) lets the now-denser edge set spread out
 * across more of the vertical field — without it the cluster would
 * collapse around a single midline because the average Y of 5 parents
 * regresses to whatever the parent average was.
 */
function pickYRatio(parents: DagBlock[]): number {
  if (parents.length === 0) return Math.random();
  const avg = parents.reduce((sum, p) => sum + p.yRatio, 0) / parents.length;
  const jittered = avg + (Math.random() - 0.5) * Y_JITTER;
  return Math.max(0.02, Math.min(0.98, jittered));
}

export function BlockDagVisualizer() {
  const [blocks, setBlocks] = useState<DagBlock[]>([]);
  // `tick` is a pure re-render trigger — its value is never read in
  // the render body, but setTick(...) on a fixed interval is what
  // forces React to recompute every block's x-position from Date.now().
  const [, setTick] = useState(0);

  // Spawn loop: produce two blocks every 200ms = ~10 BPS.
  useEffect(() => {
    const spawn = window.setInterval(() => {
      const now = Date.now();
      setBlocks((current) => {
        const next = [...current];
        for (let i = 0; i < BLOCKS_PER_SPAWN; i += 1) {
          const parents = pickParents(next, now);
          next.push({
            id: randomId(),
            parentIds: parents.map((p) => p.id),
            spawnedAt: now + i * 30,
            yRatio: pickYRatio(parents),
          });
        }
        return next;
      });
    }, SPAWN_INTERVAL_MS);
    return () => window.clearInterval(spawn);
  }, []);

  // Tick loop drives the leftward motion. Pure state bump — the
  // render function does the math from spawnedAt.
  useEffect(() => {
    const ticker = window.setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(ticker);
  }, []);

  // Cleanup pass: drop blocks that have drifted past the left edge.
  // Runs less often than the visual tick because removals don't need
  // to be frame-perfect — a few stale rows in state for a tick or two
  // are invisible to the user.
  useEffect(() => {
    const cleanup = window.setInterval(() => {
      const now = Date.now();
      setBlocks((current) => current.filter((b) => blockX(b, now) > BLOCK_VISIBLE_AFTER_SPAWN));
    }, 600);
    return () => window.clearInterval(cleanup);
  }, []);

  const now = Date.now();
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  return (
    <section
      aria-label="Live visualization of Kaspa producing roughly ten blocks per second"
      className="dag-visualizer"
    >
      <div className="dag-visualizer-field" aria-hidden="true">
        <svg
          className="dag-visualizer-svg"
          preserveAspectRatio="xMidYMid slice"
          viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Edges first so blocks render on top of their own lines —
              without this the rectangle fills get drawn under their
              parent lines and the graph reads scratchy. */}
          <g className="dag-visualizer-edges">
            {blocks.flatMap((block) => {
              const cx = blockX(block, now);
              const cy = blockY(block);
              return block.parentIds.flatMap((parentId) => {
                const parent = blockById.get(parentId);
                if (!parent) return [];
                return [
                  <line
                    key={`${parent.id}->${block.id}`}
                    x1={blockX(parent, now)}
                    y1={blockY(parent)}
                    x2={cx}
                    y2={cy}
                  />,
                ];
              });
            })}
          </g>
          <g className="dag-visualizer-blocks">
            {blocks.map((block) => {
              const x = blockX(block, now);
              const age = now - block.spawnedAt;
              // Fade-in over the first 200ms of life so a block doesn't
              // pop from full opacity, and fade-out across the last
              // 500ms so it doesn't disappear abruptly at the edge.
              const lifetime = FRAME_WIDTH / SPEED_PX_PER_S / (1 / 1000);
              const opacity =
                age < 200
                  ? age / 200
                  : age > lifetime - 500
                    ? Math.max(0, (lifetime - age) / 500)
                    : 1;
              return (
                <rect
                  className="dag-visualizer-block"
                  height={9}
                  key={block.id}
                  opacity={opacity}
                  rx={1.5}
                  width={11}
                  x={x - 5.5}
                  y={blockY(block) - 4.5}
                />
              );
            })}
          </g>
        </svg>
      </div>
      <div className="dag-visualizer-caption">
        <span className="dag-visualizer-pulse" aria-hidden="true" />
        <p>
          {/* Explicit non-breaking space as a JSX expression. A plain
              " Each" right after </strong> rendered as "second.Each" in
              production — JSX's whitespace coalescing dropped it after
              prettier reflowed the tag boundary. "\u00a0" in an expression
              survives both passes. */}
          <strong>~10 blocks per second.</strong>
          {"\u00a0"}Each square is a new block; lines connect it to its parents. Multiple miners can
          build in parallel — that&apos;s the BlockDAG, and that&apos;s why a Kaspa payment confirms
          in seconds.
        </p>
      </div>
    </section>
  );
}
