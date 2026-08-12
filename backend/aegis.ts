import { createHash } from 'node:crypto';
import OpenAI from 'openai';

const RPC_URL = process.env.ARBITRUM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const selectors: Record<string, string> = {
  '0x095ea7b3': 'ERC20 approve',
  '0xa22cb465': 'setApprovalForAll',
  '0xa9059cbb': 'ERC20 transfer',
  '0x23b872dd': 'ERC20 transferFrom',
  '0x': 'native / no call',
};

type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Finding = { severity: Severity; title: string; detail: string; source: string };
type RpcOutcome = { ok: boolean; result?: string; error?: string };
export type AnalyzeInput = {
  intent: string;
  from: string;
  to: string;
  valueEth: string;
  data: string;
  maxValueEth?: string;
  policy?: { maxValueEth?: string; allowUnlimitedApprovals?: boolean; strictIntent?: boolean };
};

export class ValidationError extends Error {}

function isAddress(v: string) { return /^0x[a-fA-F0-9]{40}$/.test(v); }
function isHex(v: string) { return /^0x[a-fA-F0-9]*$/.test(v) && v.length % 2 === 0; }
function ethToWei(v: string) {
  const clean = v.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new ValidationError('Invalid ETH amount');
  const [whole, fraction = ''] = clean.split('.');
  const normalized = (fraction + '0'.repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(normalized || '0');
}
function severityPoints(s: Severity) { return s === 'CRITICAL' ? 55 : s === 'HIGH' ? 35 : s === 'MEDIUM' ? 18 : s === 'LOW' ? 7 : 0; }
function selectorOf(data: string) { return data.length >= 10 ? data.slice(0, 10).toLowerCase() : '0x'; }
function isZeroStorage(v?: string) { return !v || /^0x0*$/.test(v); }
function evidenceHash(input: string) { return `0x${createHash('sha256').update(input).digest('hex')}`; }

async function rpc(method: string, params: unknown[]): Promise<RpcOutcome> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const body = await response.json() as { result?: string; error?: { message?: string } };
    if (body.error) return { ok: false, error: body.error.message || 'RPC error' };
    return { ok: true, result: body.result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'RPC unavailable' };
  }
}

async function aiReview(input: AnalyzeInput, findings: Finding[], selector: string) {
  const fallback = {
    score: 25,
    confidence: 0.35,
    alignment: 'UNCERTAIN',
    action: 'REQUIRE_HUMAN',
    rationale: 'AI semantic review is disabled or unavailable; deterministic policy and RPC evidence remain active.',
    redFlags: [] as string[],
  };
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions: 'You are a defensive Web3 transaction reviewer. Compare user intent to transaction evidence. Never authorize a transaction solely because simulation succeeds. Return concise security analysis only.',
      input: JSON.stringify({ intent: input.intent, to: input.to, valueEth: input.valueEth, selector, findings }),
      max_output_tokens: 650,
      text: {
        format: {
          type: 'json_schema',
          name: 'aegis_review',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              score: { type: 'number', minimum: 0, maximum: 100 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              alignment: { type: 'string', enum: ['ALIGNED', 'UNCERTAIN', 'MISMATCH'] },
              action: { type: 'string', enum: ['ALLOW', 'REQUIRE_HUMAN', 'BLOCK'] },
              rationale: { type: 'string' },
              redFlags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
            },
            required: ['score', 'confidence', 'alignment', 'action', 'rationale', 'redFlags'],
          },
        },
      },
    });
    const parsed = JSON.parse(response.output_text) as typeof fallback;
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
      alignment: parsed.alignment,
      action: parsed.action,
      rationale: parsed.rationale,
      redFlags: parsed.redFlags || [],
    };
  } catch (error) {
    console.warn('AEGIS AI review fallback:', error instanceof Error ? error.message : error);
    return fallback;
  }
}

