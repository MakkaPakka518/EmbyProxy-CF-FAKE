#!/usr/bin/env bash
# 一键部署 / 更新 Worker（纯 API，不需要 wrangler）
#
# 用法：
#   export CF_API_TOKEN=...        # Cloudflare API Token，权限：Workers Scripts:Edit、D1:Edit
#   export CF_ACCOUNT_ID=...       # 账户 ID
#   export D1_ID=...               # D1 数据库 ID
#   export WORKER_NAME=myemby      # 想用的 Worker 名字
#   export ADMIN_TOKEN=...         # 面板管理员密码（自己定，别用弱密码）
#   sh deploy.sh ./worker.js
#
# 可选：
#   CF_ZONE_ID / CF_DOMAIN         # 绑了自定义域才需要，纯面板用 workers.dev 可不管
#   CF_API_TOKEN_FOR_PANEL         # 面板里「清理缓存/更新脚本」用的 token，一般填同一个
set -eu

API=https://api.cloudflare.com/client/v4
SCRIPT="${1:-./worker.js}"
: "${CF_API_TOKEN:?需要 CF_API_TOKEN}"; : "${CF_ACCOUNT_ID:?需要 CF_ACCOUNT_ID}"
: "${D1_ID:?需要 D1_ID}"; : "${WORKER_NAME:?需要 WORKER_NAME}"; : "${ADMIN_TOKEN:?需要 ADMIN_TOKEN}"

AUTH="Authorization: Bearer $CF_API_TOKEN"
url="$API/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME"

# ── 1. 是不是第一次部署？决定要不要带 migrations ──────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$url")
if [ "$code" = "200" ]; then first=no; else first=yes; fi
if [ "$first" = "yes" ]; then mode="首次部署"; else mode="更新"; fi
echo "== Worker: $WORKER_NAME  ($mode)"

# ── 2. 生成 metadata ────────────────────────────────────────────────────────
meta=$(jq -n \
  --arg d1 "$D1_ID" --arg acc "$CF_ACCOUNT_ID" --arg name "$WORKER_NAME" \
  --arg zone "${CF_ZONE_ID:-}" --arg dom "${CF_DOMAIN:-}" '
  {
    main_module: "worker.js",
    compatibility_date: "2024-09-23",
    compatibility_flags: ["nodejs_compat"],
    bindings: ([
      {type:"plain_text", name:"CF_ACCOUNT_ID", text:$acc},
      {type:"plain_text", name:"CF_WORKER_NAME", text:$name},
      {type:"d1", name:"DB", id:$d1},
      {type:"durable_object_namespace", name:"KEEPALIVE_DO", class_name:"KeepAliveDO"}
    ] + (if $zone != "" then [{type:"plain_text", name:"CF_ZONE_ID", text:$zone}] else [] end)
      + (if $dom  != "" then [{type:"plain_text", name:"CF_DOMAIN",  text:$dom }] else [] end))
  }')
# 首次部署必须带 migration：它在账户里创建 DO 命名空间（免费版只能用 new_sqlite_classes）
if [ $first = yes ]; then
  meta=$(printf '%s' "$meta" | jq '. + {migrations:{new_sqlite_classes:["KeepAliveDO"]}}')
fi

upload() {  # $1 = metadata json
  printf '%s' "$1" > /tmp/_cf_meta.json
  curl -s -X PUT -H "$AUTH" "$url" \
    -F 'metadata=@/tmp/_cf_meta.json;type=application/json' \
    -F "worker.js=@$SCRIPT;type=application/javascript+module"
}

res=$(upload "$meta")
if [ "$(printf '%s' "$res" | jq -r .success)" != "true" ]; then
  msg=$(printf '%s' "$res" | jq -r '[.errors[]?.message]|join(" | ")')
  echo "!! 上传失败: $msg"
  # 常见坑：已经迁移过的账号重复带 migrations -> tag 冲突；自动去掉重试一次
  if printf '%s' "$msg" | grep -qi 'migration'; then
    echo "   -> 去掉 migrations 重试"
    res=$(upload "$(printf '%s' "$meta" | jq 'del(.migrations)')")
    [ "$(printf '%s' "$res" | jq -r .success)" = "true" ] || { printf '%s' "$res" | jq .errors; exit 1; }
  else
    printf '%s' "$res" | jq .errors; exit 1
  fi
fi
echo "  上传成功"

# ── 3. 密钥（不能写在 metadata 里，走 /secrets）────────────────────────────
put_secret() {
  jq -nc --arg n "$1" --arg v "$2" '{name:$n,type:"secret_text",text:$v}' > /tmp/_cf_sec.json
  curl -s -X PUT -H "$AUTH" "$url/secrets" --data @/tmp/_cf_sec.json | jq -c '{ok:.success,err:[.errors[]?.message]}'
  rm -f /tmp/_cf_sec.json
}
echo -n "  ADMIN_TOKEN: "; put_secret ADMIN_TOKEN "$ADMIN_TOKEN"
if [ -n "${CF_API_TOKEN_FOR_PANEL:-}" ]; then
  echo -n "  CF_API_TOKEN: "; put_secret CF_API_TOKEN "$CF_API_TOKEN_FOR_PANEL"
fi

# ── 4. cron（每小时巡检：保活 + 签到看门狗）────────────────────────────────
echo -n "  cron: "
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' "$url/schedules" \
  --data '[{"cron":"0 * * * *"}]' | jq -c '{ok:.success,err:[.errors[]?.message]}'

# ── 5. 打开 workers.dev 访问 ────────────────────────────────────────────────
echo -n "  workers.dev: "
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' "$url/subdomain" \
  --data '{"enabled":true,"previews_enabled":false}' | jq -c '{ok:.success,err:[.errors[]?.message]}'

sub=$(curl -s -H "$AUTH" "$API/accounts/$CF_ACCOUNT_ID/workers/subdomain" | jq -r .result.subdomain)
echo
echo "== 完成：https://$WORKER_NAME.$sub.workers.dev"
echo "   面板密码就是 ADMIN_TOKEN。第一次打开会自动建表，无需手动执行 SQL。"
echo "   要绑自定义域：Cloudflare 面板 -> 该 Worker -> Settings -> Domains & Routes -> Add -> Custom domain"
