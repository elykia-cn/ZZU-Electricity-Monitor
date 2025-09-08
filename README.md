# ZZU Electricity Monitor

## 项目简介

  这是一个宿舍电量监控系统，旨在定时监测并记录宿舍照明和空调设备的电量余额。本项目修改并整合 [TorCroft/ZZU-Electricity](https://github.com/TorCroft/ZZU-Electricity) 的监控逻辑，同时将原项目的 [ZZU-API](https://github.com/TorCroft/ZZU-API) 替换为更高效的 [ZZU.Py](https://github.com/Illustar0/ZZU.Py)，实现了宿舍电量余额的实时获取与监控。当电量低于用户设定的阈值时，系统会自动通过 **Server 酱** 、 **Telegram** 和 **邮件(新增)** 发送通知，提醒及时充值，避免晚上宿舍突然断电困扰。感谢 [@Illustar0](https://github.com/Illustar0) 和 [@SirTamago](https://github.com/SirTamago) 的帮助。本人也是 **门外汉** ，代码很简陋，欢迎提交 Issue 或 Pull Request。

## 部署教程

详细的部署过程可以参考筱荷同学的教程 [郑州大学宿舍电量监控部署方法](https://rimrose.top/TEC/Tutorial_for_ZZU_Dorm_Electricity_Balance/)。

  
### 核心功能

1. **实时电量监控**：通过 [ZZU.Py](https://github.com/Illustar0/ZZU.Py) 实时获取宿舍电量余额，监控照明和空调设备的用电情况。
2. **智能提醒**：当电量低于设定阈值时，自动通过 Server 酱，邮件 和 Telegram 发送通知，确保用户及时充值。
3. **历史记录**：记录每月电量使用数据，支持查看和分析历史用电情况，帮助用户更好地管理电量。
4. **多平台通知**：支持 Server 酱、 Telegram 和 邮件 3种通知方式，满足不同用户的需求。
5. **数据版本控制**：电量数据会自动保存到新的 Git 分支中，以便查看历史记录并进行版本控制。

### 技术亮点

- 基于 [ZZU.Py](https://github.com/Illustar0/ZZU.Py) 实现高效、稳定的电量数据获取。
- 结合 [ZZU-Electricity](https://github.com/TorCroft/ZZU-Electricity) 的监控逻辑，实现电量余额的实时监控与提醒。
- 支持Server 酱和 Telegram 等多平台通知，确保用户不会错过重要提醒。
- 电量数据会根据设定的定时任务自动生成更新，并提交到新的 Git 分支。

## 功能

- 每隔一段时间获取宿舍照明和空调的电量余额。
- 自动判断电量状态，并根据设定的阈值（默认为10.0）发送警告通知。
- 通过 Server 酱，邮件 和 Telegram 通知宿舍住户电量状态。
- 提供一个简单的前端页面，显示电量数据和图表。

## 技术栈

- **Python**：主要用于数据采集、处理和发送通知。
- **ZZUPy**：郑州大学移动校园的 Python API 封装。
- **Telegram Bot API**：通过 Telegram 发送通知。
- **Server 酱**：通过 Server 酱发送通知。
- **邮箱**：测试QQ邮箱能用，其他自行测试。
- **ECharts**：用于前端展示电量数据图表。
- **Tenacity**：用于实现自动重试机制
- **GitHub Actions**：用于自动化构建和部署，自动检查更新并部署到 GitHub Pages。

## 配置

1. **Repository Secrets**：需要在GitHub Secrets中添加以下变量：

| 环境变量            | 描述                              |
|---------------------|-----------------------------------|
| `ACCOUNT`           | 郑州大学移动校园登录账户           |
| `PASSWORD`          | 郑州大学移动校园登录密码           |
| `lt_room`           | 照明电量账户                      |
| `ac_room`           | 空调电量账户                      |
| `TELEGRAM_BOT_TOKEN`| Telegram Bot Token                |
| `TELEGRAM_CHAT_ID`  | Telegram Chat ID                  |
| `SERVERCHAN_KEY`    | Server 酱 API 密钥                |
| `SERVERCHAN_KEY2`   | 多个Server 酱 API 密钥            |
| `SERVERCHAN_KEY3`   | 多个Server 酱 API 密钥            |
| `EMAIL`             | 发送邮件和接收邮件                |
| `SMTP_CODE`         | 邮箱 SMTP 的 授权码               |
| `SMTP_SERVER`       | 邮箱的 SMTP 服务器地址            |


2. **创建数据存储文件夹**：该项目会将数据保存在 `./page/data` 文件夹下，请确保该文件夹存在。

## 自动化工作流

该项目使用 GitHub Actions 进行自动化管理。工作流触发时会：

- **定时触发**：工作流通过 `cron` 表达式每天 0 点开始每隔 3 小时执行。
- **手动触发**：也可以通过 GitHub 界面手动触发工作流执行。

### 工作流步骤

1. **Checkout**：拉取项目代码，确保获取最新的提交记录，深度为 2，以便能够查看历史提交。
2. **设置 Python 环境**：使用 `actions/setup-python@v5` 配置 Python 3.12 环境，确保运行 Python 脚本所需的环境准备好。
3. **安装依赖**：通过 `pip` 安装项目所需的 Python 依赖，确保 `requirements.txt` 中列出的所有依赖都被安装。
4. **克隆页面分支**：从 GitHub 仓库克隆最新的 `page` 分支，并将 `data` 文件夹的内容复制到目标目录，确保页面数据更新。
5. **运行 Python 脚本**：执行 `index.py` 和 `markdown.py` 脚本，处理项目中的数据并生成更新内容，同时将脚本的输出添加到 GitHub Actions 的步骤摘要中。
6. **Git 配置**：配置 Git 用户名和邮箱，确保提交使用正确的身份。
7. **提交更改**：如果有更新，创建新的分支并提交更改，推送到 GitHub 仓库的 `page` 分支，提交信息包含当前的时间戳，标明这是定时更新。
8. **设置 GitHub Pages**：配置 GitHub Pages 环境，准备将更新的页面文件上传到 GitHub Pages 上。
9. **上传构建的页面**：将生成的页面文件（如 `index.html`、`style.css`、`data` 等）上传，以便在 GitHub Pages 上部署。
10. **删除旧的工作流运行**：使用 `Mattraks/delete-workflow-runs@v2` 清理 30 天前的工作流记录，确保保持工作流历史的整洁，同时保留至少 6 次的工作流运行记录。
11. **部署到 GitHub Pages**：在 `deploy` 阶段，使用 `actions/deploy-pages@v4` 将更新后的页面文件部署到 GitHub Pages 上，确保页面展示的是最新的内容。
12. **保持活跃工作流**：使用 `gautamkrishnar/keepalive-workflow@v2` 插件，确保即使没有实际变动，工作流也会保持活跃，避免由于长时间未执行而导致工作流被停止。

## 示例通知

- **电量充足**：  
  🏠宿舍电量通报🏠  
  💡 照明剩余电量：25.0 度（充足）  
  ❄️ 空调剩余电量：50.0 度（充足）

- **电量不足**：  
  ⚠️宿舍电量预警⚠️  
  💡 照明剩余电量：4.5 度（⚠️警告）  
  ❄️ 空调剩余电量：3.0 度（⚠️警告）  
  ⚠️ 电量不足，请尽快充电！

## 常见问题

### 1. 登录失败怎么办？

请确保您提供的账号和密码正确，并且 `ZZUPy` 的 API 接口正常工作。如果仍然无法登录，请检查网络连接或参考 [`ZZUPy` 的文档](https://illustar0.github.io/ZZU.Py/))。

### 2. Telegram 通知无法发送？

请确保您设置了正确的 Telegram Bot Token 和 Chat ID，并且 Telegram Bot 有权向该 Chat ID 发送消息。

### 3. Server 酱 通知无法发送？

因 Server 酱 每日发送数量的限制较为严格，仅为5条/天，故设置为只有 **电量不足** 预警时才会发送消息，Telegram Bot 无此限制，每次运行 GitHub Actions 都会发送电量消息。

### 4. 数据没有更新？

请确保程序能正常读取 `./page/data` 文件夹中的 JSON 文件。如果该文件夹没有数据，请先运行程序获取初始数据。

## 贡献

如果您有任何想法、问题或建议，欢迎提交 Issue 或 Pull Request。我们欢迎社区的贡献。

## 许可证

本项目使用 [MIT 许可证](LICENSE)。

