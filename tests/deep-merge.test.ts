import { describe, test, expect } from 'bun:test';

function deepMerge<T>(base: T, override: Record<string, unknown>): T {
    const result = { ...base } as Record<string, unknown>;
    for (const key of Object.keys(override)) {
        const val = (override as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && key in result) {
            const baseVal = result[key];
            if (baseVal !== null && typeof baseVal === 'object' && !Array.isArray(baseVal)) {
                result[key] = deepMerge(baseVal as Record<string, unknown>, val as Record<string, unknown>);
                continue;
            }
        }
        if (val !== undefined) {
            result[key] = val;
        }
    }
    return result as T;
}

describe('deepMerge', () => {
    test('empty override returns original config', () => {
        const base = { a: 1, b: 'hello' };
        const result = deepMerge(base, {});
        expect(result).toEqual(base);
    });

    test('overrides top-level values', () => {
        const base = { a: 1, b: 'hello' };
        const result = deepMerge(base, { a: 42 });
        expect(result.a).toBe(42);
        expect(result.b).toBe('hello');
    });

    test('deep merges nested objects', () => {
        const base = { worker: { maxConcurrency: 2, pollIntervalMs: 1000 } };
        const result = deepMerge(base, { worker: { maxConcurrency: 5 } });
        expect(result.worker.maxConcurrency).toBe(5);
        expect(result.worker.pollIntervalMs).toBe(1000);
    });

    test('ignores undefined values', () => {
        const base = { a: 1 };
        const result = deepMerge(base, { a: undefined });
        expect(result.a).toBe(1);
    });

    test('null values do not trigger deep merge', () => {
        const base = { nested: { a: 1 } };
        const result = deepMerge(base, { nested: null } as Record<string, unknown>);
        expect(result.nested).toBeNull();
    });

    test('new fields are added', () => {
        const base = { a: 1 } as Record<string, unknown>;
        const result = deepMerge(base, { b: 2 });
        expect(result.a).toBe(1);
        expect(result.b).toBe(2);
    });

    test('arrays are fully replaced', () => {
        const base = { items: [1, 2, 3] };
        const result = deepMerge(base, { items: [4, 5] });
        expect(result.items).toEqual([4, 5]);
    });

    test('three-level deep merge', () => {
        const base = { level1: { level2: { level3: 'deep', keep: true } } };
        const result = deepMerge(base, { level1: { level2: { level3: 'changed' } } });
        expect(result.level1.level2.level3).toBe('changed');
        expect(result.level1.level2.keep).toBe(true);
    });
});
