package app.recollect.phone;

/**
 * Which addresses count as this computer or the home network (pure Java: the connect link and the updater share it, and
 * `node build.mjs --test` runs it on the PC). Plain http is allowed only to these; anything on the internet needs https.
 */
public final class Hosts {
    private Hosts() {}

    /** localhost, the private IPv4 ranges and .local names. */
    public static boolean isLocal(String host) {
        if (host == null) return false;
        String h = host.toLowerCase();
        if (h.equals("localhost") || h.endsWith(".local") || h.equals("[::1]") || h.equals("::1")) return true;
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
}
