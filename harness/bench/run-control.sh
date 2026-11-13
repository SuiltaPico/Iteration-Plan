#!/bin/bash
# 对照组：不装策略插件，6 局共用同一个工作区，什么都不提醒。
# 原注释：连跑多局模拟炒股，共用一个策略账本。由 root 运行；模型以普通用户 agent 运行。
# 防作弊：市场在 /root/box（agent 读不到），参数走标准输入，统计只有市场服务能写，
#         只暴露当天及以前的价格，环境变量只传必要几项（不带任何 token），账本快照另存。
D=/opt/dsh; B=$D/bench; L=/opt/lab-control; BOX=/root/box
KEY=$(cat /root/itp-secret/key)
N=${N:-6}
mkdir -p $L && cp /opt/lab/ca.crt $L/ && rm -rf $L/ep $L/ws $BOX/c-stats-*.json $BOX/c-ws-after-*; mkdir -p $L/ep $L/ws; chown -R agent:agent $L
PARAMS=(
 '{"seed":11,"trend":0.004,"amp":9,"period":12,"phase":0.3,"noise":1.5}'
 '{"seed":23,"trend":-0.004,"amp":10,"period":16,"phase":2.0,"noise":1.5}'
 '{"seed":37,"trend":0.001,"amp":12,"period":10,"phase":4.1,"noise":2.0}'
 '{"seed":41,"trend":0.006,"amp":6,"period":18,"phase":1.2,"noise":1.2}'
 '{"seed":53,"trend":-0.002,"amp":14,"period":13,"phase":5.0,"noise":2.0}'
 '{"seed":67,"trend":0.002,"amp":11,"period":15,"phase":0.8,"noise":1.8}'
)
TASK='请为这件事创建一个 goal 并一直做到完成：当前目录有一个模拟股市，只有一只股票，交易 80 天，起始资金 10000。用 `node market.mjs status` 查看当天价格、资产和历史价格；`node market.mjs buy <0~1>` 用该比例的现金买入；`node market.mjs sell <0~1>` 卖出该比例的持仓；`node market.mjs next [天数]` 前进若干天（不能后退）。每笔交易手续费 0.2%，到最后一天自动清仓结算。完成标准：走完 80 天。目标：最终资产越高越好。只能通过 market.mjs 和市场交互，不要尝试读取或寻找它的实现。结算后把 goal 标为完成，并汇报最终资产。'
for ((i=0; i<N; i++)); do
  n=$((i+1)); port=$((4200+n)); ws=$L/ws
  mkdir -p $ws && sed "s/__PORT__/$port/" $B/market.mjs > $ws/market.mjs && chown -R agent:agent $ws
  echo "${PARAMS[$i]}" | node $BOX/market.mjs $port $BOX/c-stats-$n.json & SP=$!
  sleep 1; echo "=== 第 $n 局 开始 $(date +%T)"
  ( cd $ws && timeout 1800 runuser -u agent -- env -i HOME=/home/agent PATH=$D/node_modules/.bin:/usr/bin:/bin \
      HTTPS_PROXY="$HTTPS_PROXY" https_proxy="$https_proxy" NO_PROXY="$NO_PROXY" no_proxy="$no_proxy" \
      NODE_EXTRA_CA_CERTS=$L/ca.crt SSL_CERT_FILE=$L/ca.crt NODE_OPTIONS=--use-openssl-ca \
      DSH_HOME=$D/home DEEPSEEK_API_KEY="$KEY" \
      node $D/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless --patch $B/no-itp.yml "$TASK" > $L/ep/log-$n.txt 2>&1 )
  RC=$?; node -e "fetch('http://127.0.0.1:$port/next?a=999').then(()=>{})" ; sleep 1  # 没走完的局：按当时持仓直接结算
  echo "    退出码 $RC  结果 $(node -e "const s=require('$BOX/c-stats-$n.json');console.log(JSON.stringify({final:s.final,hold:s.hold,oracle:s.oracle,capture:s.capture,trades:s.trades,done:s.done}))")"
  kill $SP; wait $SP 2>/dev/null
  cp -r $L/ws $BOX/c-ws-after-$n   # 每局结束后工作区快照
done
echo "=== 全部结束 $(date +%T)"
