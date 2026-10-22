import assert from "node:assert/strict";
import test from "node:test";
import { audioModelKind } from "./audio-model-kind.ts";

test("speech catalog models remain speech when upstream reports generic t2a", () => {
  for (const name of ["Gemini Flash TTS", "MAI-Voice-2", "Voxtral Mini TTS"]) {
    assert.equal(audioModelKind({ name }, ["t2a"]), "speech");
  }
  assert.equal(audioModelKind({ modelId: "gemini-2.5-flash-preview-tts" }, ["t2a"]), "speech");
  assert.equal(audioModelKind({ modelId: "custom-voice" }, ["t2a"], true), "speech");
});

test("only Suno music exposes its lyrics and source clip protocol", () => {
  for (const name of ["Suno V4 (MXAPI)", "Suno V4.5 (MXAPI)", "Suno V5 (MXAPI)", "Suno V5.5 (MXAPI)"]) {
    assert.equal(audioModelKind({ name }, ["t2a"]), "suno");
  }
  assert.equal(audioModelKind({ modelId: "suno-v5" }, []), "suno");
  assert.equal(audioModelKind({ name: "Lyria 3 Pro" }, ["t2a"]), "music");
  assert.equal(audioModelKind({ name: "Lyria 3 Clip" }, []), "music");
  assert.equal(audioModelKind({ name: "New audio model" }, ["t2a"]), "music");
});

test("sound effects never expose speech tokens or Suno song controls", () => {
  assert.equal(audioModelKind({ name: "Suno 音效 (MXAPI)" }, ["t2a"]), "sfx");
  assert.equal(audioModelKind({ modelId: "suno-sfx" }, ["t2a"]), "sfx");
  assert.equal(audioModelKind({ name: "Effects" }, ["sfx"]), "sfx");
  assert.equal(audioModelKind({}, []), "speech");
});
