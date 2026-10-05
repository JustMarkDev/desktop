/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// End to end: the global boost reaches real pages through the actors, and
// site boosts, per-site disabling and toggling update open tabs live.

const { gZenBoostsManager: manager } = ChromeUtils.importESModule(
  "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs"
);

const GLOBAL = manager.GLOBAL_DOMAIN;
const PATH = "/browser/zen/tests/boosts/file_boost_page.html";
const SITE_A = "example.com";
const SITE_B = "example.org";

// Custom CSS is the easiest boost effect to observe from content
const GLOBAL_CSS = "#text { outline: 3px solid rgb(1, 2, 3) !important; }";
const SITE_CSS = "#text { outline: 3px solid rgb(4, 5, 6) !important; }";

function makeBoost(domain, data) {
  const boost = manager.createNewBoost(domain);
  Object.assign(boost.boostEntry.boostData, data, { changeWasMade: true });
  manager.saveBoostToStore(boost);
  manager.makeBoostActiveForDomain(domain, boost.id);
  return boost;
}

function outlineOf(browser) {
  return SpecialPowers.spawn(browser, [], () => {
    const el = content.document.getElementById("text");
    return content.getComputedStyle(el).outlineColor;
  });
}

async function waitForOutline(browser, color, message) {
  await TestUtils.waitForCondition(
    async () => (await outlineOf(browser)) === color,
    message
  );
  ok(true, message);
}

registerCleanupFunction(() => {
  for (const domain of [GLOBAL, SITE_A, SITE_B]) {
    for (const boost of manager.loadBoostsFromStore(domain) ?? []) {
      manager.deleteBoost(boost);
    }
    manager.setGlobalDisabledForDomain(domain, false);
  }
});

add_task(async function test_global_boost_end_to_end() {
  const global = makeBoost(GLOBAL, {
    customCSS: GLOBAL_CSS,
    smartInvert: true,
    sizeOverride: 1.5,
  });

  const tabA = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `https://${SITE_A}${PATH}`
  );
  const tabB = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `https://${SITE_B}${PATH}`
  );
  const [a, b] = [tabA.linkedBrowser, tabB.linkedBrowser];

  await waitForOutline(a, "rgb(1, 2, 3)", "Global CSS applies on site A");
  await waitForOutline(b, "rgb(1, 2, 3)", "Global CSS applies on site B");
  await TestUtils.waitForCondition(
    () => b.browsingContext.isZenBoostsInverted,
    "Global invert applies"
  );
  is(ZoomManager.getZoomForBrowser(b), 1, "Global boost never zooms");

  // A site boost replaces the global one on its site only
  const site = makeBoost(SITE_A, { customCSS: SITE_CSS, smartInvert: false });
  await waitForOutline(a, "rgb(4, 5, 6)", "Site boost replaces global");
  await TestUtils.waitForCondition(
    () => !a.browsingContext.isZenBoostsInverted,
    "Site boost settings win over global ones"
  );
  is(await outlineOf(b), "rgb(1, 2, 3)", "Other site keeps global");

  // Switching the site boost off falls back to the global boost
  manager.toggleBoostActiveForDomain(SITE_A, site.id);
  await waitForOutline(a, "rgb(1, 2, 3)", "Disabled site boost falls back");

  // Disabling global on one site only affects that site
  manager.setGlobalDisabledForDomain(SITE_B, true);
  await TestUtils.waitForCondition(
    async () => (await outlineOf(b)) !== "rgb(1, 2, 3)",
    "Global removed where disabled"
  );
  is(await outlineOf(a), "rgb(1, 2, 3)", "Global stays on the other site");
  manager.setGlobalDisabledForDomain(SITE_B, false);
  await waitForOutline(b, "rgb(1, 2, 3)", "Global back after re-enabling");

  // Editing the global boost updates open tabs live
  const { boostEntry } = manager.loadBoostFromStore(GLOBAL, global.id);
  boostEntry.boostData.customCSS = SITE_CSS.replace("4, 5, 6", "7, 8, 9");
  manager.saveBoostToStore({ id: global.id, domain: GLOBAL, boostEntry });
  await waitForOutline(b, "rgb(7, 8, 9)", "Global edits apply live");

  // Switching the global boost off clears it everywhere
  manager.toggleBoostActiveForDomain(GLOBAL, global.id);
  await TestUtils.waitForCondition(
    async () =>
      (await outlineOf(a)) !== "rgb(7, 8, 9)" &&
      (await outlineOf(b)) !== "rgb(7, 8, 9)" &&
      !b.browsingContext.isZenBoostsInverted,
    "Global off clears every site"
  );
  ok(true, "Global off clears every site");

  BrowserTestUtils.removeTab(tabA);
  BrowserTestUtils.removeTab(tabB);
});

