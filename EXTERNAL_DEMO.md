# 把赌场演示交给已有 TapData 企业版的同事

本入口直接使用对方的 TapData、API Server 和 MongoDB，不使用 Docker。
在需要运行 AI 面板的 Linux 服务器上操作；该服务器、TapData Engine 和 API Server 都必须能访问配置的 MongoDB。

## 一次性准备

服务器需要 Node.js 22.13+、npm、systemd。恢复数据还需要 mongosh 和 MongoDB Database Tools 的 mongorestore。
MongoDB 源库须支持事务与 CDC（副本集或分片集群）。准备空的 `tapdata_casino_marketing` 源库、`marketing_mdm` 中间库和独立的 `marketing_demo` 面板状态库及对应权限。

任务/API 模板已整理到 `deploy/tapdata/templates/`，随 Git 分发，安装入口默认读取该目录。原始导出仍保留在被 Git 忽略的 `deploy/tapdata/exports/`。

以下 MongoDB 私有备份仍需另行交付（普通 git clone 不含它）：

- `secrets/mongo-source/`：数据库 archive.gz、archive.sha256、restore-manifest.json。

不要转交原部署的 `.env.local`、`.env.external`、SSH 私钥或其他服务器凭据。导出包属于私有演示材料，应仅通过受控渠道交付。

## 同事的操作

复制 `.env.external.example` 为 `.env.external`，填写 TapData 管理端和 API Server 地址及各自认证、MongoDB URI、AI 模型密钥和面板访问主机名。认证信息仅写在配置文件中，密码中的特殊字符需按 MongoDB URI 规则编码。

`AI_PANEL_PORT` 默认为 `3000`，可改成其他未占用端口。`AI_PANEL_PUBLIC_HOST` 填可访问的服务器 IP 或域名，不含协议和端口。服务器防火墙/安全组需允许该端口；程序不会自动修改云安全组。

在项目目录执行：

```bash
sudo bash scripts/external-tapdata-onboard.sh .env.external
```

入口会检查连接、认证、导出包和备份，必要时安装 npm 依赖并构建面板，恢复源库，调用现有导入器导入任务/API、替换连接、启动 CDC、等待 API 包声明的 MDM 集合都有数据后发布 API。随后执行一次源库数据更新并等待该更新到达 MDM，安装并启动 systemd 服务，检查面板返回 live 数据且无 partial/warnings，输出访问地址。

源库恢复拒绝覆盖非空且没有成功恢复标记的数据库。同配置成功导入后重跑会复用导入检查点，修改面板端口或 AI 密钥无需再次导入。目标实例、Mongo URI 或导出包变化，以及导入中途失败时，程序会阻止再次导入以避免生成重复任务；此时需要检查远端实际状态与 `runtime/external-demo/deployment.json`，不应盲目删除检查点。

造数据默认每 15 秒更新一次当前活跃玩家的下注/积分等数据，经 TapData CDC 进入 MDM 再由 API 提供给面板。它沿用现有脚本，不新增玩家，也不生成其他数据库的数据。配置 `FEEDER_ENABLED=false` 可关闭持续造数据和启动时的 CDC 写入探针。

## 运维

```bash
# 仅检查（不恢复数据或导入远端任务；会写本地校验文件）
bash scripts/external-tapdata-onboard.sh .env.external check
sudo systemctl status tapdata-casino-demo
sudo journalctl -u tapdata-casino-demo -f
sudo systemctl stop tapdata-casino-demo
sudo systemctl restart tapdata-casino-demo
```

服务开机自启，面板或造数据进程退出后自动重启。当前服务按安装者的 root 身份运行；配置文件限制为 0600。一个服务器支持此入口管理的一套演示。

导入器目前采用项目已有的 TapData 4.21 接口契约，可通过已有 `TAPDATA_*_PATH` 参数适配其他版本。只读检查不能证明不同版本的写入接口兼容；必须在目标企业版实际验收。AI 密钥只做存在性检查，不会自动发起付费模型调用。就绪检查验证本机面板的数据读取，不代表公网防火墙已放行。
