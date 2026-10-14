import test from "node:test";
import assert from "node:assert/strict";
import {WaffoPancakeError} from "@waffo/pancake-ts";
import {promptDiagnostic,InvalidPromptVerdict} from "../dist/prompt-diagnostics.js";
import {createAdapter} from "../dist/http.js";

test("prompt diagnostics distinguish SDK auth, throttling, network, timeout and invalid response without raw errors",()=>{
 for(const [status,reason] of [[401,"upstream_unauthorized"],[403,"upstream_forbidden"],[429,"upstream_rate_limited"],[400,"upstream_request_rejected"],[504,"upstream_timeout"],[503,"upstream_unavailable"],[200,"upstream_invalid_response"]]) {
  const result=promptDiagnostic(new WaffoPancakeError(status,[{message:"PRIVATE KEY and private prompt",layer:"secret"}]));
  assert.deepEqual(result,{reasonCode:reason,upstreamStatus:status});assert.ok(!JSON.stringify(result).includes("PRIVATE"));
 }
 assert.equal(promptDiagnostic(new DOMException("private prompt","TimeoutError")).reasonCode,"upstream_timeout");
 assert.equal(promptDiagnostic(new Error("secret",{cause:{code:"ENOTFOUND"}})).reasonCode,"upstream_dns_error");
 assert.equal(promptDiagnostic(new Error("secret",{cause:{code:"CERT_HAS_EXPIRED"}})).reasonCode,"upstream_tls_error");
 assert.equal(promptDiagnostic(new Error("secret",{cause:{code:"ECONNREFUSED"}})).reasonCode,"upstream_network_error");
 assert.equal(promptDiagnostic(new InvalidPromptVerdict("raw payload")).reasonCode,"upstream_invalid_response");
 assert.deepEqual(promptDiagnostic({status:401,message:"secret"}),{reasonCode:"upstream_unavailable"});
});

test("internal screening response and structured log contain only sanitized diagnostics; checkout remains unchanged", async t=>{
 const token="internal-fixture-token-".repeat(3),logs=[];
 t.mock.method(console,"warn",line=>logs.push(line));
 const fail=async()=>{throw new WaffoPancakeError(401,[{message:"sensitive-key-and-prompt",layer:"auth"}]);};
 const server=createAdapter({ready:true,mode:"prod",token},{scanPrompt:fail,checkout:fail});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const input={method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({mode:"prod",prompt:"fixture content"})};
 const response=await fetch(base+"/scan-prompt",input);
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:"provider_unavailable",reasonCode:"upstream_unauthorized",upstreamStatus:401});
 assert.deepEqual(logs.map(JSON.parse),[{event:"prompt_screening_failed",reasonCode:"upstream_unauthorized",upstreamStatus:401}]);
 assert.deepEqual(await (await fetch(base+"/checkout",input)).json(),{error:"provider_unavailable"});
 assert.equal(logs.length,1);assert.ok(!logs[0].includes("sensitive"));
});
