import { ai, error, json, type RouterContext } from '@appdeploy/sdk';

const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const selectors: Record<string,string> = { '0x095ea7b3':'ERC20 approve', '0xa22cb465':'setApprovalForAll', '0xa9059cbb':'ERC20 transfer', '0x23b872dd':'ERC20 transferFrom', '0x':'native / no call' };

type Severity = 'INFO'|'LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
type Finding = { severity: Severity; title: string; detail: string; source: string };
type RpcOutcome = { ok: boolean; result?: string; error?: string };
type Input = { intent: string; from: string; to: string; valueEth: string; data: string; maxValueEth?: string; policy?: { maxValueEth?: string; allowUnlimitedApprovals?: boolean; strictIntent?: boolean } };

function isAddress(v: string) { return /^0x[a-fA-F0-9]{40}$/.test(v); }
function isHex(v: string) { return /^0x[a-fA-F0-9]*$/.test(v) && v.length % 2 === 0; }
function ethToWei(v: string) { const clean = v.trim(); if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error('Invalid ETH amount'); const [w,f=''] = clean.split('.'); const frac = (f+'0'.repeat(18)).slice(0,18); return BigInt(w)*10n**18n + BigInt(frac || '0'); }
function severityPoints(s: Severity) { return s === 'CRITICAL' ? 55 : s === 'HIGH' ? 35 : s === 'MEDIUM' ? 18 : s === 'LOW' ? 7 : 0; }
function selectorOf(data: string) { return data.length >= 10 ? data.slice(0,10).toLowerCase() : '0x'; }
function isZeroStorage(v?: string) { return !v || /^0x0*$/.test(v); }
function compactHash(input: string) { let h1 = 0x811c9dc5; let h2 = 0x9e3779b9; for (let i=0;i<input.length;i++){ h1 ^= input.charCodeAt(i); h1 = Math.imul(h1,0x01000193); h2 ^= (input.charCodeAt(i)+i); h2 = Math.imul(h2,0x85ebca6b); } const a=(h1>>>0).toString(16).padStart(8,'0'); const b=(h2>>>0).toString(16).padStart(8,'0'); return `0x${(a+b).repeat(4).slice(0,64)}`; }

