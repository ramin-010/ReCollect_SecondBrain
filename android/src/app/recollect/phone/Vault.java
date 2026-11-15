package app.recollect.phone;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The token at rest: sealed with an AES-256-GCM key that lives in the Android Keystore (it never
 * leaves the phone's secure hardware), so the preferences file alone holds nothing usable.
 */
final class Vault {
    private static final String STORE = "AndroidKeyStore";
    private static final String ALIAS = "recollect-token";

    private Vault() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
            gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return gen.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    /** "iv:ciphertext", both Base64. */
    static String seal(String plain) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] sealed = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException("The phone's keystore couldn't seal the token", e);
        }
    }

    /** The plain text, or null when it can't be opened (a reset keystore): the app then asks to connect again. */
    static String open(String sealed) {
        if (sealed == null) return null;
        int at = sealed.indexOf(':');
        if (at <= 0) return null;
        try {
            byte[] iv = Base64.decode(sealed.substring(0, at), Base64.NO_WRAP);
            byte[] body = Base64.decode(sealed.substring(at + 1), Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(body), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
