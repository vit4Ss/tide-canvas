import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source=readFileSync(new URL("./mcp-config-api.ts",import.meta.url),"utf8");
const loaded={exports:{}};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{URL,module:loaded,exports:loaded.exports,require:()=>({http:{}})});
const {mcpClientConfig,mcpServiceState,mcpSuggestedPublicURL}=loaded.exports;

test("MCP client examples use the saved endpoint without exposing credentials",()=>{
  const config=mcpClientConfig(" https://custom.test/tools/mcp ","https://site.test");
  assert.equal(config.mcpServers["flowlight-generation"].url,"https://custom.test/tools/mcp");
  assert.equal(config.mcpServers["flowlight-generation"].headers.Authorization,"Bearer 你的主站APIKey");
  assert.equal(mcpClientConfig("","https://site.test").mcpServers["flowlight-generation"].url,"https://site.test/mcp");
});

test("an online process is not reported as synchronized until supported policy revision matches",()=>{
  assert.equal(mcpServiceState(null,1).label,"未检测");
  assert.equal(mcpServiceState({reachable:false},1).label,"未连接");
  assert.equal(mcpServiceState({reachable:true,adminConfig:false},1).label,"需要升级服务");
  assert.equal(mcpServiceState({reachable:true,adminConfig:true,policyAvailable:false},1).label,"配置尚未读取");
  const status={reachable:true,adminConfig:true,policyAvailable:true,policyRevision:1};
  assert.equal(mcpServiceState(status,2).label,"等待配置同步");
  assert.equal(mcpServiceState(status,1).label,"配置已同步");
});

test("MCP form suggestions are explicit current-site HTTP addresses, not credentials or paths",()=>{
  assert.equal(mcpSuggestedPublicURL("https://flowlight.tcmzhan.com"),"https://flowlight.tcmzhan.com/mcp");
  assert.equal(mcpSuggestedPublicURL("http://localhost:3319"),"http://localhost:3319/mcp");
  for(const value of ["","not a URL","file:///tmp","https://user:secret@example.com","https://example.com/path","https://example.com?key=secret"]) assert.equal(mcpSuggestedPublicURL(value),"");
});
