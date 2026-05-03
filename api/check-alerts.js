const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;

async function sendLINE(message) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      to: LINE_USER_ID,
      messages: [{ type: 'text', text: message }]
    })
  });
}

// CoinGecko for crypto
async function fetchCrypto() {
  const ids = 'solana,ethereum,hyperliquid,ripple,fetch-ai';
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,thb`);
  return await r.json();
}

// Frankfurter for USD/THB rate
async function fetchUSDTHB() {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await r.json();
    return d.rates?.THB || 32.67;
  } catch { return 32.67; }
}

// Use hardcoded recent prices for stocks (updated manually via import)
// stooq is unreliable - skip it
function getStockPrices() {
  return {
    NVDA: 198.45,
    QQQ: 475.44,
    MSFT: 414.20,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [cryptoData, usdThb] = await Promise.all([
      fetchCrypto(),
      fetchUSDTHB()
    ]);

    const stocks = getStockPrices();

    const prices = {
      NVDA: stocks.NVDA,
      QQQ:  stocks.QQQ,
      MSFT: stocks.MSFT,
      SOL:  cryptoData['solana']?.usd || null,
      ETH:  cryptoData['ethereum']?.usd || null,
      HYPE: cryptoData['hyperliquid']?.usd || null,
      XRP:  cryptoData['ripple']?.usd || null,
      FET:  cryptoData['fetch-ai']?.thb || null,
      SOL_THB: cryptoData['solana']?.thb || null,
      ETH_THB: cryptoData['ethereum']?.thb || null,
    };

    // ─── ALERT RULES ───
    const alerts = [];

    if (prices.NVDA >= 260) alerts.push(`🚨 NVDA $${prices.NVDA.toFixed(2)}\n→ $260超！1株利確ルール発動\n今すぐInnovestXを確認`);
    if (prices.NVDA <= 190) alerts.push(`🚨 NVDA $${prices.NVDA.toFixed(2)}\n→ $190割れ！即撤退ルール発動`);
    if (prices.SOL >= 156) alerts.push(`🚀 SOL $${prices.SOL.toFixed(2)}\n→ 取得コスト比+50%超！\n25%利確→QQQへ`);
    if (prices.ETH >= 3982) alerts.push(`🚀 ETH $${prices.ETH.toFixed(2)}\n→ 取得コスト比+50%超！\n25%利確→QQQへ`);
    if (prices.FET && prices.FET <= 3.63) alerts.push(`⚠️ FET ฿${prices.FET.toFixed(2)}\n→ -40%割れ！即撤退ルール発動`);
    if (prices.SOL >= 120) alerts.push(`💥 SOL $${prices.SOL.toFixed(2)}\n→ 急騰！停戦合意の可能性\n停戦弾฿20,000〜40,000を即投入検討`);

    // Send alerts
    for (const msg of alerts) {
      await sendLINE(`【OKA QUEST ALERT】\n${msg}`);
    }

    // Daily summary
    const hour = new Date().getUTCHours() + 7;
    if (req.query.summary === '1' || hour === 8) {
      const summary = `📊 OKA QUEST 朝のサマリー
━━━━━━━━━━━━━━
株式（前日終値）
NVDA: $${prices.NVDA?.toFixed(2) ?? '---'}
QQQ:  $${prices.QQQ?.toFixed(2) ?? '---'}
MSFT: $${prices.MSFT?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
クリプト（リアルタイム）
SOL:  $${prices.SOL?.toFixed(2) ?? '---'}
ETH:  $${prices.ETH?.toFixed(2) ?? '---'}
HYPE: $${prices.HYPE?.toFixed(2) ?? '---'}
XRP:  $${prices.XRP?.toFixed(2) ?? '---'}
FET:  ฿${prices.FET?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
USD/THB: ${usdThb.toFixed(2)}
アラート: ${alerts.length}件
https://oka-portfolio.vercel.app`;
      await sendLINE(summary);
    }

    res.status(200).json({ prices, alerts, ok: true, checked_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, ok: false });
  }
}
