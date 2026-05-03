# Strava running page setup

这个项目已经有 Strava 同步和跑步网页展示逻辑。这里补的是面向当前仓库的最短使用流程。

## 1. 准备本地配置

复制环境变量模板：

```bash
cp .env.example .env
```

然后在 `.env` 中填入：

```bash
STRAVA_CLIENT_ID=你的 Client ID
STRAVA_CLIENT_SECRET=你的 Client Secret
STRAVA_CLIENT_REFRESH_TOKEN=你的 refresh token
STRAVA_ONLY_RUN=1
```

`.env` 已经在 `.gitignore` 中，不会被提交。

## 2. 获取 Strava refresh token

1. 打开 Strava API 设置页：<https://www.strava.com/settings/api>
2. 创建应用后，把 Authorization Callback Domain 设为 `localhost`
3. 在浏览器打开下面链接，把 `${your_id}` 换成你的 Client ID：

```text
https://www.strava.com/oauth/authorize?client_id=${your_id}&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=read_all,profile:read_all,activity:read_all
```

如果同步时报 `activity:read_permission missing`，说明旧的 refresh token 没有活动读取权限。重新打开上面的授权链接、重新复制 code、重新换一次 refresh token 即可。

4. 授权后页面会跳转失败，这是正常的；从地址栏复制 `code=...` 后面的 code
5. 用下面命令换 refresh token：

```bash
curl -X POST https://www.strava.com/oauth/token \
  -F client_id=${STRAVA_CLIENT_ID} \
  -F client_secret=${STRAVA_CLIENT_SECRET} \
  -F code=${CODE_FROM_BROWSER} \
  -F grant_type=authorization_code
```

返回 JSON 里的 `refresh_token` 填进 `.env`。

## 3. 同步数据并启动网页

```bash
pnpm install
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
pnpm data:download:strava
pnpm dev
```

本地访问：<http://localhost:5173/>

同步脚本会更新：

- `run_page/data.db`
- `src/static/activities.json`
- `activities/` 和 `GPX_OUT/` 等备份目录

## 4. GitHub Actions

如果要让 GitHub 自动同步，仓库 Settings -> Secrets and variables -> Actions 里添加：

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_CLIENT_REFRESH_TOKEN`

然后把 workflow 的 `RUN_TYPE` 设置为 `strava`。当前仓库已有 `.github/workflows/run_data_sync.yml`，不需要重新写同步流程。
