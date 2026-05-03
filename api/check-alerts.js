const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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

async function fetchCrypto() {
  const ids = 'solana,ethereum,hyperliquid,ripple,fetch-ai,sui';
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,thb`);
  return await r.json();
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
    const portfolio = {
      stocks: {
        QQQ:  { price: prices.QQQ,  qty: 7.09,          cost_usd: 2792, pnl_pct: ((prices.QQQ  - 2792/7.09) / (2792/7.09) * 100).toFixed(1) },
        MSFT: { price: prices.MSFT, qty: 3,              cost_usd: 1312, pnl_pct: ((prices.MSFT - 1312/3)   / (1312/3)   * 100).toFixed(1) },
        NVDA: { price: prices.NVDA, qty: 3,              cost_usd: 610,  pnl_pct: ((prices.NVDA - 610/3)    / (610/3)    * 100).toFixed(1) },
      },
      crypto: {
        SOL:  { price_usd: prices.SOL,  qty: 10.54, cost_thb: 35132, pnl_pct: prices.SOL_THB ? ((prices.SOL_THB  - 35132/10.54) / (35132/10.54) * 100).toFixed(1) : '?' },
        ETH:  { price_usd: prices.ETH,  qty: 0.1196, cost_thb: 10925, pnl_pct: prices.ETH_THB ? ((prices.ETH_THB  - 10925/0.1196) / (10925/0.1196) * 100).toFixed(1) : '?' },
        HYPE: { price_usd: prices.HYPE, qty: 4.77, cost_thb: 7688,  pnl_pct: prices.HYPE_THB ? ((prices.HYPE_THB - 7688/4.77)   / (7688/4.77)   * 100).toFixed(1) : '?' },
        XRP:  { price_usd: prices.XRP,  qty: 72.39, cost_thb: 3985,  pnl_pct: prices.XRP_THB ? ((prices.XRP_THB  - 3985/72.39)  / (3985/72.39)  * 100).toFixed(1) : '?' },
        FET:  { price_thb: prices.FET,  qty: 1777, cost_thb: 14078, pnl_pct: prices.FET ? ((prices.FET - 14078/1777) / (14078/1777) * 100).toFixed(1) : '?' },
        SUI:  { price_usd: prices.SUI,  qty: 471.84, cost_thb: 17191 },
      },
      rules: [
        'SOL・ETHが+50%超えたら25%利確→QQQ',
        'SUI・FET枠-40%超えたら即撤退',
        'NVDA：$260超→1株利確 / $190割れ→即撤退',
        '停戦合意の瞬間にSOL・HYPEを即買い増し（฿20,000〜40,000弾確保）',
        'XRP・FET：5/15までに反発なければSOL/HYPEへ整理',
        '毎月฿20,000機械的積み立て継続',
      ],
      upcoming_events: [
        '5/8 任天堂決算',
        '5/11 日本郵船決算',
        '5/12 三菱重工決算',
        '5/15 XRP・FET売却判断期限',
        '5/20 NVDA決算【最重要】',
      ],
      context: 'イラン・米国停戦交渉が膠着中。合意次第でSOL・HYPEが急騰する可能性。停戦弾฿20,000〜40,000はキャッシュキープ中。',
      triggered_alerts: alerts,
      usd_thb: usdThb,
      total_cost_thb: 257281,
    };

    const prompt = `あなたは世界最高峰の投資アナリストです。以下のポートフォリオデータと市場状況を分析し、今日のアクションプランをLINEメッセージ用に作成してください。

ポートフォリオ:
${JSON.stringify(portfolio, null, 2)}

以下の形式で、簡潔かつ具体的に日本語で返答してください（LINEなので合計800文字以内）：

【今日の総評】
（相場全体の一言コメント）

【アクション】
①（具体的に何をすべきか）
②（次に優先すること）
③（今は動かすな、という場合はその理由）

【注目ポイント】
（今日特に見るべき数字や出来事）

【一言】
（投資家として今の心構え）

トリガーされたアラートがあれば最優先で言及してください。
感情的にならず、データに基づいて冷静かつ正直に分析してください。`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const d = await r.json();
    return d.content?.[0]?.text || null;
  } catch(e) {
    console.error('AI analysis failed:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const [cryptoData, usdThb] = await Promise.all([
      fetchCrypto(),
      fetchUSDTHB()
    ]);

    const prices = {
      NVDA: 198.45,
      QQQ:  475.44,
      MSFT: 414.20,
      SOL:      cryptoData['solana']?.usd || null,
      SOL_THB:  cryptoData['solana']?.thb || null,
      ETH:      cryptoData['ethereum']?.usd || null,
      ETH_THB:  cryptoData['ethereum']?.thb || null,
      HYPE:     cryptoData['hyperliquid']?.usd || null,
      HYPE_THB: cryptoData['hyperliquid']?.thb || null,
      XRP:      cryptoData['ripple']?.usd || null,
      XRP_THB:  cryptoData['ripple']?.thb || null,
      FET:      cryptoData['fetch-ai']?.thb || null,
      SUI:      cryptoData['sui']?.usd || null,
    };

    // ─── ALERT RULES ───
    const alerts = [];
    if (prices.NVDA >= 260) alerts.push(`🚨 NVDA $${prices.NVDA} → $260超！1株利確ルール発動`);
    if (prices.NVDA <= 190) alerts.push(`🚨 NVDA $${prices.NVDA} → $190割れ！即撤退ルール発動`);
    if (prices.SOL >= 156)  alerts.push(`🚀 SOL $${prices.SOL?.toFixed(2)} → +50%超！25%利確検討`);
    if (prices.ETH >= 3982) alerts.push(`🚀 ETH $${prices.ETH?.toFixed(2)} → +50%超！25%利確検討`);
    if (prices.FET && prices.FET <= 3.63) alerts.push(`⚠️ FET ฿${prices.FET?.toFixed(2)} → -40%割れ！即撤退`);
    if (prices.SOL >= 120)  alerts.push(`💥 SOL $${prices.SOL?.toFixed(2)} → 急騰！停戦合意の可能性`);

    // Send urgent alerts immediately
    for (const msg of alerts) {
      await sendLINE(`【🚨 OKA QUEST ALERT】\n${msg}`);
    }

    // AI Analysis + Summary
    const hour = new Date().getUTCHours() + 7;
    if (req.query.summary === '1' || hour === 8) {
      // Get AI analysis
      const aiAnalysis = await getAIAnalysis(prices, usdThb, alerts);

      const header = `📊 OKA QUEST デイリーレポート
━━━━━━━━━━━━━━
株式（前日終値）
NVDA: $${prices.NVDA?.toFixed(2) ?? '---'}
QQQ:  $${prices.QQQ?.toFixed(2) ?? '---'}
MSFT: $${prices.MSFT?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
クリプト（リアルタイム）
SOL:  $${prices.SOL?.toFixed(2) ?? '---'} (฿${prices.SOL_THB?.toFixed(0) ?? '---'})
ETH:  $${prices.ETH?.toFixed(2) ?? '---'}
HYPE: $${prices.HYPE?.toFixed(2) ?? '---'}
XRP:  $${prices.XRP?.toFixed(2) ?? '---'}
FET:  ฿${prices.FET?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
USD/THB: ${usdThb.toFixed(2)}
━━━━━━━━━━━━━━`;

      await sendLINE(header);

      // Send AI analysis as separate message
      if (aiAnalysis) {
        await sendLINE(aiAnalysis);
      }
    }

    res.status(200).json({ prices, alerts, ok: true, checked_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, ok: false });
  }
}
