# 从 GitHub 导入 Skill

后台「技能管理 → 导入 Skill」现在支持粘贴 GitHub 地址，点击「读取 GitHub」。

支持：

- 公开仓库首页：`https://github.com/owner/repo`（默认分支）。
- 分支或技能子目录：`https://github.com/owner/repo/tree/main/skills/review`。
- 主文件页面：`https://github.com/owner/repo/blob/main/skills/review/SKILL.md`。
- 主文件 Raw 地址：`https://raw.githubusercontent.com/owner/repo/main/skills/review/SKILL.md`。
- 分支、标签、提交 SHA；分支名称包含 `/` 时会解析最长有效引用。

读取会固定到具体提交版本，界面提供提交编号及来源链接。文件页面地址会读取该 Skill 所在目录，连同参考资料一起导入；子目录不会混入邻近技能。仓库内有多个 Skill 时分别预览，沿用已有批量导入规则。

读取完成后复用原有导入流程：标准格式校验 → AI/人工运行配置 → 最终校验 → 导入。读取 GitHub 本身不调用模型；单 Skill 校验通过后会沿用现有 AI 智能配置逻辑，按配置模型收费。技能默认下架、对外开放默认关闭，需要管理员审核后开启。

## 规范和限制

- 必须包含大小写准确的 `SKILL.md`、合法 YAML 中的 `name` / `description` 和正文；真实技能子目录名须匹配 `name`。GitHub 生成的 ZIP 包装目录不作为技能目录校验。
- 只导入 UTF-8 `.md` / `.txt`，不执行仓库脚本，不跟随符号链接，不读取子模块外部仓库。
- 与 ZIP 导入一致：下载最大 16 MiB；选定范围最多 512 项、50 个 Skill，展开最多 64 MiB；主文件最多 1 MiB、单个参考文件最多 2 MiB、文本合计 8 MiB。
- 当前下载整个仓库的指定版本后筛选目录；仓库超过 16 MiB 时请将所需 Skill 单独打成 ZIP 后导入。即便选择子目录，压缩下载上限仍按整个仓库计算。
- 只支持公开 GitHub 仓库，不收集个人 GitHub Token；私有仓库请自行下载 ZIP 导入。
- GitHub 匿名接口限额耗尽、网络不可达、空仓库或分支不存在时会明确提示；可改用本地目录/ZIP 导入。
- 服务端请求总时限 60 秒、并发最多 4 个，接口增加频率限制；关闭弹窗会取消浏览器请求。

服务端固定访问 GitHub API / codeload，并复用公网 DNS/IP 校验和重定向白名单。不会将主站 JWT、用户 API Key 或供应商密钥发送给 GitHub；获取文件使用的是 GitHub HTTP API，不在服务器执行 `git clone` 或包内指令。

后续仓库更新不会自动覆盖已发布版本。需要重新读取、审核并导入新版本。

参考：[GitHub 提交 API](https://docs.github.com/en/rest/commits/commits#get-a-commit)、[GitHub 源码归档](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)。
