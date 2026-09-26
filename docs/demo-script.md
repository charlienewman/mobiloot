# Demo script (target 2:40)

Record on a physical Android phone (Seeker if available) against devnet, with a
fresh wallet holding about 2 devnet SOL. Turn on Do Not Disturb. Don't show a
revealed activation code from a live (non-mock) eSIM.

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | Welcome | "Your phone plan costs you every month. What if your savings paid it instead, without you spending them? This is Zero, by Shaka." |
| 0:12 | Tap **Connect wallet** → wallet approves | "One tap: Mobile Wallet Adapter connects and signs me in with Solana in a single approval." |
| 0:25 | Home, empty ring | "The ring shows how much of my plan my stake pays for. Right now, nothing." |
| 0:32 | Stake → 1 SOL → preview | "I stake SOL into the zeroSOL pool. The preview shows what it does to my plan before I sign." |
| 0:45 | Tx sheet: wallet → confirming → done | "Real devnet transaction. zeroSOL lands in my own wallet, and I can withdraw any time with no fee." |
| 1:00 | Home: ring, "Where your yield goes" | "Here's the trick. The pool sends 100% of its staking rewards to Shaka's treasury, on-chain, every epoch. 1 zeroSOL stays 1 SOL. I pay with yield, never principal." |
| 1:20 | Stake: "What would fully fund my plan?" | "At today's measured yield and Pyth's SOL price, about 9 SOL covers this plan for good. On devnet we unlock at half a SOL so anyone can try it, and the app says so." |
| 1:35 | eSIM → **Activate plan** → wallet | "Activating writes my entitlement to Solana for this billing period. Our program checks my zeroSOL at the pool's live rate. No personal data goes on-chain." |
| 1:55 | **Get my eSIM** → stepper → SIM card | "The backend verifies that entitlement on-chain and orders the eSIM. Here it's the mock provider; Shaka's sandbox plugs into the same interface." |
| 2:10 | Show code (mock) → QR → **Open SIM settings** | "Code, QR, or straight into Android's SIM settings." |
| 2:20 | Home: active plan, data usage, renews in N days | "Each day I can see my data, my funding and my renewal. As long as my stake covers it, it renews: no card, no bill." |
| 2:32 | Wordmark | "Zero Mobile. Your stake, your signal. Built by Shaka for Solana Mobile." |

End card: repository URL, devnet program id, and a stake and an activation
transaction signature.

Backup: record a second full take. If devnet RPC is slow, the tx sheet explains
every wait, so leave it in rather than cutting.
