# 赌场 Demo 一键部署（客户使用）

这份文档只保留客户需要做的事情。目标服务器需要已经部署好 **TapData Enterprise** 和 MongoDB，并且 Linux 主机有 `systemd`、`curl` 和外网访问。

Git 仓库已经带好匿名 MongoDB 演示数据、TapData 任务/API 模板、AI 面板和造数脚本。Node.js、npm 依赖和前端构建由运行命令自动完成；不需要 Docker，也不需要手动上传文件。

## 只执行这一条流程

```bash
git clone https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
bash run-demo.sh
```

`run-demo.sh` 会自动申请 sudo，然后依次完成：

1. 安装缺少的 Node.js 和 npm 依赖；
2. 构建 AI 面板；
3. 把 Git 里的 23 个匿名集合恢复到 `tapdata_casino_marketing`；
4. 复用 Enterprise 自带的 `MDM` 连接；
5. 导入任务和 23 个 API（目标中已有完全同名对象时自动跳过）；
6. 发布 API、启动 CDC 任务、启动造数脚本和 AI 面板。

MongoDB 服务端和 TapData Enterprise 不放在 Git 中，它们是同事服务器上已经准备好的外部服务；MongoDB 的演示数据已经随 Git 提供。

## 配置向导

如果 TapData、MongoDB 和 AI 面板都在当前服务器，普通配置可以一直按 Enter：

| 配置项 | 默认值 |
| --- | --- |
| TapData 管理端 | `http://127.0.0.1:3030` |
| TapData API Server | `http://127.0.0.1:3080` |
| 源数据库 | `tapdata_casino_marketing` |
| 面板状态库 | `marketing_demo` |
| AI 提供商 | `deepseek` |
| AI 模型 | `deepseek-chat` |
| 面板端口 | `3000` |
| TapData 目标连接 | Enterprise 已有的 `MDM` |

下面几项没有默认值，需要填写真实凭据：

- TapData 管理端 access token；
- 已发布 API 的 token，或 OAuth Client ID/Secret；
- MongoDB 认证 URI（MongoDB 开启账号密码时）；
- DeepSeek 或 OpenAI API Key。

密码和 Token 不会回显，只写入服务器上的 `.env.external`，权限为 `0600`。如果服务在其他主机，向导中把默认地址替换成实际地址即可；面板端口也可以在向导中改掉。

## 完成后

命令最后会输出访问地址，默认是：

```text
http://<面板服务器地址>:3000/
```

打开地址即可演示大盘、Customer 360、AI Chat 和场景工坊。造数脚本默认每 15 秒更新一个活跃客户，数据链路为：

```text
Source MongoDB → TapData CDC → Enterprise MDM → TapData API → AI 面板
```

如果源库已有数据，程序会停止并拒绝覆盖；如果只存在部分同名任务/API，也会停止提示处理，避免产生重复对象。正常情况下不需要再次执行任何导入、构建或启动命令。

需要暂停时执行：

```bash
sudo systemctl stop tapdata-casino-demo.service
```
