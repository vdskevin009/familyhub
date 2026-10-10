import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { financeFixture } from "./finance-fixture.mjs";

test("private finance HTTP authorization, preview/apply, conflict and restart preserve source and unrelated state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "familyhub-finance-api-"));
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const key = "synthetic-finance-key",
        protectedBytes = '{"manual":"synthetic retained authority"}';
    await writeFile(join(dir, "pairing-key.txt"), key);
    await writeFile(join(dir, "protected-manual.json"), protectedBytes);
    let child,
        logs = "";
    const headers = {
        "x-familyhub-key": key,
        Origin: "https://vdskevin009.github.io",
        "Content-Type": "application/json",
    };
    const call = (path, init = {}) =>
        fetch(`http://127.0.0.1:${port}${path}`, init);
    const post = (path, body, extra = {}) =>
        call(path, {
            method: "POST",
            headers: { ...headers, ...extra },
            body: JSON.stringify(body),
        });
    const start = async () => {
        child = spawn(process.execPath, ["apps/worker/dist/index.js"], {
            env: {
                ...process.env,
                FAMILYHUB_WORKER_PORT: String(port),
                FAMILYHUB_WORKER_DATA: dir,
                FAMILYHUB_WORKER_HOST: "127.0.0.1",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (x) => (logs += x));
        child.stderr.on("data", (x) => (logs += x));
        for (let i = 0; i < 100; i++) {
            try {
                if ((await call("/health", { headers })).ok) return;
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw Error("Synthetic worker failed to start: " + logs);
    };
    const stop = async () => {
        if (child) {
            const done = once(child, "exit");
            child.kill();
            await done;
            child = null;
        }
    };
    try {
        await start();
        for (const path of [
            "/finances",
            "/finances/import",
            "/finances/decision",
        ]) {
            assert.equal(
                (
                    await call(path, {
                        method: path === "/finances" ? "GET" : "POST",
                        body: path === "/finances" ? undefined : "{}",
                    })
                ).status,
                401,
            );
            assert.equal(
                (
                    await call(path, {
                        headers: {
                            ...headers,
                            Origin: "https://untrusted.invalid",
                        },
                    })
                ).status,
                403,
            );
        }
        let response = await call("/finances", { headers });
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal((await response.json()).data, null);
        assert.ok(
            !(await readdir(dir)).includes("finances"),
            "Read must not initialize finance storage",
        );
        const bundle = financeFixture();
        assert.equal((await post("/finances/import", { bundle })).status, 200);
        assert.ok(
            !(await readdir(dir)).includes("finances"),
            "Preview must not write",
        );
        assert.equal(
            (
                await post("/finances/import", {
                    bundle,
                    apply: true,
                    expectedRevision: "stale",
                })
            ).status,
            409,
        );
        const first = await (
            await post("/finances/import", {
                bundle,
                apply: true,
                expectedRevision: "empty",
            })
        ).json();
        assert.equal(first.state.data.transactions.length, 13);
        let changed = await (
            await post("/finances/decision", {
                id: "childcare",
                expectedRevision: first.state.revision,
                decision: {
                    nature: "expense",
                    category: "childcare",
                    note: "Confirmed from a synthetic receipt",
                },
            })
        ).json();
        assert.equal(changed.decisions.childcare.category, "childcare");
        assert.equal((await post("/finances/decision", { id: "transfer", expectedRevision: changed.revision, decision: { nature: "expense", category: "savings-investments", note: "Invalid consumption" } })).status, 400);
        changed = await (await post("/finances/decision", { id: "transfer", expectedRevision: changed.revision, decision: { nature: "investment", category: "savings-investments", note: "Synthetic savings" } })).json();
        assert.equal(changed.decisions.transfer.category, "savings-investments");
        assert.equal(changed.decisions.childcare.category, "childcare");
        assert.equal(
            (
                await post("/finances/decision", {
                    id: "childcare",
                    expectedRevision: first.state.revision,
                    decision: {
                        nature: "expense",
                        category: "other",
                        note: "stale",
                    },
                })
            ).status,
            409,
        );
        await stop();
        await start();
        const saved = await (await call("/finances", { headers })).json();
        assert.deepEqual(saved, changed);
        assert.equal(
            (
                await (
                    await post("/finances/import", {
                        bundle,
                        apply: true,
                        expectedRevision: saved.revision,
                    })
                ).json()
            ).alreadyImported,
            true,
        );
        assert.equal(
            await readFile(join(dir, "protected-manual.json"), "utf8"),
            protectedBytes,
        );
        assert.equal(await readFile(join(dir, "pairing-key.txt"), "utf8"), key);
        assert.ok(!logs.includes(key));
        assert.ok(!logs.includes("TWIG + OWL"));
    } finally {
        await stop();
        await rm(dir, { recursive: true, force: true });
    }
});
