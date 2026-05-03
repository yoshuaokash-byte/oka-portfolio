const LINE_TOKEN = 'HrZzZiPv9Lhwp6kRh9MlbbvwV+8i6R3BVWHNPWlpmtmLTT6Lrg4Z8YGHsflA6xnse7UL2rKN/aHsq4sPA/MIReVGrAo+C/H6/+1/g2et56y8f8tpBVNF/lHuIQ2d3TidE5K18FV02D4uemg8BmyFlwdB04t89/1O/w1cDnyilFU=';
const LINE_USER_ID = 'U590a2812f96e9e08661eea20247b0bf0';

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

async function fetchStooq(sym) {
  const url = `https://stooq.com/q/l/?s=${sym.toLowerCase()}.us&f=sd2t2ohlcv&h&e=json`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const d = await r.json();
  const close = d?.symbols?.[0]?.close;
  return close ? parseFloat(close) : null;
}

async function fetchCrypto(id) {
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,thb`);
  const d = await r.json();
  return d[id] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Fetch prices in parallel
    const [nvda, qqq, msft, sol, eth, hype, xrp, fet] = await Promise.allSettled([
      fetchStooq('NVDA'),
      fetchStooq('QQQ'),
      fetchStooq('MSFT'),
      fetchCrypto('solana'),
      fetchCrypto('ethereum'),
      fetchCrypto('hyperliquid'),
      fetchCrypto('ripple'),
      fetchCrypto('fetch-ai'),
    ]);

    // Sanity check for stooq values
    const sanityCheck = (val, min, max) => (val && val >= min && val <= max) ? val : null;

    const prices = {
      NVDA: sanityCheck(nvda.status==='fulfilled' ? nvda.value : null, 80, 400),
      QQQ:  sanityCheck(qqq.status==='fulfilled'  ? qqq.value  : null, 400, 600),
      MSFT: sanityCheck(msft.status==='fulfilled' ? msft.value : null, 300, 600),
      SOL:  sol.status==='fulfilled'  ? sol.value  : null,
      ETH:  eth.status==='fulfilled'  ? eth.value  : null,
      HYPE: hype.status==='fulfilled' ? hype.value : null,
      XRP:  xrp.status==='fulfilled'  ? xrp.value  : null,
      FET:  fet.status==='fulfilled'  ? fet.value  : null,
    };

    // ─── ALERT RULES ───
    const alerts = [];

    // NVDA
    if (prices.NVDA) {
      if (prices.NVDA >= 260) alerts.push({ sym:'NVDA', msg:`🚨 NVDA $${prices.NVDA.toFixed(2)}\n→ $260超！1株利確ルール発動\n今すぐInnovestXを確認` });
      if (prices.NVDA <= 190) alerts.push({ sym:'NVDA', msg:`🚨 NVDA $${prices.NVDA.toFixed(2)}\n→ $190割れ！即撤退ルール発動\n全株売却を検討` });
    }

    // SOL: cost $104/SOL → +50% = $156
    if (prices.SOL?.usd >= 156) alerts.push({ sym:'SOL', msg:`🚀 SOL $${prices.SOL.usd.toFixed(2)}\n→ 取得コスト比+50%超！\n25%利確→QQQへ` });

    // ETH: cost $2,655 → +50% = $3,982
    if (prices.ETH?.usd >= 3982) alerts.push({ sym:'ETH', msg:`🚀 ETH $${prices.ETH.usd.toFixed(2)}\n→ 取得コスト比+50%超！\n25%利確→QQQへ` });

    // SUI/FET: -40% stop loss
    // FET cost ฿6.05 → -40% = ฿3.63
    if (prices.FET?.thb && prices.FET.thb <= 3.63) alerts.push({ sym:'FET', msg:`⚠️ FET ฿${prices.FET.thb.toFixed(2)}\n→ -40%割れ！即撤退ルール発動` });

    // Ceasefire proxy: if SOL > $120 sudden spike
    if (prices.SOL?.usd >= 120) alerts.push({ sym:'SOL', msg:`💥 SOL $${prices.SOL.usd.toFixed(2)}\n→ 急騰！停戦合意の可能性\n停戦弾฿20,000〜40,000を即投入検討` });

    // Send LINE notifications
    for (const alert of alerts) {
      await sendLINE(`【OKA QUEST ALERT】\n${alert.msg}`);
    }

    // Daily summary (only when called manually or at specific hours)
    const hour = new Date().getUTCHours() + 7; // Bangkok time
    if (req.query.summary === '1' || hour === 8) {
      const summary = `📊 OKA QUEST 朝のサマリー
━━━━━━━━━━━━━━
株式
NVDA: $${prices.NVDA?.toFixed(2) ?? '---'}
QQQ:  $${prices.QQQ?.toFixed(2) ?? '---'}
MSFT: $${prices.MSFT?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
クリプト
SOL:  $${prices.SOL?.usd?.toFixed(2) ?? '---'}
ETH:  $${prices.ETH?.usd?.toFixed(2) ?? '---'}
HYPE: $${prices.HYPE?.usd?.toFixed(2) ?? '---'}
XRP:  $${prices.XRP?.usd?.toFixed(2) ?? '---'}
FET:  ฿${prices.FET?.thb?.toFixed(2) ?? '---'}
━━━━━━━━━━━━━━
アラート: ${alerts.length}件
https://oka-portfolio.vercel.app`;
      await sendLINE(summary);
    }

    res.status(200).json({ prices, alerts: alerts.map(a=>a.sym), ok: true, checked_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message, ok: false });
  }
}
