// The time zone agents see times in: the user's learning time zone (Settings), so a
// change list and "updated" days match the app. Read once per connection; UTC if it can't be read.
import { realApi, type KaagaApi } from './api.js';
import type { LearningSettings } from './types.js';

const zones = new WeakMap<KaagaApi, Promise<string>>();

function valid(zone: unknown): string {
    if (typeof zone !== 'string' || !zone) return 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return zone;
    } catch {
        return 'UTC';
    }
}

export function userTimeZone(api: KaagaApi): Promise<string> {
    // Keyed by the request's own client (a pooled server's stand-in serves many people).
    const key = realApi(api);
    let zone = zones.get(key);
    if (!zone) {
        zone = key
            .get<LearningSettings>('/api/learning/settings')
            .then((s) => valid(s?.timezone))
            .catch(() => {
                zones.delete(key); // try again next time
                return 'UTC';
            });
        zones.set(key, zone);
    }
    return zone;
}
