// 交易客户端。用法：
//   node market.mjs status          查看当天价格、资产、历史价格
//   node market.mjs buy <0~1>       用这个比例的现金买入（手续费 0.2%）
//   node market.mjs sell <0~1>      卖出这个比例的持仓
//   node market.mjs next [天数]     前进若干天（不能后退）
const PORT = '__PORT__'
const [cmd, a] = process.argv.slice(2)
if (!['status', 'buy', 'sell', 'next'].includes(cmd)) { console.log('用法: node market.mjs status | buy <0~1> | sell <0~1> | next [天数]'); process.exit(1) }
const r = await fetch(`http://127.0.0.1:${PORT}/${cmd}${a ? '?a=' + encodeURIComponent(a) : ''}`)
console.log(await r.text())
