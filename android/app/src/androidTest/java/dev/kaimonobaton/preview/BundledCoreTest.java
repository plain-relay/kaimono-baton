package dev.kaimonobaton.preview;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real WebView/native-bridge checks. These tests never run on a physical/user device. */
@RunWith(AndroidJUnit4.class)
public class BundledCoreTest {
    private Instrumentation instrumentation;
    private MainActivity activity;

    @Before
    public void launchSyntheticEmulator() {
        assumeTrue("Explicit synthetic emulator required",
            "true".equals(InstrumentationRegistry.getArguments().getString("syntheticDevice")) &&
            ("ranchu".equals(Build.HARDWARE) || "goldfish".equals(Build.HARDWARE)));
        instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(intent);
        // Block network loads while keeping Capacitor's bundled-asset interceptor intact.
        // Wi-Fi/mobile-data settings alone do not disconnect an emulator's virtual Ethernet.
        instrumentation.runOnMainSync(() -> {
            activity.getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            activity.getBridge().getWebView().setNetworkAvailable(false);
            activity.getBridge().getWebView().reload();
        });
        eventually("bundled home", "document.body.textContent.includes('新しい買いものリストを作る')");
        assertEquals("native bridge", "true", evaluate("window.Capacitor.isNativePlatform()"));
        assertEquals("offline test environment", "false", evaluate("navigator.onLine"));
    }

    @After
    public void finishActivity() {
        if (activity != null) instrumentation.runOnMainSync(() -> activity.finish());
    }

    @Test
    public void createOpenAndPersistFixedRequestOffline() throws Exception {
        // Only the explicit synthetic emulator is reset. No real browser or user storage is touched.
        evaluate("localStorage.clear(); true");
        click("新しい買いものリストを作る", true);
        eventually("create form", "!!document.querySelector('button.step-button')");
        evaluate("[...document.querySelectorAll('button.step-button')].find(b=>b.textContent.trim()==='＋').click(); true");
        click("確認へ", false);
        eventually("review", "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='LINEで送る')");
        assertEquals("draft persisted", "true", evaluate("!!localStorage.getItem('otsukai:createDraft')"));

        String encoded;
        try (InputStream input = instrumentation.getContext().getAssets().open("published-v3.txt")) {
            encoded = read(input).trim();
        }
        String syntheticLink = "https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/" + encoded;
        evaluate("document.querySelector('.native-link-import details').open=true; true");
        evaluate("(() => { const input=document.querySelector('#native-link-input'); " +
            "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input," +
            JSONObject.quote(syntheticLink) + "); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()");
        evaluate("document.querySelector('.native-link-import form').requestSubmit(); true");
        eventually("published v3 request", "document.querySelectorAll('.shopping-item-card').length===4");
        evaluate("(() => { const buttons=document.querySelectorAll('.shopping-cart-button'); buttons[buttons.length-1].click(); return true; })()");
        eventually("purchase progress", "!!document.querySelector('.shopping-item-card.is-inCart')");
        assertEquals("resume key", "true", evaluate("!!localStorage.getItem('kaimono-baton:native:last-fixed-route:v1')"));
        eventually("stored purchase progress", "Object.keys(localStorage).filter(k=>k.startsWith('otsukai:checked:')).some(k=>Object.values(JSON.parse(localStorage.getItem(k))).includes('inCart'))");
        // Normal restart is tested after the WebView's asynchronous storage commit window.
        // Immediate force-kill/crash durability is a separate, unproven contract.
        SystemClock.sleep(6000);
    }

    @Test
    public void resumeAfterProcessRestartOffline() throws Exception {
        // Run after the fixture test, with a separate instrumentation invocation/process.
        eventually("resume button", "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='前回の買い物を再開')");
        click("前回の買い物を再開", false);
        eventually("restored progress", "!!document.querySelector('.shopping-item-card.is-inCart')");
        shell("input keyevent 4");
        eventually("Android back to home", "document.body.textContent.includes('新しい買いものリストを作る')");
        click("前回の買い物を再開", false);
        eventually("progress retained after back", "!!document.querySelector('.shopping-item-card.is-inCart')");
    }

