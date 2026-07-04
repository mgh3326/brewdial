import { sql, type Kysely } from 'kysely'
import type { BeanAttributes } from '@brewdial/shared'
import type { DB } from '../types.js'

const ATTR_COLS = [
  'roast_level_ord', 'agtron_min', 'agtron_max', 'acidity', 'body',
  'decaf', 'flavor_categories', 'attrs_source',
] as const satisfies ReadonlyArray<keyof DB['beans']>

interface AttrRow {
  roast_level_ord: number | null; agtron_min: number | null; agtron_max: number | null
  acidity: number | null; body: number | null; decaf: boolean | null
  flavor_categories: string[] | null; attrs_source: string | null
}

function toAttrs(r: AttrRow): BeanAttributes {
  const a: BeanAttributes = {}
  if (r.roast_level_ord != null) a.roastLevelOrd = r.roast_level_ord
  if (r.agtron_min != null) a.agtronMin = r.agtron_min
  if (r.agtron_max != null) a.agtronMax = r.agtron_max
  if (r.acidity != null) a.acidity = r.acidity
  if (r.body != null) a.body = r.body
  if (r.decaf != null) a.decaf = r.decaf
  if (r.flavor_categories != null) a.flavorCategories = r.flavor_categories as BeanAttributes['flavorCategories']
  if (r.attrs_source != null) a.attrsSource = r.attrs_source as BeanAttributes['attrsSource']
  return a
}

/**
 * getTasteSignals — read-time taste signals for an app user.
 * savedBeanAttrs: beans the user saved. ratedBeanAttrs: beans of feedback the user
 * gave overall>=4. Returns empty arrays when appUserId is undefined (anon).
 */
export async function getTasteSignals(
  db: Kysely<DB>,
  appUserId?: string
): Promise<{ savedBeanAttrs: BeanAttributes[]; ratedBeanAttrs: BeanAttributes[] }> {
  if (!appUserId) return { savedBeanAttrs: [], ratedBeanAttrs: [] }

  const savedRows = await db
    .selectFrom('saved_beans')
    .innerJoin('beans', 'beans.id', 'saved_beans.bean_id')
    .select(ATTR_COLS.map((c) => `beans.${c}` as `beans.${typeof c}`))
    .where('saved_beans.app_user_id', '=', appUserId)
    .execute() as unknown as AttrRow[]

  const ratedRows = await db
    .selectFrom('feedback')
    .innerJoin('beans', 'beans.id', 'feedback.bean_id')
    .select(ATTR_COLS.map((c) => `beans.${c}` as `beans.${typeof c}`))
    // House visibility pattern (mirrors recipes.ts getRecipeByCode/listRecipesByBean):
    // public feedback (owner_id null, e.g. agent/anon-submitted) + the caller's own
    // feedback both count as taste signal. A strict owner_id=appUserId equality would
    // silently exclude all public feedback from the signal set.
    .where((eb) => eb.or([eb('feedback.owner_id', 'is', null), eb('feedback.owner_id', '=', appUserId)]))
    .where(sql<number>`coalesce((feedback.ratings->>'overall')::int, 0)`, '>=', 4)
    .execute() as unknown as AttrRow[]

  return { savedBeanAttrs: savedRows.map(toAttrs), ratedBeanAttrs: ratedRows.map(toAttrs) }
}
