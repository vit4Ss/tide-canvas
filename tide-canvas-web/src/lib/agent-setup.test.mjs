import test from "node:test";
import assert from "node:assert/strict";
import { agentConfig, agentConfigPath, agentModels, agentTerminal, ccSwitchLink, gatewayBase } from "./agent-setup.ts";

const secret="tc_sk_fixture_only", origin="https://flowlight.example.test", model="flowinglight/test-model";
test("setup always uses the site's actual text gateway and advertised model IDs",()=>{
 assert.equal(gatewayBase(origin),origin+"/api/integrations/v1");
 assert.equal(gatewayBase("http://localhost:3101"),"http://localhost:3101/api/integrations/v1");
 for(const invalid of ["javascript:alert(1)","https://x.test/path","https://user:pass@x.test","https://x.test/?key=x"]) assert.throws(()=>gatewayBase(invalid));
 assert.deepEqual(agentModels({data:[{id:model,name:"Test model"},{id:model},{id:"bad\nmodel"},null,{id:7}]}),[{id:model,name:"Test model"}]);
 assert.deepEqual(agentModels({data:[]}),[]);assert.throws(()=>agentModels({}));
});
test("Codex and OpenCode configurations match the supported wire formats without embedding a key",()=>{
 const codex=agentConfig("codex",origin,model);
 assert.match(codex,/wire_api = "responses"/);assert.match(codex,/env_key = "FLOWLIGHT_API_KEY"/);
 assert.match(codex,/model = "flowinglight\/test-model"/);assert.ok(!codex.includes(secret));
 const oc=JSON.parse(agentConfig("opencode",origin,model));
 assert.equal(oc.provider.flowlight.npm,"@ai-sdk/openai-compatible");
 assert.equal(oc.provider.flowlight.options.baseURL,origin+"/api/integrations/v1");
 assert.equal(oc.provider.flowlight.options.apiKey,"{env:FLOWLIGHT_API_KEY}");
 assert.equal(oc.model,"flowlight/"+model);assert.deepEqual(Object.keys(oc.provider.flowlight.models),[model]);
 assert.throws(()=>agentConfig("gemini",origin,model));assert.throws(()=>agentConfig("codex",origin,"injected\nsetting"));
});
test("terminal examples use temporary environment settings and reject shell metacharacters",()=>{
 assert.equal(agentTerminal("codex","posix",secret),`export FLOWLIGHT_API_KEY='${secret}'\ncodex`);
 assert.equal(agentTerminal("codex","powershell",secret),`$env:FLOWLIGHT_API_KEY = '${secret}'\ncodex`);
 assert.equal(agentTerminal("opencode","cmd",secret),`set "FLOWLIGHT_API_KEY=${secret}"\nopencode`);
 for(const bad of ["tc_sk_x'$(echo bad)","tc_sk_x\ncmd","tc_sk_%PATH%","tc_sk_!VAR!","tc_sk_x&command",""]) assert.throws(()=>agentTerminal("codex","cmd",bad));
 assert.equal(agentConfigPath("codex","cmd"),"%USERPROFILE%\\.codex\\config.toml");
 assert.equal(agentConfigPath("opencode","posix"),"~/.config/opencode/opencode.json");
});
test("CC Switch import preserves account key, model and exact gateway using encoded official parameters",()=>{
 for(const client of ["codex","opencode"]) {
  const url=new URL(ccSwitchLink(client,origin,model,secret));
  assert.equal(url.protocol,"ccswitch:");assert.equal(url.hostname,"v1");assert.equal(url.pathname,"/import");
  assert.equal(url.searchParams.get("app"),client);assert.equal(url.searchParams.get("apiKey"),secret);
  assert.equal(url.searchParams.get("model"),model);assert.equal(url.searchParams.get("endpoint"),origin+"/api/integrations/v1");
  assert.equal(url.searchParams.get("apiFormat"),client==="codex"?"openai_responses":"openai_chat");
  assert.equal(url.searchParams.has("configUrl"),false);assert.equal(url.searchParams.has("enabled"),false);
 }
});