async function rpc(method: string, params: unknown[]): Promise<RpcOutcome> {
  try {
    const res = await fetch(RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(!res.ok) return {ok:false,error:`HTTP ${res.status}`};
    const body = await res.json() as {result?:string;error?:{message?:string}};
    if(body.error) return {ok:false,error:body.error.message || 'RPC error'};
    return {ok:true,result:body.result};
  } catch(e) {
    return {ok:false,error:e instanceof Error ? e.message : 'RPC unavailable'};
  }
}

async function aiReview(input: Input, findings: Finding[], selector: string) {
  try {
    const result = await ai.generate({
      thinkingMode:'FAST',
      maxTokens:700,
      temperature:0.1,
      system:'You are a defensive Web3 transaction reviewer. Compare the user intent to the proposed transaction and deterministic findings. Do not claim that a transaction is safe merely because simulation succeeds. AI may recommend human review but is not the execution authority.',
      prompt:JSON.stringify({intent:input.intent,to:input.to,valueEth:input.valueEth,selector,findings}),
      schema:{type:'object',properties:{score:{type:'number'},confidence:{type:'number'},alignment:{type:'string',enum:['ALIGNED','UNCERTAIN','MISMATCH']},action:{type:'string',enum:['ALLOW','REQUIRE_HUMAN','BLOCK']},rationale:{type:'string'},redFlags:{type:'array',items:{type:'string'}}},required:['score','confidence','alignment','action','rationale','redFlags']}
    });
    const parsed = JSON.parse(result.text) as {score:number;confidence:number;alignment:string;action:string;rationale:string;redFlags:string[]};
    return { score:Math.max(0,Math.min(100,Math.round(parsed.score))), confidence:Math.max(0,Math.min(1,Number(parsed.confidence))), alignment:parsed.alignment, action:parsed.action, rationale:parsed.rationale, redFlags:parsed.redFlags || [] };
  } catch {
    return {score:25,confidence:0.35,alignment:'UNCERTAIN',action:'REQUIRE_HUMAN',rationale:'AI semantic review was unavailable; AEGIS fell back to deterministic policy and RPC evidence.',redFlags:['AI review unavailable']};
  }
}

export async function analyzeRoute(ctx: RouterContext) {
  const input = ctx.body as Partial<Input>;
  if (!input || typeof input.intent !== 'string' || typeof input.from !== 'string' || typeof input.to !== 'string' || typeof input.valueEth !== 'string' || typeof input.data !== 'string') return error('Missing transaction fields',400);
  if (!input.intent.trim()) return error('Human intent is required',400);
  if (!isAddress(input.from) || !isAddress(input.to)) return error('FROM and TO must be valid EVM addresses',400);
  if (!isHex(input.data)) return error('Calldata must be valid even-length hex',400);
  let valueWei: bigint; let maxWei: bigint;
  try { valueWei = ethToWei(input.valueEth); maxWei = ethToWei(input.policy?.maxValueEth || input.maxValueEth || '0.01'); } catch { return error('Invalid ETH value or policy maximum',400); }

  const findings: Finding[] = [];
  const selector = selectorOf(input.data);
  const selectorLabel = selectors[selector] || 'unknown selector';
  const approvalAmount = selector === '0x095ea7b3' && input.data.length >= 138 ? input.data.slice(74,138).toLowerCase() : '';
  const unlimitedApproval = selector === '0x095ea7b3' && /^f{64}$/.test(approvalAmount);
  const approvalForAll = selector === '0xa22cb465' && input.data.length >= 138 && !/^0{64}$/.test(input.data.slice(74,138));

  if (valueWei > maxWei) findings.push({severity:'CRITICAL',title:'Policy value exceeded',detail:`Proposed ${input.valueEth} ETH is above the configured maximum ${input.policy?.maxValueEth || input.maxValueEth || '0.01'} ETH.`,source:'deterministic policy'});
  if (unlimitedApproval) findings.push({severity:'HIGH',title:'Unlimited token approval',detail:'The transaction grants the spender the maximum uint256 allowance. This conflicts with least-privilege delegation.',source:'calldata decoder'});
  if (approvalForAll) findings.push({severity:'HIGH',title:'Global operator approval',detail:'setApprovalForAll(true) can authorize an operator across the owner’s token collection.',source:'calldata decoder'});
  if (selectorLabel === 'unknown selector' && input.data !== '0x') findings.push({severity:'MEDIUM',title:'Unknown function selector',detail:`AEGIS does not have a deterministic decoder for ${selector}.`,source:'calldata decoder'});

  const block = await rpc('eth_blockNumber',[]);
  const code = await rpc('eth_getCode',[input.to,'latest']);
  const targetHasCode = code.ok && !!code.result && code.result !== '0x';
  if (code.ok && !targetHasCode && input.data !== '0x') findings.push({severity: unlimitedApproval || approvalForAll ? 'CRITICAL' : 'HIGH',title:'Calldata sent to non-contract target',detail:'The destination currently has no bytecode, yet the proposal contains contract calldata.',source:'live RPC'});

  const tx = {from:input.from,to:input.to,value:`0x${valueWei.toString(16)}`,data:input.data};
  const callLatest = await rpc('eth_call',[tx,'latest']);
  const gas = await rpc('eth_estimateGas',[tx]);
  if (!callLatest.ok) findings.push({severity:'MEDIUM',title:'Live simulation reverted',detail:callLatest.error || 'eth_call failed on current state.',source:'Arbitrum RPC'});

  let temporalConsistency = 'not available';
  if (block.ok && block.result) {
    const n = Number.parseInt(block.result,16);
    if (Number.isFinite(n) && n > 2) {
      const prev = `0x${(n-1).toString(16)}`;
      const callPrev = await rpc('eth_call',[tx,prev]);
      if (callLatest.ok && callPrev.ok) {
        temporalConsistency = callLatest.result === callPrev.result ? 'stable across latest / previous block' : 'state-sensitive output';
        if (callLatest.result !== callPrev.result) findings.push({severity:'MEDIUM',title:'State-sensitive simulation result',detail:'The same call produced different outputs across adjacent block states. This is not proof of maliciousness, but it increases simulation-bypass risk.',source:'temporal probe'});
      } else if (callLatest.ok !== callPrev.ok) {
        temporalConsistency = 'execution changed across adjacent state';
        findings.push({severity:'HIGH',title:'Execution changes across block state',detail:'The transaction succeeds in one adjacent state and fails in another. Require human review or deeper state-override simulation.',source:'temporal probe'});
      }
    }
  }

  const proxy = targetHasCode ? await rpc('eth_getStorageAt',[input.to,IMPLEMENTATION_SLOT,'latest']) : {ok:false} as RpcOutcome;
  const proxyDetected = proxy.ok && !isZeroStorage(proxy.result);
  if (proxyDetected) findings.push({severity:'LOW',title:'Upgradeable proxy signal',detail:'The EIP-1967 implementation slot is populated. Runtime behavior may change after upgrades.',source:'storage inspection'});
  if (!findings.length) findings.push({severity:'INFO',title:'No deterministic blocker found',detail:'No hard policy violation was detected. A successful simulation is still not treated as a security proof.',source:'AEGIS core'});

  let deterministicScore = Math.min(100,findings.reduce((sum,f)=>sum+severityPoints(f.severity),0));
  if (unlimitedApproval && valueWei === 0n) deterministicScore = Math.max(deterministicScore,55);
  const aiResult = await aiReview(input as Input,findings,selector);
  for (const flag of aiResult.redFlags.slice(0,3)) findings.push({severity:'LOW',title:'AI red flag',detail:flag,source:'semantic review'});
  const riskScore = Math.min(100,Math.max(deterministicScore,Math.round(aiResult.score*0.7)));
  const criticalHardSignal = findings.some(f=>f.severity==='CRITICAL') || valueWei > maxWei;
  let decision: 'ALLOW'|'REQUIRE_HUMAN'|'BLOCK' = 'ALLOW';
  if (criticalHardSignal) decision = 'BLOCK';
  else if (unlimitedApproval || approvalForAll || riskScore >= 55 || aiResult.alignment === 'MISMATCH' || !callLatest.ok) decision = 'REQUIRE_HUMAN';

  const evidencePayload = JSON.stringify({intent:input.intent,from:input.from,to:input.to,valueEth:input.valueEth,data:input.data,selector,block:block.result || 'unknown',decision,riskScore,deterministicScore,aiScore:aiResult.score});
  return json({decision,riskScore,deterministicScore,aiScore:aiResult.score,aiConfidence:aiResult.confidence,aiAlignment:aiResult.alignment,aiRationale:aiResult.rationale,selector,selectorLabel,rpcStatus:code.ok && block.ok ? 'LIVE' : 'DEGRADED',networkBlock:block.result || 'unavailable',gasEstimate:gas.ok && gas.result ? `${Number.parseInt(gas.result,16).toLocaleString()} gas` : 'unavailable',targetType:code.ok ? (targetHasCode ? 'CONTRACT' : 'EOA / NO CODE') : 'UNKNOWN',proxyDetected,temporalConsistency,findings,policy:{maxValueEth:input.policy?.maxValueEth || input.maxValueEth || '0.01',allowUnlimitedApprovals:false,strictIntent:true},evidenceHash:compactHash(evidencePayload)});
}
