const LINE_TOKEN = process.env.LINE_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWELVE_KEY = process.env.TWELVE_DATA_API_KEY;

const fmt2 = v => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(2) : '---';
const fmt3 = v => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(3) : '---';
const fmt0 = v => (v != null && !isNaN(v)) ? Math.round(v).toLocaleString() : '---';

const FALLBACK = { NVDA: 198.45, QQQ: 475.44, MSFT: 414.20, POLA: 1296 };

// Simple in-memory cache for previous prices (resets on cold start ~daily)
let prevPrices = {};

function pct(cur, prev) {
  if (!cur || !prev) return '';
  const p = ((cur - prev) / prev * 100);
  const sign = p >= 0 ? '+' : '';
  return ` (${sign}${p.toFixed(1)}%)`;
}

async function sendLINE(text) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: 'text', text }] })
  });
  if (!r.ok) throw new Error('LINE ' + r.status);
}

async function fetchStocks() {
  try {
    if (!TWELVE_KEY) return FALLBACK;
    const r = await fetch(`https://api.twelvedata.com/price?symbol=NVDA,QQQ,MSFT&apikey=${TWELVE_KEY}`);
    if (!r.ok) return FALLBACK;
    const d = await r.json();
    const p = (val, sym, min, max) => {
      const v = parseFloat(val);
      return (v >= min && v <= max) ? Math.round(v * 100) / 100 : FALLBACK[sym];
    };
    // Fetch POLA from stooq (Japanese stock)
    let polaPrice = FALLBACK.POLA;
    try {
      const rp = await fetch('https://stooq.com/q/l/?s=4927.jp&f=sd2t2ohlcv&h&e=json',
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const dp = await rp.json();
      const pp = parseFloat(dp?.symbols?.[0]?.close);
      if (pp >= 800 && pp <= 3000) polaPrice = pp;
    } catch {}

    return {
      NVDA: p(d?.NVDA?.price, 'NVDA', 80, 400),
      QQQ:  p(d?.QQQ?.price,  'QQQ',  400, 600),
      MSFT: p(d?.MSFT?.price, 'MSFT', 300, 600),
      POLA: polaPrice,
    };
  } catch {
    return FALLBACK;
  }
}

async function fetchCrypto() {
  try {
    const ids = 'solana,ethereum,hyperliquid,ripple,fetch-ai,sui';
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,thb`);
    if (!r.ok) return {};
    const d = await r.json();
    return {
      SOL_USD:  d?.solana?.usd       ?? null,
      SOL_THB:  d?.solana?.thb       ?? null,
      ETH_USD:  d?.ethereum?.usd     ?? null,
      ETH_THB:  d?.ethereum?.thb     ?? null,
      HYPE_USD: d?.hyperliquid?.usd  ?? null,
      XRP_USD:  d?.ripple?.usd       ?? null,
      FET_THB:  d?.['fetch-ai']?.thb ?? null,
      SUI_USD:  d?.sui?.usd          ?? null,
    };
  } catch {
    return {};
  }
}

async function fetchUSDTHB() {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await r.json();
    return typeof d?.rates?.THB === 'number' ? d.rates.THB : 32.67;
  } catch {
    return 32.67;
  }
}

async function getAIAnalysis(p, usdThb, alerts) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const pnl = (cur, cost) => cur ? ((cur - cost) / cost * 100).toFixed(1) + '%' : '?';
    const nvdaPnl = pnl(p.NVDA, 610 / 3);
    const solPnl  = pnl(p.SOL_THB, 3699);
    const ethPnl  = pnl(p.ETH_THB, 94782);
    const fetPnl  = pnl(p.FET_THB, 6.05);
    const today   = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Bangkok' });
    const d515    = Math.ceil((new Date('2026-05-15') - new Date()) / 86400000);
    const d520    = Math.ceil((new Date('2026-05-20') - new Date()) / 86400000);

    const prompt = `あなたは世界最高峰の投資アナリストです。以下のポートフォリオを分析し、今日のアクションプランをLINE用（800文字以内）で作成してください。

今日: ${today}
XRP・FET判断期限まで: ${d515}日 | NVDA決算まで: ${d520}日

現在価格:
NVDA $${p.NVDA}(${nvdaPnl}) | QQQ $${p.QQQ} | MSFT $${p.MSFT}
POLA ¥${p.POLA ?? '---'}(日本株・J-Beauty 100株保有)
SOL $${fmt2(p.SOL_USD)} / ฿${fmt0(p.SOL_THB)}(${solPnl})
ETH $${fmt2(p.ETH_USD)} / ฿${fmt0(p.ETH_THB)}(${ethPnl})
HYPE $${fmt2(p.HYPE_USD)} | XRP $${fmt3(p.XRP_USD)} | FET ฿${fmt2(p.FET_THB)}(${fetPnl})
USD/THB: ${usdThb.toFixed(2)}

投資ルール:
- NVDA $260超→1株利確 / $190割れ→即撤退
- SOL・ETH +50%超→25%利確→QQQ
- SUI・FET -40%割れ→即撤退(FET基準฿3.63)
- 5/15 XRP・FET判断期限
- 5/20 NVDA決算【最重要】
- 停戦合意→SOL・HYPE即買い増し(弾฿20,000〜40,000確保中)
- 元値: 株式฿168,282 + クリプト฿89,000 = ฿257,282

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
    if (!r.ok) return null;
    const d = await r.json();
    return d?.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const [stocks, crypto, usdThb] = await Promise.all([
    fetchStocks(),
    fetchCrypto(),
    fetchUSDTHB()
  ]);

  const p = { ...stocks, ...crypto };

  const alerts = [];
  if (p.NVDA >= 260)                           alerts.push(`NVDA $${p.NVDA} → $260超！1株利確ルール発動`);
  if (p.NVDA > 0 && p.NVDA <= 190)            alerts.push(`NVDA $${p.NVDA} → $190割れ！即撤退ルール発動`);
  if (p.SOL_USD != null && p.SOL_USD >= 156)  alerts.push(`SOL $${fmt2(p.SOL_USD)} → +50%超！25%利確検討`);
  if (p.ETH_USD != null && p.ETH_USD >= 3982) alerts.push(`ETH $${fmt2(p.ETH_USD)} → +50%超！25%利確検討`);
  if (p.FET_THB != null && p.FET_THB <= 3.63) alerts.push(`FET ฿${fmt2(p.FET_THB)} → -40%割れ！即撤退`);
  if (p.POLA != null && p.POLA >= 1555) alerts.push(`POLA ¥${p.POLA} → +20%超！半分利確検討`);
  if (p.POLA != null && p.POLA <= 1100) alerts.push(`POLA ¥${p.POLA} → -15%割れ！損切りライン`);
  if (p.SOL_USD != null && p.SOL_USD >= 120)  alerts.push(`SOL $${fmt2(p.SOL_USD)} → 急騰！停戦合意の可能性`);

  for (const msg of alerts) {
    try { await sendLINE(`【OKA QUEST ALERT】\n${msg}`); } catch {}
  }

  const bangkokHour = (new Date().getUTCHours() + 7) % 24;
  const isSummary = req.query.summary === '1' || bangkokHour === 8;

  if (isSummary) {
    try {
      const header = [
        '📊 OKA QUEST デイリーレポート',
        '━━━━━━━━━━━━━━',
        '株式（リアルタイム）',
        `NVDA: $${p.NVDA}${pct(p.NVDA, prevPrices.NVDA)}`,
        `QQQ:  $${p.QQQ}${pct(p.QQQ, prevPrices.QQQ)}`,
        `MSFT: $${p.MSFT}${pct(p.MSFT, prevPrices.MSFT)}`,
        `POLA: ¥${p.POLA ?? '---'}${pct(p.POLA, prevPrices.POLA)}`,
        '━━━━━━━━━━━━━━',
        'クリプト（リアルタイム）',
        `SOL:  $${fmt2(p.SOL_USD)}${pct(p.SOL_USD, prevPrices.SOL_USD)} (฿${fmt0(p.SOL_THB)})`,
        `ETH:  $${fmt2(p.ETH_USD)}${pct(p.ETH_USD, prevPrices.ETH_USD)}`,
        `HYPE: $${fmt2(p.HYPE_USD)}${pct(p.HYPE_USD, prevPrices.HYPE_USD)}`,
        `XRP:  $${fmt3(p.XRP_USD)}${pct(p.XRP_USD, prevPrices.XRP_USD)}`,
        `FET:  ฿${fmt2(p.FET_THB)}${pct(p.FET_THB, prevPrices.FET_THB)}`,
        `SUI:  $${fmt3(p.SUI_USD)}${pct(p.SUI_USD, prevPrices.SUI_USD)}`,
        '━━━━━━━━━━━━━━',
        `USD/THB: ${usdThb.toFixed(2)}`,
        `アラート: ${alerts.length}件`,
      ].join('\n');

      await sendLINE(header);
      const ai = await getAIAnalysis(p, usdThb, alerts);
      if (ai) await sendLINE(ai);
    } catch {}
  }

  // Cache current prices for next call's comparison
  prevPrices = { ...p };

  res.status(200).json({
    ok: true,
    prices: p,
    alerts,
    checked_at: new Date().toISOString()
  });
}
