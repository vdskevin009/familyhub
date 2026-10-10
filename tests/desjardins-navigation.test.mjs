import test from 'node:test';
import assert from 'node:assert/strict';
import { desjardinsHistoryReady } from '../apps/worker/dist/desjardins-navigation.js';
const host = 'https://www.agea-gbim.dsf-dfs.com';
const history = host + '/AGEA-GBIM/Rclmtn/RclmtnTrt/HistoriqueReclamation_ClaimHistory.aspx';
function fixture({ english = false, alreadyReady = false, external = false, missing = false, redirect = false } = {}) {
  let current = external ? 'https://id.desjardins.com/login' : alreadyReady ? history : host + '/AGEA-GBIM/Athntfctn/Accl/Accueil_Home.aspx';
  let expanded = false, clicks = 0;
  const page = {
    url: () => current,
    getByRole: (role, { name }) => {
      const menu = name.test(english ? 'History' : 'Historique');
      const target = name.test(english ? 'Processed claims' : 'Réclamations traitées');
      const locator = {
        first: () => locator,
        isVisible: async () => menu ? !missing : target && expanded && !missing,
        waitFor: async () => { if (!expanded) throw new Error('hidden'); },
        click: async () => { clicks++; if (menu) expanded = true; else { assert.ok(target && expanded); current = redirect ? 'https://untrusted.example/HistoriqueReclamation_ClaimHistory.aspx' : history; } }
      };
      return locator;
    },
    waitForURL: async pattern => assert.ok(pattern.test(current)),
    locator: selector => { assert.equal(selector, 'table.tableau-donnees'); return { isVisible: async () => current === history }; }
  };
  return { page, clicks: () => clicks };
}
test('French authenticated home expands Historique and opens Réclamations traitées', async () => {
  const f = fixture(); assert.equal(await desjardinsHistoryReady(f.page), true); assert.equal(f.clicks(), 2);
});
test('English authenticated home opens Processed claims from History', async () => {
  const f = fixture({ english: true }); assert.equal(await desjardinsHistoryReady(f.page), true); assert.equal(f.clicks(), 2);
});
test('Existing authenticated history stays on the same page', async () => {
  const f = fixture({ alreadyReady: true }); assert.equal(await desjardinsHistoryReady(f.page), true); assert.equal(f.clicks(), 0);
});
test('Identity provider page is not mistaken for authenticated history', async () => {
  const f = fixture({ external: true }); assert.equal(await desjardinsHistoryReady(f.page), false); assert.equal(f.clicks(), 0);
});
test('Missing authenticated navigation does not trigger a guessed action', async () => {
  const f = fixture({ missing: true }); assert.equal(await desjardinsHistoryReady(f.page), false); assert.equal(f.clicks(), 0);
});
test('History-like redirect on another origin never establishes authentication', async () => {
  const f = fixture({ redirect: true }); assert.equal(await desjardinsHistoryReady(f.page), false);
});
