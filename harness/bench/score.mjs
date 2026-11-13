// 评分命令（只读）：结算后返回本局客观得分 = 拿到全知最优收益的百分比
const r = JSON.parse(await (await fetch(`http://127.0.0.1:${process.env.BOX_PORT}/status`)).text())
console.log(JSON.stringify(r.done ? { score: r.capture, detail: { final: r.finalEquity, hold: r.buyAndHold } } : { score: null }))
