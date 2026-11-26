// The time zone agents see times in: the user's learning time zone (Settings), so a
// change list and "updated" days match the app. Read once per connection; UTC if it can't be read.
import type { KaagaApi } from './api.js';
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
    let zone = zones.get(api);
    if (!zone) {
        zone = api
            .get<LearningSettings>('/api/learning/settings')
            .then((s) => valid(s?.timezone))
            .catch(() => {
                zones.delete(api); // try again next time
                return 'UTC';
            });
        zones.set(api, zone);
    }
    return zone;
}
