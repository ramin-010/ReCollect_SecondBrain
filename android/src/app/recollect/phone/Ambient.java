package app.recollect.phone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** GET /api/ambient/widget's `data`: what the day holds now (backend ambient.service.ts). */
final class Ambient {
    /** morning | working | evening | done | rest */
    final String state;
    /** "Sunday 15 November" */
    final String date;
    /** The one line that matters now; empty on a done day. */
    final String headline;
    /** Up to three quieter lines. */
    final List<String> lines;
    /** The web app's address, or null. */
    final String appUrl;
    final String accountName;
    final String accountEmail;

    private Ambient(String state, String date, String headline, List<String> lines, String appUrl, String accountName, String accountEmail) {
        this.state = state;
        this.date = date;
        this.headline = headline;
        this.lines = lines;
        this.appUrl = appUrl;
        this.accountName = accountName;
        this.accountEmail = accountEmail;
    }

    static Ambient parse(JSONObject d) throws JSONException {
        List<String> lines = new ArrayList<>();
        JSONArray arr = d.optJSONArray("lines");
        if (arr != null) for (int i = 0; i < arr.length() && lines.size() < 3; i++) {
            String l = arr.optString(i, "").trim();
            if (!l.isEmpty()) lines.add(l);
        }
        JSONObject account = d.optJSONObject("account");
        String appUrl = d.isNull("appUrl") ? null : d.optString("appUrl", null);
        return new Ambient(
                d.getString("state"),
                d.optString("date", ""),
                d.optString("headline", ""),
                Collections.unmodifiableList(lines),
                appUrl == null || appUrl.isEmpty() ? null : appUrl,
                account == null ? null : account.optString("name", null),
                account == null ? null : account.optString("email", null));
    }

    boolean done() {
        return "done".equals(state);
    }

    /** What the picture shows: the same key means the same picture, so nothing is fetched again. */
    String pictureKey() {
        StringBuilder b = new StringBuilder(state).append('|').append(date).append('|').append(headline);
        for (String l : lines) b.append('|').append(l);
        return b.toString();
    }
}
