# 家里电脑接入开发环境

> 这份文档写给你回家后用家里那台电脑读。读完照做，就能继续在家修改 music-station 代码、推到 GitHub、部署到 VM。
>
> VM 地址：办公室 LAN 是 `192.168.1.16`，但家里到不了那个 IP——**家里要走 Tailscale**，把 VM 当成一台名叫 `debian` 的"虚拟近邻"。

---

## 0. 前置情况

- VM 是一台 Debian 服务器，跑着 `music-station` 服务（systemd 管理）
- 代码在 GitHub：<https://github.com/showbox88/Music-Station>
- 部署脚本在 VM 上：`/opt/music-station/deploy.sh`
- 你的开发循环：**改本地代码 → git push → SSH 触发 VM 跑 deploy.sh → 服务自动重启**

家里电脑只要做完下面 5 步，就跟在办公室一样能干活。

---

## 1. 安装基础工具

需要装：

| 工具 | 作用 | 下载 |
|---|---|---|
| **Git** | 拉/推代码 | <https://git-scm.com/download> |
| **Node.js 22 LTS** | 本地能跑 `npm run build` 验证 | <https://nodejs.org/>（选 22.x LTS） |
| **Tailscale** | 让家里电脑能连到公司的 VM | <https://tailscale.com/download> |
| **VS Code**（可选） | 编辑代码 | <https://code.visualstudio.com/> |
| **Claude Code**（可选） | AI 助手命令行 | 你已经熟） |

Windows 用户：上面装完后 PowerShell / Git Bash 都能用。Mac/Linux 同理。

---

## 2. 接入 Tailscale

1. 打开装好的 **Tailscale 客户端**
2. 点 "Log in"，**用现有账号登录**（就是 VM 当初注册用的那个 Tailscale 账号）
3. 登录后，托盘 / 菜单栏的 Tailscale 图标显示绿色就 OK 了

> **怎么知道接入成功了？** 打开命令行：
>
> ```bash
> ping debian
> ```
>
> 能 ping 通（或至少 DNS 解析到 `100.85.13.26`），就说明接通了。
>
> Windows 如果 ping 不通但 `ssh` 能连得上也算成功（Windows 默认 ICMP 可能被防火墙拦了）。

---

## 3. SSH 钥匙

VM 用 SSH 公钥登录（不是密码）。两种选择：

### 方案 A：把办公室的私钥复制到家里电脑（最快）

把办公室那台电脑的 `~/.ssh/id_ed25519` 和 `~/.ssh/id_ed25519.pub`（或 `id_rsa` / `id_rsa.pub`）拷过来放进家里电脑的 `~/.ssh/`。

权限要对：
```bash
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

Windows 用 Git Bash，路径是 `C:\Users\你的用户名\.ssh\`。

### 方案 B：家里电脑生成新钥匙（更安全）

```bash
ssh-keygen -t ed25519 -C "home-laptop"
```

然后把生成的 `~/.ssh/id_ed25519.pub` 内容追加到 VM 的 `~/.ssh/authorized_keys`：

```bash
# 一句搞定（先用密码或现有 key 登一次 VM）
ssh-copy-id -i ~/.ssh/id_ed25519.pub showbox@debian
```

不行的话手动：把 `id_ed25519.pub` 内容贴到 VM 上 `~showbox/.ssh/authorized_keys` 末尾，一行一个 key。

### 验证

```bash
ssh showbox@debian 'whoami; hostname; date'
```

应该不问密码，直接返回：
```
showbox
debian
Sun May  3 18:50:00 EDT 2026
```

✅ 能返回就代表网络 + SSH 都通了。

---

## 4. 拉代码

选个目录（比如 `D:\Projects` 或 `~/Projects`），克隆仓库：

```bash
cd ~/Projects
git clone https://github.com/showbox88/Music-Station.git
cd Music-Station
npm install
```

Git 第一次推送可能要登录 GitHub。建议用 **GitHub CLI**：

```bash
# 装 gh: https://cli.github.com/
gh auth login
```

或者用 SSH 推送（把家里电脑 SSH 公钥加到 GitHub Settings → SSH keys，然后改 remote）：

```bash
git remote set-url origin git@github.com:showbox88/Music-Station.git
```

---

## 5. 开发循环（最重要的一段）

每次改代码的标准流程：

```bash
# 1. 拉最新（防止跟办公室那边冲突）
git pull

# 2. 改代码

# 3. 本地构建验证（可选但推荐）
npm run build

# 4. 提交 + 推送
git add -A
git commit -m "你的提交说明"
git push

# 5. 部署到 VM
ssh showbox@debian 'sudo /opt/music-station/deploy.sh'
```

部署脚本会：
- 在 VM 上 `git pull`
- `npm install`
- `npm run build`
- `systemctl restart music-station`
- 健康检查

你看到 `==> [music-station] done` 就代表线上更新好了。

---

## 6. 验证线上

部署完打开浏览器：

- **公网（所有设备都能访问）**：<https://debian.tail4cfa2.ts.net/app/>
- **办公室局域网**：<http://192.168.1.16/>（家里访问不到这个）
- **Tailscale 网内**：<http://debian/app/> （需家里电脑装了 Tailscale）

---

## 7. 常用命令速查

```bash
# 查看 VM 服务状态
ssh showbox@debian 'systemctl status music-station --no-pager'

# 看实时日志
ssh showbox@debian 'sudo journalctl -u music-station -f'

# 查看 VM 上磁盘占用
ssh showbox@debian 'df -h /opt'

# 强制重新扫描音乐库（如果直接往 /opt/music 拖了文件）
ssh showbox@debian 'curl -X POST http://127.0.0.1:3002/api/status/rescan'

# 一行命令：commit + push + deploy（PowerShell / Git Bash 都行）
git add -A && git commit -m "msg" && git push && ssh showbox@debian 'sudo /opt/music-station/deploy.sh'
```

---

## 8. 故障排查

**`ssh: Could not resolve hostname debian`**
→ Tailscale 没启动 / 没登录。打开 Tailscale 客户端检查。

**`Permission denied (publickey)`**
→ SSH key 没装好。检查 `~/.ssh/id_ed25519` 是否存在、权限是否 600，或者 VM 上 `~/.ssh/authorized_keys` 是否有你这台机器的 pub key。

**`sudo: a password is required`**
→ 不应该出现。`deploy.sh` 在 VM 的 sudoers 里有 NOPASSWD 配置。如果出现说明 VM 配置变了，要去 VM 上看 `/etc/sudoers.d/`。

**部署成功但浏览器看不到改动**
→ 浏览器有缓存。**Ctrl+Shift+R**（Mac: **Cmd+Shift+R**）硬刷新。

**Git push 失败：authentication required**
→ 看第 4 节最下面，用 gh auth login 或换成 SSH remote。

---

## 9. 记忆点

- VM 名字：**`debian`**（Tailscale MagicDNS）
- 用户：**`showbox`**
- 部署一行命令：**`ssh showbox@debian 'sudo /opt/music-station/deploy.sh'`**
- 公网访问：**<https://debian.tail4cfa2.ts.net/app/>**

只要 Tailscale 是绿的，家里和办公室体验完全一样。
