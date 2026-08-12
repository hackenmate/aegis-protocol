# AEGIS Protocol

**Intent-bound security for autonomous Web3 transactions.**

AEGIS is a defensive transaction firewall for wallets and AI agents that can propose blockchain actions. It compares the user's stated intent with deterministic policy checks, calldata signals, live Arbitrum execution evidence and an optional AI semantic review before returning:

- `ALLOW`
- `REQUIRE_HUMAN`
- `BLOCK`

> **AI can recommend. Policy must authorize.**

## Live MVP

https://aegis-6kv1tl.v2.appdeploy.ai/

The GitHub version is standalone and uses its own Express API plus the official OpenAI Node SDK.

## Quick start

Requirements: Node.js 20+.

```bash
git clone https://github.com/hackenmate/aegis-protocol.git
cd aegis-protocol
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL shown in your terminal. The frontend proxies `/api/*` to the local API at port `8787`.

### Optional AI review

AEGIS works without an AI key: deterministic rules and Arbitrum RPC analysis remain active. To enable semantic intent review, set this only on the server:

```env
OPENAI_API_KEY=your_server_side_key
OPENAI_MODEL=gpt-5-mini
```

Never expose the API key in frontend code.

## Standalone architecture

```text
React / Vite UI
      |
      v
Express API  POST /api/analyze
      |
      +--> Intent + input validation
      +--> Deterministic calldata decoder
      +--> Policy engine
      +--> Arbitrum Sepolia JSON-RPC
      +--> EIP-1967 proxy signal
      +--> EIP-7702 delegated-account signal
      +--> Adjacent-state execution probe
      +--> Optional OpenAI structured review
      |
      v
ALLOW / REQUIRE_HUMAN / BLOCK
      |
      v
SHA-256 decision fingerprint
      |
      v
AegisGuard.sol deterministic enforcement
```

## Current MVP capabilities

- Human-intent binding before signing.
- EVM address/value/calldata validation.
- ERC-20 `approve`, unlimited approval, `setApprovalForAll`, `transfer` and `transferFrom` signals.
- Configurable maximum ETH value policy.
- Live Arbitrum Sepolia calls using `eth_blockNumber`, `eth_getCode`, `eth_call`, `eth_estimateGas` and `eth_getStorageAt`.
- EIP-1967 implementation-slot signal for upgradeable proxies.
- EIP-7702 delegation bytecode detection.
- Adjacent-block simulation consistency probe.
- Structured OpenAI semantic review when `OPENAI_API_KEY` is configured.
- Deterministic hard policy remains the final blocking authority.
- Real SHA-256 evidence fingerprint generated server-side.
- Responsive presentation UI and wallet-address capture from an injected EVM wallet.

## Onchain enforcement demo

`contracts/AegisGuard.sol` is a real Solidity execution boundary for the hackathon demo. It can:

- enforce a maximum native-token value per transaction;
- block ERC-20 `approve(spender, uint256.max)`;
- block `setApprovalForAll(..., true)`;
- execute an allowed call only after deterministic policy validation;
- emit an onchain `TransactionAllowed` event tied to an evidence hash.

Run the app and open:

```text
http://localhost:5173/guard-demo.html
```

Then:

1. Connect a browser wallet.
2. Switch to Arbitrum Sepolia when prompted.
3. Click **Deploy AegisGuard** and approve the deployment in your wallet.
4. Click **Simulate dangerous approval**. AEGIS performs a call against the deployed Solidity contract and expects an `UnlimitedApprovalBlocked` revert; no dangerous approval is broadcast.
5. Optionally click **Send safe proof** to broadcast a zero-value allowed call and generate a real onchain success transaction.

The deployment bytecode and ABI used by the browser are checked into `src/guardArtifact.ts`, and CI recompiles the Solidity source on every push.

Compile manually with:

```bash
npm run compile:guard
```

The contract is **not audited**. The hackathon contract proves deterministic onchain enforcement; a production release should integrate equivalent policy logic into a reviewed Safe Guard / modular smart-account hook rather than treating this demo contract as a custody solution.

## API

### Health

```http
GET /api/health
```

### Analyze

```http
POST /api/analyze
Content-Type: application/json
```

Example request:

```json
{
  "intent": "Swap up to 100 USDC for ETH. Never grant unlimited approval.",
  "from": "0x0000000000000000000000000000000000000000",
  "to": "0x1111111111111111111111111111111111111111",
  "valueEth": "0",
  "data": "0x095ea7b30000000000000000000000002222222222222222222222222222222222222222ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "policy": {
    "maxValueEth": "0.01",
    "allowUnlimitedApprovals": false,
    "strictIntent": true
  }
}
```

## Repository structure

```text
backend/
  aegis.ts          Standalone defensive analysis engine
  index.ts          Express API + production static hosting
contracts/
  AegisGuard.sol    Deterministic onchain execution boundary
src/
  AegisApp.tsx      Main React hackathon UI
  GuardDemo.tsx     Browser wallet deploy + onchain proof UI
  guardArtifact.ts  Compiled ABI / deployment bytecode
  api.ts            Standalone HTTP adapter
  index.css         Main responsive visual system
  guard.css         Onchain demo visual system
.github/workflows/
  ci.yml            TypeScript, Vite and Solidity validation
```

## Scripts

```bash
npm run dev             # frontend + API
npm run dev:web         # frontend only
npm run dev:api         # API only
npm run typecheck
npm run build
npm run compile:guard   # compile Solidity artifact locally
npm start               # serve API; serves dist/ too after npm run build
```

## Production roadmap

1. Verified ABI/source resolution via Sourcify/Etherscan-compatible sources.
2. Full transaction effect and state-diff decoding.
3. Adversarial multi-state simulation using fork/state overrides.
4. Contract/address threat intelligence and reputation signals.
5. EIP-7702 delegate-code recursive analysis.
6. Safe Guard / modular smart-account integration on Arbitrum.
7. Signed/onchain decision attestations with nonce, expiry and domain separation.
8. Agent permissions: protocol allowlists, spend limits, expiry and human escalation.

## Security status

This is a **hackathon MVP, not an audited security product**. It must not be used as the sole control for production funds. A successful simulation is not proof that a transaction is safe, and an AI model never has unilateral authorization authority in the design.

## Stack

- React 19 + TypeScript + Vite
- Express
- ethers v6 browser wallet integration
- Official OpenAI Node SDK / Responses API
- Arbitrum Sepolia JSON-RPC
- Solidity 0.8.x
- GitHub Actions CI

---

AEGIS explores a simple thesis: as autonomous software gains access to programmable money, it needs an independent execution boundary between intelligence and authority.
