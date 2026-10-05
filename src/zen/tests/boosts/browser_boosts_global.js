/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { gZenBoostsManager: manager } = ChromeUtils.importESModule(
  "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs"
);

const GLOBAL = manager.GLOBAL_DOMAIN;
const SITE = "site.global-boost.test";
const OTHER = "other.global-boost.test";

function makeBoost(domain, name, tweak = {}) {
  const boost = manager.createNewBoost(domain);
  Object.assign(boost.boostEntry.boostData, tweak, {
    boostName: name,
    changeWasMade: true,
  });
  manager.saveBoostToStore(boost);
  manager.makeBoostActiveForDomain(domain, boost.id);
  return boost;
}

registerCleanupFunction(() => {
  for (const domain of [GLOBAL, SITE, OTHER]) {
    for (const boost of manager.loadBoostsFromStore(domain) ?? []) {
      manager.deleteBoost(boost);
    }
    manager.setGlobalDisabledForDomain(domain, false);
  }
});

add_task(async function test_global_resolution() {
  is(manager.resolveBoost(SITE), null, "No boost without any boost");
  ok(
    !manager.registeredDomains.has(SITE),
    "Resolving must not create domain entries"
  );

  const global = makeBoost(GLOBAL, "Global", { brightness: 0.3 });
  let resolved = manager.resolveBoost(SITE);
  is(resolved.source, "global", "Global applies on a site without a boost");
  is(resolved.domain, GLOBAL, "Global boost is owned by the global domain");
  is(resolved.id, global.id, "Resolved the global boost");

  const site = makeBoost(SITE, "Site");
  resolved = manager.resolveBoost(SITE);
  is(resolved.source, "site", "Site boost replaces the global one");
  is(resolved.id, site.id, "Resolved the site boost");
  is(manager.resolveBoost(OTHER).source, "global", "Other sites keep global");

  manager.toggleBoostActiveForDomain(SITE, site.id);
  is(
    manager.resolveBoost(SITE).source,
    "global",
    "Disabled site boost falls back"
  );

  manager.toggleBoostActiveForDomain(SITE, site.id);
  is(manager.resolveBoost(SITE).source, "site", "Re-enabled site boost wins");
});

add_task(async function test_global_disabled_per_site() {
  manager.setGlobalDisabledForDomain(OTHER, true);
  ok(manager.isGlobalDisabledFor(OTHER), "Flag is stored");
  is(manager.resolveBoost(OTHER), null, "Global is off on that site");
  is(manager.resolveBoost("third.global-boost.test").source, "global");

  manager.setGlobalDisabledForDomain(OTHER, false);
  is(manager.resolveBoost(OTHER).source, "global", "Global is back");
  ok(!manager.registeredDomains.has(OTHER), "Empty entry is dropped");

  const global = manager.loadActiveBoostFromStore(GLOBAL);
  manager.toggleBoostActiveForDomain(GLOBAL, global.id);
  is(manager.resolveBoost(OTHER), null, "Inactive global applies nowhere");
  manager.toggleBoostActiveForDomain(GLOBAL, global.id);
});

add_task(async function test_site_boost_starts_from_global() {
  const draft = manager.createNewBoost(OTHER);
  const { boostData } = draft.boostEntry;
  is(boostData.brightness, 0.3, "Copied the global values");
  is(boostData.boostName, "My Boost", "Kept the default name");
  is(boostData.changeWasMade, false, "Abandoned drafts are not applied");
  is(manager.resolveBoost(OTHER).source, "global", "Draft does not replace");
  manager.deleteBoost(draft);
});