add_task(async function test_font_and_case_skip_code_and_icons() {
  // A digit in the name would be invalid CSS unless the name is quoted
  const FONT = "Zen Test Font 2";
  const global = makeBoost(GLOBAL, {
    fontFamily: FONT,
    textCaseOverride: "uppercase",
  });

  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `https://${SITE_A}${PATH}`
  );
  const styles = () =>
    SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      const doc = content.document;
      const read = el => {
        const cs = content.getComputedStyle(el);
        return { font: cs.fontFamily, transform: cs.textTransform };
      };
      return {
        body: read(doc.body),
        text: read(doc.getElementById("text")),
        code: read(doc.getElementById("code")),
        icon: read(doc.getElementById("icon")),
        empty: read(doc.getElementById("empty")),
        shadow: read(
          doc.getElementById("host").shadowRoot.getElementById("inner")
        ),
      };
    });

  await TestUtils.waitForCondition(
    async () => (await styles()).text.font.includes(FONT),
    "Global font applies"
  );
  const s = await styles();
  ok(s.body.font.includes(FONT), "Text directly in body gets the font");
  ok(s.shadow.font.includes(FONT), "Styled shadow DOM text gets the font");
  is(s.text.transform, "uppercase", "Text case applies");
  ok(!s.code.font.includes(FONT), "Code keeps its monospace font");
  is(s.code.transform, "none", "Code keeps its case");
  ok(!s.icon.font.includes(FONT), "Icon font classes keep their font");
  is(s.icon.transform, "none", "Icon ligatures keep their case");
  ok(!s.empty.font.includes(FONT), "Empty icon elements keep their font");

  manager.deleteBoost({ domain: GLOBAL, id: global.id });
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_global_invert_skips_dark_pages() {
  const DARK_PATH = "/browser/zen/tests/boosts/file_boost_dark.html";
  const global = makeBoost(GLOBAL, {
    smartInvert: true,
    customCSS: GLOBAL_CSS,
  });

  const light = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `https://${SITE_A}${PATH}`
  );
  const dark = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `https://${SITE_B}${DARK_PATH}`
  );
  await TestUtils.waitForCondition(
    () => light.linkedBrowser.browsingContext.isZenBoostsInverted,
    "Global invert applies to light pages"
  );
  // Wait until the global boost reached the dark page before checking
  await waitForOutline(dark.linkedBrowser, "rgb(1, 2, 3)", "Global applies");
  ok(
    !dark.linkedBrowser.browsingContext.isZenBoostsInverted,
    "Global invert leaves dark pages alone"
  );

  // A site boost's invert is an explicit choice for that site
  makeBoost(SITE_B, { smartInvert: true });
  await TestUtils.waitForCondition(
    () => dark.linkedBrowser.browsingContext.isZenBoostsInverted,
    "Site boost inverts even dark pages"
  );
  ok(true, "Site boost inverts even dark pages");

  for (const boost of manager.loadBoostsFromStore(SITE_B) ?? []) {
    manager.deleteBoost(boost);
  }
  manager.deleteBoost({ domain: GLOBAL, id: global.id });
  BrowserTestUtils.removeTab(light);
  BrowserTestUtils.removeTab(dark);
});
