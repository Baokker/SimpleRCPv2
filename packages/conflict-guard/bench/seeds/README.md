# D1 种子项目

这些目录提供七个无外部依赖的 TypeScript 项目：电商配送、库存仓储、订阅计费、日程提醒、事件重试、令牌权限与文档布局。每个项目有七个源文件和两份 `node:test` 文件，包含原有业务、计量规则、调用方、状态记录、类型与导出入口。

生成器通过 TypeScript AST 与 semantic index 选取满足前提的声明和调用方。四种状态保留项目的原始源码，算子修改具体的参数、返回字段、计算表达式、状态写入或调用参数。`node --experimental-strip-types --test bench/seeds/*/test/*.test.mjs` 运行全部种子测试；标注时，每次状态探针同时执行该项目的全部测试。

项目集合由固定种子选择，约 40% 用于开发集，其他项目用于保留集。`SS` 与 `EB` 两个完整算子族仅出现在保留集。保留集可生成和标注，策略评价留到配置冻结之后。

清单中的 `seedPrograms` 为原始项目数，`uniquePrograms` 为四种状态所有完整程序的 SHA-256 去重数量，`uniqueVariantPrograms` 为四种状态组合的去重数量。`developmentHoldoutOverlap` 比较开发集与保留集的全部程序，必须为零。
