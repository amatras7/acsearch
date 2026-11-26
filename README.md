# 文献索引 · acsearch

独立实现的静态文献日报。按期刊 ISSN 从 Crossref 获取近 30 天发表或首次登记的记录，部分期刊用 PubMed 补收录日和文章类型。按 DOI 去重，缺少 DOI 时按 PMID。页面一次查看一天，关键词只筛选当日记录。选择出版方后，结果按具体期刊分栏，每栏可以展开或收起。在 `journals.json` 中通过 `group` 设置出版方，通过 `pubmed` 设置需要补查的 PubMed 刊名。

「发表日」采用来源提供的完整发表日期。没有日级日期的记录仍可通过「新收录」浏览。收录日优先采用 PubMed 入库日，其余使用 Crossref 首次登记日。列表会显示来源能判断的类型，细分类缺失时显示「期刊文章」。

## 本地运行

```sh
python scripts/update.py
python -m http.server 8765 --directory site
```

浏览器打开 `http://localhost:8765/`。可设置环境变量 `CROSSREF_EMAIL` 使用 Crossref polite pool。

## GitHub Pages

将项目推送到 GitHub 仓库的 `main`，在 **Settings → Pages → Source** 选择 **GitHub Actions**，再从 **Actions → Update and publish literature** 手动运行一次。工作流默认每小时（UTC 每小时 17 分）重新抓取并发布 `site/`；抓到的数据不写回仓库，仓库体积基本不变。每月会自动提交一个心跳文件，避免 GitHub 在 60 天无活动后停掉定时任务。可在仓库变量中配置 `CROSSREF_EMAIL`。

单刊请求失败时保留该刊在窗口内的上一次数据，并在页面显示来源未更新。所有期刊失败时保留现有发布。

## easyScholar 期刊指标

登录 easyScholar 官网后，在用户后台的「开放接口」中获取密钥。在论文详情里展开「连接 easyScholar」，输入密钥后即可按期刊查询接口返回的分区和影响因子。密钥和查询缓存仅保留在当前页面内存中，刷新或断开后需要重新连接。查询由浏览器直接发往 easyScholar 官方接口。
