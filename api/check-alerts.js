const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function sendLINE(message) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
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
  const d = await r.json();
  if (!r.ok) throw new Error('LINE error: ' + JSON.stringify(d));
}

// Binance API - no auth, reliable, CORS friendly
async function fetchCryptoFromBinance() {
  const pairs = ['SOLUSDT','ETHUSDT','XRPUSDT','SUIUSDT'];
  const results = await Promise.allSettled(
    pairs.map(async pair => {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
      const d = await r.json();
      return { pair, price: parseFloat(d.price) };
    })
  );
  const prices = {};
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      const sym = r.value.pair.replace('USDT','');
      prices[sym] = r.value.price;
    }
  });
  return prices;
}

// HYPE and FET from CoinGecko with retry
async function fetchFromCoinGecko() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=hyperliquid,fetch-ai&vs_currencies=usd,thb',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!r.ok) throw new Error('CG ' + r.status);
    return await r.json();
  } catch { return {}; }
}

async function fetchUSDTHB() {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await r.json();
    return d.rates?.THB || 32.67;
  } catch { return 32.67; }
}

async function getAIAnalysis(prices, usdThb, alerts) {
  try {
    const solPnl = prices.SOL ? ((prices.SOL - 3699/35.7*usdThb) / (3699/35.7*usdThb) * 100).toFixed(1) : '?';
    const ethPnl = prices.ETH ? ((prices.ETH - 94782/usdThb) / (94782/usdThb) * 100).toFixed(1) : '?';
    const nvdaPnl = prices.NVDA ? ((prices.NVDA - 609/3) / (609/3) * 100).toFixed(1) : '?';

    const prompt = `あなたは世界最高峰の投資アナリストです。以下のポートフォリオを分析し、今日のアクションプランをLINE用に作成してください（800文字以内）。

【現在価格】
NVDA: $${prices.NVDA} (損益${nvdaPnl}%)
QQQ:  $${prices.QQQ}
MSFT: $${prices.MSFT}
SOL:  $${prices.SOL} (損益${solPnl}%)
ETH:  $${prices.ETH} (損益${ethPnl}%)
HYPE: $${prices.HYPE}
XRP:  $${prices.XRP}
FET:  ฿${prices.FET}
USD/THB: ${usdThb}

【投資ルール】
- NVDA $260超→1株利確 / $190割れ→即撤退
- SOL・ETH +50%超→25%利確→QQQ
- SUI・FET -40%割れ→即撤退
- 5/15 XRP・FET判断期限
- 5/20 NVDA決算【最重要】
- 停戦合意→SOL・HYPE即買い増し（弾฿20,000〜40,000確保中）

【市場背景】
イラン停戦交渉膠着中。停戦合意でクリプト急騰期待。

【トリガーアラート】
${alerts.length > 0 ? alerts.join('\n') : 'なし'}

以下の形式で返答してください：

【今日の総評】
（相場の一言）

【アクション】
①
②
③

【注目】
（今日見るべき数字）

【一言】
（投資家の心構え）`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    return d.content?.[0]?.text || null;
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [binancePrices, cgData, usdThb] = await Promise.all([
      fetchCryptoFromBinance(),
      fetchFromCoinGecko(),
      fetchUSDTHB()
    ]);

    const prices = {
      // Stocks (hardcoded - updated via import)
      NVDA: 198.45,
      QQQ:  475.44,
      MSFT: 414.20,
      // Crypto from Binance
      SOL:  binancePrices['SOL']  || null,
      ETH:  binancePrices['ETH']  || null,
      XRP:  binancePrices['XRP']  || null,
      SUI:  binancePrices['SUI']  || null,
      // HYPE & FET from CoinGecko
      HYPE: cgData['hyperliquid']?.usd || null,
      FET:  cgData['fetch-ai']?.thb   || null,
      // THB prices
      SOL_THB:  binancePrices['SOL']  ? binancePrices['SOL']  * usdThb : null,
      ETH_THB:  binancePrices['ETH']  ? binancePrices['ETH']  * usdThb : null,
    };

    // ─── ALERT RULES ───
    const alerts = [];
    if (prices.NVDA >= 260) alerts.push(`🚨 NVDA $${prices.NVDA} → $260超！1株利確ルール発動`);
    if (prices.NVDA <= 190) alerts.push(`🚨 NVDA $${prices.NVDA} → $190割れ！即撤退ルール発動`);
    if (prices.SOL >= 156)  alerts.push(`🚀 SOL $${prices.SOL?.toFixed(2)} → +50%超！25%利確検討`);
    if (prices.ETH >= 3982) alerts.push(`🚀 ETH $${prices.ETH?.toFixed(2)} → +50%超！25%利確検討`);
    if (prices.FET && prices.FET <= 3.63) alerts.push(`⚠️ FET ฿${prices.FET?.toFixed(2)} → -40%割れ！即撤退`);
    if (prices.SOL >= 120)  alerts.push(`💥 SOL $${prices.SOL?.toFixed(2)} → 急騰！停戦合意の可能性`);

    // Urgent alerts
    for (const msg of alerts) {
      await sendLINE(`【🚨 OKA QUEST ALERT】\n${msg}`);
    }

    // Daily summary + AI analysis
    const hour = new Date().getUTCHours() + 7;
    if (req.query.summary === '1' || hour === 8) {

      const header = `📊 OKA QUEST デイリーレポート
━━━━━━━━━━━━━━
株式（前日終値）
NVDA: $${prices.NVDA}
QQQ:  $${prices.QQQ}
MSFT: $${prices.MSFT}
━━━━━━━━━━━━━━
クリプト（リアルタイム）
SOL:  $${prices.SOL?.toFixed(2) ?? '---'} (฿${prices.SOL_THB?.toFixed(0) ?? '---'})
ETH:  $${prices.ETH?.toFixed(2) ?? '---'}
HYPE: $${prices.HYPE?.toFixed(2) ?? '---'}
XRP:  $${prices.XRP?.toFixed(3) ?? '---'}
FET:  ฿${prices.FET?.toFixed(2) ?? '---'}
SUI:  $${prices.SUI?.toFixed(3) ?? '---'}
━━━━━━━━━━━━━━
USD/THB: ${usdThb.toFixed(2)}`;

      await sendLINE(header);

      const ai = await getAIAnalysis(prices, usdThb, alerts);
      if (ai) await sendLINE(ai);
    }

    res.status(200).json({ prices, alerts, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message, ok: false });
  }
}
