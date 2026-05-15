export type MaybePromise<T> = Promise<T> | T;

type ObjectEntry<T extends object> = {
    [Key in keyof T]: [Key, T[Key]];
}[keyof T];

export function objectEntries<T extends object>(obj: T): ObjectEntry<T>[] {
    return Object.entries(obj) as ObjectEntry<T>[];
}

export function objectFromEntries<Key extends PropertyKey, Value>(
    entries: Iterable<readonly [Key, Value]>
): Record<Key, Value> {
    return Object.fromEntries(entries) as Record<Key, Value>;
}
