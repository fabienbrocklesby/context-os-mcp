import type { MemorySearchHit } from "~/domain/memory";

// Active state values that mean "this entity is not part of current truth/pipeline".
// "closed(?![\s_-]?won)" carves out closed_won (a current, won deal) while still
// matching closed / closed_lost / closed_not_proceeding.
const NOT_CURRENT_VALUE_PATTERN =
  /(parked|legacy|closed(?![\s_-]?won)|lost|inactive|archived|dormant|dead|not[_\s-]?current|on[_\s-]?hold|deprioriti[sz]ed|stale|requires[_\s-]?live[_\s-]?check)/i;

// State keys that carry volatile current-state truth. next_action is intentionally
// excluded: its values are free-text actions that can incidentally match the pattern.
export const VOLATILE_STATE_KEYS = [
  "deal_stage",
  "status",
  "pipeline_status",
  "source_freshness",
  "engagement_status",
] as const;

const VOLATILE_STATE_KEY_SET = new Set<string>(VOLATILE_STATE_KEYS);

export type EntityStateLike = { stateKey: string; value: unknown; status: string };
export type EntityWithStates = { entityId: string; names: string[]; states: EntityStateLike[] };
export type NotCurrentEntity = { entityId: string; names: string[]; reason: string };

export function deriveNotCurrentEntities(entities: EntityWithStates[]): NotCurrentEntity[] {
  const result: NotCurrentEntity[] = [];
  for (const entity of entities) {
    const signal = entity.states.find(
      (state) =>
        state.status === "active" &&
        VOLATILE_STATE_KEY_SET.has(state.stateKey) &&
        NOT_CURRENT_VALUE_PATTERN.test(String(state.value ?? "")),
    );
    if (signal) {
      result.push({
        entityId: entity.entityId,
        names: entity.names.filter((name) => Boolean(name)),
        reason: `${signal.stateKey}=${String(signal.value)}`,
      });
    }
  }
  return result;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type EntityAuthorityRepo = {
  searchEntities(input: { project: string; limit: number }): Promise<Array<{ id: string; name: string; slug: string }>>;
  listEntityStatesForEntities(input: {
    project: string;
    entityIds: string[];
    includeSuperseded: boolean;
    stateKeys?: string[];
  }): Promise<Array<{ entityId: string; stateKey: string; value: unknown; status: string }>>;
};

/**
 * Best-effort: resolve which of a project's entities are flagged not-current by an
 * active volatile state. Returns [] on any failure so search is never blocked.
 */
export async function computeNotCurrentEntities(
  repo: EntityAuthorityRepo,
  project: string,
): Promise<NotCurrentEntity[]> {
  try {
    const entities = await repo.searchEntities({ project, limit: 50 });
    if (!entities.length) return [];
    const states = await repo.listEntityStatesForEntities({
      project,
      entityIds: entities.map((e) => e.id),
      includeSuperseded: false,
      stateKeys: [...VOLATILE_STATE_KEYS],
    });
    if (!states.length) return [];
    const grouped: EntityWithStates[] = entities.map((entity) => ({
      entityId: entity.id,
      names: [entity.name, entity.slug].filter(Boolean),
      states: states
        .filter((s) => s.entityId === entity.id)
        .map((s) => ({ stateKey: s.stateKey, value: s.value, status: s.status })),
    }));
    return deriveNotCurrentEntities(grouped);
  } catch (err) {
    console.warn("[computeNotCurrentEntities] best-effort entity-state lookup failed, skipping:", err);
    return [];
  }
}

export function markContradictedHits(
  hits: MemorySearchHit[],
  notCurrent: NotCurrentEntity[],
): MemorySearchHit[] {
  if (!notCurrent.length) return hits;
  // Path-slug matching assumes entity names are distinctive (len > 2 after slugify).
  // Entity names shorter than ~5 chars can collide with unrelated paths; current
  // Light Lane entity names are long enough that this is not a live risk.
  const slugs = notCurrent.flatMap((e) => e.names.map(slugify)).filter((s) => s.length > 2);
  const lowerNames = notCurrent.flatMap((e) => e.names.map((n) => n.toLowerCase())).filter((n) => n.length > 2);
  return hits.map((hit) => {
    const pathLc = hit.path.toLowerCase();
    const titleLc = hit.title.toLowerCase();
    const contradicted =
      slugs.some((slug) => pathLc.includes(slug)) ||
      lowerNames.some((name) => titleLc === name);
    return contradicted ? { ...hit, contradictedByCurrentState: true } : hit;
  });
}
