import test from "node:test";
import assert from "node:assert/strict";
import { parseDraft, writeDraft, readDraft, loginDraft, takeLoginDraft } from "../src/lib/studio-draft.ts";
import { audioKind, promptIdea } from "../src/lib/model-guidance.ts";
import { buildGenerationInput } from "../src/lib/studio.ts";
import { DEFAULT_SUPPORT_EMAIL, supportEmail, supportLink } from "../src/lib/consumer.ts";

test("public contact falls back on missing or invalid settings and keeps the mailto address safe", () => {
  assert.equal(supportEmail("   ", "help@example.test"), "help@example.test");
  for (const invalid of [null, {}, "", "not-an-email", "support@example.test\r\nBcc: attacker@example.test", "<support@example.test>"]) {
    assert.equal(supportEmail(invalid), DEFAULT_SUPPORT_EMAIL);
    const link = new URL(supportLink(invalid));
    assert.equal(link.protocol, "mailto:");
    assert.equal(decodeURIComponent(link.pathname), DEFAULT_SUPPORT_EMAIL);
    assert.equal(link.searchParams.has("bcc"), false);
  }
  assert.equal(supportEmail(" support@example.test "), "support@example.test");
});

const draft = { media:"video",modelId:"video-model",mode:"text_to_video",prompt:"My saved idea",resolution:"1080p",ratio:"16:9",quality:"",duration:"5",count:1,refs:[],outputFps:"",upscaleModel:"max",voice:"",lyrics:"",instrumental:false,enablePbr:false };
test("drafts reject corrupt, stale, future and unsafe reference data", () => {
  const pack = value => JSON.stringify({version:1,savedAt:1000,draft:value});
  assert.equal(parseDraft(pack(draft),1001)?.prompt,draft.prompt);
  assert.equal(parseDraft(pack(draft),0),null);
  assert.equal(parseDraft(pack(draft),1000+8*86400000),null);
  assert.equal(parseDraft(pack({...draft,refs:[{url:"javascript:alert(1)",name:"bad",kind:"image"}]}),1001),null);
  assert.equal(parseDraft("broken"),null);
});
test("sign-in handoff is single-use and account drafts remain isolated", () => {
  const data = new Map(); globalThis.sessionStorage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  writeDraft("alice",draft); assert.equal(readDraft("bob"),null);
  const url=loginDraft(draft);const id=new URL(url,"https://example.test").searchParams.get("draft");
  assert.equal(takeLoginDraft(id)?.prompt,draft.prompt);assert.equal(takeLoginDraft(id),null);
  assert.equal(readDraft("alice")?.prompt,draft.prompt);
  delete globalThis.sessionStorage;
});
test("audio suggestions and payload controls match the selected capability", () => {
  const music={modelKey:"suno-v5",name:"Suno V5"}; const sound={modelKey:"suno-sfx-mxapi"}; const speech={modelKey:"speech-tts"};
  assert.equal(audioKind(music),"music");assert.equal(audioKind(sound),"sound");
  assert.match(promptIdea("audio",music),/piano|music/i);assert.match(promptIdea("audio",sound),/rain/);assert.match(promptIdea("audio",speech),/Welcome/);
  const settings={...draft,media:"audio",voice:"stale-voice",lyrics:"lyrics",instrumental:true};
  assert.equal(buildGenerationInput(settings,music).voice,undefined);
  assert.equal(buildGenerationInput(settings,sound).extras,undefined);
  assert.equal(buildGenerationInput(settings,speech).voice,"stale-voice");
  assert.equal(buildGenerationInput(settings,speech).extras,undefined);
});