    @Test
    public void nativeShareUsesPublicUrlAndCancellationPreservesDraft() throws Exception {
        click("新しい買いものリストを作る", true);
        eventually("create form", "!!document.querySelector('button.step-button')");
        // Keep this share case independent of whether an earlier draft exists.
        evaluate("(() => { if(![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='確認へ'&&!b.disabled)) " +
            "[...document.querySelectorAll('button.step-button')].find(b=>b.textContent.trim()==='＋').click(); return true; })()");
        click("確認へ", false);
        eventually("review", "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='LINEで送る')");
        click("LINEで送る", false);
        eventually("canonical URL budget", "(() => { const value=localStorage.getItem('otsukai:lastSharedUrl'); " +
            "if(!value)return false; const u=new URL(value); return u.origin==='https://plain-relay.github.io' && " +
            "u.pathname==='/kaimono-baton/' && u.searchParams.get('openExternalBrowser')==='1' && " +
            "u.hash.startsWith('#/l/') && value.length<=2200; })()");
        long deadline = SystemClock.elapsedRealtime() + 60000;
        boolean chooser = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (isChooserResumed()) {
                chooser = true;
                break;
            }
            SystemClock.sleep(500);
        }
        assertTrue("OS chooser opened", chooser);
        shell("input keyevent 4");
        eventually("share cancelled", "document.body.textContent.includes('共有をキャンセルしました')");
        assertEquals("no clipboard fallback notice", "false", evaluate("document.body.textContent.includes('依頼文をコピーしました')"));
        assertEquals("draft retained", "true", evaluate("!!localStorage.getItem('otsukai:createDraft')"));
    }

    @Test
    public void catalogJsonExportUsesPrivateCacheAndRequiresConfirmation() throws Exception {
        String now = "2026-10-26T00:00:00.000Z";
        JSONArray products = new JSONArray();
        for (int index = 0; index < 200; index++) {
            products.put(new JSONObject()
                .put("id", String.format(java.util.Locale.ROOT, "household:%08x-1234-4abc-8def-%012x", index, index * 7919L))
                .put("name", "TEST-" + index + "-" + Long.toString(index * 104729L, 36))
                .put("unit", "unit").put("categoryId", index % 2 == 0 ? "daily" : "other")
                .put("hidden", false).put("createdAt", now).put("updatedAt", now));
        }
        String json = new JSONObject().put("version", 2).put("createdAt", now)
            .put("catalog", new JSONObject().put("schemaVersion", 2).put("revision", 200)
                .put("updatedAt", now).put("overrides", new JSONObject()).put("addedProducts", products)).toString();
        evaluate("window.location.hash='/products'; true");
        eventually("catalog file input", "!!document.querySelector('input[type=file]')");
        // Drive the existing JSON import handler; selecting from the OS Picker remains a separate check.
        evaluate("(() => { const transfer=new DataTransfer(); transfer.items.add(new File([" + JSONObject.quote(json) +
            "],'synthetic-catalog.json',{type:'application/json'})); const input=document.querySelector('input[type=file]'); " +
            "input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()");
        eventually("catalog recovery preview", "document.body.textContent.includes('内容を確認してから置き換えます')");
        click("この商品リストに置き換える", false);
        eventually("catalog imported", "document.body.textContent.includes('復旧用JSONファイルから商品リストを復元しました')");
        // Importing an existing backup intentionally records it as backed up in the Web contract.
        // Make a real edit before testing cancellation of a new backup attempt.
        click("編集", false);
        click("商品リストから外す", false);
        eventually("edited catalog unbacked", "document.querySelector('.catalog-backup-state').textContent.includes('未バックアップ')");
        File exported = new File(instrumentation.getTargetContext().getCacheDir(), "catalog-backups/catalog-backup.json");
        if (exported.exists()) assertTrue("previous synthetic cache removed", exported.delete());
        click("復旧リンクを保存", false);
        long deadline = SystemClock.elapsedRealtime() + 60000;
        while (!exported.isFile() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(250);
        assertTrue("private cache JSON created", exported.isFile() && exported.length() > 0);
        deadline = SystemClock.elapsedRealtime() + 60000;
        boolean chooser = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (isChooserResumed()) {
                chooser = true;
                break;
            }
            SystemClock.sleep(500);
        }
        assertTrue("file share chooser opened", chooser);
        shell("input keyevent 4");
        eventually("JSON share cancelled", "document.body.textContent.includes('共有をキャンセルしました')");
        assertEquals("backup not auto-confirmed", "false", evaluate("document.querySelector('.catalog-backup-state').textContent.includes('バックアップ済みです')"));
        assertEquals("catalog retained", "true", evaluate("document.body.textContent.includes('未バックアップ')"));
    }

    private void click(String label, boolean includes) {
        String predicate = "b.textContent.trim()" + (includes ? ".includes(" + JSONObject.quote(label) + ")" : "===" + JSONObject.quote(label));
        eventually("button available", "[...document.querySelectorAll('button')].some(b=>" + predicate + "&&!b.disabled)");
        assertEquals("button clicked", "true", evaluate("[...document.querySelectorAll('button')].find(b=>" + predicate + ").click(); true"));
    }

    private void eventually(String stage, String expression) {
        long deadline = SystemClock.elapsedRealtime() + 90000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(expression))) return;
            SystemClock.sleep(250);
        }
        throw new AssertionError(stage + " did not complete");
    }

    private String evaluate(String expression) {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(expression, value -> {
            result.set(value);
            done.countDown();
        }));
        try {
            assertTrue("WebView evaluation timeout", done.await(30, TimeUnit.SECONDS));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new AssertionError("WebView evaluation interrupted");
        }
        return result.get();
    }

    private boolean isChooserResumed() throws Exception {
        for (String line : shell("dumpsys activity activities").split("\n")) {
            if (line.contains("ResumedActivity") && line.contains("com.android.internal.app.ChooserActivity")) return true;
        }
        return false;
    }

    private String shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = instrumentation.getUiAutomation().executeShellCommand(command);
             InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            return read(input);
        }
    }

    private static String read(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
