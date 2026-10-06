/**
 * ticket-utils arama yardımcıları testleri.
 * Çalıştırma: node --test netlify/tests/client-utils.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, normalizeSearch } from "../../assets/js/support-v2/ticket-utils.js";

test("normalizeSearch: Türkçe karakterler ve aksanlar", () => {
  assert.equal(normalizeSearch("ÖZTÜRK İSMAİL Işık"), "ozturk ismail isik");
  assert.equal(normalizeSearch(null), "");
});

test("matchesSearch: boş arama her şeyi eşler", () => {
  assert.equal(matchesSearch("", ["a"]), true);
  assert.equal(matchesSearch("   ", []), true);
});

test("matchesSearch: tüm sözcükler alanların birleşiminde geçmeli", () => {
  const fields = ["Ayşe", "Öztürk", "ayse@abc.com", "ABC A.Ş.", null, ""];
  assert.equal(matchesSearch("ozturk", fields), true);
  assert.equal(matchesSearch("ayse abc", fields), true);
  assert.equal(matchesSearch("ayse xyz", fields), false);
  assert.equal(matchesSearch("ABC", fields), true);
});
