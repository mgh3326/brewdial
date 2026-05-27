import type { CreateRecipeInput, RecipeCode, RecipeDoc } from '@brewdial/shared';
import type { CouchConfig } from '../config';
import { getAllDocuments, getDocument, putDocument } from '../couch';
import { nextRecipeCode } from './counters';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_PAGE_SIZE = 20;

export async function createRecipe(
  config: CouchConfig,
  input: CreateRecipeInput,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc> {
  const code = await nextRecipeCode(config, fetchImpl);
  const now = new Date().toISOString();
  const doc: RecipeDoc = {
    _id: `recipe:${code}`,
    type: 'recipe',
    code,
    method: input.method,
    title: input.title,
    version: 1,
    params: input.params ?? {},
    steps: input.steps ?? [],
    createdBy: input.createdBy ?? 'manual',
    createdAt: now,
    updatedAt: now
  };
  if (input.beanId !== undefined) doc.beanId = input.beanId;
  if (input.beanSnapshot !== undefined) doc.beanSnapshot = input.beanSnapshot;
  if (input.intent !== undefined) doc.intent = input.intent;
  if (input.notes !== undefined) doc.notes = input.notes;
  if (input.adjustmentFromPrevious !== undefined)
    doc.adjustmentFromPrevious = input.adjustmentFromPrevious;
  return putDocument(config, doc, fetchImpl);
}

export async function getRecipeByCode(
  config: CouchConfig,
  code: RecipeCode,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc | null> {
  return getDocument<RecipeDoc>(config, `recipe:${code}`, fetchImpl);
}

async function fetchAllRecipesSorted(
  config: CouchConfig,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const docs = await getAllDocuments<RecipeDoc>(
    config,
    {
      startkey: 'recipe:',
      endkey: 'recipe:￰',
      includeDocs: true
    },
    fetchImpl
  );
  return docs
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function listRecentRecipes(
  config: CouchConfig,
  limit: number = DEFAULT_LIMIT,
  fetchImpl: typeof fetch = fetch
): Promise<RecipeDoc[]> {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const sorted = await fetchAllRecipesSorted(config, fetchImpl);
  return sorted.slice(0, safeLimit);
}

export interface RecipePage {
  recipes: RecipeDoc[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listRecipesPage(
  config: CouchConfig,
  opts: { page?: number; pageSize?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<RecipePage> {
  const pageSize = Math.max(
    1,
    Math.min(MAX_LIMIT, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)
  );
  const sorted = await fetchAllRecipesSorted(config, fetchImpl);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rawPage = Math.floor(opts.page ?? 1);
  const page = Math.max(
    1,
    Math.min(totalPages, Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1)
  );
  const start = (page - 1) * pageSize;
  const recipes = sorted.slice(start, start + pageSize);
  return { recipes, total, page, pageSize, totalPages };
}

export { DEFAULT_PAGE_SIZE };
