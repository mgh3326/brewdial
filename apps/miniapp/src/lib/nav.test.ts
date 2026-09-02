import { describe, it, expect } from 'vitest';
import { whichTab, asRecipeCode } from './nav';

describe('whichTab', () => {
  it('marks the empty hash route as the Pick tab', () => {
    expect(whichTab('/')).toBe('pick');
  });

  it('marks the bean route + legacy alias as the bean tab', () => {
    expect(whichTab('/beans')).toBe('beans');
    expect(whichTab('/recipes')).toBe('beans');
    expect(whichTab('/recipes/')).toBe('beans');
  });

  it('marks the saved route as the saved tab', () => {
    expect(whichTab('/saved')).toBe('saved');
  });

  it('hides the tab bar on detail/form/404 routes', () => {
    expect(whichTab('/recipes/COF-1')).toBeNull();
    expect(whichTab('/recipes/removed')).toBeNull();
    expect(whichTab('/beans/some-bean')).toBeNull();
    expect(whichTab('/totally/unknown')).toBeNull();
  });
});

describe('asRecipeCode', () => {
  it('coerces COF- prefixed strings and rejects the rest', () => {
    expect(asRecipeCode('COF-1')).toBe('COF-1');
    expect(asRecipeCode('bean-x')).toBeNull();
  });
});
