const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ─── UTILS ───
const fmt2 = v => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(2) : '---';
const fmt3 = v => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(3) : '---';
const fmt0 = v => (v != null && !isNaN(v)) ? Math.round(v).toLocaleString() : '---';

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
  if (!r.ok) {
    const e = await r.json();
    throw new Error('LINE: ' + JSON.stringify(e));
  }
}

// ─── CRYPTO: CoinGecko ───
// Returns { SOL_USD, SOL_THB, ETH_USD, ... } all as plain numbers
async function fetchCrypto() {
  const ids = 'solana,ethereum,hyperliquid,ripple,fetch-ai,sui';
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,thb`;
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
  });
  if (!r.ok) throw new Error('CoinGecko ' + r.status);
  const d = await r.json();

  // Always extract as plain numbers here
  return {
    SOL_USD:  d?.solana?.usd         ?? null,
    SOL_THB:  d?.solana?.thb         ?? null,
    ETH_USD:  d?.ethereum?.usd       ?? null,
    ETH_THB:  d?.ethereum?.thb       ?? null,
    HYPE_USD: d?.hyperliquid?.usd    ?? null,
    HYPE_THB: d?.hyperliquid?.thb    ?? null,
    XRP_USD:  d?.ripple?.usd         ?? null,
    XRP_THB:  d?.ripple?.thb         ?? null,
    FET_USD:  d?.['fetch-ai']?.usd   ?? null,
    FET_THB:  d?.['fetch-ai']?.thb   ?? null,
    SUI_USD:  d?.sui?.usd            ?? null,
  };
}

// ─── FX ───
async function fetchUSDTHB() {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await r.json();
    return typeof d?.rates?.THB === 'number' ? d.rates.THB : 32.67;
  } catch {
    return 32.67;
  }
}

// ─── AI ANALYSIS ───
async function getAIAnalysis(p, usdThb, alerts) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const nvdaPnl = p.NVDA ? ((p.NVDA - 610/3) / (610/3) * 100).toFixed(1) + '%' : '?';
    const solPnl  = p.SOL_THB ? ((p.SOL_THB - 3699) / 3699 * 100).toFixed(1) + '%' : '?';
    const ethPnl  = p.ETH_THB ? ((p.ETH_THB - 94782) / 94782 * 100).toFixed(1) + '%' : '?';
    const fetPnl  = p.FET_THB ? ((p.FET_THB - 6.05) / 6.05 * 100).toFixed(1) + '%' : '?';

    const prompt = `あなたは世界最高峰の投資アナリストです。以下のポートフォリオを分析し、今日のアクションプランをLINE用（800文字以内）で作成してください。

現在価格:
NVDA $${p.NVDA} (${nvdaPnl}) | QQQ $${p.QQQ} | MSFT $${p.MSFT}
SOL $${fmt2(p.SOL_USD)} / ฿${fmt0(p.SOL_THB)} (${solPnl})
ETH $${fmt2(p.ETH_USD)} / ฿${fmt0(p.ETH_THB)} (${ethPnl})
HYPE $${fmt2(p.HYPE_USD)} | XRP $${fmt3(p.XRP_USD)} | FET ฿${fmt2(p.FET_THB)} (${fetPnl})
USD/THB: ${usdThb.toFixed(2)}

投資ルール:
- NVDA $260超→1株利確 / $190割れ→即撤退
- SOL・ETH +50%超→25%利確→QQQ
- SUI・FET -40%割れ→即撤退（FET基準฿3.63）
- 5/15 XRP・FET判断期限
- 5/20 NVDA決算【最重要】
- 停戦合意→SOL・HYPE即買い増し（弾฿20,000〜40,000確保中）
- 元値合計: 株式฿168,282 + クリプト฿89,000 = ฿257,282

市場背景: イラン停戦交渉膠着中。合意でSOL・HYPE急騰期待。

発動アラート: ${alerts.length > 0 ? alerts.join(' / ') : 'なし'}

以下の形式で返答:
【今日の総評】
【アクション】①②③
【注目】
【一言】`;

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
    if (!r.ok) throw new Error('Claude API ' + r.status);
    const d = await r.json();
    return d?.content?.[0]?.text ?? null;
  } catch (e) {
    console.error('AI failed:', e.message);
    return null;
  }
}

// ─── MAIN HANDLER ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Stock prices (hardcoded - updated via import screen)
  const STOCKS = { NVDA: 198.45, QQQ: 475.44, MSFT: 414.20 };

  let crypto = {};
  let usdThb = 32.67;
  const errors = [];

  // Fetch in parallel
  const [cryptoResult, fxResult] = await Promise.allSettled([
    fetchCrypto(),
    fetchUSDTHB()
  ]);

  if (cryptoResult.status === 'fulfilled') {
    crypto = cryptoResult.value;
  } else {
    errors.push('crypto: ' + cryptoResult.reason?.message);
  }

  if (fxResult.status === 'fulfilled') {
    usdThb = fxResult.value;
  } else {
    errors.push('fx: ' + fxResult.reason?.message);
  }

  // Merge into flat price object (all plain numbers)
  const p = {
    ...STOCKS,
    ...crypto,
  };

  // ─── ALERT RULES ───
  const alerts = [];
  if (p.NVDA >= 260)                          alerts.push(`🚨 NVDA $${p.NVDA} → $260超！1株利確ルール発動`);
  if (p.NVDA > 0 && p.NVDA <= 190)           alerts.push(`🚨 NVDA $${p.NVDA} → $190割れ！即撤退ルール発動`);
  if (p.SOL_USD != null && p.SOL_USD >= 156) alerts.push(`🚀 SOL $${fmt2(p.SOL_USD)} → +50%超！25%利確検討`);
  if (p.ETH_USD != null && p.ETH_USD >= 3982)alerts.push(`🚀 ETH $${fmt2(p.ETH_USD)} → +50%超！25%利確検討`);
  if (p.FET_THB != null && p.FET_THB <= 3.63)alerts.push(`⚠️ FET ฿${fmt2(p.FET_THB)} → -40%割れ！即撤退`);
  if (p.SOL_USD != null && p.SOL_USD >= 120) alerts.push(`💥 SOL $${fmt2(p.SOL_USD)} → 急騰！停戦合意の可能性`);

  // Send urgent alerts
  for (const msg of alerts) {
    try { await sendLINE(`【🚨 OKA QUEST ALERT】\n${msg}`); }
    catch (e) { errors.push('alert LINE: ' + e.message); }
  }

  // Daily report
  const bangkokHour = new Date().getUTCHours() + 7;
  const isSummary = req.query.summary === '1' || bangkokHour === 8;

  if (isSummary) {
    try {
      const header = [
        '📊 OKA QUEST デイリーレポート',
        '━━━━━━━━━━━━━━',
        '株式（前日終値）',
        `NVDA: $${p.NVDA}`,
        `QQQ:  $${p.QQQ}`,
        `MSFT: $${p.MSFT}`,
        '━━━━━━━━━━━━━━',
        'クリプト（リアルタイム）',
        `SOL:  $${fmt2(p.SOL_USD)} (฿${fmt0(p.SOL_THB)})`,
        `ETH:  $${fmt2(p.ETH_USD)} (฿${fmt0(p.ETH_THB)})`,
        `HYPE: $${fmt2(p.HYPE_USD)}`,
        `XRP:  $${fmt3(p.XRP_USD)}`,
        `FET:  ฿${fmt2(p.FET_THB)}`,
        `SUI:  $${fmt3(p.SUI_USD)}`,
        '━━━━━━━━━━━━━━',
        `USD/THB: ${usdThb.toFixed(2)}`,
        `アラート: ${alerts.length}件`,
      ].join('\n');

      await sendLINE(header);

      const ai = await getAIAnalysis(p, usdThb, alerts);
      if (ai) await sendLINE(ai);

    } catch (e) {
      errors.push('summary LINE: ' + e.message);
    }
  }

  res.status(200).json({
    ok: true,
    prices: p,
    alerts,
    errors: errors.length > 0 ? errors : undefined,
    checked_at: new Date().toISOString()
  });
}
