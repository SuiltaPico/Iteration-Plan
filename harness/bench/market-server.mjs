// 模拟股市（黑盒）：价格由预设公式生成。参数从标准输入读入，模型无法看到。
// 只暴露 status / buy / sell / next。80 天后自动清仓结算。
import http from 'node:http'; import { writeFileSync } from 'node:fs'
const [port, statsFile] = process.argv.slice(2)
const P = JSON.parse(await new Promise((r) => { let b = ''; process.stdin.on('data', (c) => (b += c)); process.stdin.on('end', () => r(b)) }))
const DAYS = 80, FEE = 0.002, START = 10000
let s = P.seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const price = Array.from({ length: DAYS }, (_, t) => +(100 * Math.exp(P.trend * t) + P.amp * Math.sin(2 * Math.PI * t / P.period + P.phase) + P.noise * gauss()).toFixed(2))
// 参照：买入持有、全知最优（动态规划，含手续费）
const hold = START * (1 - FEE) / price[0] * price[DAYS - 1] * (1 - FEE)
let cash = START, stock = -Infinity
for (const p of price) { const c2 = Math.max(cash, stock * p * (1 - FEE)); const s2 = Math.max(stock, cash * (1 - FEE) / p); cash = c2; stock = s2 }
const oracle = cash
const st = { params: P, day: 0, cash: START, shares: 0, trades: 0, calls: 0, done: false, final: null, hold: +hold.toFixed(2), oracle: +oracle.toFixed(2), capture: null }
const equity = () => st.cash + st.shares * price[st.day]
const finish = () => { st.cash += st.shares * price[DAYS - 1] * (1 - FEE); st.shares = 0; st.day = DAYS - 1; st.done = true; st.final = +st.cash.toFixed(2); st.capture = +((st.final - START) / (oracle - START) * 100).toFixed(1) }
const dump = () => writeFileSync(statsFile, JSON.stringify(st)); dump()
const view = (msg) => JSON.stringify({ msg, day: st.day + 1, of: DAYS, price: price[st.day], cash: +st.cash.toFixed(2), shares: +st.shares.toFixed(4), equity: +equity().toFixed(2),
  history: price.slice(0, st.day + 1), done: st.done, ...(st.done ? { finalEquity: st.final, buyAndHold: st.hold, capture: st.capture } : {}) })
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const a = Number(u.searchParams.get('a') ?? 1); st.calls++
  let msg = ''
  if (st.done && u.pathname !== '/status') msg = '交易已结束'
  else if (u.pathname === '/buy') { const f = Math.min(Math.max(a, 0), 1); const c = st.cash * f; if (c > 0) { st.shares += c * (1 - FEE) / price[st.day]; st.cash -= c; st.trades++ } msg = `用 ${(f * 100).toFixed(0)}% 现金买入` }
  else if (u.pathname === '/sell') { const f = Math.min(Math.max(a, 0), 1); const q = st.shares * f; if (q > 0) { st.cash += q * price[st.day] * (1 - FEE); st.shares -= q; st.trades++ } msg = `卖出 ${(f * 100).toFixed(0)}% 持仓` }
  else if (u.pathname === '/next') { const k = Math.max(1, Math.floor(a)); st.day = Math.min(st.day + k, DAYS - 1); msg = `前进 ${k} 天`; if (st.day === DAYS - 1) { finish(); msg += '，已到最后一天，自动清仓结算' } }
  dump(); res.end(view(msg))
}).listen(+port, '127.0.0.1')
