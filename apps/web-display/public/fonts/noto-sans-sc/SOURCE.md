# Noto Sans SC 子集（MSDF）

- 字体：Noto Sans SC Regular，noto-cjk 标签 `Sans2.004`
- 下载：<https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf>
- 许可：SIL Open Font License 1.1，原文见同目录 `LICENSE`（取自 <https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE>）
- 校验：源文件与许可证的 sha256 记录在 `scripts/fonts/sources.json`，生成脚本下载后逐一核对

本目录的 `noto-sans-sc-32.json` 与 `noto-sans-sc-32.png` 是由上述字体生成的修改版本（字形子集、32px 多通道距离场图集），
按 OFL 随附许可证分发，不单独出售。

字符集为 `scripts/fonts/charset.txt`：可打印 ASCII、常用中英文标点、回退符 `□`、`scripts/fonts/common-hanzi.txt` 的
1000 个常用汉字，以及源码与测试里出现的全部中文字面量。重新生成：

```sh
npm ci --ignore-scripts --prefix scripts/fonts
node scripts/fonts/generate-sc-font.ts
```
