package app.recollect.phone;

import android.net.Uri;

/**
 * A connect link, in either form: recollect://connect?server=…&token=… (what the server's page hands
 * the app) or the page's own address, http(s)://host/phone/connect#t=… (what the QR code and "Copy the
 * link" hold; the server is then the page's origin).
 */
final class ConnectLink {
    final String server;
    final String token;

    private ConnectLink(String server, String token) {
        this.server = server;
        this.token = token;
    }

    /** Why a link was refused. */
    static final class Refused extends Exception {
        final boolean needsHttps;

        Refused(boolean needsHttps) {
            super(needsHttps ? "needs https" : "not a connect link");
            this.needsHttps = needsHttps;
        }
    }

    static ConnectLink parse(String text) throws Refused {
        if (text == null) throw new Refused(false);
        Uri uri = Uri.parse(text.trim());
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String server;
        String token;
        if (scheme.equals("recollect") && "connect".equals(uri.getHost())) {
            server = uri.getQueryParameter("server");
            token = uri.getQueryParameter("token");
        } else if ((scheme.equals("http") || scheme.equals("https")) && uri.getPath() != null && uri.getPath().endsWith("/phone/connect")) {
            // The fragment reads like a query string ("t=rcl_…"); a hierarchical stand-in parses it.
            Uri fragment = Uri.parse("http://x/?" + (uri.getEncodedFragment() == null ? "" : uri.getEncodedFragment()));
            token = fragment.getQueryParameter("t");
            server = scheme + "://" + uri.getEncodedAuthority();
        } else {
            throw new Refused(false);
        }
        return check(server, token);
    }

    private static ConnectLink check(String server, String token) throws Refused {
        if (server == null || token == null || !token.startsWith("rcl_") || token.length() < 20) throw new Refused(false);
        Uri s = Uri.parse(server.trim());
        String scheme = s.getScheme() == null ? "" : s.getScheme().toLowerCase();
        String host = s.getHost();
        if (host == null || host.isEmpty() || !(scheme.equals("http") || scheme.equals("https"))) throw new Refused(false);
        // Plain http only to this computer (USB) or the home network; anything on the internet needs https.
        if (scheme.equals("http") && !isLocal(host)) throw new Refused(true);
        String origin = scheme + "://" + s.getEncodedAuthority();
        return new ConnectLink(origin, token.trim());
    }

    /** localhost, the private IPv4 ranges and .local names. */
    static boolean isLocal(String host) {
        String h = host.toLowerCase();
        if (h.equals("localhost") || h.endsWith(".local") || h.equals("[::1]")) return true;
        String[] p = h.split("\\.");
        if (p.length != 4) return false;
        int a;
        int b;
        try {
            a = Integer.parseInt(p[0]);
            b = Integer.parseInt(p[1]);
        } catch (NumberFormatException e) {
            return false;
        }
        return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
    }

    /** "localhost:8002", "192.168.43.20:8002", "recollect.example.com" */
    static String hostOf(String server) {
        Uri s = Uri.parse(server);
        return s.getEncodedAuthority() == null ? server : s.getEncodedAuthority();
    }
}
