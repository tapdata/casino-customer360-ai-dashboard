# Git 分发的 TapData 演示模板

这里是从已提供的企业版导出包生成的可交付副本：

- `tasks/`：1 个 CDC 任务、2 个连接和 48 个元数据记录，保留 23 个集合映射。
- `apis/`：23 个 API 模块及其连接/元数据记录。
- `manifest.json`：记录数和压缩文件 SHA-256。

清除了凭据字段、账号邮箱、原 MongoDB 地址、指定运行节点、同步位点与运行指标；连接使用 `demo.invalid` 占位地址。记录 ID 保留以维持包内关联，不表示目的实例的实际 ID。API 字段、路径、集合名和任务 DAG 保持原导出定义。

这些包不能作为已配置好的连接直接运行。使用 `.env.external` 配置目标 Source 和 MDM URI，再运行 `scripts/external-tapdata-onboard.sh`；现有导入器会导入后替换连接并启动任务。导入接口仍须在目标 TapData 版本验证。

更新原始导出后，在项目根目录运行：

```bash
node scripts/prepare-tapdata-templates.mjs
node --test tests/tapdata-templates.test.mjs
```

原始包留在被 Git 忽略的 `deploy/tapdata/exports/`，不应强制加入 Git。模板不包含 MongoDB 演示数据、AI 密钥、客户配置或 TapData 安装程序。
