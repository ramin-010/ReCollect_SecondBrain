// The time zone agents see times in: Ramin's learning time zone (Settings; India for him), so a
// change list and "updated" days match the app. Read once per connection; UTC if it can't be read.
import type { RecollectApi } from './api.js';
import type { LearningSettings } from './types.js';

const zones = new WeakMap<RecollectApi, Promise<string>>();

function valid(zone: unknown): string {
    if (typeof zone !== 'string' || !zone) return 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return zone;
    } catch {
        return 'UTC';
    }
}

export function userTimeZone(api: RecollectApi): Promise<string> {
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