export async function analyzeTransaction(input: AnalyzeInput) {
  if (!input || typeof input.intent !== 'string' || typeof input.from !== 'string' || typeof input.to !== 'string' || typeof input.valueEth !== 'string' || typeof input.data !== 'string') throw new ValidationError('Missing transaction fields');
  if (!input.intent.trim()) throw new ValidationError('Human intent is required');
  if (!isAddress(input.from) || !isAddress(input.to)) throw new ValidationError('FROM and TO must be valid EVM addresses');
  if (!isHex(input.data)) throw new ValidationError('Calldata must be valid even-length hex');

  const valueWei = ethToWei(input.valueEth);
  const maxValueEth = input.policy?.maxValueEth || input.maxValueEth || '0.01';
  const maxWei = ethToWei(maxValueEth);
  const findings: Finding[] = [];
  const selector = selectorOf(input.data);
  const selectorLabel = selectors[selector] || 'unknown selector';
  const approvalAmount = selector === '0x095ea7b3' && input.data.length >= 138 ? input.data.slice(74, 138).toLowerCase() : '';
  const unlimitedApproval = selector === '0x095ea7b3' && /^f{64}$/.test(approvalAmount);
  const approvalForAll = selector === '0xa22cb465' && input.data.length >= 138 && !/^0{64}$/.test(input.data.slice(74, 138));

  if (valueWei > maxWei) findings.push({ severity: 'CRITICAL', title: 'Policy value exceeded', detail: `Proposed ${input.valueEth} ETH is above the configured maximum ${maxValueEth} ETH.`, source: 'deterministic policy' });
  if (unlimitedApproval) findings.push({ severity: 'HIGH', title: 'Unlimited token approval', detail: 'The transaction grants the spender the maximum uint256 allowance.', source: 'calldata decoder' });
  if (approvalForAll) findings.push({ severity: 'HIGH', title: 'Global operator approval', detail: 'setApprovalForAll(true) can authorize an operator across the owner’s token collection.', source: 'calldata decoder' });
  if (selectorLabel === 'unknown selector' && input.data !== '0x') findings.push({ severity: 'MEDIUM', title: 'Unknown function selector', detail: `No deterministic decoder is registered for ${selector}.`, source: 'calldata decoder' });

  const [block, code] = await Promise.all([rpc('eth_blockNumber', []), rpc('eth_getCode', [input.to, 'latest'])]);
  const bytecode = code.result || '0x';
  const targetHasCode = code.ok && bytecode !== '0x';
  const eip7702Delegation = targetHasCode && /^0xef0100[a-fA-F0-9]{40}$/.test(bytecode);
  const delegatedTo = eip7702Delegation ? `0x${bytecode.slice(-40)}` : null;

  if (eip7702Delegation) findings.push({ severity: 'MEDIUM', title: 'EIP-7702 delegated account', detail: `The destination delegates executable behavior to ${delegatedTo}. Analyze the delegate before production authorization.`, source: 'bytecode inspection' });
  if (code.ok && !targetHasCode && input.data !== '0x') findings.push({ severity: unlimitedApproval || approvalForAll ? 'CRITICAL' : 'HIGH', title: 'Calldata sent to non-contract target', detail: 'The destination currently has no bytecode, yet the proposal contains contract calldata.', source: 'live RPC' });

  const tx = { from: input.from, to: input.to, value: `0x${valueWei.toString(16)}`, data: input.data };
  const [callLatest, gas] = await Promise.all([rpc('eth_call', [tx, 'latest']), rpc('eth_estimateGas', [tx])]);
  if (!callLatest.ok) findings.push({ severity: 'MEDIUM', title: 'Live simulation reverted', detail: callLatest.error || 'eth_call failed on current state.', source: 'Arbitrum RPC' });

  let temporalConsistency = 'not available';
  if (block.ok && block.result) {
    const blockNumber = Number.parseInt(block.result, 16);
    if (Number.isFinite(blockNumber) && blockNumber > 2) {
      const previous = `0x${(blockNumber - 1).toString(16)}`;
      const callPrevious = await rpc('eth_call', [tx, previous]);
      if (callLatest.ok && callPrevious.ok) {
        temporalConsistency = callLatest.result === callPrevious.result ? 'stable across latest / previous block' : 'state-sensitive output';
        if (callLatest.result !== callPrevious.result) findings.push({ severity: 'MEDIUM', title: 'State-sensitive simulation result', detail: 'The same call produced different outputs across adjacent block states.', source: 'temporal probe' });
      } else if (callLatest.ok !== callPrevious.ok) {
        temporalConsistency = 'execution changed across adjacent state';
        findings.push({ severity: 'HIGH', title: 'Execution changes across block state', detail: 'The transaction succeeds in one adjacent state and fails in another.', source: 'temporal probe' });
      }
    }
  }

  const proxy = targetHasCode && !eip7702Delegation ? await rpc('eth_getStorageAt', [input.to, IMPLEMENTATION_SLOT, 'latest']) : { ok: false } as RpcOutcome;
  const proxyDetected = proxy.ok && !isZeroStorage(proxy.result);
  if (proxyDetected) findings.push({ severity: 'LOW', title: 'Upgradeable proxy signal', detail: 'The EIP-1967 implementation slot is populated; runtime behavior may change after upgrades.', source: 'storage inspection' });
  if (!findings.length) findings.push({ severity: 'INFO', title: 'No deterministic blocker found', detail: 'No hard policy violation was detected. A successful simulation is not treated as a security proof.', source: 'AEGIS core' });

  let deterministicScore = Math.min(100, findings.reduce((sum, finding) => sum + severityPoints(finding.severity), 0));
  if (unlimitedApproval && valueWei === 0n) deterministicScore = Math.max(deterministicScore, 55);
  const aiResult = await aiReview(input, findings, selector);
  for (const flag of aiResult.redFlags.slice(0, 3)) findings.push({ severity: 'LOW', title: 'AI red flag', detail: flag, source: 'semantic review' });

  const riskScore = Math.min(100, Math.max(deterministicScore, Math.round(aiResult.score * 0.7)));
  const criticalHardSignal = findings.some(finding => finding.severity === 'CRITICAL') || valueWei > maxWei;
  let decision: 'ALLOW' | 'REQUIRE_HUMAN' | 'BLOCK' = 'ALLOW';
  if (criticalHardSignal) decision = 'BLOCK';
  else if (unlimitedApproval || approvalForAll || eip7702Delegation || riskScore >= 55 || aiResult.alignment === 'MISMATCH' || !callLatest.ok) decision = 'REQUIRE_HUMAN';

  const evidencePayload = JSON.stringify({ intent: input.intent, from: input.from, to: input.to, valueEth: input.valueEth, data: input.data, selector, block: block.result || 'unknown', decision, riskScore, deterministicScore, aiScore: aiResult.score });
  return {
    decision,
    riskScore,
    deterministicScore,
    aiScore: aiResult.score,
    aiConfidence: aiResult.confidence,
    aiAlignment: aiResult.alignment,
    aiRationale: aiResult.rationale,
    selector,
    selectorLabel,
    rpcStatus: code.ok && block.ok ? 'LIVE' : 'DEGRADED',
    networkBlock: block.result || 'unavailable',
    gasEstimate: gas.ok && gas.result ? `${Number.parseInt(gas.result, 16).toLocaleString()} gas` : 'unavailable',
    targetType: code.ok ? (eip7702Delegation ? 'EIP-7702 DELEGATED' : targetHasCode ? 'CONTRACT' : 'EOA / NO CODE') : 'UNKNOWN',
    proxyDetected,
    delegatedTo,
    temporalConsistency,
    findings,
    policy: { maxValueEth, allowUnlimitedApprovals: false, strictIntent: true },
    evidenceHash: evidenceHash(evidencePayload),
  };
}
