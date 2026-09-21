# 把赌场演示交给已有 TapData 企业版的同事

本入口直接使用对方的 TapData、API Server 和 MongoDB，不使用 Docker。
在需要运行 AI 面板的 Linux 服务器上操作；该服务器、TapData Engine 和 API Server 都必须能访问配置的 MongoDB。

同事实际使用时只需要看 [客户一键部署说明](CUSTOMER_QUICKSTART.md)。如果要在云服务器上做逐项验收，再按 [云上同事 Demo 手动全流程验收](artifacts/云上同事Demo手动全流程验收.md) 执行；已有任务/API 的服务器请使用其中的“安全回归”分支，避免重复导入。

## 一次性准备

服务器需要 Linux、systemd、curl 和能访问外网的 HTTPS；安装脚本会在缺少 Node.js 22.13+ 时下载并校验 Node.js，并通过 Node.js 驱动恢复 Git 中的演示数据，不需要安装 MongoDB 服务端、mongosh 或 mongorestore。
MongoDB 源库须支持事务与 CDC（副本集或分片集群）。准备空的 `tapdata_casino_marketing` 源库和独立的 `marketing_demo` 面板状态库及对应权限。MDM 由 TapData Enterprise 自带，使用已有的 `MDM` 连接，不在这一步创建或填写 MDM MongoDB URI。

任务/API 模板已整理到 `deploy/tapdata/templates/`，匿名化后的 23 个 MongoDB 集合位于 `seed/demo/`，都随 Git 分发。原始导出和原始数据库备份仍保留在被 Git 忽略的目录中，不参与交付。

不要转交原部署的 `.env.local`、`.env.external`、SSH 私钥或其他服务器凭据。安装时只在同事服务器上的私有 `.env.external` 保存新环境的凭据。

## 同事的操作

同事可以直接让安装器引导填写配置；也可以先复制 `.env.external.example` 为 `.env.external` 手动填写。向导已经预填常用默认值，直接按 Enter 即可确认：TapData 管理端/API Server 默认 `127.0.0.1:3030/3080`，MongoDB 默认本机 `27017` 的副本集，源库名固定为 `tapdata_casino_marketing`，面板状态库名固定为 `marketing_demo`，面板端口默认 `3000`，AI 默认 DeepSeek。Token、OAuth Secret、MongoDB 账号密码和 AI Key 不提供默认值，仍需输入。

如果 TapData 或 MongoDB 在另一台服务器，可以在执行前设置默认主机，之后仍然按 Enter：

```bash
sudo env DEMO_TAPDATA_HOST=tapdata.example.internal \
  DEMO_MONGO_HOST=mongo.example.internal \
  DEMO_PUBLIC_HOST=demo.example.internal \
  bash scripts/install-external.sh
```

认证信息仅写在服务器上的配置文件中，密码中的特殊字符需按 MongoDB URI 规则编码。

`AI_PANEL_PORT` 默认为 `3000`，可改成其他未占用端口。`AI_PANEL_PUBLIC_HOST` 填可访问的服务器 IP 或域名，不含协议和端口。服务器防火墙/安全组需允许该端口；程序不会自动修改云安全组。

从 Git 克隆项目后，在项目目录执行这一条命令：

```bash
sudo bash scripts/install-external.sh
```

首次运行会提示填写 TapData 管理端、API Server、源 MongoDB、面板状态库、AI 密钥和面板端口（默认 3000），然后检查连接、认证和模板，恢复匿名演示源库，复用 TapData 已有的 `MDM` 连接，导入任务/API 并启动 CDC。随后通过已发布 API 检查源库更新已到达 MDM，安装并启动 systemd 服务，检查面板返回 live 数据且无 partial/warnings，输出访问地址。

源库恢复拒绝覆盖非空且没有成功恢复标记的数据库。同配置成功导入后重跑会复用导入检查点，修改面板端口或 AI 密钥无需再次导入。目标实例、Mongo URI 或导出包变化，以及导入中途失败时，程序会阻止再次导入以避免生成重复任务；此时需要检查远端实际状态与 `runtime/external-demo/deployment.json`，不应盲目删除检查点。

造数据默认每 15 秒更新一次当前活跃玩家的下注/积分等数据，经 TapData CDC 进入 MDM 再由 API 提供给面板。它沿用现有脚本，不新增玩家，也不生成其他数据库的数据。配置 `FEEDER_ENABLED=false` 可关闭持续造数据和启动时的 CDC 写入探针。

## 运维

```bash
# 仅检查（不恢复数据或导入远端任务）
bash scripts/external-tapdata-onboard.sh .env.external check
sudo systemctl status tapdata-casino-demo
sudo journalctl -u tapdata-casino-demo -f
sudo systemctl stop tapdata-casino-demo
sudo systemctl restart tapdata-casino-demo
```

服务开机自启，面板或造数据进程退出后自动重启。当前服务按安装者的 root 身份运行；配置文件限制为 0600。一个服务器支持此入口管理的一套演示。

导入器目前采用项目已有的 TapData 4.21 接口契约，可通过已有 `TAPDATA_*_PATH` 参数适配其他版本。只读检查不能证明不同版本的写入接口兼容；必须在目标企业版实际验收。AI 密钥只做存在性检查，不会自动发起付费模型调用。就绪检查验证本机面板的数据读取，不代表公网防火墙已放行。匿名种子只用于演示，安装器拒绝覆盖非空源库；源库支持副本集或分片集群是 CDC 前提。
