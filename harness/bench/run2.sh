#!/bin/bash
# 第二轮实验。用法：GROUP=exp|ctl SEQ=A|B run2.sh
#   exp = 装策略插件；ctl = 不装。两组都在同一个工作区里连跑 6 局，任务描述一字不差。
# 防作弊同前：市场在 /root/box，参数走标准输入，只给当天及以前价格，分数由服务端算，环境变量最小化。
D=/opt/dsh; B=$D/bench; BOX=/root/box
G=${GROUP:?}; S=${SEQ:?}; L=/opt/lab2/$G-$S; KEY=$(cat /root/itp-secret/key)
case $G in exp) HOME_DIR=$D/home; PATCH="";; ctl) HOME_DIR=$D/home-ctl; PATCH="--patch $B/no-itp.yml";; esac
case $S in
 A) PARAMS=('{"seed":11,"trend":0.004,"amp":9,"period":12,"phase":0.3,"noise":1.5}' '{"seed":23,"trend":-0.004,"amp":10,"period":16,"phase":2.0,"noise":1.5}' '{"seed":37,"trend":0.001,"amp":12,"period":10,"phase":4.1,"noise":2.0}' '{"seed":41,"trend":0.006,"amp":6,"period":18,"phase":1.2,"noise":1.2}' '{"seed":53,"trend":-0.002,"amp":14,"period":13,"phase":5.0,"noise":2.0}' '{"seed":67,"trend":0.002,"amp":11,"period":15,"phase":0.8,"noise":1.8}');;
 B) PARAMS=('{"seed":71,"trend":0.003,"amp":8,"period":11,"phase":2.5,"noise":1.6}' '{"seed":83,"trend":-0.003,"amp":12,"period":14,"phase":0.5,"noise":1.8}' '{"seed":97,"trend":0.007,"amp":5,"period":20,"phase":3.3,"noise":1.0}' '{"seed":101,"trend":0.000,"amp":13,"period":9,"phase":1.7,"noise":2.2}' '{"seed":113,"trend":-0.005,"amp":9,"period":17,"phase":4.4,"noise":1.4}' '{"seed":127,"trend":0.002,"amp":15,"period":12,"phase":0.1,"noise":2.5}');;
esac
BASEPORT=4300; [ $G = ctl ] && BASEPORT=$((BASEPORT+100)); [ $S = B ] && BASEPORT=$((BASEPORT+200))
rm -rf $L $BOX/s2-$G-$S-*; mkdir -p $L/ep $L/ws; cp /opt/lab/ca.crt $L/
[ $G = exp ] && cp $B/itp.seed.json $L/itp.json
chown -R agent:agent $L
TASK='请为这件事创建一个 goal 并一直做到完成：当前目录有一个模拟股市，只有一只股票，交易 80 天，起始资金 10000。用 `node market.mjs status` 查看当天价格、资产和历史价格；`node market.mjs buy <0~1>` 用该比例的现金买入；`node market.mjs sell <0~1>` 卖出该比例的持仓；`node market.mjs next [天数]` 前进若干天（不能后退）。每笔交易手续费 0.2%，到最后一天自动清仓结算。完成标准：走完 80 天。目标：最终资产越高越好。只能通过 market.mjs 和市场交互，不要尝试寻找或读取市场的实现；当前目录里的其他文件你可以随意使用。结算后把 goal 标为完成，并汇报最终资产。'
for ((i=0; i<6; i++)); do
  n=$((i+1)); port=$((BASEPORT+n)); ST=$BOX/s2-$G-$S-$n.json
  sed "s/__PORT__/$port/" $B/market.mjs > $L/ws/market.mjs && chown agent:agent $L/ws/market.mjs
  echo "${PARAMS[$i]}" | node $BOX/market.mjs $port $ST & SP=$!
  sleep 1; echo "=== $G-$S 第 $n 局 开始 $(date +%T)"
  ( cd $L/ws && timeout 1800 runuser -u agent -- env -i HOME=/home/agent PATH=$D/node_modules/.bin:/usr/bin:/bin \
      HTTPS_PROXY="$HTTPS_PROXY" https_proxy="$https_proxy" NO_PROXY="$NO_PROXY" no_proxy="$no_proxy" \
      NODE_EXTRA_CA_CERTS=$L/ca.crt SSL_CERT_FILE=$L/ca.crt NODE_OPTIONS=--use-openssl-ca \
      DSH_HOME=$HOME_DIR DEEPSEEK_API_KEY="$KEY" ITP_FILE=$L/itp.json ITP_EPISODE=$n \
      BOX_PORT=$port ITP_SCORE_CMD="node $B/score.mjs" \
      node $D/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless $PATCH "$TASK" > $L/ep/log-$n.txt 2>&1 )
  RC=$?; node -e "fetch('http://127.0.0.1:$port/next?a=999').then(()=>{})"; sleep 1
  R=$(node -e "const s=require('$ST');console.log(JSON.stringify({final:s.final,hold:s.hold,oracle:s.oracle,capture:s.capture,trades:s.trades}))")
  echo "    $G-$S 第 $n 局 退出码 $RC 结果 $R"
  kill $SP; wait $SP 2>/dev/null
  if [ $G = exp ]; then   # 可信的外部评测补记分数（插件已记过则同值），并存账本快照
    node -e "const fs=require('fs'),f='$L/itp.json',d=JSON.parse(fs.readFileSync(f)),s=require('$ST');d.logs.push({type:'score',episode:'$n',at:Date.now(),score:s.capture,source:'runner'});fs.writeFileSync(f,JSON.stringify(d,null,2))"
    cp $L/itp.json $BOX/s2-$G-$S-ledger-$n.json
  fi
  cp -r $L/ws $BOX/s2-$G-$S-ws-$n
done
echo "=== $G-$S 全部结束 $(date +%T)"
